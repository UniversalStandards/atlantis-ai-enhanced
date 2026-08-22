export type DurableAppendOutcomeKind =
  | "committed"
  | "conflict"
  | "known-failure"
  | "uncertain";

export type DurableAppendReconciliationState =
  | "pending"
  | "committed"
  | "known-failure"
  | "conflict"
  | "quarantined";

export interface DurableAppendIdentity {
  readonly operationId: string;
  readonly executionId: string;
  readonly eventId: string;
  readonly expectedStreamVersion: number;
  readonly contentDigest: string;
}

export interface DurableAppendOutcome {
  readonly kind: DurableAppendOutcomeKind;
  readonly identity: DurableAppendIdentity;
  readonly providerOperationId?: string;
  readonly evidenceId: string;
}

export interface DurableAppendUncertaintyRecord {
  readonly identity: DurableAppendIdentity;
  readonly firstAttemptEpochMs: number;
  readonly lastAttemptEpochMs: number;
  readonly providerOperationId?: string;
  readonly reconciliationState: DurableAppendReconciliationState;
  readonly retryCount: number;
  readonly lastObservedEvidenceId: string;
  readonly quarantineReason?: string;
}

export interface DurableAppendAuthoritativeReadback {
  readonly operationId: string;
  readonly evidenceId: string;
  readonly status: "exact-commit" | "absent-known-not-committed" | "conflict" | "ambiguous";
  readonly executionId: string;
  readonly eventId: string;
  readonly streamVersion?: number;
  readonly contentDigest?: string;
}

export class InvalidDurableAppendEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidDurableAppendEvidenceError";
  }
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidDurableAppendEvidenceError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function safeNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InvalidDurableAppendEvidenceError(`${field} must be a non-negative safe integer`);
  }
  return value as number;
}

function reconciliationState(value: unknown): DurableAppendReconciliationState {
  switch (value) {
    case "pending":
    case "committed":
    case "known-failure":
    case "conflict":
    case "quarantined":
      return value;
    default:
      throw new InvalidDurableAppendEvidenceError("reconciliationState must be a supported value");
  }
}

function validateIdentity(identity: DurableAppendIdentity): Readonly<DurableAppendIdentity> {
  return Object.freeze({
    operationId: nonBlank(identity.operationId, "operationId"),
    executionId: nonBlank(identity.executionId, "executionId"),
    eventId: nonBlank(identity.eventId, "eventId"),
    expectedStreamVersion: safeNonNegativeInteger(identity.expectedStreamVersion, "expectedStreamVersion"),
    contentDigest: nonBlank(identity.contentDigest, "contentDigest"),
  });
}

export function validateDurableAppendUncertaintyRecord(
  record: DurableAppendUncertaintyRecord,
): Readonly<DurableAppendUncertaintyRecord> {
  const identity = validateIdentity(record.identity);
  const firstAttemptEpochMs = safeNonNegativeInteger(record.firstAttemptEpochMs, "firstAttemptEpochMs");
  const lastAttemptEpochMs = safeNonNegativeInteger(record.lastAttemptEpochMs, "lastAttemptEpochMs");
  if (lastAttemptEpochMs < firstAttemptEpochMs) {
    throw new InvalidDurableAppendEvidenceError("lastAttemptEpochMs must not precede firstAttemptEpochMs");
  }
  const validatedReconciliationState = reconciliationState(record.reconciliationState);
  const retryCount = safeNonNegativeInteger(record.retryCount, "retryCount");
  const lastObservedEvidenceId = nonBlank(record.lastObservedEvidenceId, "lastObservedEvidenceId");
  const providerOperationId = record.providerOperationId === undefined
    ? undefined
    : nonBlank(record.providerOperationId, "providerOperationId");
  const quarantineReason = record.quarantineReason === undefined
    ? undefined
    : nonBlank(record.quarantineReason, "quarantineReason");
  if (validatedReconciliationState === "quarantined" && quarantineReason === undefined) {
    throw new InvalidDurableAppendEvidenceError("quarantined uncertainty requires quarantineReason");
  }
  if (validatedReconciliationState !== "quarantined" && quarantineReason !== undefined) {
    throw new InvalidDurableAppendEvidenceError("quarantineReason is valid only for quarantined uncertainty");
  }
  return Object.freeze({
    identity,
    firstAttemptEpochMs,
    lastAttemptEpochMs,
    reconciliationState: validatedReconciliationState,
    retryCount,
    lastObservedEvidenceId,
    ...(providerOperationId === undefined ? {} : { providerOperationId }),
    ...(quarantineReason === undefined ? {} : { quarantineReason }),
  });
}

export function reconcileDurableAppendUncertainty(
  record: DurableAppendUncertaintyRecord,
  readback: DurableAppendAuthoritativeReadback,
): Readonly<DurableAppendUncertaintyRecord> {
  const current = validateDurableAppendUncertaintyRecord(record);
  const operationId = nonBlank(readback.operationId, "readback.operationId");
  const evidenceId = nonBlank(readback.evidenceId, "readback.evidenceId");
  const executionId = nonBlank(readback.executionId, "readback.executionId");
  const eventId = nonBlank(readback.eventId, "readback.eventId");
  if (operationId !== current.identity.operationId || executionId !== current.identity.executionId || eventId !== current.identity.eventId) {
    throw new InvalidDurableAppendEvidenceError("authoritative readback identity does not match uncertain operation");
  }

  let reconciliationState: DurableAppendReconciliationState;
  let quarantineReason: string | undefined;
  switch (readback.status) {
    case "exact-commit": {
      if (safeNonNegativeInteger(readback.streamVersion, "readback.streamVersion") !== current.identity.expectedStreamVersion + 1) {
        reconciliationState = "quarantined";
        quarantineReason = "committed event occupies an unexpected stream version";
        break;
      }
      if (nonBlank(readback.contentDigest, "readback.contentDigest") !== current.identity.contentDigest) {
        reconciliationState = "quarantined";
        quarantineReason = "committed event content digest differs from the attempted immutable event";
        break;
      }
      reconciliationState = "committed";
      break;
    }
    case "absent-known-not-committed":
      reconciliationState = "known-failure";
      break;
    case "conflict":
      reconciliationState = "conflict";
      break;
    case "ambiguous":
      reconciliationState = "pending";
      break;
    default:
      throw new InvalidDurableAppendEvidenceError("unsupported authoritative readback status");
  }

  return Object.freeze({
    identity: current.identity,
    firstAttemptEpochMs: current.firstAttemptEpochMs,
    lastAttemptEpochMs: current.lastAttemptEpochMs,
    reconciliationState,
    retryCount: current.retryCount,
    lastObservedEvidenceId: evidenceId,
    ...(current.providerOperationId === undefined ? {} : { providerOperationId: current.providerOperationId }),
    ...(quarantineReason === undefined ? {} : { quarantineReason }),
  });
}

import {
  normalizeExactDataRecord,
  requireExactDataFields,
  type ExactDataRecord,
} from "./exact-data-record.js";
import {
  InvalidPersistenceReconciliationEvidenceError,
  classifyPersistenceReconciliation,
  type ExpectedPersistenceEvent,
  type PersistenceReconciliationDecision,
  type PersistenceReconciliationEvidence,
} from "./production-persistence.js";

export type PersistenceUncertaintyStatus =
  | "pending"
  | "quarantined"
  | "resolved_committed"
  | "resolved_not_committed";

export interface PersistenceReconciliationAttempt {
  readonly attemptNumber: number;
  readonly attemptId: string;
  readonly observedAt: string;
  readonly reconciledAt: string;
  readonly decision: PersistenceReconciliationDecision;
  readonly providerObservationId?: string;
  readonly proofId?: string;
}

export interface PersistenceUncertaintyRecord {
  readonly recordId: string;
  readonly expected: ExpectedPersistenceEvent;
  readonly providerOperationId?: string;
  readonly firstObservedAt: string;
  readonly status: PersistenceUncertaintyStatus;
  readonly attempts: readonly PersistenceReconciliationAttempt[];
}

export interface CreatePersistenceUncertaintyRecordInput {
  readonly recordId: string;
  readonly expected: ExpectedPersistenceEvent;
  readonly providerOperationId?: string;
  readonly firstObservedAt: string;
}

export interface ReconcilePersistenceUncertaintyInput {
  readonly attemptId: string;
  readonly observedAt: string;
  /** Authoritative time at which ATLANTIS validated and consumed this evidence. */
  readonly reconciledAt: string;
  readonly providerObservationId?: string;
  readonly evidence: PersistenceReconciliationEvidence;
}

export class InvalidPersistenceUncertaintyTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistenceUncertaintyTransitionError";
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      `${field} must be a non-empty string`,
    );
  }
}

function requireCanonicalTimestamp(value: string, field: string): void {
  requireNonEmpty(value, field);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      `${field} must be a canonical ISO-8601 UTC timestamp`,
    );
  }
}

function requireExpectedIdentity(event: ExpectedPersistenceEvent): void {
  requireNonEmpty(event.operationId, "expected.operationId");
  requireNonEmpty(event.executionId, "expected.executionId");
  requireNonEmpty(event.eventId, "expected.eventId");
  requireNonEmpty(event.contentDigest, "expected.contentDigest");
  if (!Number.isSafeInteger(event.streamVersion) || event.streamVersion < 1) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "expected.streamVersion must be a positive safe integer",
    );
  }
}

function sameExpectedIdentity(
  left: ExpectedPersistenceEvent,
  right: ExpectedPersistenceEvent,
): boolean {
  return left.operationId === right.operationId
    && left.executionId === right.executionId
    && left.eventId === right.eventId
    && left.streamVersion === right.streamVersion
    && left.contentDigest === right.contentDigest;
}

function freezeExpected(
  expected: ExpectedPersistenceEvent,
): ExpectedPersistenceEvent {
  return Object.freeze({ ...expected });
}

function normalizeLifecycleRecord(
  subject: string,
  value: unknown,
  allowedFields: readonly string[],
  requiredFields: readonly string[],
): ExactDataRecord {
  try {
    const record = normalizeExactDataRecord(subject, value, allowedFields);
    requireExactDataFields(subject, record, requiredFields);
    return record;
  } catch (error) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      error instanceof Error ? error.message : `${subject} is invalid`,
    );
  }
}

function normalizeReconcileInput(
  value: unknown,
): ReconcilePersistenceUncertaintyInput {
  const input = normalizeLifecycleRecord(
    "reconciliation input",
    value,
    [
      "attemptId",
      "observedAt",
      "reconciledAt",
      "providerObservationId",
      "evidence",
    ],
    ["attemptId", "observedAt", "reconciledAt", "evidence"],
  );

  return Object.freeze({
    attemptId: input.attemptId as string,
    observedAt: input.observedAt as string,
    reconciledAt: input.reconciledAt as string,
    ...(Object.prototype.hasOwnProperty.call(input, "providerObservationId")
      ? { providerObservationId: input.providerObservationId as string }
      : {}),
    evidence: input.evidence as PersistenceReconciliationEvidence,
  });
}

function nextStatus(
  decision: PersistenceReconciliationDecision,
): PersistenceUncertaintyStatus {
  switch (decision.kind) {
    case "committed":
      return "resolved_committed";
    case "retry_permitted":
      return "resolved_not_committed";
    case "conflict":
      return "quarantined";
    case "uncertain":
      return "pending";
  }
}

/** Creates an immutable provider-neutral uncertainty record for one exact append. */
export function createPersistenceUncertaintyRecord(
  input: CreatePersistenceUncertaintyRecordInput,
): PersistenceUncertaintyRecord {
  requireNonEmpty(input.recordId, "recordId");
  requireExpectedIdentity(input.expected);
  requireCanonicalTimestamp(input.firstObservedAt, "firstObservedAt");
  if (input.providerOperationId !== undefined) {
    requireNonEmpty(input.providerOperationId, "providerOperationId");
  }

  return Object.freeze({
    recordId: input.recordId,
    expected: freezeExpected(input.expected),
    ...(input.providerOperationId === undefined
      ? {}
      : { providerOperationId: input.providerOperationId }),
    firstObservedAt: input.firstObservedAt,
    status: "pending" as const,
    attempts: Object.freeze([]),
  });
}

/**
 * Applies one authoritative reconciliation attempt. Retry-authorizing proof is
 * bound to this exact uncertainty record and provider operation, and the audit
 * observation identity/time must exactly match the proof that authorized it.
 * Proof validity is enforced against the distinct authoritative consumption
 * time rather than the provider's own observation timestamp. Authorization-
 * bearing reconciliation evidence and the lifecycle input envelope are
 * structurally normalized before nested or authorization-bearing fields are
 * read.
 */
export function reconcilePersistenceUncertainty(
  record: PersistenceUncertaintyRecord,
  input: ReconcilePersistenceUncertaintyInput,
): PersistenceUncertaintyRecord {
  if (record.status !== "pending") {
    throw new InvalidPersistenceUncertaintyTransitionError(
      `cannot reconcile a ${record.status} uncertainty record`,
    );
  }

  const normalizedInput = normalizeReconcileInput(input);

  requireNonEmpty(normalizedInput.attemptId, "attemptId");
  requireCanonicalTimestamp(normalizedInput.observedAt, "observedAt");
  requireCanonicalTimestamp(normalizedInput.reconciledAt, "reconciledAt");
  if (normalizedInput.providerObservationId !== undefined) {
    requireNonEmpty(normalizedInput.providerObservationId, "providerObservationId");
  }
  if (normalizedInput.observedAt < record.firstObservedAt) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "observedAt cannot precede firstObservedAt",
    );
  }
  if (normalizedInput.reconciledAt < record.firstObservedAt) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "reconciledAt cannot precede firstObservedAt",
    );
  }
  if (normalizedInput.reconciledAt < normalizedInput.observedAt) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "reconciledAt cannot precede observedAt",
    );
  }
  if (record.attempts.some((attempt) => attempt.attemptId === normalizedInput.attemptId)) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "attemptId must be unique within the uncertainty record",
    );
  }

  let decision: PersistenceReconciliationDecision;
  try {
    decision = classifyPersistenceReconciliation(normalizedInput.evidence, {
      decisionAt: normalizedInput.reconciledAt,
    });
  } catch (error) {
    if (error instanceof InvalidPersistenceReconciliationEvidenceError) {
      throw new InvalidPersistenceUncertaintyTransitionError(error.message);
    }
    throw error;
  }

  if (!sameExpectedIdentity(record.expected, normalizedInput.evidence.expected)) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "reconciliation evidence must match the uncertainty record append identity",
    );
  }

  const proof = normalizedInput.evidence.nonCommitProof;
  if (proof !== undefined) {
    if (record.providerOperationId === undefined) {
      throw new InvalidPersistenceUncertaintyTransitionError(
        "retry-authorizing proof requires a stored providerOperationId",
      );
    }
    if (proof.uncertaintyRecordId !== record.recordId) {
      throw new InvalidPersistenceUncertaintyTransitionError(
        "nonCommitProof must be bound to this uncertainty record",
      );
    }
    if (proof.providerOperationId !== record.providerOperationId) {
      throw new InvalidPersistenceUncertaintyTransitionError(
        "nonCommitProof must match the stored provider operation",
      );
    }
    if (normalizedInput.providerObservationId !== proof.providerObservationId) {
      throw new InvalidPersistenceUncertaintyTransitionError(
        "attempt providerObservationId must exactly match nonCommitProof",
      );
    }
    if (normalizedInput.observedAt !== proof.observedAt) {
      throw new InvalidPersistenceUncertaintyTransitionError(
        "attempt observedAt must exactly match nonCommitProof",
      );
    }
    if (proof.observedAt < record.firstObservedAt) {
      throw new InvalidPersistenceUncertaintyTransitionError(
        "nonCommitProof cannot predate the uncertainty record",
      );
    }
    if (normalizedInput.reconciledAt > proof.validUntil) {
      throw new InvalidPersistenceUncertaintyTransitionError(
        "nonCommitProof is expired at reconciliation time",
      );
    }
    if (record.attempts.some((attempt) => attempt.proofId === proof.proofId)) {
      throw new InvalidPersistenceUncertaintyTransitionError(
        "nonCommitProof proofId has already been used",
      );
    }
  }

  const attempt = Object.freeze({
    attemptNumber: record.attempts.length + 1,
    attemptId: normalizedInput.attemptId,
    observedAt: normalizedInput.observedAt,
    reconciledAt: normalizedInput.reconciledAt,
    decision,
    ...(normalizedInput.providerObservationId === undefined
      ? {}
      : { providerObservationId: normalizedInput.providerObservationId }),
    ...(proof === undefined ? {} : { proofId: proof.proofId }),
  });

  return Object.freeze({
    ...record,
    status: nextStatus(decision),
    attempts: Object.freeze([...record.attempts, attempt]),
  });
}

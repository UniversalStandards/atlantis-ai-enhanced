import {
  normalizeExactDataRecord,
  requireExactDataFields,
  type ExactDataRecord,
} from "./exact-data-record.js";

export interface ExpectedRecoveryOwnershipIdentity {
  readonly recoveryId: string;
  readonly executionId: string;
  readonly ownerId: string;
}

/**
 * Provider-neutral evidence that one recovery worker currently holds an
 * exclusive recovery lease for one execution. Provider-specific atomic
 * acquisition, renewal, expiry enforcement, fairness, crash recovery, and
 * fencing semantics remain obligations of the real persistence adapter.
 *
 * ownershipToken is authority-bearing material and MUST NOT be emitted into
 * traces, logs, or general diagnostic evidence.
 */
export interface RecoveryOwnershipLeaseEvidence {
  readonly claimId: string;
  readonly recoveryId: string;
  readonly executionId: string;
  readonly ownerId: string;
  readonly ownershipToken: string;
  readonly fence: number;
  readonly acquiredAtEpochMs: number;
  readonly expiresAtEpochMs: number;
}

/**
 * Safe diagnostic projection of verified recovery ownership evidence.
 * Authority-bearing ownershipToken is deliberately absent.
 */
export interface RecoveryOwnershipDiagnosticEvidence {
  readonly claimId: string;
  readonly recoveryId: string;
  readonly executionId: string;
  readonly ownerId: string;
  readonly fence: number;
  readonly acquiredAtEpochMs: number;
  readonly expiresAtEpochMs: number;
}

export class InvalidRecoveryOwnershipLeaseEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRecoveryOwnershipLeaseEvidenceError";
  }
}

function normalizeRecord(
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
    if (error instanceof InvalidRecoveryOwnershipLeaseEvidenceError) {
      throw error;
    }
    throw new InvalidRecoveryOwnershipLeaseEvidenceError(
      error instanceof Error ? error.message : `${subject} is invalid`,
    );
  }
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidRecoveryOwnershipLeaseEvidenceError(
      `${field} must be a non-empty string`,
    );
  }
}

function requirePositiveSafeInteger(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new InvalidRecoveryOwnershipLeaseEvidenceError(
      `${field} must be a positive safe integer`,
    );
  }
}

function requireNonNegativeSafeInteger(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidRecoveryOwnershipLeaseEvidenceError(
      `${field} must be a non-negative safe integer`,
    );
  }
}

function normalizeExpectedRecoveryOwnershipIdentity(
  value: unknown,
): ExpectedRecoveryOwnershipIdentity {
  const expected = normalizeRecord(
    "expected",
    value,
    ["recoveryId", "executionId", "ownerId"],
    ["recoveryId", "executionId", "ownerId"],
  );

  requireNonEmpty(expected.recoveryId, "expected.recoveryId");
  requireNonEmpty(expected.executionId, "expected.executionId");
  requireNonEmpty(expected.ownerId, "expected.ownerId");

  return Object.freeze({
    recoveryId: expected.recoveryId,
    executionId: expected.executionId,
    ownerId: expected.ownerId,
  });
}

/**
 * Validates the minimum provider-neutral evidence shape that may authorize a
 * recovery worker to mutate recovery state. This validator proves structural
 * and identity binding only; the adapter acceptance harness must independently
 * prove that claim acquisition is atomic/exclusive, fences are monotonic across
 * ownership changes, expired/lost owners cannot mutate, renewals preserve
 * authority correctly, and restart/crash behavior is safe.
 */
export function verifyRecoveryOwnershipLeaseEvidence(
  expectedValue: ExpectedRecoveryOwnershipIdentity,
  evidenceValue: RecoveryOwnershipLeaseEvidence,
): Readonly<RecoveryOwnershipLeaseEvidence> {
  const expected = normalizeExpectedRecoveryOwnershipIdentity(expectedValue);
  const evidence = normalizeRecord(
    "evidence",
    evidenceValue,
    [
      "claimId",
      "recoveryId",
      "executionId",
      "ownerId",
      "ownershipToken",
      "fence",
      "acquiredAtEpochMs",
      "expiresAtEpochMs",
    ],
    [
      "claimId",
      "recoveryId",
      "executionId",
      "ownerId",
      "ownershipToken",
      "fence",
      "acquiredAtEpochMs",
      "expiresAtEpochMs",
    ],
  );

  requireNonEmpty(evidence.claimId, "evidence.claimId");
  requireNonEmpty(evidence.recoveryId, "evidence.recoveryId");
  requireNonEmpty(evidence.executionId, "evidence.executionId");
  requireNonEmpty(evidence.ownerId, "evidence.ownerId");
  requireNonEmpty(evidence.ownershipToken, "evidence.ownershipToken");
  requirePositiveSafeInteger(evidence.fence, "evidence.fence");
  requireNonNegativeSafeInteger(
    evidence.acquiredAtEpochMs,
    "evidence.acquiredAtEpochMs",
  );
  requireNonNegativeSafeInteger(
    evidence.expiresAtEpochMs,
    "evidence.expiresAtEpochMs",
  );

  if (
    evidence.recoveryId !== expected.recoveryId ||
    evidence.executionId !== expected.executionId ||
    evidence.ownerId !== expected.ownerId
  ) {
    throw new InvalidRecoveryOwnershipLeaseEvidenceError(
      "evidence must be bound to the exact admitted recovery ownership identity",
    );
  }

  if (evidence.expiresAtEpochMs <= evidence.acquiredAtEpochMs) {
    throw new InvalidRecoveryOwnershipLeaseEvidenceError(
      "evidence.expiresAtEpochMs must be greater than evidence.acquiredAtEpochMs",
    );
  }

  return Object.freeze({
    claimId: evidence.claimId,
    recoveryId: evidence.recoveryId,
    executionId: evidence.executionId,
    ownerId: evidence.ownerId,
    ownershipToken: evidence.ownershipToken,
    fence: evidence.fence,
    acquiredAtEpochMs: evidence.acquiredAtEpochMs,
    expiresAtEpochMs: evidence.expiresAtEpochMs,
  });
}

/**
 * Produces the only general-purpose diagnostic projection of recovery ownership
 * evidence. The input is fully re-verified first, then copied into a frozen
 * object that cannot contain the authority-bearing ownershipToken.
 */
export function toRecoveryOwnershipDiagnosticEvidence(
  expectedValue: ExpectedRecoveryOwnershipIdentity,
  evidenceValue: RecoveryOwnershipLeaseEvidence,
): Readonly<RecoveryOwnershipDiagnosticEvidence> {
  const verified = verifyRecoveryOwnershipLeaseEvidence(
    expectedValue,
    evidenceValue,
  );

  return Object.freeze({
    claimId: verified.claimId,
    recoveryId: verified.recoveryId,
    executionId: verified.executionId,
    ownerId: verified.ownerId,
    fence: verified.fence,
    acquiredAtEpochMs: verified.acquiredAtEpochMs,
    expiresAtEpochMs: verified.expiresAtEpochMs,
  });
}

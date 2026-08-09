import {
  normalizeExactDataRecord,
  requireExactDataFields,
  type ExactDataRecord,
} from "./exact-data-record.js";

export interface ExpectedRecoveryOwnershipFenceTransition {
  readonly recoveryId: string;
  readonly executionId: string;
  readonly previousFence: number;
}

/**
 * Provider-neutral evidence that recovery ownership advanced to a strictly
 * newer fencing epoch. This contract intentionally does not define acquisition,
 * renewal, expiry, fairness, storage, or provider-specific locking semantics.
 * Those remain obligations of the real persistence adapter and acceptance
 * harness.
 */
export interface RecoveryOwnershipFenceTransitionEvidence {
  readonly transitionId: string;
  readonly recoveryId: string;
  readonly executionId: string;
  readonly previousClaimId: string;
  readonly nextClaimId: string;
  readonly previousOwnerId: string;
  readonly nextOwnerId: string;
  readonly previousFence: number;
  readonly nextFence: number;
  readonly observedAtEpochMs: number;
}

export class InvalidRecoveryOwnershipFenceTransitionEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRecoveryOwnershipFenceTransitionEvidenceError";
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
    if (error instanceof InvalidRecoveryOwnershipFenceTransitionEvidenceError) {
      throw error;
    }
    throw new InvalidRecoveryOwnershipFenceTransitionEvidenceError(
      error instanceof Error ? error.message : `${subject} is invalid`,
    );
  }
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidRecoveryOwnershipFenceTransitionEvidenceError(
      `${field} must be a non-empty string`,
    );
  }
}

function requirePositiveSafeInteger(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new InvalidRecoveryOwnershipFenceTransitionEvidenceError(
      `${field} must be a positive safe integer`,
    );
  }
}

function requireNonNegativeSafeInteger(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidRecoveryOwnershipFenceTransitionEvidenceError(
      `${field} must be a non-negative safe integer`,
    );
  }
}

function normalizeExpected(
  value: unknown,
): ExpectedRecoveryOwnershipFenceTransition {
  const expected = normalizeRecord(
    "expected",
    value,
    ["recoveryId", "executionId", "previousFence"],
    ["recoveryId", "executionId", "previousFence"],
  );

  requireNonEmpty(expected.recoveryId, "expected.recoveryId");
  requireNonEmpty(expected.executionId, "expected.executionId");
  requirePositiveSafeInteger(expected.previousFence, "expected.previousFence");

  return Object.freeze({
    recoveryId: expected.recoveryId,
    executionId: expected.executionId,
    previousFence: expected.previousFence,
  });
}

/**
 * Verifies evidence that one recovery ownership epoch has advanced beyond a
 * known fencing epoch. A successful verification proves exact recovery and
 * execution binding plus strict fence monotonicity only. It does not prove that
 * a lease was atomically acquired, that an old owner has stopped running, or
 * that a provider rejects stale writes; those properties require adapter-level
 * contention and restart tests.
 */
export function verifyRecoveryOwnershipFenceTransitionEvidence(
  expectedValue: ExpectedRecoveryOwnershipFenceTransition,
  evidenceValue: RecoveryOwnershipFenceTransitionEvidence,
): Readonly<RecoveryOwnershipFenceTransitionEvidence> {
  const expected = normalizeExpected(expectedValue);
  const evidence = normalizeRecord(
    "evidence",
    evidenceValue,
    [
      "transitionId",
      "recoveryId",
      "executionId",
      "previousClaimId",
      "nextClaimId",
      "previousOwnerId",
      "nextOwnerId",
      "previousFence",
      "nextFence",
      "observedAtEpochMs",
    ],
    [
      "transitionId",
      "recoveryId",
      "executionId",
      "previousClaimId",
      "nextClaimId",
      "previousOwnerId",
      "nextOwnerId",
      "previousFence",
      "nextFence",
      "observedAtEpochMs",
    ],
  );

  requireNonEmpty(evidence.transitionId, "evidence.transitionId");
  requireNonEmpty(evidence.recoveryId, "evidence.recoveryId");
  requireNonEmpty(evidence.executionId, "evidence.executionId");
  requireNonEmpty(evidence.previousClaimId, "evidence.previousClaimId");
  requireNonEmpty(evidence.nextClaimId, "evidence.nextClaimId");
  requireNonEmpty(evidence.previousOwnerId, "evidence.previousOwnerId");
  requireNonEmpty(evidence.nextOwnerId, "evidence.nextOwnerId");
  requirePositiveSafeInteger(evidence.previousFence, "evidence.previousFence");
  requirePositiveSafeInteger(evidence.nextFence, "evidence.nextFence");
  requireNonNegativeSafeInteger(
    evidence.observedAtEpochMs,
    "evidence.observedAtEpochMs",
  );

  if (
    evidence.recoveryId !== expected.recoveryId ||
    evidence.executionId !== expected.executionId ||
    evidence.previousFence !== expected.previousFence
  ) {
    throw new InvalidRecoveryOwnershipFenceTransitionEvidenceError(
      "evidence must be bound to the exact admitted recovery ownership epoch",
    );
  }

  if (evidence.nextFence <= evidence.previousFence) {
    throw new InvalidRecoveryOwnershipFenceTransitionEvidenceError(
      "evidence.nextFence must be strictly greater than evidence.previousFence",
    );
  }

  return Object.freeze({
    transitionId: evidence.transitionId,
    recoveryId: evidence.recoveryId,
    executionId: evidence.executionId,
    previousClaimId: evidence.previousClaimId,
    nextClaimId: evidence.nextClaimId,
    previousOwnerId: evidence.previousOwnerId,
    nextOwnerId: evidence.nextOwnerId,
    previousFence: evidence.previousFence,
    nextFence: evidence.nextFence,
    observedAtEpochMs: evidence.observedAtEpochMs,
  });
}

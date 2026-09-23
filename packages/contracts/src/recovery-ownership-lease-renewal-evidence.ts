import {
  verifyRecoveryOwnershipLeaseEvidence,
  type ExpectedRecoveryOwnershipIdentity,
  type RecoveryOwnershipLeaseEvidence,
} from "./recovery-ownership-lease-evidence.js";

export class InvalidRecoveryOwnershipLeaseRenewalEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRecoveryOwnershipLeaseRenewalEvidenceError";
  }
}

function asRenewalError(error: unknown): InvalidRecoveryOwnershipLeaseRenewalEvidenceError {
  if (error instanceof InvalidRecoveryOwnershipLeaseRenewalEvidenceError) {
    return error;
  }

  return new InvalidRecoveryOwnershipLeaseRenewalEvidenceError(
    error instanceof Error ? error.message : "recovery ownership lease renewal evidence is invalid",
  );
}

/**
 * Verifies that one already-admitted recovery ownership claim was renewed
 * without changing its authority identity or fencing epoch.
 *
 * This contract proves renewal continuity only. Atomic renewal, expiry checks,
 * stale-owner rejection, provider locking, persistence, and crash/restart
 * behavior remain obligations of the real recovery ownership adapter and its
 * acceptance harness.
 */
export function verifyRecoveryOwnershipLeaseRenewalEvidence(
  expectedValue: ExpectedRecoveryOwnershipIdentity,
  previousValue: RecoveryOwnershipLeaseEvidence,
  renewedValue: RecoveryOwnershipLeaseEvidence,
): Readonly<RecoveryOwnershipLeaseEvidence> {
  try {
    const previous = verifyRecoveryOwnershipLeaseEvidence(
      expectedValue,
      previousValue,
    );
    const renewed = verifyRecoveryOwnershipLeaseEvidence(
      expectedValue,
      renewedValue,
    );

    if (renewed.claimId !== previous.claimId) {
      throw new InvalidRecoveryOwnershipLeaseRenewalEvidenceError(
        "renewed evidence must preserve the exact ownership claim identity",
      );
    }

    if (renewed.ownershipToken !== previous.ownershipToken) {
      throw new InvalidRecoveryOwnershipLeaseRenewalEvidenceError(
        "renewed evidence must preserve the exact ownership authority token",
      );
    }

    if (renewed.fence !== previous.fence) {
      throw new InvalidRecoveryOwnershipLeaseRenewalEvidenceError(
        "renewed evidence must preserve the existing fencing epoch",
      );
    }

    if (renewed.acquiredAtEpochMs !== previous.acquiredAtEpochMs) {
      throw new InvalidRecoveryOwnershipLeaseRenewalEvidenceError(
        "renewed evidence must preserve the original acquisition timestamp",
      );
    }

    if (renewed.expiresAtEpochMs <= previous.expiresAtEpochMs) {
      throw new InvalidRecoveryOwnershipLeaseRenewalEvidenceError(
        "renewed evidence must strictly extend the lease expiry",
      );
    }

    return Object.freeze({
      claimId: renewed.claimId,
      recoveryId: renewed.recoveryId,
      executionId: renewed.executionId,
      ownerId: renewed.ownerId,
      ownershipToken: renewed.ownershipToken,
      fence: renewed.fence,
      acquiredAtEpochMs: renewed.acquiredAtEpochMs,
      expiresAtEpochMs: renewed.expiresAtEpochMs,
    });
  } catch (error) {
    throw asRenewalError(error);
  }
}

import {
  verifyRecoveryOwnershipFenceTransitionEvidence,
  type RecoveryOwnershipFenceTransitionEvidence,
} from "./recovery-ownership-fence-transition-evidence.js";
import {
  toRecoveryOwnershipDiagnosticEvidence,
  verifyRecoveryOwnershipLeaseEvidence,
  type ExpectedRecoveryOwnershipIdentity,
  type RecoveryOwnershipDiagnosticEvidence,
  type RecoveryOwnershipLeaseEvidence,
} from "./recovery-ownership-lease-evidence.js";

/**
 * Token-safe, provider-neutral evidence that one verified recovery ownership
 * claim was superseded by a distinct verified claim in a strictly newer
 * fencing epoch. This composition boundary does not prove atomic acquisition,
 * expiry enforcement, stale-write rejection, fairness, persistence, or crash
 * recovery; those remain obligations of the real adapter acceptance harness.
 */
export interface RecoveryOwnershipReacquisitionEvidence {
  readonly previous: Readonly<RecoveryOwnershipDiagnosticEvidence>;
  readonly transition: Readonly<RecoveryOwnershipFenceTransitionEvidence>;
  readonly next: Readonly<RecoveryOwnershipDiagnosticEvidence>;
}

export class InvalidRecoveryOwnershipReacquisitionEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRecoveryOwnershipReacquisitionEvidenceError";
  }
}

/**
 * Composes already-defined lease and fence-transition evidence into one exact,
 * token-safe reacquisition proof. Both leases are independently verified
 * against caller-admitted identities before any cross-evidence comparison.
 * The returned object deliberately exposes diagnostic lease projections only,
 * so authority-bearing ownershipToken values cannot enter general evidence.
 */
export function verifyRecoveryOwnershipReacquisitionEvidence(
  previousExpected: ExpectedRecoveryOwnershipIdentity,
  previousEvidence: RecoveryOwnershipLeaseEvidence,
  nextExpected: ExpectedRecoveryOwnershipIdentity,
  nextEvidence: RecoveryOwnershipLeaseEvidence,
  transitionEvidence: RecoveryOwnershipFenceTransitionEvidence,
): Readonly<RecoveryOwnershipReacquisitionEvidence> {
  const previous = verifyRecoveryOwnershipLeaseEvidence(
    previousExpected,
    previousEvidence,
  );
  const next = verifyRecoveryOwnershipLeaseEvidence(nextExpected, nextEvidence);

  if (
    previous.recoveryId !== next.recoveryId ||
    previous.executionId !== next.executionId
  ) {
    throw new InvalidRecoveryOwnershipReacquisitionEvidenceError(
      "previous and next ownership evidence must describe the same recovery execution",
    );
  }

  if (previous.claimId === next.claimId) {
    throw new InvalidRecoveryOwnershipReacquisitionEvidenceError(
      "next ownership evidence must identify a distinct ownership claim",
    );
  }

  const transition = verifyRecoveryOwnershipFenceTransitionEvidence(
    {
      recoveryId: previous.recoveryId,
      executionId: previous.executionId,
      previousFence: previous.fence,
    },
    transitionEvidence,
  );

  if (
    transition.previousClaimId !== previous.claimId ||
    transition.nextClaimId !== next.claimId ||
    transition.previousOwnerId !== previous.ownerId ||
    transition.nextOwnerId !== next.ownerId ||
    transition.nextFence !== next.fence
  ) {
    throw new InvalidRecoveryOwnershipReacquisitionEvidenceError(
      "transition evidence must bind the exact previous and next ownership claims",
    );
  }

  const previousDiagnostic = toRecoveryOwnershipDiagnosticEvidence(
    previousExpected,
    previous,
  );
  const nextDiagnostic = toRecoveryOwnershipDiagnosticEvidence(nextExpected, next);

  return Object.freeze({
    previous: previousDiagnostic,
    transition,
    next: nextDiagnostic,
  });
}

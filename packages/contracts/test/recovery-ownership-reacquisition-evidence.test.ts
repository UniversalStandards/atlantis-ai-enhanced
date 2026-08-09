import { describe, expect, it } from "vitest";

import {
  InvalidRecoveryOwnershipReacquisitionEvidenceError,
  verifyRecoveryOwnershipReacquisitionEvidence,
} from "../src/recovery-ownership-reacquisition-evidence.js";

const previousExpected = {
  recoveryId: "recovery-1",
  executionId: "execution-1",
  ownerId: "worker-1",
} as const;

const nextExpected = {
  recoveryId: "recovery-1",
  executionId: "execution-1",
  ownerId: "worker-2",
} as const;

const previousLease = {
  claimId: "claim-1",
  recoveryId: previousExpected.recoveryId,
  executionId: previousExpected.executionId,
  ownerId: previousExpected.ownerId,
  ownershipToken: "secret-previous-token",
  fence: 7,
  acquiredAtEpochMs: 1000,
  expiresAtEpochMs: 2000,
} as const;

const nextLease = {
  claimId: "claim-2",
  recoveryId: nextExpected.recoveryId,
  executionId: nextExpected.executionId,
  ownerId: nextExpected.ownerId,
  ownershipToken: "secret-next-token",
  fence: 8,
  acquiredAtEpochMs: 2100,
  expiresAtEpochMs: 3100,
} as const;

const transition = {
  transitionId: "transition-1",
  recoveryId: previousExpected.recoveryId,
  executionId: previousExpected.executionId,
  previousClaimId: previousLease.claimId,
  nextClaimId: nextLease.claimId,
  previousOwnerId: previousLease.ownerId,
  nextOwnerId: nextLease.ownerId,
  previousFence: previousLease.fence,
  nextFence: nextLease.fence,
  observedAtEpochMs: 2150,
} as const;

describe("recovery ownership reacquisition evidence", () => {
  it("composes exact prior, transition, and next evidence into a frozen token-safe proof", () => {
    const verified = verifyRecoveryOwnershipReacquisitionEvidence(
      previousExpected,
      previousLease,
      nextExpected,
      nextLease,
      transition,
    );

    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.previous)).toBe(true);
    expect(Object.isFrozen(verified.transition)).toBe(true);
    expect(Object.isFrozen(verified.next)).toBe(true);
    expect(verified.previous).toMatchObject({ claimId: "claim-1", fence: 7 });
    expect(verified.next).toMatchObject({ claimId: "claim-2", fence: 8 });
    expect("ownershipToken" in verified.previous).toBe(false);
    expect("ownershipToken" in verified.next).toBe(false);
    expect(JSON.stringify(verified)).not.toContain("secret-previous-token");
    expect(JSON.stringify(verified)).not.toContain("secret-next-token");
  });

  it("rejects a transition that does not bind the exact next claim, owner, and fence", () => {
    for (const mismatchedTransition of [
      { ...transition, nextClaimId: "claim-3" },
      { ...transition, nextOwnerId: "worker-3" },
      { ...transition, nextFence: 9 },
    ]) {
      expect(() => verifyRecoveryOwnershipReacquisitionEvidence(
        previousExpected,
        previousLease,
        nextExpected,
        nextLease,
        mismatchedTransition,
      )).toThrowError(
        new InvalidRecoveryOwnershipReacquisitionEvidenceError(
          "transition evidence must bind the exact previous and next ownership claims",
        ),
      );
    }
  });

  it("rejects composition across different recovery executions", () => {
    const differentExpected = {
      recoveryId: "recovery-2",
      executionId: "execution-2",
      ownerId: "worker-2",
    } as const;
    const differentLease = {
      ...nextLease,
      recoveryId: differentExpected.recoveryId,
      executionId: differentExpected.executionId,
    };

    expect(() => verifyRecoveryOwnershipReacquisitionEvidence(
      previousExpected,
      previousLease,
      differentExpected,
      differentLease,
      transition,
    )).toThrowError(
      new InvalidRecoveryOwnershipReacquisitionEvidenceError(
        "previous and next ownership evidence must describe the same recovery execution",
      ),
    );
  });

  it("rejects reuse of the same ownership claim even when the fence advances", () => {
    const reusedClaimLease = {
      ...nextLease,
      claimId: previousLease.claimId,
    };

    expect(() => verifyRecoveryOwnershipReacquisitionEvidence(
      previousExpected,
      previousLease,
      nextExpected,
      reusedClaimLease,
      { ...transition, nextClaimId: previousLease.claimId },
    )).toThrowError(
      new InvalidRecoveryOwnershipReacquisitionEvidenceError(
        "next ownership evidence must identify a distinct ownership claim",
      ),
    );
  });

  it("inherits fail-closed stale-fence rejection from the transition verifier", () => {
    expect(() => verifyRecoveryOwnershipReacquisitionEvidence(
      previousExpected,
      previousLease,
      nextExpected,
      { ...nextLease, fence: previousLease.fence },
      { ...transition, nextFence: previousLease.fence },
    )).toThrow("evidence.nextFence must be strictly greater than evidence.previousFence");
  });

  it("rejects a transition observation that predates the next ownership acquisition", () => {
    expect(() => verifyRecoveryOwnershipReacquisitionEvidence(
      previousExpected,
      previousLease,
      nextExpected,
      nextLease,
      { ...transition, observedAtEpochMs: nextLease.acquiredAtEpochMs - 1 },
    )).toThrowError(
      new InvalidRecoveryOwnershipReacquisitionEvidenceError(
        "transition observation must not precede next ownership acquisition",
      ),
    );
  });
});

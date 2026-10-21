import { describe, expect, it } from "vitest";

import { verifyRecoveryOwnershipReacquisitionEvidence } from "../src/recovery-ownership-reacquisition-evidence.js";

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

describe("recovery ownership reacquisition transition binding", () => {
  it("inherits exact recovery, execution, and prior-fence binding from the transition verifier", () => {
    for (const mismatchedTransition of [
      { ...transition, recoveryId: "recovery-2" },
      { ...transition, executionId: "execution-2" },
      { ...transition, previousFence: previousLease.fence - 1 },
    ]) {
      expect(() =>
        verifyRecoveryOwnershipReacquisitionEvidence(
          previousExpected,
          previousLease,
          nextExpected,
          nextLease,
          mismatchedTransition,
        ),
      ).toThrow("evidence must be bound to the exact admitted recovery ownership epoch");
    }
  });
});

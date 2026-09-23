import { describe, expect, it } from "vitest";

import { verifyRecoveryOwnershipReacquisitionEvidence } from "../src/recovery-ownership-reacquisition-evidence.js";

const expected = {
  recoveryId: "recovery-1",
  executionId: "execution-1",
  ownerId: "worker-1",
} as const;

const previousLease = {
  claimId: "claim-1",
  recoveryId: expected.recoveryId,
  executionId: expected.executionId,
  ownerId: expected.ownerId,
  ownershipToken: "secret-previous-token",
  fence: 7,
  acquiredAtEpochMs: 1000,
  expiresAtEpochMs: 2000,
} as const;

const nextLease = {
  claimId: "claim-2",
  recoveryId: expected.recoveryId,
  executionId: expected.executionId,
  ownerId: expected.ownerId,
  ownershipToken: "secret-next-token",
  fence: 8,
  acquiredAtEpochMs: 2100,
  expiresAtEpochMs: 3100,
} as const;

const transition = {
  transitionId: "transition-1",
  recoveryId: expected.recoveryId,
  executionId: expected.executionId,
  previousClaimId: previousLease.claimId,
  nextClaimId: nextLease.claimId,
  previousOwnerId: expected.ownerId,
  nextOwnerId: expected.ownerId,
  previousFence: previousLease.fence,
  nextFence: nextLease.fence,
  observedAtEpochMs: 2150,
} as const;

describe("same-owner recovery ownership reacquisition", () => {
  it("accepts a distinct later claim by the same owner only in a newer fencing epoch", () => {
    const verified = verifyRecoveryOwnershipReacquisitionEvidence(
      expected,
      previousLease,
      expected,
      nextLease,
      transition,
    );

    expect(verified.previous).toMatchObject({
      ownerId: expected.ownerId,
      claimId: previousLease.claimId,
      fence: previousLease.fence,
    });
    expect(verified.next).toMatchObject({
      ownerId: expected.ownerId,
      claimId: nextLease.claimId,
      fence: nextLease.fence,
    });
    expect(verified.transition).toMatchObject({
      previousOwnerId: expected.ownerId,
      nextOwnerId: expected.ownerId,
      previousClaimId: previousLease.claimId,
      nextClaimId: nextLease.claimId,
      previousFence: previousLease.fence,
      nextFence: nextLease.fence,
    });
    expect("ownershipToken" in verified.previous).toBe(false);
    expect("ownershipToken" in verified.next).toBe(false);
    expect(JSON.stringify(verified)).not.toContain("secret-previous-token");
    expect(JSON.stringify(verified)).not.toContain("secret-next-token");
  });

  it("still rejects same-owner claim reuse even when the proposed fence advances", () => {
    expect(() =>
      verifyRecoveryOwnershipReacquisitionEvidence(
        expected,
        previousLease,
        expected,
        { ...nextLease, claimId: previousLease.claimId },
        { ...transition, nextClaimId: previousLease.claimId },
      ),
    ).toThrow("next ownership evidence must identify a distinct ownership claim");
  });
});

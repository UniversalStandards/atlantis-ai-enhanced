import { describe, expect, it } from "vitest";

import { verifyRecoveryOwnershipReacquisitionEvidence } from "../src/recovery-ownership-reacquisition-evidence.js";

describe("recovery ownership reacquisition input isolation", () => {
  it("retains a frozen token-safe snapshot when caller-owned inputs mutate after verification", () => {
    const previousExpected = {
      recoveryId: "recovery-1",
      executionId: "execution-1",
      ownerId: "worker-1",
    };
    const nextExpected = {
      recoveryId: "recovery-1",
      executionId: "execution-1",
      ownerId: "worker-2",
    };
    const previousLease = {
      claimId: "claim-1",
      recoveryId: "recovery-1",
      executionId: "execution-1",
      ownerId: "worker-1",
      ownershipToken: "secret-previous-token",
      fence: 7,
      acquiredAtEpochMs: 1000,
      expiresAtEpochMs: 2000,
    };
    const nextLease = {
      claimId: "claim-2",
      recoveryId: "recovery-1",
      executionId: "execution-1",
      ownerId: "worker-2",
      ownershipToken: "secret-next-token",
      fence: 8,
      acquiredAtEpochMs: 2100,
      expiresAtEpochMs: 3100,
    };
    const transition = {
      transitionId: "transition-1",
      recoveryId: "recovery-1",
      executionId: "execution-1",
      previousClaimId: "claim-1",
      nextClaimId: "claim-2",
      previousOwnerId: "worker-1",
      nextOwnerId: "worker-2",
      previousFence: 7,
      nextFence: 8,
      observedAtEpochMs: 2150,
    };

    const verified = verifyRecoveryOwnershipReacquisitionEvidence(
      previousExpected,
      previousLease,
      nextExpected,
      nextLease,
      transition,
    );

    previousExpected.recoveryId = "mutated-recovery";
    nextExpected.ownerId = "mutated-owner";
    previousLease.claimId = "mutated-previous-claim";
    previousLease.ownershipToken = "mutated-previous-token";
    previousLease.fence = 70;
    nextLease.claimId = "mutated-next-claim";
    nextLease.ownershipToken = "mutated-next-token";
    nextLease.fence = 80;
    transition.transitionId = "mutated-transition";
    transition.previousClaimId = "mutated-transition-previous";
    transition.nextClaimId = "mutated-transition-next";
    transition.nextFence = 800;

    expect(verified.previous).toMatchObject({
      claimId: "claim-1",
      recoveryId: "recovery-1",
      executionId: "execution-1",
      ownerId: "worker-1",
      fence: 7,
      acquiredAtEpochMs: 1000,
      expiresAtEpochMs: 2000,
    });
    expect(verified.transition).toEqual({
      transitionId: "transition-1",
      recoveryId: "recovery-1",
      executionId: "execution-1",
      previousClaimId: "claim-1",
      nextClaimId: "claim-2",
      previousOwnerId: "worker-1",
      nextOwnerId: "worker-2",
      previousFence: 7,
      nextFence: 8,
      observedAtEpochMs: 2150,
    });
    expect(verified.next).toMatchObject({
      claimId: "claim-2",
      recoveryId: "recovery-1",
      executionId: "execution-1",
      ownerId: "worker-2",
      fence: 8,
      acquiredAtEpochMs: 2100,
      expiresAtEpochMs: 3100,
    });

    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.previous)).toBe(true);
    expect(Object.isFrozen(verified.transition)).toBe(true);
    expect(Object.isFrozen(verified.next)).toBe(true);
    expect("ownershipToken" in verified.previous).toBe(false);
    expect("ownershipToken" in verified.next).toBe(false);

    const serialized = JSON.stringify(verified);
    expect(serialized).not.toContain("secret-previous-token");
    expect(serialized).not.toContain("secret-next-token");
    expect(serialized).not.toContain("mutated-previous-token");
    expect(serialized).not.toContain("mutated-next-token");
    expect(serialized).not.toContain("mutated-");
  });
});

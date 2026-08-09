import { describe, expect, it } from "vitest";

import { verifyRecoveryOwnershipReacquisitionEvidence } from "../src/recovery-ownership-reacquisition-evidence.js";

describe("recovery ownership reacquisition transition containment", () => {
  it("rejects accessor-backed transition identity without executing caller code", () => {
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
      recoveryId: "recovery-1",
      executionId: "execution-1",
      ownerId: "worker-1",
      ownershipToken: "secret-previous-token",
      fence: 7,
      acquiredAtEpochMs: 1000,
      expiresAtEpochMs: 2000,
    } as const;
    const nextLease = {
      claimId: "claim-2",
      recoveryId: "recovery-1",
      executionId: "execution-1",
      ownerId: "worker-2",
      ownershipToken: "secret-next-token",
      fence: 8,
      acquiredAtEpochMs: 2100,
      expiresAtEpochMs: 3100,
    } as const;

    let accessorExecutions = 0;
    const transition = {
      transitionId: "transition-1",
      executionId: "execution-1",
      previousClaimId: "claim-1",
      nextClaimId: "claim-2",
      previousOwnerId: "worker-1",
      nextOwnerId: "worker-2",
      previousFence: 7,
      nextFence: 8,
      observedAtEpochMs: 2150,
    } as Record<string, unknown>;
    Object.defineProperty(transition, "recoveryId", {
      enumerable: true,
      get() {
        accessorExecutions += 1;
        return "recovery-1";
      },
    });

    expect(() =>
      verifyRecoveryOwnershipReacquisitionEvidence(
        previousExpected,
        previousLease,
        nextExpected,
        nextLease,
        transition as never,
      ),
    ).toThrow("evidence.recoveryId must be a data property");
    expect(accessorExecutions).toBe(0);
  });
});

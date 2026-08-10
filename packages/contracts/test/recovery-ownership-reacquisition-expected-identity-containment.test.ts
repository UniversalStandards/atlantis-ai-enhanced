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
} as const;

describe("recovery ownership reacquisition expected identity containment", () => {
  it("rejects accessor-backed admitted identity fields without executing caller code", () => {
    for (const side of ["previous", "next"] as const) {
      const expected = side === "previous" ? previousExpected : nextExpected;

      for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
        let accessorExecutions = 0;
        const accessorBackedExpected = { ...expected } as Record<string, unknown>;
        delete accessorBackedExpected[field];
        Object.defineProperty(accessorBackedExpected, field, {
          enumerable: true,
          get() {
            accessorExecutions += 1;
            return expected[field];
          },
        });

        expect(() =>
          verifyRecoveryOwnershipReacquisitionEvidence(
            side === "previous" ? (accessorBackedExpected as never) : previousExpected,
            previousLease,
            side === "next" ? (accessorBackedExpected as never) : nextExpected,
            nextLease,
            transition,
          ),
        ).toThrow(`expected.${field} must be an enumerable data property`);
        expect(accessorExecutions).toBe(0);
      }
    }
  });
});

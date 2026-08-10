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

describe("recovery ownership reacquisition transition containment", () => {
  it("rejects every accessor-backed transition field without executing caller code", () => {
    for (const field of Object.keys(transition) as Array<keyof typeof transition>) {
      let accessorExecutions = 0;
      const accessorBackedTransition = { ...transition } as Record<string, unknown>;
      delete accessorBackedTransition[field];
      Object.defineProperty(accessorBackedTransition, field, {
        enumerable: true,
        get() {
          accessorExecutions += 1;
          return transition[field];
        },
      });

      expect(() =>
        verifyRecoveryOwnershipReacquisitionEvidence(
          previousExpected,
          previousLease,
          nextExpected,
          nextLease,
          accessorBackedTransition as never,
        ),
      ).toThrow(`evidence.${field} must be an enumerable data property`);
      expect(accessorExecutions).toBe(0);
    }
  });

  it("rejects every non-enumerable required transition field", () => {
    for (const field of Object.keys(transition) as Array<keyof typeof transition>) {
      const nonEnumerableTransition = { ...transition } as Record<string, unknown>;
      Object.defineProperty(nonEnumerableTransition, field, {
        configurable: true,
        enumerable: false,
        value: transition[field],
        writable: true,
      });

      expect(() =>
        verifyRecoveryOwnershipReacquisitionEvidence(
          previousExpected,
          previousLease,
          nextExpected,
          nextLease,
          nonEnumerableTransition as never,
        ),
      ).toThrow(`evidence.${field} must be an enumerable data property`);
    }
  });

  it("rejects symbol-keyed transition fields instead of silently dropping them", () => {
    const symbolBackedTransition = { ...transition } as Record<PropertyKey, unknown>;
    symbolBackedTransition[Symbol("hidden-transition-data")] = "must-not-be-ignored";

    expect(() =>
      verifyRecoveryOwnershipReacquisitionEvidence(
        previousExpected,
        previousLease,
        nextExpected,
        nextLease,
        symbolBackedTransition as never,
      ),
    ).toThrow("evidence must not contain symbol fields");
  });
});

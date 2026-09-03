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

function verifyWithExpected(
  side: "previous" | "next",
  expected: unknown,
): void {
  verifyRecoveryOwnershipReacquisitionEvidence(
    side === "previous" ? (expected as never) : previousExpected,
    previousLease,
    side === "next" ? (expected as never) : nextExpected,
    nextLease,
    transition,
  );
}

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

        expect(() => verifyWithExpected(side, accessorBackedExpected)).toThrow(
          `expected.${field} must be an enumerable data property`,
        );
        expect(accessorExecutions).toBe(0);
      }
    }
  });

  it("rejects non-enumerable admitted identity fields", () => {
    for (const side of ["previous", "next"] as const) {
      const expected = side === "previous" ? previousExpected : nextExpected;

      for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
        const nonEnumerableExpected = { ...expected } as Record<string, unknown>;
        Object.defineProperty(nonEnumerableExpected, field, {
          configurable: true,
          enumerable: false,
          value: expected[field],
          writable: true,
        });

        expect(() => verifyWithExpected(side, nonEnumerableExpected)).toThrow(
          `expected.${field} must be an enumerable data property`,
        );
      }
    }
  });

  it("rejects symbol-keyed admitted identity data", () => {
    for (const side of ["previous", "next"] as const) {
      const expected = side === "previous" ? previousExpected : nextExpected;
      const symbolBackedExpected = {
        ...expected,
        [Symbol("hidden-identity")]: "unexpected",
      };

      expect(() => verifyWithExpected(side, symbolBackedExpected)).toThrow(
        "expected must not contain symbol fields",
      );
    }
  });

  it("rejects admitted identities with caller-controlled prototypes", () => {
    for (const side of ["previous", "next"] as const) {
      const expected = side === "previous" ? previousExpected : nextExpected;
      const inheritedExpected = Object.assign(
        Object.create({ inheritedIdentity: "unexpected" }) as Record<
          string,
          unknown
        >,
        expected,
      );

      expect(() => verifyWithExpected(side, inheritedExpected)).toThrow(
        "expected must be a plain data record",
      );
    }
  });
});

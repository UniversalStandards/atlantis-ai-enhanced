import { describe, expect, it, vi } from "vitest";

import {
  InvalidRecoveryOwnershipFenceTransitionEvidenceError,
  verifyRecoveryOwnershipFenceTransitionEvidence,
} from "../src/recovery-ownership-fence-transition-evidence.js";

const expected = {
  recoveryId: "recovery-1",
  executionId: "execution-1",
  previousFence: 7,
} as const;

const evidence = {
  transitionId: "transition-1",
  recoveryId: expected.recoveryId,
  executionId: expected.executionId,
  previousClaimId: "claim-1",
  nextClaimId: "claim-2",
  previousOwnerId: "worker-1",
  nextOwnerId: "worker-2",
  previousFence: expected.previousFence,
  nextFence: 8,
  observedAtEpochMs: 3000,
} as const;

describe("recovery ownership fence transition evidence", () => {
  it("accepts an exact strictly newer fencing epoch and returns a frozen copy", () => {
    const verified = verifyRecoveryOwnershipFenceTransitionEvidence(
      expected,
      evidence,
    );

    expect(verified).toEqual(evidence);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(verified).not.toBe(evidence);
  });

  it("allows the same owner to enter a newer fencing epoch under a distinct claim", () => {
    expect(verifyRecoveryOwnershipFenceTransitionEvidence(expected, {
      ...evidence,
      nextOwnerId: evidence.previousOwnerId,
      nextFence: 9,
    })).toMatchObject({
      previousFence: 7,
      nextFence: 9,
      previousOwnerId: "worker-1",
      nextOwnerId: "worker-1",
      previousClaimId: "claim-1",
      nextClaimId: "claim-2",
    });
  });

  it("rejects a numerically newer fence that reuses the same ownership claim", () => {
    expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(expected, {
      ...evidence,
      nextClaimId: evidence.previousClaimId,
      nextFence: 9,
    })).toThrowError(
      new InvalidRecoveryOwnershipFenceTransitionEvidenceError(
        "evidence.nextClaimId must identify a distinct ownership claim",
      ),
    );
  });

  it("rejects stale or non-advancing fencing epochs", () => {
    for (const nextFence of [expected.previousFence, expected.previousFence - 1]) {
      expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(expected, {
        ...evidence,
        nextFence,
      })).toThrowError(
        new InvalidRecoveryOwnershipFenceTransitionEvidenceError(
          "evidence.nextFence must be strictly greater than evidence.previousFence",
        ),
      );
    }
  });

  it("rejects evidence bound to a different recovery, execution, or prior fence", () => {
    for (const mismatchedEvidence of [
      { ...evidence, recoveryId: "recovery-2" },
      { ...evidence, executionId: "execution-2" },
      { ...evidence, previousFence: 6 },
    ]) {
      expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(
        expected,
        mismatchedEvidence,
      )).toThrowError(
        new InvalidRecoveryOwnershipFenceTransitionEvidenceError(
          "evidence must be bound to the exact admitted recovery ownership epoch",
        ),
      );
    }
  });

  it("rejects malformed identities, fences, timestamps, and unexpected fields", () => {
    for (const malformedEvidence of [
      { ...evidence, transitionId: "" },
      { ...evidence, previousClaimId: "" },
      { ...evidence, nextClaimId: "" },
      { ...evidence, previousOwnerId: "" },
      { ...evidence, nextOwnerId: "" },
      { ...evidence, previousFence: 0 },
      { ...evidence, nextFence: 1.5 },
      { ...evidence, observedAtEpochMs: -1 },
      { ...evidence, unexpected: true },
    ]) {
      expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(
        expected,
        malformedEvidence as never,
      )).toThrow(InvalidRecoveryOwnershipFenceTransitionEvidenceError);
    }
  });

  it("rejects accessor-backed transition fields without executing the accessor", () => {
    const nextFenceGetter = vi.fn(() => evidence.nextFence);
    const accessorEvidence = { ...evidence } as Record<string, unknown>;

    Object.defineProperty(accessorEvidence, "nextFence", {
      enumerable: true,
      get: nextFenceGetter,
    });

    expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(
      expected,
      accessorEvidence as never,
    )).toThrow(InvalidRecoveryOwnershipFenceTransitionEvidenceError);
    expect(nextFenceGetter).not.toHaveBeenCalled();
  });
});

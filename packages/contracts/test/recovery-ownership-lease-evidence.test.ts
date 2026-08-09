import { describe, expect, it, vi } from "vitest";

import {
  InvalidRecoveryOwnershipLeaseEvidenceError,
  verifyRecoveryOwnershipLeaseEvidence,
} from "../src/recovery-ownership-lease-evidence.js";

const expected = {
  recoveryId: "recovery-1",
  executionId: "execution-1",
  ownerId: "worker-1",
} as const;

const evidence = {
  claimId: "claim-1",
  recoveryId: expected.recoveryId,
  executionId: expected.executionId,
  ownerId: expected.ownerId,
  ownershipToken: "opaque-token-1",
  fence: 7,
  acquiredAtEpochMs: 1000,
  expiresAtEpochMs: 2000,
} as const;

describe("recovery ownership lease evidence", () => {
  it("accepts exact ownership evidence and returns a frozen copy", () => {
    const verified = verifyRecoveryOwnershipLeaseEvidence(expected, evidence);

    expect(verified).toEqual(evidence);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(verified).not.toBe(evidence);
  });

  it("rejects evidence for a different recovery, execution, or owner", () => {
    for (const mismatchedEvidence of [
      { ...evidence, recoveryId: "recovery-2" },
      { ...evidence, executionId: "execution-2" },
      { ...evidence, ownerId: "worker-2" },
    ]) {
      expect(() => verifyRecoveryOwnershipLeaseEvidence(
        expected,
        mismatchedEvidence,
      )).toThrowError(
        new InvalidRecoveryOwnershipLeaseEvidenceError(
          "evidence must be bound to the exact admitted recovery ownership identity",
        ),
      );
    }
  });

  it("rejects missing or malformed authority and fence fields", () => {
    for (const malformedEvidence of [
      { ...evidence, ownershipToken: "" },
      { ...evidence, fence: 0 },
      { ...evidence, fence: -1 },
      { ...evidence, fence: 1.5 },
      { ...evidence, claimId: "" },
    ]) {
      expect(() => verifyRecoveryOwnershipLeaseEvidence(
        expected,
        malformedEvidence as never,
      )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);
    }
  });

  it("rejects invalid or non-bounded lease intervals", () => {
    for (const malformedEvidence of [
      { ...evidence, acquiredAtEpochMs: -1 },
      { ...evidence, acquiredAtEpochMs: 1.5 },
      { ...evidence, expiresAtEpochMs: evidence.acquiredAtEpochMs },
      { ...evidence, expiresAtEpochMs: evidence.acquiredAtEpochMs - 1 },
      { ...evidence, expiresAtEpochMs: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() => verifyRecoveryOwnershipLeaseEvidence(
        expected,
        malformedEvidence as never,
      )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);
    }
  });

  it("rejects unexpected fields and missing required fields", () => {
    expect(() => verifyRecoveryOwnershipLeaseEvidence(expected, {
      ...evidence,
      unexpected: true,
    } as never)).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);

    const missingToken = { ...evidence } as Record<string, unknown>;
    delete missingToken.ownershipToken;

    expect(() => verifyRecoveryOwnershipLeaseEvidence(
      expected,
      missingToken as never,
    )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);
  });

  it("rejects accessor-backed authority without executing the accessor", () => {
    const ownershipTokenGetter = vi.fn(() => "opaque-token-1");
    const accessorEvidence = { ...evidence } as Record<string, unknown>;

    Object.defineProperty(accessorEvidence, "ownershipToken", {
      enumerable: true,
      get: ownershipTokenGetter,
    });

    expect(() => verifyRecoveryOwnershipLeaseEvidence(
      expected,
      accessorEvidence as never,
    )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);
    expect(ownershipTokenGetter).not.toHaveBeenCalled();
  });
});

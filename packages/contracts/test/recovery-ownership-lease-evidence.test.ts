import { describe, expect, it } from "vitest";

import {
  InvalidRecoveryOwnershipLeaseEvidenceError,
  toRecoveryOwnershipDiagnosticEvidence,
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

  it("projects verified ownership evidence without authority-bearing token", () => {
    const diagnostic = toRecoveryOwnershipDiagnosticEvidence(expected, evidence);

    expect(diagnostic).toEqual({
      claimId: evidence.claimId,
      recoveryId: evidence.recoveryId,
      executionId: evidence.executionId,
      ownerId: evidence.ownerId,
      fence: evidence.fence,
      acquiredAtEpochMs: evidence.acquiredAtEpochMs,
      expiresAtEpochMs: evidence.expiresAtEpochMs,
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect("ownershipToken" in diagnostic).toBe(false);
    expect(JSON.stringify(diagnostic)).not.toContain(evidence.ownershipToken);
  });

  it("re-verifies evidence before producing diagnostic output", () => {
    let ownershipTokenAccessorExecutions = 0;
    const accessorEvidence = { ...evidence } as Record<string, unknown>;

    Object.defineProperty(accessorEvidence, "ownershipToken", {
      enumerable: true,
      get() {
        ownershipTokenAccessorExecutions += 1;
        return evidence.ownershipToken;
      },
    });

    expect(() => toRecoveryOwnershipDiagnosticEvidence(
      expected,
      accessorEvidence as never,
    )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);
    expect(ownershipTokenAccessorExecutions).toBe(0);
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

  it("rejects accessor-backed lease fields without executing caller code", () => {
    for (const field of Object.keys(evidence) as Array<keyof typeof evidence>) {
      let accessorExecutions = 0;
      const accessorEvidence = { ...evidence } as Record<string, unknown>;
      delete accessorEvidence[field];
      Object.defineProperty(accessorEvidence, field, {
        enumerable: true,
        get() {
          accessorExecutions += 1;
          return evidence[field];
        },
      });

      expect(() => verifyRecoveryOwnershipLeaseEvidence(
        expected,
        accessorEvidence as never,
      )).toThrow(`evidence.${field} must be an enumerable data property`);
      expect(accessorExecutions).toBe(0);
    }
  });

  it("rejects non-enumerable lease fields", () => {
    for (const field of Object.keys(evidence) as Array<keyof typeof evidence>) {
      const nonEnumerableEvidence = { ...evidence } as Record<string, unknown>;
      Object.defineProperty(nonEnumerableEvidence, field, {
        configurable: true,
        enumerable: false,
        value: evidence[field],
        writable: true,
      });

      expect(() => verifyRecoveryOwnershipLeaseEvidence(
        expected,
        nonEnumerableEvidence as never,
      )).toThrow(`evidence.${field} must be an enumerable data property`);
    }
  });

  it("rejects symbol-keyed lease data", () => {
    const symbolBackedEvidence = {
      ...evidence,
      [Symbol("hidden-authority")]: "unexpected",
    };

    expect(() => verifyRecoveryOwnershipLeaseEvidence(
      expected,
      symbolBackedEvidence as never,
    )).toThrow("evidence must not contain symbol fields");
  });

  it("rejects leases with caller-controlled prototypes", () => {
    const inheritedEvidence = Object.assign(
      Object.create({ inheritedAuthority: "unexpected" }) as Record<
        string,
        unknown
      >,
      evidence,
    );

    expect(() => verifyRecoveryOwnershipLeaseEvidence(
      expected,
      inheritedEvidence as never,
    )).toThrow("evidence must be a plain data record");
  });
});

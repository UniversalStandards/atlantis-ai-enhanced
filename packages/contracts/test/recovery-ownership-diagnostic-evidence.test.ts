import { describe, expect, it } from "vitest";

import {
  InvalidRecoveryOwnershipLeaseEvidenceError,
  toRecoveryOwnershipDiagnosticEvidence,
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

describe("recovery ownership diagnostic evidence containment", () => {
  it("never projects authority-bearing ownershipToken", () => {
    const diagnostic = toRecoveryOwnershipDiagnosticEvidence(expected, evidence);

    expect(Reflect.ownKeys(diagnostic)).toEqual([
      "claimId",
      "recoveryId",
      "executionId",
      "ownerId",
      "fence",
      "acquiredAtEpochMs",
      "expiresAtEpochMs",
    ]);
    expect("ownershipToken" in diagnostic).toBe(false);
    expect(JSON.stringify(diagnostic)).not.toContain(evidence.ownershipToken);
    expect(Object.isFrozen(diagnostic)).toBe(true);
  });

  it("rejects token accessors without executing caller-controlled code", () => {
    let accessorExecutions = 0;
    const accessorEvidence = { ...evidence } as Record<string, unknown>;
    delete accessorEvidence.ownershipToken;
    Object.defineProperty(accessorEvidence, "ownershipToken", {
      enumerable: true,
      get() {
        accessorExecutions += 1;
        return evidence.ownershipToken;
      },
    });

    expect(() => toRecoveryOwnershipDiagnosticEvidence(
      expected,
      accessorEvidence as never,
    )).toThrow("evidence.ownershipToken must be an enumerable data property");
    expect(accessorExecutions).toBe(0);
  });

  it("rejects hidden or inherited authority before diagnostic projection", () => {
    const nonEnumerableToken = { ...evidence } as Record<string, unknown>;
    Object.defineProperty(nonEnumerableToken, "ownershipToken", {
      configurable: true,
      enumerable: false,
      value: evidence.ownershipToken,
      writable: true,
    });

    expect(() => toRecoveryOwnershipDiagnosticEvidence(
      expected,
      nonEnumerableToken as never,
    )).toThrow("evidence.ownershipToken must be an enumerable data property");

    expect(() => toRecoveryOwnershipDiagnosticEvidence(expected, {
      ...evidence,
      [Symbol("hidden-authority")]: evidence.ownershipToken,
    } as never)).toThrow("evidence must not contain symbol fields");

    const inheritedAuthority = Object.assign(
      Object.create({ ownershipToken: "inherited-token" }) as Record<string, unknown>,
      evidence,
    );

    expect(() => toRecoveryOwnershipDiagnosticEvidence(
      expected,
      inheritedAuthority as never,
    )).toThrow("evidence must be a plain data record");
  });

  it("fails closed on malformed authority instead of projecting diagnostics", () => {
    expect(() => toRecoveryOwnershipDiagnosticEvidence(expected, {
      ...evidence,
      ownershipToken: "",
    })).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);
  });
});

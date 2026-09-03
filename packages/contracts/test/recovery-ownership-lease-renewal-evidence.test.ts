import { describe, expect, it } from "vitest";

import {
  InvalidRecoveryOwnershipLeaseRenewalEvidenceError,
  verifyRecoveryOwnershipLeaseRenewalEvidence,
} from "../src/recovery-ownership-lease-renewal-evidence.js";

const expected = {
  recoveryId: "recovery-1",
  executionId: "execution-1",
  ownerId: "worker-1",
} as const;

const previous = {
  claimId: "claim-1",
  recoveryId: expected.recoveryId,
  executionId: expected.executionId,
  ownerId: expected.ownerId,
  ownershipToken: "opaque-token-1",
  fence: 7,
  acquiredAtEpochMs: 1000,
  expiresAtEpochMs: 2000,
} as const;

const renewed = {
  ...previous,
  expiresAtEpochMs: 3000,
} as const;

describe("recovery ownership lease renewal evidence", () => {
  it("accepts a strict lease extension and returns a frozen copy", () => {
    const verified = verifyRecoveryOwnershipLeaseRenewalEvidence(
      expected,
      previous,
      renewed,
    );

    expect(verified).toEqual(renewed);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(verified).not.toBe(renewed);
  });

  it("rejects claim, authority, fence, or acquisition identity rotation", () => {
    for (const invalidRenewal of [
      { ...renewed, claimId: "claim-2" },
      { ...renewed, ownershipToken: "opaque-token-2" },
      { ...renewed, fence: previous.fence + 1 },
      { ...renewed, acquiredAtEpochMs: previous.acquiredAtEpochMs + 1 },
    ]) {
      expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
        expected,
        previous,
        invalidRenewal,
      )).toThrow(InvalidRecoveryOwnershipLeaseRenewalEvidenceError);
    }
  });

  it("rejects renewal that does not strictly extend expiry", () => {
    for (const invalidExpiry of [
      previous.expiresAtEpochMs,
      previous.expiresAtEpochMs - 1,
    ]) {
      expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
        expected,
        previous,
        { ...previous, expiresAtEpochMs: invalidExpiry },
      )).toThrowError(
        new InvalidRecoveryOwnershipLeaseRenewalEvidenceError(
          "renewed evidence must strictly extend the lease expiry",
        ),
      );
    }
  });

  it("rejects identity substitution through either lease snapshot", () => {
    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      expected,
      { ...previous, ownerId: "worker-2" },
      renewed,
    )).toThrow(InvalidRecoveryOwnershipLeaseRenewalEvidenceError);

    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      expected,
      previous,
      { ...renewed, executionId: "execution-2" },
    )).toThrow(InvalidRecoveryOwnershipLeaseRenewalEvidenceError);
  });

  it("rejects accessor-backed fields in either lease snapshot without executing caller code", () => {
    for (const [snapshotName, snapshot] of [
      ["previous", previous],
      ["renewed", renewed],
    ] as const) {
      for (const field of Object.keys(snapshot) as Array<keyof typeof snapshot>) {
        let accessorExecutions = 0;
        const accessorSnapshot = { ...snapshot } as Record<string, unknown>;
        delete accessorSnapshot[field];
        Object.defineProperty(accessorSnapshot, field, {
          enumerable: true,
          get() {
            accessorExecutions += 1;
            return snapshot[field];
          },
        });

        expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
          expected,
          snapshotName === "previous" ? accessorSnapshot as never : previous,
          snapshotName === "renewed" ? accessorSnapshot as never : renewed,
        )).toThrow(`${snapshotName === "previous" ? "evidence" : "evidence"}.${field} must be an enumerable data property`);
        expect(accessorExecutions).toBe(0);
      }
    }
  });

  it("rejects non-enumerable fields in either lease snapshot", () => {
    for (const [snapshotName, snapshot] of [
      ["previous", previous],
      ["renewed", renewed],
    ] as const) {
      for (const field of Object.keys(snapshot) as Array<keyof typeof snapshot>) {
        const nonEnumerableSnapshot = { ...snapshot } as Record<string, unknown>;
        Object.defineProperty(nonEnumerableSnapshot, field, {
          configurable: true,
          enumerable: false,
          value: snapshot[field],
          writable: true,
        });

        expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
          expected,
          snapshotName === "previous" ? nonEnumerableSnapshot as never : previous,
          snapshotName === "renewed" ? nonEnumerableSnapshot as never : renewed,
        )).toThrow(`evidence.${field} must be an enumerable data property`);
      }
    }
  });

  it("rejects symbol-keyed data in either lease snapshot", () => {
    const symbolBackedPrevious = {
      ...previous,
      [Symbol("hidden-authority")]: "unexpected",
    };
    const symbolBackedRenewed = {
      ...renewed,
      [Symbol("hidden-authority")]: "unexpected",
    };

    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      expected,
      symbolBackedPrevious as never,
      renewed,
    )).toThrow("evidence must not contain symbol fields");

    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      expected,
      previous,
      symbolBackedRenewed as never,
    )).toThrow("evidence must not contain symbol fields");
  });

  it("rejects caller-controlled prototypes in either lease snapshot", () => {
    const inheritedPrevious = Object.assign(
      Object.create({ inheritedAuthority: "unexpected" }) as Record<string, unknown>,
      previous,
    );
    const inheritedRenewed = Object.assign(
      Object.create({ inheritedAuthority: "unexpected" }) as Record<string, unknown>,
      renewed,
    );

    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      expected,
      inheritedPrevious as never,
      renewed,
    )).toThrow("evidence must be a plain data record");

    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      expected,
      previous,
      inheritedRenewed as never,
    )).toThrow("evidence must be a plain data record");
  });
});

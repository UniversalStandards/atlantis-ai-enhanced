import { describe, expect, it, vi } from "vitest";

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

  it("rejects accessor-backed authority without executing the accessor", () => {
    const ownershipTokenGetter = vi.fn(() => previous.ownershipToken);
    const accessorRenewal = { ...renewed } as Record<string, unknown>;

    Object.defineProperty(accessorRenewal, "ownershipToken", {
      enumerable: true,
      get: ownershipTokenGetter,
    });

    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      expected,
      previous,
      accessorRenewal as never,
    )).toThrow(InvalidRecoveryOwnershipLeaseRenewalEvidenceError);
    expect(ownershipTokenGetter).not.toHaveBeenCalled();
  });
});

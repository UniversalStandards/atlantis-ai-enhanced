import { describe, expect, it, vi } from "vitest";

import {
  InvalidRecoveryOwnershipFenceTransitionEvidenceError,
  InvalidRecoveryOwnershipLeaseEvidenceError,
  verifyRecoveryOwnershipFenceTransitionEvidence,
  verifyRecoveryOwnershipLeaseEvidence,
} from "../src/index.js";
import {
  InvalidRecoveryOwnershipLeaseRenewalEvidenceError,
  verifyRecoveryOwnershipLeaseRenewalEvidence,
} from "../src/recovery-ownership-lease-renewal-evidence.js";

const identity = {
  recoveryId: "recovery-1",
  executionId: "execution-1",
  ownerId: "worker-1",
} as const;

const lease = {
  claimId: "claim-1",
  recoveryId: identity.recoveryId,
  executionId: identity.executionId,
  ownerId: identity.ownerId,
  ownershipToken: "opaque-token-1",
  fence: 7,
  acquiredAtEpochMs: 1000,
  expiresAtEpochMs: 2000,
} as const;

const renewedLease = {
  ...lease,
  expiresAtEpochMs: 3000,
} as const;

const transitionExpected = {
  recoveryId: identity.recoveryId,
  executionId: identity.executionId,
  previousFence: lease.fence,
} as const;

const transitionEvidence = {
  transitionId: "transition-1",
  recoveryId: identity.recoveryId,
  executionId: identity.executionId,
  previousClaimId: lease.claimId,
  nextClaimId: "claim-2",
  previousOwnerId: identity.ownerId,
  nextOwnerId: "worker-2",
  previousFence: lease.fence,
  nextFence: lease.fence + 1,
  observedAtEpochMs: 3000,
} as const;

describe("recovery ownership expected-input containment", () => {
  it("rejects accessor-backed expected lease identity without executing it", () => {
    const recoveryIdGetter = vi.fn(() => identity.recoveryId);
    const expected = { ...identity } as Record<string, unknown>;

    Object.defineProperty(expected, "recoveryId", {
      enumerable: true,
      get: recoveryIdGetter,
    });

    expect(() => verifyRecoveryOwnershipLeaseEvidence(
      expected as never,
      lease,
    )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);
    expect(recoveryIdGetter).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed expected renewal identity without executing it", () => {
    const ownerIdGetter = vi.fn(() => identity.ownerId);
    const expected = { ...identity } as Record<string, unknown>;

    Object.defineProperty(expected, "ownerId", {
      enumerable: true,
      get: ownerIdGetter,
    });

    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      expected as never,
      lease,
      renewedLease,
    )).toThrow(InvalidRecoveryOwnershipLeaseRenewalEvidenceError);
    expect(ownerIdGetter).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed expected fence epoch without executing it", () => {
    const previousFenceGetter = vi.fn(() => transitionExpected.previousFence);
    const expected = { ...transitionExpected } as Record<string, unknown>;

    Object.defineProperty(expected, "previousFence", {
      enumerable: true,
      get: previousFenceGetter,
    });

    expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(
      expected as never,
      transitionEvidence,
    )).toThrow(InvalidRecoveryOwnershipFenceTransitionEvidenceError);
    expect(previousFenceGetter).not.toHaveBeenCalled();
  });
});

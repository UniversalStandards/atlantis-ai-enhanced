import { describe, expect, it } from "vitest";

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

function withAccessor(
  source: Readonly<Record<string, unknown>>,
  field: string,
  onExecute: () => void,
): Record<string, unknown> {
  const candidate = { ...source };
  delete candidate[field];
  Object.defineProperty(candidate, field, {
    enumerable: true,
    get() {
      onExecute();
      return source[field];
    },
  });
  return candidate;
}

function withNonEnumerable(
  source: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  const candidate = { ...source };
  Object.defineProperty(candidate, field, {
    configurable: true,
    enumerable: false,
    value: source[field],
    writable: true,
  });
  return candidate;
}

describe("recovery ownership expected-input containment", () => {
  it("rejects accessor-backed expected lease identity fields without executing caller code", () => {
    for (const field of Object.keys(identity)) {
      let accessorExecutions = 0;
      const expected = withAccessor(identity, field, () => {
        accessorExecutions += 1;
      });

      expect(() => verifyRecoveryOwnershipLeaseEvidence(
        expected as never,
        lease,
      )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);
      expect(accessorExecutions).toBe(0);
    }
  });

  it("rejects accessor-backed expected renewal identity fields without executing caller code", () => {
    for (const field of Object.keys(identity)) {
      let accessorExecutions = 0;
      const expected = withAccessor(identity, field, () => {
        accessorExecutions += 1;
      });

      expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
        expected as never,
        lease,
        renewedLease,
      )).toThrow(InvalidRecoveryOwnershipLeaseRenewalEvidenceError);
      expect(accessorExecutions).toBe(0);
    }
  });

  it("rejects accessor-backed expected transition fields without executing caller code", () => {
    for (const field of Object.keys(transitionExpected)) {
      let accessorExecutions = 0;
      const expected = withAccessor(transitionExpected, field, () => {
        accessorExecutions += 1;
      });

      expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(
        expected as never,
        transitionEvidence,
      )).toThrow(InvalidRecoveryOwnershipFenceTransitionEvidenceError);
      expect(accessorExecutions).toBe(0);
    }
  });

  it("rejects non-enumerable required fields across all expected ownership inputs", () => {
    for (const field of Object.keys(identity)) {
      const expected = withNonEnumerable(identity, field);

      expect(() => verifyRecoveryOwnershipLeaseEvidence(
        expected as never,
        lease,
      )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);

      expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
        expected as never,
        lease,
        renewedLease,
      )).toThrow(InvalidRecoveryOwnershipLeaseRenewalEvidenceError);
    }

    for (const field of Object.keys(transitionExpected)) {
      const expected = withNonEnumerable(transitionExpected, field);

      expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(
        expected as never,
        transitionEvidence,
      )).toThrow(InvalidRecoveryOwnershipFenceTransitionEvidenceError);
    }
  });

  it("rejects symbol-keyed hidden data across all expected ownership inputs", () => {
    const symbolBackedIdentity = {
      ...identity,
      [Symbol("hidden-authority")]: "unexpected",
    };
    const symbolBackedTransitionExpected = {
      ...transitionExpected,
      [Symbol("hidden-authority")]: "unexpected",
    };

    expect(() => verifyRecoveryOwnershipLeaseEvidence(
      symbolBackedIdentity as never,
      lease,
    )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);

    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      symbolBackedIdentity as never,
      lease,
      renewedLease,
    )).toThrow(InvalidRecoveryOwnershipLeaseRenewalEvidenceError);

    expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(
      symbolBackedTransitionExpected as never,
      transitionEvidence,
    )).toThrow(InvalidRecoveryOwnershipFenceTransitionEvidenceError);
  });

  it("rejects caller-controlled prototypes across all expected ownership inputs", () => {
    const inheritedIdentity = Object.assign(
      Object.create({ inheritedAuthority: "unexpected" }) as Record<string, unknown>,
      identity,
    );
    const inheritedTransitionExpected = Object.assign(
      Object.create({ inheritedAuthority: "unexpected" }) as Record<string, unknown>,
      transitionExpected,
    );

    expect(() => verifyRecoveryOwnershipLeaseEvidence(
      inheritedIdentity as never,
      lease,
    )).toThrow(InvalidRecoveryOwnershipLeaseEvidenceError);

    expect(() => verifyRecoveryOwnershipLeaseRenewalEvidence(
      inheritedIdentity as never,
      lease,
      renewedLease,
    )).toThrow(InvalidRecoveryOwnershipLeaseRenewalEvidenceError);

    expect(() => verifyRecoveryOwnershipFenceTransitionEvidence(
      inheritedTransitionExpected as never,
      transitionEvidence,
    )).toThrow(InvalidRecoveryOwnershipFenceTransitionEvidenceError);
  });
});

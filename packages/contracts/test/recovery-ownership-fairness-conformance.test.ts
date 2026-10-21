import { describe } from "vitest";

import {
  RecoveryOwnershipConflictError,
  type RecoveryOwnershipAcquireRequest,
  type RecoveryOwnershipAcquireResult,
  type RecoveryOwnershipStore,
} from "../src/recovery-ownership-store.js";
import {
  verifyRecoveryOwnershipLeaseEvidence,
  type RecoveryOwnershipLeaseEvidence,
} from "../src/recovery-ownership-lease-evidence.js";
import { recoveryOwnershipFairnessConformance } from "./recovery-ownership-fairness-conformance.js";

interface SharedState {
  now: number;
  sequence: number;
  fence: number;
  lease?: Readonly<RecoveryOwnershipLeaseEvidence>;
}

function sameLease(
  left: RecoveryOwnershipLeaseEvidence,
  right: RecoveryOwnershipLeaseEvidence,
): boolean {
  return (
    left.claimId === right.claimId &&
    left.recoveryId === right.recoveryId &&
    left.executionId === right.executionId &&
    left.ownerId === right.ownerId &&
    left.ownershipToken === right.ownershipToken &&
    left.fence === right.fence &&
    left.acquiredAtEpochMs === right.acquiredAtEpochMs &&
    left.expiresAtEpochMs === right.expiresAtEpochMs
  );
}

/**
 * Test-only shared-state model used to execute the fairness specification.
 * It is deliberately not exported as a production adapter: its purpose is to
 * prove that the conformance suite is executable before a persistence backend
 * is selected.
 */
class FairnessReferenceStore implements RecoveryOwnershipStore {
  public constructor(
    private readonly state: SharedState,
    private readonly maxContinuousOwnershipMs: number,
  ) {}

  public acquire(request: RecoveryOwnershipAcquireRequest): RecoveryOwnershipAcquireResult {
    const live = this.state.lease;
    if (live !== undefined && live.expiresAtEpochMs > this.state.now) {
      return Object.freeze({
        status: "owned" as const,
        recoveryId: live.recoveryId,
        executionId: live.executionId,
        ownerId: live.ownerId,
        fence: live.fence,
        expiresAtEpochMs: live.expiresAtEpochMs,
      });
    }

    this.state.sequence += 1;
    this.state.fence += 1;
    const acquiredAtEpochMs = this.state.now;
    const expiresAtEpochMs = Math.min(
      acquiredAtEpochMs + request.leaseDurationMs,
      acquiredAtEpochMs + this.maxContinuousOwnershipMs,
    );
    const lease = verifyRecoveryOwnershipLeaseEvidence(
      {
        recoveryId: request.recoveryId,
        executionId: request.executionId,
        ownerId: request.ownerId,
      },
      {
        claimId: `fairness-claim-${this.state.sequence}`,
        recoveryId: request.recoveryId,
        executionId: request.executionId,
        ownerId: request.ownerId,
        ownershipToken: `fairness-token-${this.state.sequence}`,
        fence: this.state.fence,
        acquiredAtEpochMs,
        expiresAtEpochMs,
      },
    );
    this.state.lease = lease;
    return Object.freeze({
      status: "acquired" as const,
      acquisition: live === undefined ? "new" as const : "expired" as const,
      lease,
    });
  }

  public renew(
    lease: RecoveryOwnershipLeaseEvidence,
    leaseDurationMs: number,
  ): Readonly<RecoveryOwnershipLeaseEvidence> {
    const live = this.state.lease;
    if (
      live === undefined ||
      !sameLease(live, lease) ||
      live.expiresAtEpochMs <= this.state.now
    ) {
      throw new RecoveryOwnershipConflictError("Only exact live authority may renew");
    }

    const bound = live.acquiredAtEpochMs + this.maxContinuousOwnershipMs;
    const requestedExpiry = this.state.now + leaseDurationMs;
    if (requestedExpiry > bound) {
      throw new RecoveryOwnershipConflictError("Continuous ownership bound reached");
    }
    if (requestedExpiry <= live.expiresAtEpochMs) {
      return live;
    }

    const renewed = verifyRecoveryOwnershipLeaseEvidence(
      {
        recoveryId: live.recoveryId,
        executionId: live.executionId,
        ownerId: live.ownerId,
      },
      { ...live, expiresAtEpochMs: requestedExpiry },
    );
    this.state.lease = renewed;
    return renewed;
  }

  public release(lease: RecoveryOwnershipLeaseEvidence): void {
    if (this.state.lease !== undefined && sameLease(this.state.lease, lease)) {
      delete this.state.lease;
    }
  }

  public observe(
    recoveryId: string,
    executionId: string,
  ): RecoveryOwnershipAcquireResult | Readonly<{ status: "unclaimed"; fence: number }> {
    const live = this.state.lease;
    if (
      live !== undefined &&
      live.recoveryId === recoveryId &&
      live.executionId === executionId &&
      live.expiresAtEpochMs > this.state.now
    ) {
      return Object.freeze({
        status: "owned" as const,
        recoveryId,
        executionId,
        ownerId: live.ownerId,
        fence: live.fence,
        expiresAtEpochMs: live.expiresAtEpochMs,
      });
    }
    return Object.freeze({ status: "unclaimed" as const, fence: this.state.fence });
  }
}

describe("recovery ownership fairness conformance reference fixture", () => {
  recoveryOwnershipFairnessConformance(() => {
    const state: SharedState = { now: 1_000, sequence: 0, fence: 0 };
    const maxContinuousOwnershipMs = 250;
    const createStore = () => new FairnessReferenceStore(state, maxContinuousOwnershipMs);

    return {
      store: createStore(),
      clock: {
        setNow(value: number): void {
          state.now = value;
        },
      },
      maxContinuousOwnershipMs,
      restart(): RecoveryOwnershipStore {
        return createStore();
      },
    };
  });
});

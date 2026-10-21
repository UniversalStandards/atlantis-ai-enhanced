import { expect, it } from "vitest";

import {
  RecoveryOwnershipConflictError,
  type RecoveryOwnershipAcquireRequest,
  type RecoveryOwnershipStore,
} from "../src/recovery-ownership-store.js";

export interface RecoveryOwnershipFairnessClock {
  setNow(value: number): void;
}

/**
 * A fairness fixture is configured with a finite continuous-ownership budget.
 * Restart must replace the adapter instance without clearing durable ownership,
 * fencing, acquired-at, or continuation-budget state.
 */
export interface RecoveryOwnershipFairnessHarness {
  readonly store: RecoveryOwnershipStore;
  readonly clock: RecoveryOwnershipFairnessClock;
  readonly maxContinuousOwnershipMs: number;
  restart(): RecoveryOwnershipStore | Promise<RecoveryOwnershipStore>;
}

export type CreateRecoveryOwnershipFairnessHarness =
  () => RecoveryOwnershipFairnessHarness;

const request: RecoveryOwnershipAcquireRequest = {
  recoveryId: "fairness-recovery",
  executionId: "fairness-execution",
  ownerId: "worker-a",
  leaseDurationMs: 100,
};

function acquired(
  result: Awaited<ReturnType<RecoveryOwnershipStore["acquire"]>>,
) {
  expect(result.status).toBe("acquired");
  if (result.status !== "acquired") {
    throw new Error("fairness conformance expected ownership acquisition");
  }
  return result;
}

async function expectRenewalDeniedWithoutMutation(
  store: RecoveryOwnershipStore,
  lease: ReturnType<typeof acquired>["lease"],
  leaseDurationMs: number,
): Promise<void> {
  const before = await store.observe(lease.recoveryId, lease.executionId);
  await expect(
    Promise.resolve().then(() => store.renew(lease, leaseDurationMs)),
  ).rejects.toBeInstanceOf(RecoveryOwnershipConflictError);
  const after = await store.observe(lease.recoveryId, lease.executionId);
  expect(after).toEqual(before);
}

/**
 * Provider-neutral bounded-continuation acceptance scenarios.
 *
 * Real durable adapters run this suite unchanged with a deployment-selected
 * maxContinuousOwnershipMs. The suite intentionally does not prescribe FIFO,
 * ticket queues, database primitives, topology, or production timeout values.
 */
export function recoveryOwnershipFairnessConformance(
  createHarness: CreateRecoveryOwnershipFairnessHarness,
): void {
  it("fairness: repeated renewal cannot extend one claim beyond its continuous-ownership bound", async () => {
    const { store, clock, maxContinuousOwnershipMs } = createHarness();
    expect(maxContinuousOwnershipMs).toBeGreaterThan(request.leaseDurationMs);

    let live = acquired(await store.acquire(request)).lease;
    const bound = live.acquiredAtEpochMs + maxContinuousOwnershipMs;

    while (live.expiresAtEpochMs + request.leaseDurationMs <= bound) {
      clock.setNow(live.expiresAtEpochMs - 1);
      live = await store.renew(live, request.leaseDurationMs);
      expect(live.acquiredAtEpochMs + maxContinuousOwnershipMs).toBe(bound);
      expect(live.expiresAtEpochMs).toBeLessThanOrEqual(bound);
    }

    clock.setNow(live.expiresAtEpochMs - 1);
    await expectRenewalDeniedWithoutMutation(
      store,
      live,
      request.leaseDurationMs,
    );
  });

  it("fairness: restart preserves acquired-at and the remaining continuation budget", async () => {
    const harness = createHarness();
    const first = acquired(await harness.store.acquire(request));
    const bound =
      first.lease.acquiredAtEpochMs + harness.maxContinuousOwnershipMs;

    harness.clock.setNow(first.lease.expiresAtEpochMs - 1);
    const renewed = await harness.store.renew(
      first.lease,
      request.leaseDurationMs,
    );
    const restarted = await harness.restart();

    expect(await restarted.observe(request.recoveryId, request.executionId)).toMatchObject({
      status: "owned",
      ownerId: request.ownerId,
      fence: renewed.fence,
    });
    expect(renewed.acquiredAtEpochMs + harness.maxContinuousOwnershipMs).toBe(
      bound,
    );

    harness.clock.setNow(renewed.expiresAtEpochMs - 1);
    if (renewed.expiresAtEpochMs + request.leaseDurationMs > bound) {
      await expectRenewalDeniedWithoutMutation(
        restarted,
        renewed,
        request.leaseDurationMs,
      );
    }
  });

  it("fairness: a waiting contender acquires after bounded continuation and predecessor authority stays fenced", async () => {
    const { store, clock, maxContinuousOwnershipMs } = createHarness();
    let incumbent = acquired(await store.acquire(request)).lease;
    const bound = incumbent.acquiredAtEpochMs + maxContinuousOwnershipMs;

    expect(
      await store.acquire({ ...request, ownerId: "worker-b" }),
    ).toMatchObject({ status: "owned", ownerId: "worker-a" });

    while (incumbent.expiresAtEpochMs < bound) {
      clock.setNow(incumbent.expiresAtEpochMs - 1);
      const remaining = bound - (incumbent.expiresAtEpochMs - 1);
      const duration = Math.min(request.leaseDurationMs, remaining);
      if (incumbent.expiresAtEpochMs - 1 + duration <= incumbent.expiresAtEpochMs) {
        break;
      }
      incumbent = await store.renew(incumbent, duration);
    }

    clock.setNow(incumbent.expiresAtEpochMs);
    const successor = acquired(
      await store.acquire({ ...request, ownerId: "worker-b" }),
    );
    expect(successor.lease.fence).toBe(incumbent.fence + 1);
    expect(successor.lease.claimId).not.toBe(incumbent.claimId);
    expect(successor.lease.ownershipToken).not.toBe(incumbent.ownershipToken);

    await expect(
      Promise.resolve().then(() => store.renew(incumbent, request.leaseDurationMs)),
    ).rejects.toBeInstanceOf(RecoveryOwnershipConflictError);
    await store.release(incumbent);
    expect(await store.observe(request.recoveryId, request.executionId)).toMatchObject({
      status: "owned",
      ownerId: "worker-b",
      fence: successor.lease.fence,
    });
  });
}

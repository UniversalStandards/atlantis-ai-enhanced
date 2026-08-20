import { expect, it } from "vitest";

import {
  RecoveryOwnershipConflictError,
  type RecoveryOwnershipAcquireRequest,
  type RecoveryOwnershipStore,
} from "../src/recovery-ownership-store.js";

export interface DurableRecoveryOwnershipConformanceClock {
  setNow(value: number): void;
}

/**
 * A durable adapter harness must return independent adapter instances backed by
 * the same durable state. restart() must discard the current adapter instance
 * and return a fresh one without clearing durable ownership/fence history.
 */
export interface DurableRecoveryOwnershipConformanceHarness {
  readonly first: RecoveryOwnershipStore;
  readonly second: RecoveryOwnershipStore;
  readonly clock: DurableRecoveryOwnershipConformanceClock;
  restart(): RecoveryOwnershipStore | Promise<RecoveryOwnershipStore>;
}

export type CreateDurableRecoveryOwnershipConformanceHarness =
  () => DurableRecoveryOwnershipConformanceHarness;

const baseRequest: RecoveryOwnershipAcquireRequest = {
  recoveryId: "durable-conformance-recovery",
  executionId: "durable-conformance-execution",
  ownerId: "worker-a",
  leaseDurationMs: 100,
};

function acquired(
  result: Awaited<ReturnType<RecoveryOwnershipStore["acquire"]>>,
) {
  expect(result.status).toBe("acquired");
  if (result.status !== "acquired") {
    throw new Error("durable conformance harness expected ownership acquisition");
  }
  return result;
}

/**
 * Provider-neutral durability scenarios for every real recovery ownership
 * adapter. The process-local reference store intentionally does not register
 * here because it cannot prove cross-process/restart durability.
 */
export function durableRecoveryOwnershipStoreConformance(
  createHarness: CreateDurableRecoveryOwnershipConformanceHarness,
): void {
  it("durable conformance: independent adapters observe one live authority", async () => {
    const { first, second } = createHarness();
    const winner = acquired(await first.acquire(baseRequest));

    expect(
      await second.acquire({ ...baseRequest, ownerId: "worker-b" }),
    ).toMatchObject({
      status: "owned",
      ownerId: "worker-a",
      fence: winner.lease.fence,
    });
  });

  it("durable conformance: live ownership survives adapter restart", async () => {
    const harness = createHarness();
    const winner = acquired(await harness.first.acquire(baseRequest));
    const restarted = await harness.restart();

    expect(
      await restarted.acquire({ ...baseRequest, ownerId: "worker-b" }),
    ).toMatchObject({
      status: "owned",
      ownerId: "worker-a",
      fence: winner.lease.fence,
      expiresAtEpochMs: winner.lease.expiresAtEpochMs,
    });
  });

  it("durable conformance: expiry takeover after restart advances the durable fence", async () => {
    const harness = createHarness();
    const first = acquired(await harness.first.acquire(baseRequest));
    harness.clock.setNow(first.lease.expiresAtEpochMs);
    const restarted = await harness.restart();

    const successor = acquired(
      await restarted.acquire({ ...baseRequest, ownerId: "worker-b" }),
    );
    expect(successor.acquisition).toBe("expired");
    expect(successor.lease.fence).toBe(first.lease.fence + 1);

    await expect(
      Promise.resolve().then(() => restarted.renew(first.lease, 100)),
    ).rejects.toBeInstanceOf(RecoveryOwnershipConflictError);
  });

  it("durable conformance: released authority remains fenced after restart", async () => {
    const harness = createHarness();
    const first = acquired(await harness.first.acquire(baseRequest));
    await harness.first.release(first.lease);
    const restarted = await harness.restart();

    const successor = acquired(
      await restarted.acquire({ ...baseRequest, ownerId: "worker-b" }),
    );
    expect(successor.acquisition).toBe("released");
    expect(successor.lease.fence).toBe(first.lease.fence + 1);

    await expect(
      Promise.resolve().then(() => restarted.renew(first.lease, 100)),
    ).rejects.toBeInstanceOf(RecoveryOwnershipConflictError);
  });
}

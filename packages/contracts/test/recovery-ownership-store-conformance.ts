import { expect } from "vitest";

import {
  RecoveryOwnershipConflictError,
  type RecoveryOwnershipAcquireRequest,
  type RecoveryOwnershipStore,
} from "../src/recovery-ownership-store.js";

export interface RecoveryOwnershipConformanceClock {
  setNow(value: number): void;
}

export interface RecoveryOwnershipConformanceHarness {
  readonly store: RecoveryOwnershipStore;
  readonly clock: RecoveryOwnershipConformanceClock;
}

export type CreateRecoveryOwnershipConformanceHarness =
  () => RecoveryOwnershipConformanceHarness;

const baseRequest: RecoveryOwnershipAcquireRequest = {
  recoveryId: "conformance-recovery",
  executionId: "conformance-execution",
  ownerId: "worker-a",
  leaseDurationMs: 100,
};

function acquired(
  result: Awaited<ReturnType<RecoveryOwnershipStore["acquire"]>>,
) {
  expect(result.status).toBe("acquired");
  if (result.status !== "acquired") {
    throw new Error("conformance harness expected ownership acquisition");
  }
  return result;
}

/**
 * Adapter-neutral recovery ownership acceptance scenarios.
 *
 * Every production adapter must run these scenarios unchanged. Durable adapters
 * add restart/crash scenarios around the same contract; this baseline does not
 * pretend that a process-local reference implementation proves durability.
 */
export function recoveryOwnershipStoreConformance(
  createHarness: CreateRecoveryOwnershipConformanceHarness,
): void {
  it("conformance: same owner reacquires only after authority loss with a fresh claim and fence", async () => {
    const { store, clock } = createHarness();
    const first = acquired(await store.acquire(baseRequest));

    const whileLive = await store.acquire(baseRequest);
    expect(whileLive).toMatchObject({
      status: "owned",
      ownerId: baseRequest.ownerId,
      fence: first.lease.fence,
    });

    await store.release(first.lease);
    const reacquired = acquired(await store.acquire(baseRequest));
    expect(reacquired.acquisition).toBe("released");
    expect(reacquired.lease.ownerId).toBe(first.lease.ownerId);
    expect(reacquired.lease.claimId).not.toBe(first.lease.claimId);
    expect(reacquired.lease.ownershipToken).not.toBe(first.lease.ownershipToken);
    expect(reacquired.lease.fence).toBe(first.lease.fence + 1);

    clock.setNow(reacquired.lease.expiresAtEpochMs);
    const afterExpiry = acquired(await store.acquire(baseRequest));
    expect(afterExpiry.acquisition).toBe("expired");
    expect(afterExpiry.lease.fence).toBe(reacquired.lease.fence + 1);
  });

  it("conformance: temporal boundary is exclusive and stale authority stays fenced", async () => {
    const { store, clock } = createHarness();
    const first = acquired(await store.acquire(baseRequest));

    clock.setNow(first.lease.expiresAtEpochMs - 1);
    expect(await store.acquire({ ...baseRequest, ownerId: "worker-b" })).toMatchObject({
      status: "owned",
      ownerId: "worker-a",
      fence: first.lease.fence,
    });

    clock.setNow(first.lease.expiresAtEpochMs);
    const second = acquired(
      await store.acquire({ ...baseRequest, ownerId: "worker-b" }),
    );
    expect(second.acquisition).toBe("expired");
    expect(second.lease.fence).toBe(first.lease.fence + 1);

    await expect(Promise.resolve().then(() => store.renew(first.lease, 100))).rejects.toBeInstanceOf(
      RecoveryOwnershipConflictError,
    );
    await store.release(first.lease);
    expect(await store.observe(baseRequest.recoveryId, baseRequest.executionId)).toMatchObject({
      status: "owned",
      ownerId: "worker-b",
      fence: second.lease.fence,
    });
  });

  it("conformance: ownership loss never lets the former owner disturb the successor", async () => {
    const { store } = createHarness();
    const first = acquired(await store.acquire(baseRequest));
    await store.release(first.lease);

    const successor = acquired(
      await store.acquire({ ...baseRequest, ownerId: "worker-b" }),
    );
    await store.release(first.lease);

    await expect(Promise.resolve().then(() => store.renew(first.lease, 100))).rejects.toBeInstanceOf(
      RecoveryOwnershipConflictError,
    );
    expect(await store.observe(baseRequest.recoveryId, baseRequest.executionId)).toMatchObject({
      status: "owned",
      ownerId: "worker-b",
      fence: successor.lease.fence,
    });
  });
}

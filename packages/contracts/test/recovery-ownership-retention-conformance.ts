import { expect, it } from "vitest";

import {
  RecoveryOwnershipConflictError,
  type RecoveryOwnershipAcquireRequest,
  type RecoveryOwnershipStore,
} from "../src/recovery-ownership-store.js";
import type { RecoveryOwnershipLeaseEvidence } from "../src/recovery-ownership-lease-evidence.js";

export interface RecoveryOwnershipRetentionConformanceHarness {
  readonly store: RecoveryOwnershipStore;
  compact(): void | Promise<void>;
  restart():
    | RecoveryOwnershipStore
    | Promise<RecoveryOwnershipStore>;
}

export type CreateRecoveryOwnershipRetentionConformanceHarness =
  () => RecoveryOwnershipRetentionConformanceHarness;

const baseRequest: RecoveryOwnershipAcquireRequest = {
  recoveryId: "retention-recovery",
  executionId: "retention-execution",
  ownerId: "worker-a",
  leaseDurationMs: 100,
};

function acquired(
  result: Awaited<ReturnType<RecoveryOwnershipStore["acquire"]>>,
) {
  expect(result.status).toBe("acquired");
  if (result.status !== "acquired") {
    throw new Error("retention conformance expected ownership acquisition");
  }
  return result;
}

async function rejectsStaleAuthority(
  store: RecoveryOwnershipStore,
  lease: RecoveryOwnershipLeaseEvidence,
): Promise<void> {
  await expect(
    Promise.resolve().then(() => store.renew(lease, 100)),
  ).rejects.toBeInstanceOf(RecoveryOwnershipConflictError);
  await store.release(lease);
}

/**
 * Provider-neutral retention/compaction acceptance scenarios.
 *
 * Durable adapters register this suite only when they expose a real compaction
 * or retention operation. The suite intentionally does not prescribe a storage
 * engine or retention mechanism; it proves that maintenance cannot erase the
 * fencing history required to reject stale authority.
 */
export function recoveryOwnershipRetentionConformance(
  createHarness: CreateRecoveryOwnershipRetentionConformanceHarness,
): void {
  it("retention conformance: compaction preserves the fence and rejects released authority", async () => {
    const harness = createHarness();
    const first = acquired(await harness.store.acquire(baseRequest));
    await harness.store.release(first.lease);

    await harness.compact();
    const restarted = await harness.restart();

    expect(
      await restarted.observe(baseRequest.recoveryId, baseRequest.executionId),
    ).toEqual({ status: "unclaimed", fence: first.lease.fence });
    await rejectsStaleAuthority(restarted, first.lease);

    const successor = acquired(
      await restarted.acquire({ ...baseRequest, ownerId: "worker-b" }),
    );
    expect(successor.lease.fence).toBe(first.lease.fence + 1);
  });

  it("retention conformance: repeated maintenance never makes predecessor authority valid again", async () => {
    const harness = createHarness();
    const first = acquired(await harness.store.acquire(baseRequest));
    await harness.store.release(first.lease);
    const second = acquired(
      await harness.store.acquire({ ...baseRequest, ownerId: "worker-b" }),
    );
    await harness.store.release(second.lease);

    await harness.compact();
    await harness.compact();
    const restarted = await harness.restart();

    expect(
      await restarted.observe(baseRequest.recoveryId, baseRequest.executionId),
    ).toEqual({ status: "unclaimed", fence: second.lease.fence });
    await rejectsStaleAuthority(restarted, first.lease);
    await rejectsStaleAuthority(restarted, second.lease);

    const successor = acquired(
      await restarted.acquire({ ...baseRequest, ownerId: "worker-c" }),
    );
    expect(successor.lease.fence).toBe(second.lease.fence + 1);
  });
}

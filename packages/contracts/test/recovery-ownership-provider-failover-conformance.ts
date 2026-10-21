import { expect, it } from "vitest";

import {
  RecoveryOwnershipConflictError,
  type RecoveryOwnershipAcquireRequest,
  type RecoveryOwnershipStore,
} from "../src/recovery-ownership-store.js";
import type { RecoveryOwnershipLeaseEvidence } from "../src/recovery-ownership-lease-evidence.js";

export type RecoveryOwnershipProviderFailoverFailurePoint =
  | "before-acquire-commit"
  | "after-acquire-commit-before-ack";

/**
 * Provider-neutral failover harness for a concrete durable adapter.
 *
 * `failover()` must make the previously active persistence path unavailable and
 * return a freshly constructed client through the candidate's alternate
 * provider/replica/failover path without copying state through process memory.
 * The returned client must observe only authoritative durable state.
 */
export interface RecoveryOwnershipProviderFailoverHarness {
  readonly primary: RecoveryOwnershipStore;
  setNow(epochMs: number): void | Promise<void>;
  failNext(point: RecoveryOwnershipProviderFailoverFailurePoint): void | Promise<void>;
  failover(): RecoveryOwnershipStore | Promise<RecoveryOwnershipStore>;
}

export type CreateRecoveryOwnershipProviderFailoverHarness =
  () => RecoveryOwnershipProviderFailoverHarness;

const request: RecoveryOwnershipAcquireRequest = {
  recoveryId: "provider-failover-recovery",
  executionId: "provider-failover-execution",
  ownerId: "worker-a",
  leaseDurationMs: 100,
};

function acquired(result: Awaited<ReturnType<RecoveryOwnershipStore["acquire"]>>) {
  expect(result.status).toBe("acquired");
  if (result.status !== "acquired") throw new Error("expected ownership acquisition");
  return result;
}

async function expectRejected(operation: () => unknown | Promise<unknown>) {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}

async function expectStaleAuthorityRejected(
  store: RecoveryOwnershipStore,
  lease: RecoveryOwnershipLeaseEvidence,
) {
  await expect(Promise.resolve().then(() => store.renew(lease, 100))).rejects.toBeInstanceOf(
    RecoveryOwnershipConflictError,
  );
  await expect(Promise.resolve().then(() => store.release(lease))).rejects.toBeInstanceOf(
    RecoveryOwnershipConflictError,
  );
}

/**
 * Mandatory provider-failover scenarios for a real durable ownership adapter.
 * This suite cannot be satisfied by the process-local reference store: the
 * harness must switch persistence paths and construct a fresh client.
 */
export function recoveryOwnershipProviderFailoverConformance(
  createHarness: CreateRecoveryOwnershipProviderFailoverHarness,
): void {
  it("provider failover: live authority remains singular and visible", async () => {
    const harness = createHarness();
    const first = acquired(await harness.primary.acquire(request));
    const failedOver = await harness.failover();

    expect(await failedOver.acquire({ ...request, ownerId: "worker-b" })).toMatchObject({
      status: "owned",
      ownerId: "worker-a",
      fence: first.lease.fence,
      expiresAtEpochMs: first.lease.expiresAtEpochMs,
    });
  });

  it("provider failover: expiry takeover advances the durable fence", async () => {
    const harness = createHarness();
    const first = acquired(await harness.primary.acquire(request));
    await harness.setNow(first.lease.expiresAtEpochMs);
    const failedOver = await harness.failover();

    const successor = acquired(
      await failedOver.acquire({ ...request, ownerId: "worker-b" }),
    );
    expect(successor.acquisition).toBe("expired");
    expect(successor.lease.fence).toBe(first.lease.fence + 1);
    await expectStaleAuthorityRejected(failedOver, first.lease);
  });

  it("provider failover: acknowledgement loss reconciles the committed authority", async () => {
    const harness = createHarness();
    await harness.failNext("after-acquire-commit-before-ack");
    await expectRejected(() => harness.primary.acquire(request));
    const failedOver = await harness.failover();

    expect(await failedOver.acquire({ ...request, ownerId: "worker-b" })).toMatchObject({
      status: "owned",
      ownerId: "worker-a",
      fence: 1,
    });
  });

  it("provider failover: pre-commit failure does not manufacture authority", async () => {
    const harness = createHarness();
    await harness.failNext("before-acquire-commit");
    await expectRejected(() => harness.primary.acquire(request));
    const failedOver = await harness.failover();

    const successor = acquired(
      await failedOver.acquire({ ...request, ownerId: "worker-b" }),
    );
    expect(successor.acquisition).toBe("new");
    expect(successor.lease.fence).toBe(1);
  });

  it("provider failover: released authority stays fenced across the alternate path", async () => {
    const harness = createHarness();
    const first = acquired(await harness.primary.acquire(request));
    await harness.primary.release(first.lease);
    const failedOver = await harness.failover();
    const successor = acquired(
      await failedOver.acquire({ ...request, ownerId: "worker-b" }),
    );

    expect(successor.acquisition).toBe("released");
    expect(successor.lease.fence).toBe(first.lease.fence + 1);
    await expectStaleAuthorityRejected(failedOver, first.lease);
  });
}

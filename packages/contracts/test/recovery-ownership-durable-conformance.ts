import { expect, it } from "vitest";

import {
  RecoveryOwnershipConflictError,
  type RecoveryOwnershipAcquireRequest,
  type RecoveryOwnershipLease,
  type RecoveryOwnershipStore,
} from "../src/recovery-ownership-store.js";

export interface DurableRecoveryOwnershipConformanceClock {
  setNow(value: number): void;
}

export type DurableRecoveryOwnershipFailurePoint =
  | "before-acquire-commit"
  | "after-acquire-commit-before-ack";

/**
 * A durable adapter harness must return independent adapter instances backed by
 * the same durable state. restart() must discard the current adapter instance
 * and return a fresh one without clearing durable ownership/fence history.
 *
 * Failure injection is deliberately provider-neutral: implementations map the
 * two named points onto their own transaction/commit mechanism while preserving
 * the externally observable semantics required by this conformance suite.
 */
export interface DurableRecoveryOwnershipConformanceHarness {
  readonly first: RecoveryOwnershipStore;
  readonly second: RecoveryOwnershipStore;
  readonly clock: DurableRecoveryOwnershipConformanceClock;
  restart(): RecoveryOwnershipStore | Promise<RecoveryOwnershipStore>;
  failNext(point: DurableRecoveryOwnershipFailurePoint): void | Promise<void>;
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
  lease: RecoveryOwnershipLease,
) {
  await expect(
    Promise.resolve().then(() => store.renew(lease, 100)),
  ).rejects.toBeInstanceOf(RecoveryOwnershipConflictError);
  await expect(
    Promise.resolve().then(() => store.release(lease)),
  ).rejects.toBeInstanceOf(RecoveryOwnershipConflictError);
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

    await expectStaleAuthorityRejected(restarted, first.lease);
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

    await expectStaleAuthorityRejected(restarted, first.lease);
  });

  it("durable conformance: acknowledgement loss reconciles one authoritative claim", async () => {
    const harness = createHarness();
    await harness.failNext("after-acquire-commit-before-ack");
    await expectRejected(() => harness.first.acquire(baseRequest));

    const restarted = await harness.restart();
    const observed = await restarted.acquire({ ...baseRequest, ownerId: "worker-b" });
    expect(observed).toMatchObject({
      status: "owned",
      ownerId: "worker-a",
      fence: 1,
    });

    const retry = await restarted.acquire(baseRequest);
    expect(retry).toMatchObject({
      status: "owned",
      ownerId: "worker-a",
      fence: 1,
    });
  });

  it("durable conformance: pre-commit failure creates no observable ownership", async () => {
    const harness = createHarness();
    await harness.failNext("before-acquire-commit");
    await expectRejected(() => harness.first.acquire(baseRequest));

    const restarted = await harness.restart();
    const successor = acquired(
      await restarted.acquire({ ...baseRequest, ownerId: "worker-b" }),
    );
    expect(successor.acquisition).toBe("new");
    expect(successor.lease.fence).toBe(1);
  });

  it("durable conformance: replayed or identity-substituted stale authority cannot disturb a successor", async () => {
    const harness = createHarness();
    const first = acquired(await harness.first.acquire(baseRequest));
    await harness.first.release(first.lease);
    const restarted = await harness.restart();
    const successor = acquired(
      await restarted.acquire({ ...baseRequest, ownerId: "worker-b" }),
    );

    await expectStaleAuthorityRejected(restarted, first.lease);

    const substituted = {
      ...first.lease,
      ownerId: successor.lease.ownerId,
    };
    await expectStaleAuthorityRejected(restarted, substituted);
  });
}

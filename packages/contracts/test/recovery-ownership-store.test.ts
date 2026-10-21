import { describe, expect, it } from "vitest";

import {
  InMemoryRecoveryOwnershipStore,
  RecoveryOwnershipConflictError,
} from "../src/recovery-ownership-store.js";

function createHarness() {
  let now = 1_000;
  let claim = 0;
  let token = 0;
  const store = new InMemoryRecoveryOwnershipStore({
    nowEpochMs: () => now,
    createClaimId: () => `claim-${String(++claim)}`,
    createOwnershipToken: () => `token-${String(++token)}`,
    maxLeaseDurationMs: 1_000,
  });
  return {
    store,
    setNow(value: number) {
      now = value;
    },
  };
}

const request = {
  recoveryId: "recovery-1",
  executionId: "execution-1",
  ownerId: "worker-1",
  leaseDurationMs: 100,
} as const;

describe("provider-neutral recovery ownership store", () => {
  it("admits exactly one competing owner and keeps authority opaque", async () => {
    const { store } = createHarness();
    const [first, second] = await Promise.all([
      store.acquire(request),
      store.acquire({ ...request, ownerId: "worker-2" }),
    ]);

    expect(first.status).toBe("acquired");
    expect(second).toMatchObject({
      status: "owned",
      ownerId: "worker-1",
      fence: 1,
    });
    expect(second).not.toHaveProperty("ownershipToken");
    expect(second).not.toHaveProperty("claimId");
  });

  it("reacquires after expiry with fresh authority and a higher fence", () => {
    const harness = createHarness();
    const first = harness.store.acquire(request);
    if (first.status !== "acquired") throw new Error("expected acquisition");

    harness.setNow(1_101);
    const second = harness.store.acquire({ ...request, ownerId: "worker-2" });
    if (second.status !== "acquired") throw new Error("expected reacquisition");

    expect(second.acquisition).toBe("expired");
    expect(second.lease.fence).toBe(2);
    expect(second.lease.claimId).not.toBe(first.lease.claimId);
    expect(second.lease.ownershipToken).not.toBe(first.lease.ownershipToken);
  });

  it("fences stale owners from renewal and cannot release the current owner", () => {
    const harness = createHarness();
    const stale = harness.store.acquire(request);
    if (stale.status !== "acquired") throw new Error("expected acquisition");

    harness.setNow(1_101);
    const current = harness.store.acquire({ ...request, ownerId: "worker-2" });
    if (current.status !== "acquired") throw new Error("expected reacquisition");

    expect(() => harness.store.renew(stale.lease, 100)).toThrow(
      RecoveryOwnershipConflictError,
    );
    harness.store.release(stale.lease);
    expect(harness.store.observe(request.recoveryId, request.executionId)).toMatchObject({
      status: "owned",
      ownerId: "worker-2",
      fence: 2,
    });
  });

  it("renews only the exact live lease without changing authority or fence", () => {
    const harness = createHarness();
    const acquired = harness.store.acquire(request);
    if (acquired.status !== "acquired") throw new Error("expected acquisition");

    harness.setNow(1_050);
    const renewed = harness.store.renew(acquired.lease, 100);
    expect(renewed).toMatchObject({
      claimId: acquired.lease.claimId,
      ownershipToken: acquired.lease.ownershipToken,
      fence: acquired.lease.fence,
      expiresAtEpochMs: 1_150,
    });
    expect(() => harness.store.renew(acquired.lease, 100)).toThrow(
      RecoveryOwnershipConflictError,
    );
  });

  it("rejects renewal at expiry and advances fencing after explicit release", () => {
    const harness = createHarness();
    const acquired = harness.store.acquire(request);
    if (acquired.status !== "acquired") throw new Error("expected acquisition");

    harness.setNow(1_100);
    expect(() => harness.store.renew(acquired.lease, 100)).toThrow(
      "expired recovery ownership lease cannot be renewed",
    );

    harness.setNow(1_050);
    harness.store.release(acquired.lease);
    const next = harness.store.acquire({ ...request, ownerId: "worker-2" });
    if (next.status !== "acquired") throw new Error("expected reacquisition");
    expect(next).toMatchObject({ acquisition: "released", lease: { fence: 2 } });
  });

  it("fails closed when authority material is reused", () => {
    let now = 1_000;
    const store = new InMemoryRecoveryOwnershipStore({
      nowEpochMs: () => now,
      createClaimId: () => "claim-fixed",
      createOwnershipToken: () => "token-fixed",
      maxLeaseDurationMs: 1_000,
    });
    const first = store.acquire(request);
    if (first.status !== "acquired") throw new Error("expected acquisition");
    now = 1_101;

    expect(() => store.acquire({ ...request, ownerId: "worker-2" })).toThrow(
      "reused issued material",
    );
    expect(store.observe(request.recoveryId, request.executionId)).toEqual({
      status: "unclaimed",
      fence: 1,
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  ExternalEffectOwnershipConflictError,
  InMemoryExternalEffectOwnershipStore,
} from "../src/external-effect-ownership.js";
import type {
  ExternalEffectIdentity,
  ExternalEffectReceipt,
} from "../src/external-effect.js";

const identity: ExternalEffectIdentity = {
  idempotencyKey: "execution-1:publish-change",
  executionId: "execution-1",
  stepId: "publish-change",
  effectType: "github.commit.create",
};

const receipt: ExternalEffectReceipt = {
  ...identity,
  providerReference: "commit:abc123",
  committedAt: "2026-08-04T03:45:00.000Z",
  payloadDigest: `sha256:${"a".repeat(64)}`,
  metadata: {
    repository: "UniversalStandards/atlantis-ai-enhanced",
  },
};

function createHarness() {
  let currentTime = "2026-08-04T08:00:00.000Z";
  let tokenNumber = 0;
  const store = new InMemoryExternalEffectOwnershipStore({
    now: () => currentTime,
    createClaimToken: () => {
      tokenNumber += 1;
      return `claim-token-${String(tokenNumber)}`;
    },
    maxLeaseDurationMs: 60_000,
  });
  return {
    store,
    setTime(value: string) {
      currentTime = value;
    },
  };
}

describe("atomic external-effect ownership", () => {
  it("allows exactly one concurrent acquisition and does not expose its token", async () => {
    const { store } = createHarness();
    const [first, second] = await Promise.all([
      store.acquire(identity, {
        ownerId: "worker-1",
        leaseDurationMs: 30_000,
      }),
      store.acquire(identity, {
        ownerId: "worker-2",
        leaseDurationMs: 30_000,
      }),
    ]);

    expect(first.status).toBe("acquired");
    expect(second).toMatchObject({
      status: "owned",
      ownerId: "worker-1",
      generation: 1,
    });
    expect(second).not.toHaveProperty("claimToken");
  });

  it("returns a committed receipt to every later caller", () => {
    const { store } = createHarness();
    const acquired = store.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
    });
    if (acquired.status !== "acquired") {
      throw new Error("expected ownership acquisition");
    }

    expect(store.commit(acquired.claim, receipt)).toEqual(receipt);
    expect(
      store.acquire(identity, {
        ownerId: "worker-2",
        leaseDurationMs: 30_000,
      }),
    ).toEqual({
      status: "committed",
      identity,
      receipt,
      generation: 1,
    });
    expect(store.observe(identity)).toEqual({
      status: "committed",
      identity,
      receipt,
      generation: 1,
    });
  });

  it("recovers an expired lease with a higher fencing generation", () => {
    const harness = createHarness();
    const first = harness.store.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
    });
    if (first.status !== "acquired") {
      throw new Error("expected first acquisition");
    }

    harness.setTime("2026-08-04T08:00:31.000Z");
    const recovered = harness.store.acquire(identity, {
      ownerId: "worker-2",
      leaseDurationMs: 30_000,
    });
    expect(recovered).toMatchObject({
      status: "acquired",
      acquisition: "expired",
      claim: {
        ownerId: "worker-2",
        generation: 2,
      },
    });
    if (recovered.status !== "acquired") {
      throw new Error("expected recovery acquisition");
    }
    expect(recovered.claim.claimToken).not.toBe(first.claim.claimToken);
  });

  it("fences a stale owner from renew, commit, and release", () => {
    const harness = createHarness();
    const stale = harness.store.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
    });
    if (stale.status !== "acquired") {
      throw new Error("expected first acquisition");
    }
    harness.setTime("2026-08-04T08:00:31.000Z");
    const current = harness.store.acquire(identity, {
      ownerId: "worker-2",
      leaseDurationMs: 30_000,
    });
    if (current.status !== "acquired") {
      throw new Error("expected recovery acquisition");
    }

    expect(() =>
      harness.store.renew(stale.claim, {
        leaseDurationMs: 30_000,
      }),
    ).toThrow(ExternalEffectOwnershipConflictError);
    expect(() => harness.store.commit(stale.claim, receipt)).toThrow(
      ExternalEffectOwnershipConflictError,
    );
    harness.store.release(stale.claim, "pre_execution_failure");
    expect(harness.store.observe(identity)).toMatchObject({
      status: "owned",
      ownerId: "worker-2",
      generation: 2,
    });
  });

  it("renews only the exact live claim without changing token or generation", () => {
    const harness = createHarness();
    const acquired = harness.store.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
    });
    if (acquired.status !== "acquired") {
      throw new Error("expected ownership acquisition");
    }
    harness.setTime("2026-08-04T08:00:10.000Z");

    const renewed = harness.store.renew(acquired.claim, {
      leaseDurationMs: 30_000,
    });
    expect(renewed).toMatchObject({
      claimToken: acquired.claim.claimToken,
      generation: acquired.claim.generation,
      expiresAt: "2026-08-04T08:00:40.000Z",
    });
    expect(() =>
      harness.store.renew(acquired.claim, {
        leaseDurationMs: 30_000,
      }),
    ).toThrow(ExternalEffectOwnershipConflictError);
  });

  it("does not resurrect an expired claim through renewal", () => {
    const harness = createHarness();
    const acquired = harness.store.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
    });
    if (acquired.status !== "acquired") {
      throw new Error("expected ownership acquisition");
    }
    harness.setTime("2026-08-04T08:00:30.000Z");

    expect(() =>
      harness.store.renew(acquired.claim, {
        leaseDurationMs: 30_000,
      }),
    ).toThrow("expired external-effect claim cannot be renewed");
  });

  it("keeps observation read-only and hides the opaque token", () => {
    const { store } = createHarness();
    const acquired = store.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
    });
    if (acquired.status !== "acquired") {
      throw new Error("expected ownership acquisition");
    }

    const first = store.observe(identity);
    const second = store.observe(identity);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "owned",
      ownerId: "worker-1",
      generation: 1,
    });
    expect(first).not.toHaveProperty("claimToken");
  });

  it("releases only the exact live claim and advances the next generation", () => {
    const { store } = createHarness();
    const first = store.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
    });
    if (first.status !== "acquired") {
      throw new Error("expected ownership acquisition");
    }

    store.release(first.claim, "pre_execution_failure");
    expect(store.observe(identity)).toEqual({
      status: "unclaimed",
      identity,
      generation: 1,
    });
    expect(
      store.acquire(identity, {
        ownerId: "worker-2",
        leaseDurationMs: 30_000,
      }),
    ).toMatchObject({
      status: "acquired",
      acquisition: "released",
      claim: {
        generation: 2,
      },
    });
  });

  it("rejects invalid or over-limit leases without mutating ownership", () => {
    const { store } = createHarness();

    expect(
      store.acquire(identity, {
        ownerId: "worker-1",
        leaseDurationMs: 60_001,
      }),
    ).toMatchObject({
      status: "rejected",
      reason: "invalid_lease_duration",
    });
    expect(store.observe(identity)).toEqual({
      status: "unclaimed",
      identity,
      generation: 0,
    });
  });

  it("fails closed on mismatched receipt identity", () => {
    const { store } = createHarness();
    const acquired = store.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
    });
    if (acquired.status !== "acquired") {
      throw new Error("expected ownership acquisition");
    }

    expect(() =>
      store.commit(acquired.claim, {
        ...receipt,
        executionId: "execution-2",
      }),
    ).toThrow("executionId does not match");
    expect(store.observe(identity)).toMatchObject({
      status: "owned",
      generation: 1,
    });
  });
});

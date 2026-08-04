import { describe, expect, it, vi } from "vitest";
import {
  ObservableExternalEffectOwnershipStore,
  type ExternalEffectOwnershipLifecycleEvent,
} from "../src/observable-external-effect-ownership-store.js";
import type {
  ExternalEffectClaim,
  ExternalEffectOwnershipStore,
} from "../src/external-effect-ownership.js";
import type {
  ExternalEffectIdentity,
  ExternalEffectReceipt,
} from "../src/external-effect.js";

const identity: ExternalEffectIdentity = Object.freeze({
  idempotencyKey: "github:pull-request:10",
  executionId: "execution-observable-ownership",
  stepId: "comment-progress",
  effectType: "github.issue.comment",
});

const claim: ExternalEffectClaim = Object.freeze({
  ...identity,
  claimToken: "claim-token-1",
  ownerId: "worker-1",
  acquiredAt: "2026-08-04T12:00:00.000Z",
  expiresAt: "2026-08-04T12:01:00.000Z",
  generation: 1,
});

const receipt: ExternalEffectReceipt = Object.freeze({
  ...identity,
  providerReference: "github-comment-1",
  committedAt: "2026-08-04T12:00:10.000Z",
  payloadDigest: "sha256:receipt-1",
  metadata: Object.freeze({ repository: "UniversalStandards/atlantis-ai-enhanced" }),
});

function createStore(): ExternalEffectOwnershipStore {
  return {
    acquire: vi.fn().mockResolvedValue(
      Object.freeze({
        status: "acquired",
        identity,
        claim,
        acquisition: "new",
      }),
    ),
    renew: vi.fn().mockResolvedValue(claim),
    commit: vi.fn().mockResolvedValue(receipt),
    release: vi.fn().mockResolvedValue(undefined),
    observe: vi.fn().mockResolvedValue(
      Object.freeze({
        status: "owned",
        identity,
        ownerId: claim.ownerId,
        acquiredAt: claim.acquiredAt,
        expiresAt: claim.expiresAt,
        generation: claim.generation,
      }),
    ),
  };
}

describe("ObservableExternalEffectOwnershipStore", () => {
  it("emits lifecycle events after authoritative operations", async () => {
    const events: ExternalEffectOwnershipLifecycleEvent[] = [];
    const decorated = new ObservableExternalEffectOwnershipStore(createStore(), {
      onLifecycleEvent(event) {
        events.push(event);
      },
    });

    const acquired = await decorated.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 60_000,
    });
    const committed = await decorated.commit(claim, receipt);

    expect(acquired.status).toBe("acquired");
    expect(committed).toBe(receipt);
    expect(events.map((event) => event.type)).toEqual([
      "ownership.acquired",
      "ownership.receipt_committed",
    ]);
  });

  it("reports observer failure without changing the ownership result", async () => {
    const authoritative = createStore();
    const observationErrors: unknown[] = [];
    const decorated = new ObservableExternalEffectOwnershipStore(authoritative, {
      onLifecycleEvent() {
        throw new Error("evidence sink unavailable");
      },
      onLifecycleObservationError(error) {
        observationErrors.push(error);
      },
    });

    const result = await decorated.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 60_000,
    });

    expect(result.status).toBe("acquired");
    expect(authoritative.acquire).toHaveBeenCalledOnce();
    expect(observationErrors).toHaveLength(1);
    expect(observationErrors[0]).toBeInstanceOf(Error);
  });

  it("isolates authoritative results from observer mutation", async () => {
    const mutableClaim = { ...claim };
    const mutableResult = {
      status: "acquired" as const,
      identity: { ...identity },
      claim: mutableClaim,
      acquisition: "new" as const,
    };
    const authoritative = createStore();
    vi.mocked(authoritative.acquire).mockResolvedValueOnce(mutableResult);
    const observationErrors: unknown[] = [];
    const decorated = new ObservableExternalEffectOwnershipStore(authoritative, {
      onLifecycleEvent(event) {
        if (event.type === "ownership.acquired") {
          (event.result.claim as { ownerId: string }).ownerId = "observer-mutated";
        }
      },
      onLifecycleObservationError(error) {
        observationErrors.push(error);
      },
    });

    const result = await decorated.acquire(identity, {
      ownerId: "worker-1",
      leaseDurationMs: 60_000,
    });

    expect(result).toBe(mutableResult);
    expect(result.status).toBe("acquired");
    if (result.status !== "acquired") {
      throw new Error("expected acquired ownership result");
    }
    expect(result.claim.ownerId).toBe("worker-1");
    expect(mutableClaim.ownerId).toBe("worker-1");
    expect(observationErrors).toHaveLength(1);
  });

  it("does not emit success evidence when the authoritative store rejects", async () => {
    const authoritative = createStore();
    vi.mocked(authoritative.commit).mockRejectedValueOnce(
      new Error("stale fencing generation"),
    );
    const onLifecycleEvent = vi.fn();
    const decorated = new ObservableExternalEffectOwnershipStore(authoritative, {
      onLifecycleEvent,
    });

    await expect(decorated.commit(claim, receipt)).rejects.toThrow(
      "stale fencing generation",
    );
    expect(onLifecycleEvent).not.toHaveBeenCalled();
  });
});

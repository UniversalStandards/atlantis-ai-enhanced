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
  idempotencyKey: "github:pull-request:10:error-reporter-settlement",
  executionId: "execution-observable-error-settlement",
  stepId: "record-progress",
  effectType: "github.issue.comment",
});

const claim: ExternalEffectClaim = Object.freeze({
  ...identity,
  claimToken: "claim-token-error-settlement",
  ownerId: "worker-error-settlement",
  acquiredAt: "2026-08-04T16:00:00.000Z",
  expiresAt: "2026-08-04T16:01:00.000Z",
  generation: 1,
});

const receipt: ExternalEffectReceipt = Object.freeze({
  ...identity,
  providerReference: "github-comment-error-settlement",
  committedAt: "2026-08-04T16:00:10.000Z",
  payloadDigest: "sha256:error-settlement",
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

describe("ObservableExternalEffectOwnershipStore error-reporter settlement", () => {
  it("isolates late error-reporter settlement after its deadline", async () => {
    const authoritative = createStore();
    const lifecycleEvents: ExternalEffectOwnershipLifecycleEvent[] = [];
    const observationErrors: unknown[] = [];
    let settleErrorReporter: (() => void) | undefined;
    const errorReporterSettled = new Promise<void>((resolve) => {
      settleErrorReporter = resolve;
    });

    const decorated = new ObservableExternalEffectOwnershipStore(
      authoritative,
      {
        onLifecycleEvent(event) {
          lifecycleEvents.push(event);
          throw new Error("evidence sink unavailable");
        },
        onLifecycleObservationError(error) {
          observationErrors.push(error);
          return errorReporterSettled;
        },
      },
      { observationTimeoutMs: 10 },
    );

    const result = await decorated.acquire(identity, {
      ownerId: claim.ownerId,
      leaseDurationMs: 60_000,
    });

    expect(result.status).toBe("acquired");
    expect(authoritative.acquire).toHaveBeenCalledOnce();
    expect(lifecycleEvents).toHaveLength(1);
    expect(lifecycleEvents[0]?.type).toBe("ownership.acquired");
    expect(observationErrors).toHaveLength(1);
    expect(observationErrors[0]).toBeInstanceOf(Error);

    settleErrorReporter?.();
    await errorReporterSettled;
    await Promise.resolve();

    expect(result.status).toBe("acquired");
    expect(lifecycleEvents).toHaveLength(1);
    expect(observationErrors).toHaveLength(1);
    expect(authoritative.acquire).toHaveBeenCalledOnce();
  });
});

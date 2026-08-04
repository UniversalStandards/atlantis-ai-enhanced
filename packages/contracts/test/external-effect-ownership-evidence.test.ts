import { describe, expect, it, vi } from "vitest";
import {
  createExternalEffectOwnershipEvidenceObserver,
  type ExternalEffectOwnershipExecutionEvent,
} from "../src/external-effect-ownership-evidence.js";
import type { ExternalEffectOwnershipLifecycleEvent } from "../src/observable-external-effect-ownership-store.js";
import type { ExternalEffectClaim } from "../src/external-effect-ownership.js";
import type {
  ExternalEffectIdentity,
  ExternalEffectReceipt,
} from "../src/external-effect.js";

const identity: ExternalEffectIdentity = Object.freeze({
  idempotencyKey: "github:pull-request:10",
  executionId: "execution-ownership-evidence",
  stepId: "comment-progress",
  effectType: "github.issue.comment",
});

const claim: ExternalEffectClaim = Object.freeze({
  ...identity,
  claimToken: "claim-token-1",
  ownerId: "worker-1",
  acquiredAt: "2026-08-04T13:00:00.000Z",
  expiresAt: "2026-08-04T13:01:00.000Z",
  generation: 1,
});

const receipt: ExternalEffectReceipt = Object.freeze({
  ...identity,
  providerReference: "github-comment-1",
  committedAt: "2026-08-04T13:00:10.000Z",
  payloadDigest: "sha256:receipt-1",
  metadata: Object.freeze({ repository: "UniversalStandards/atlantis-ai-enhanced" }),
});

const acquired: ExternalEffectOwnershipLifecycleEvent = Object.freeze({
  type: "ownership.acquired",
  result: Object.freeze({
    status: "acquired",
    identity,
    claim,
    acquisition: "new",
  }),
});

const committed: ExternalEffectOwnershipLifecycleEvent = Object.freeze({
  type: "ownership.receipt_committed",
  claim,
  receipt,
});

describe("createExternalEffectOwnershipEvidenceObserver", () => {
  it("appends contiguous lifecycle evidence with parent linkage", async () => {
    const events: ExternalEffectOwnershipExecutionEvent[] = [];
    const ids = ["event-11", "event-12"];
    const observer = createExternalEffectOwnershipEvidenceObserver({
      eventSink: {
        async append(event) {
          events.push(event);
        },
      },
      executionId: identity.executionId,
      actor: "ownership-store",
      initialSequence: 10,
      parentEventId: "event-10",
      createEventId: () => ids.shift() ?? "unexpected-event",
      now: () => "2026-08-04T13:00:20.000Z",
    });

    await observer.onLifecycleEvent(acquired);
    await observer.onLifecycleEvent(committed);

    expect(events.map((event) => event.type)).toEqual([
      "external.effect.ownership.acquired",
      "external.effect.ownership.receipt_committed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([11, 12]);
    expect(events.map((event) => event.parentEventId)).toEqual([
      "event-10",
      "event-11",
    ]);
    expect(events[0]?.payload.lifecycle).toBe(acquired);
    expect(events[1]?.payload.lifecycle).toBe(committed);
  });

  it("does not advance the stream tail when append fails", async () => {
    const append = vi
      .fn<(event: ExternalEffectOwnershipExecutionEvent) => Promise<void>>()
      .mockRejectedValueOnce(new Error("durable sink unavailable"))
      .mockResolvedValueOnce(undefined);
    const observer = createExternalEffectOwnershipEvidenceObserver({
      eventSink: { append },
      executionId: identity.executionId,
      actor: "ownership-store",
      initialSequence: 4,
      parentEventId: "event-4",
      createEventId: () => "event-5",
      now: () => "2026-08-04T13:00:20.000Z",
    });

    await expect(observer.onLifecycleEvent(acquired)).rejects.toThrow(
      "durable sink unavailable",
    );
    await observer.onLifecycleEvent(acquired);

    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[0].sequence).toBe(5);
    expect(append.mock.calls[1]?.[0].sequence).toBe(5);
    expect(append.mock.calls[1]?.[0].parentEventId).toBe("event-4");
  });

  it("rejects lifecycle evidence from another execution before append", async () => {
    const append = vi.fn();
    const observer = createExternalEffectOwnershipEvidenceObserver({
      eventSink: { append },
      executionId: "different-execution",
      actor: "ownership-store",
      initialSequence: 0,
      createEventId: () => "event-1",
      now: () => "2026-08-04T13:00:20.000Z",
    });

    await expect(observer.onLifecycleEvent(acquired)).rejects.toThrow(
      "executionId does not match evidence context",
    );
    expect(append).not.toHaveBeenCalled();
  });
});

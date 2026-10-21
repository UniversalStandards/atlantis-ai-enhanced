import { describe, expect, it, vi } from "vitest";

import {
  createExternalEffectOwnershipEvidenceObserver,
  type ExternalEffectOwnershipExecutionEvent,
} from "../src/external-effect-ownership-evidence.js";
import type { ExternalEffectOwnershipLifecycleEvent } from "../src/observable-external-effect-ownership-store.js";

const executionId = "execution-array-hardening";

function lifecycleWithMetadata(metadata: unknown): ExternalEffectOwnershipLifecycleEvent {
  return {
    type: "ownership.acquired",
    result: {
      status: "acquired",
      identity: {
        idempotencyKey: "execution-array-hardening:publish",
        executionId,
        stepId: "publish",
        effectType: "github.commit.create",
      },
      claim: {
        idempotencyKey: "execution-array-hardening:publish",
        executionId,
        stepId: "publish",
        effectType: "github.commit.create",
        ownerId: "worker-1",
        claimToken: "top-level-secret",
        acquiredAt: "2026-08-05T20:00:00.000Z",
        expiresAt: "2026-08-05T20:01:00.000Z",
        generation: 1,
      },
      acquisition: "new",
      metadata,
    },
  } as ExternalEffectOwnershipLifecycleEvent;
}

function observerFor(
  append: (event: ExternalEffectOwnershipExecutionEvent) => Promise<void>,
) {
  return createExternalEffectOwnershipEvidenceObserver({
    eventSink: { append },
    executionId,
    actor: "ownership-store",
    initialSequence: 0,
    createEventId: () => "event-1",
    now: () => "2026-08-05T20:00:10.000Z",
  });
}

describe("ownership evidence array snapshot hardening", () => {
  it("rejects accessor-backed array indexes without invoking the getter", async () => {
    let getterCalls = 0;
    const metadata: unknown[] = [];
    Object.defineProperty(metadata, "0", {
      get() {
        getterCalls += 1;
        return { claimToken: "accessor-secret" };
      },
      enumerable: true,
      configurable: true,
    });
    metadata.length = 1;
    const append = vi.fn<
      (event: ExternalEffectOwnershipExecutionEvent) => Promise<void>
    >();

    await expect(
      observerFor(append).onLifecycleEvent(lifecycleWithMetadata(metadata)),
    ).rejects.toThrow(
      "lifecycle.result.metadata[0] must be an enumerable data property",
    );

    expect(getterCalls).toBe(0);
    expect(append).not.toHaveBeenCalled();
  });

  it("rejects custom array prototypes before append", async () => {
    const metadata = [{ audit: "unsafe-prototype" }];
    Object.setPrototypeOf(metadata, Object.create(Array.prototype));
    const append = vi.fn<
      (event: ExternalEffectOwnershipExecutionEvent) => Promise<void>
    >();

    await expect(
      observerFor(append).onLifecycleEvent(lifecycleWithMetadata(metadata)),
    ).rejects.toThrow(
      "lifecycle.result.metadata must contain only standard arrays",
    );

    expect(append).not.toHaveBeenCalled();
  });

  it("snapshots standard arrays as frozen data while redacting nested tokens", async () => {
    const events: ExternalEffectOwnershipExecutionEvent[] = [];
    const metadata = [{ claimToken: "nested-secret", audit: "retained" }];

    await observerFor(async (event) => {
      events.push(event);
    }).onLifecycleEvent(lifecycleWithMetadata(metadata));

    const lifecycle = events[0]?.payload.lifecycle as unknown as {
      result: { metadata: readonly Record<string, unknown>[] };
    };
    expect(Array.isArray(lifecycle.result.metadata)).toBe(true);
    expect(Object.getPrototypeOf(lifecycle.result.metadata)).toBe(Array.prototype);
    expect(Object.isFrozen(lifecycle.result.metadata)).toBe(true);
    expect(Object.isFrozen(lifecycle.result.metadata[0])).toBe(true);
    expect(JSON.stringify(events)).not.toContain("nested-secret");
    expect(JSON.stringify(events)).toContain("[REDACTED]");
    expect(JSON.stringify(events)).toContain("retained");
  });
});

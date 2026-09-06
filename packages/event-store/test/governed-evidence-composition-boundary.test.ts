import { describe, expect, it, vi } from "vitest";

import { ExternalEffectOwnershipLostError } from "@atlantis/contracts/external-effect-execution";
import type { ExternalEffectClaim } from "@atlantis/contracts/external-effect-ownership";
import type { ExternalEffectOwnershipLifecycleEvent } from "@atlantis/contracts/observable-external-effect-ownership-store";

import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import { createDurableOwnershipEvidenceObserver } from "../src/external-effect-ownership-evidence-context.js";
import { withDurableOwnershipLossEvidence } from "../src/external-effect-ownership-loss-context.js";
import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
} from "../src/index.js";

const claim: ExternalEffectClaim = Object.freeze({
  idempotencyKey: "execution-1:publish-change",
  executionId: "execution-1",
  stepId: "publish-change",
  effectType: "github.commit.create",
  ownerId: "worker-1",
  claimToken: "opaque-secret-token",
  acquiredAt: "2026-08-05T17:00:00.000Z",
  expiresAt: "2026-08-05T17:00:30.000Z",
  generation: 4,
});

const acquired: ExternalEffectOwnershipLifecycleEvent = Object.freeze({
  type: "ownership.acquired",
  result: Object.freeze({
    status: "acquired",
    identity: Object.freeze({
      idempotencyKey: claim.idempotencyKey,
      executionId: claim.executionId,
      stepId: claim.stepId,
      effectType: claim.effectType,
    }),
    claim,
    acquisition: "new",
  }),
});

describe("governed evidence composition boundary", () => {
  it("keeps lifecycle and ownership-loss evidence off compatibility append", async () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const eventSink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    );
    const compatibilityAppend = vi
      .spyOn(eventSink, "append")
      .mockRejectedValue(new Error("compatibility append must remain unreachable"));
    const eventIds = ["ownership-acquired", "ownership-lost"];
    const options = {
      eventSink,
      executionId: "execution-1",
      actor: "external-effect-runtime",
      createEventId: () => eventIds.shift() ?? "unexpected-event",
      now: () => "2026-08-05T17:00:10.000Z",
    };

    const observer = createDurableOwnershipEvidenceObserver(options);
    await observer.onLifecycleEvent(acquired);

    const ownershipLoss = new ExternalEffectOwnershipLostError(
      "provider_execution",
      claim,
      new Error("claim superseded"),
    );
    await expect(
      withDurableOwnershipLossEvidence(options, () => Promise.reject(ownershipLoss)),
    ).rejects.toBe(ownershipLoss);

    expect(compatibilityAppend).not.toHaveBeenCalled();

    const events = eventSink.readExecution("execution-1");
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.map((event) => event.id)).toEqual([
      "ownership-acquired",
      "ownership-lost",
    ]);
    expect(events[0]).not.toHaveProperty("parentEventId");
    expect(events[1]).toMatchObject({
      parentEventId: "ownership-acquired",
      type: "external.effect.ownership.lost",
    });
    expect(JSON.stringify(events)).not.toContain(claim.claimToken);

    const restarted = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    );
    expect(restarted.readExecution("execution-1")).toEqual(events);
  });
});

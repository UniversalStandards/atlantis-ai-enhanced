import { describe, expect, it } from "vitest";

import { ExternalEffectOwnershipLostError } from "@atlantis/contracts/external-effect-execution";
import type { ExternalEffectClaim } from "@atlantis/contracts/external-effect-ownership";
import type { ExternalEffectOwnershipLifecycleEvent } from "@atlantis/contracts/observable-external-effect-ownership-store";

import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import { createDurableOwnershipEvidenceObserver } from "../src/external-effect-ownership-evidence-context.js";
import { withDurableOwnershipLossEvidence } from "../src/external-effect-ownership-loss-context.js";
import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
  type AppendEventInput,
  type EventStore,
  type StoredEvent,
} from "../src/index.js";

const claim: ExternalEffectClaim = Object.freeze({
  idempotencyKey: "execution-1:publish-change",
  executionId: "execution-1",
  stepId: "publish-change",
  effectType: "github.commit.create",
  ownerId: "worker-1",
  claimToken: "opaque-secret-token",
  acquiredAt: "2026-08-04T16:00:00.000Z",
  expiresAt: "2026-08-04T16:00:30.000Z",
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

function sink(store?: EventStore): DurableExecutionEventSink {
  return new DurableExecutionEventSink(
    store ?? new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
  );
}

class FailFirstAppendEventStore implements EventStore {
  private shouldFail = true;

  public constructor(private readonly delegate: EventStore) {}

  public append<TPayload>(
    event: AppendEventInput<TPayload>,
    expectedVersion: number,
  ): StoredEvent<TPayload> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("durable sink unavailable");
    }
    return this.delegate.append(event, expectedVersion);
  }

  public readStream(
    streamId: string,
    afterVersion?: number,
  ): readonly StoredEvent[] {
    return this.delegate.readStream(streamId, afterVersion);
  }

  public readAll(afterSequence?: number): readonly StoredEvent[] {
    return this.delegate.readAll(afterSequence);
  }

  public getStreamVersion(streamId: string): number {
    return this.delegate.getStreamVersion(streamId);
  }
}

describe("durable ownership lifecycle evidence", () => {
  it("shares one execution-wide ordering boundary with ownership-loss evidence", async () => {
    const eventSink = sink();
    const eventIds = ["ownership-acquired", "ownership-lost"];
    const options = {
      eventSink,
      executionId: "execution-1",
      actor: "external-effect-runtime",
      createEventId: () => eventIds.shift() ?? "unexpected-event",
      now: () => "2026-08-04T16:00:10.000Z",
    };
    const observer = createDurableOwnershipEvidenceObserver(options);
    const ownershipLoss = new ExternalEffectOwnershipLostError(
      "provider_execution",
      claim,
      new Error("claim superseded"),
    );

    const results = await Promise.allSettled([
      observer.onLifecycleEvent(acquired),
      withDurableOwnershipLossEvidence(options, () => Promise.reject(ownershipLoss)),
    ]);

    expect(results).toEqual([
      { status: "fulfilled", value: undefined },
      { status: "rejected", reason: ownershipLoss },
    ]);

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
    expect(JSON.stringify(events[1]?.payload)).not.toContain(claim.claimToken);
  });

  it("re-reads the durable tail after a governed lifecycle append failure", async () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const baseStore = new DurableSnapshotEventStore(storage);
    const eventSink = sink(new FailFirstAppendEventStore(baseStore));
    const eventIds = ["failed-event", "recovered-event"];
    const observer = createDurableOwnershipEvidenceObserver({
      eventSink,
      executionId: "execution-1",
      actor: "external-effect-runtime",
      createEventId: () => eventIds.shift() ?? "unexpected-event",
      now: () => "2026-08-04T16:00:10.000Z",
    });

    await expect(observer.onLifecycleEvent(acquired)).rejects.toThrow(
      "durable sink unavailable",
    );
    await observer.onLifecycleEvent(acquired);

    const events = eventSink.readExecution("execution-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "recovered-event",
      sequence: 1,
      type: "external.effect.ownership.acquired",
    });
    expect(events[0]).not.toHaveProperty("parentEventId");

    const restarted = sink(new DurableSnapshotEventStore(storage));
    expect(restarted.readExecution("execution-1")).toEqual(events);
  });
});

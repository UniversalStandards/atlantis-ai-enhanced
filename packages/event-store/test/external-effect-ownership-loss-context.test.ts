import { describe, expect, it, vi } from "vitest";

import { ExternalEffectOwnershipLostError } from "@atlantis/contracts/external-effect-execution";
import { withExternalEffectOwnershipLossEvidence } from "@atlantis/contracts/external-effect-ownership-loss-evidence";
import type { ExternalEffectClaim } from "@atlantis/contracts/external-effect-ownership";

import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import {
  createDurableOwnershipLossEvidenceContext,
  withDurableOwnershipLossEvidence,
} from "../src/external-effect-ownership-loss-context.js";
import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
  InvalidEventError,
} from "../src/index.js";

const claim: ExternalEffectClaim = {
  idempotencyKey: "execution-1:publish-change",
  executionId: "execution-1",
  stepId: "publish-change",
  effectType: "github.commit.create",
  ownerId: "worker-1",
  claimToken: "opaque-secret-token",
  acquiredAt: "2026-08-04T16:00:00.000Z",
  expiresAt: "2026-08-04T16:00:30.000Z",
  generation: 4,
};

function sink(): DurableExecutionEventSink {
  return new DurableExecutionEventSink(
    new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
  );
}

describe("durable ownership-loss evidence context", () => {
  it("derives contiguous sequence and parent linkage from the durable stream tail", async () => {
    const eventSink = sink();
    await eventSink.append({
      id: "event-1",
      executionId: "execution-1",
      sequence: 1,
      type: "execution.started",
      occurredAt: "2026-08-04T16:00:00.000Z",
      actor: "runtime",
      payload: {},
    });

    const ownershipLoss = new ExternalEffectOwnershipLostError(
      "provider_execution",
      claim,
      new Error("renewal rejected"),
    );

    await expect(
      withExternalEffectOwnershipLossEvidence(
        createDurableOwnershipLossEvidenceContext({
          eventSink,
          executionId: "execution-1",
          actor: "external-effect-runtime",
          createEventId: () => "event-2",
          now: () => "2026-08-04T16:00:10.000Z",
        }),
        () => Promise.reject(ownershipLoss),
      ),
    ).rejects.toBe(ownershipLoss);

    const events = eventSink.readExecution("execution-1");
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[1]).toMatchObject({
      id: "event-2",
      parentEventId: "event-1",
      type: "external.effect.ownership.lost",
      payload: {
        stage: "provider_execution",
        ownerId: "worker-1",
        generation: 4,
      },
    });
    expect(JSON.stringify(events)).not.toContain(claim.claimToken);
  });

  it("fails closed when another event advances the stream after context creation", async () => {
    const eventSink = sink();
    const context = createDurableOwnershipLossEvidenceContext({
      eventSink,
      executionId: "execution-1",
      actor: "external-effect-runtime",
      createEventId: () => "ownership-loss-event",
      now: () => "2026-08-04T16:00:10.000Z",
    });

    await eventSink.append({
      id: "concurrent-event",
      executionId: "execution-1",
      sequence: 1,
      type: "execution.started",
      occurredAt: "2026-08-04T16:00:05.000Z",
      actor: "runtime",
      payload: {},
    });

    const evidenceErrors: unknown[] = [];
    const ownershipLoss = new ExternalEffectOwnershipLostError(
      "provider_reconciliation",
      claim,
      new Error("claim superseded"),
    );

    await expect(
      withExternalEffectOwnershipLossEvidence(
        {
          ...context,
          onEvidenceError: (error) => {
            evidenceErrors.push(error);
          },
        },
        () => Promise.reject(ownershipLoss),
      ),
    ).rejects.toBe(ownershipLoss);

    expect(evidenceErrors).toHaveLength(1);
    expect(evidenceErrors[0]).toBeInstanceOf(InvalidEventError);
    expect(eventSink.readExecution("execution-1")).toHaveLength(1);
  });

  it("serializes concurrent ownership-loss handlers onto contiguous stream positions", async () => {
    const eventSink = sink();
    const eventIds = ["ownership-loss-1", "ownership-loss-2"];
    const firstLoss = new ExternalEffectOwnershipLostError(
      "provider_reconciliation",
      claim,
      new Error("first claim superseded"),
    );
    const secondLoss = new ExternalEffectOwnershipLostError(
      "provider_execution",
      claim,
      new Error("second claim superseded"),
    );
    const options = {
      eventSink,
      executionId: "execution-1",
      actor: "external-effect-runtime",
      createEventId: () => eventIds.shift() ?? "unexpected-event",
      now: () => "2026-08-04T16:00:10.000Z",
    };

    const results = await Promise.allSettled([
      withDurableOwnershipLossEvidence(options, () => Promise.reject(firstLoss)),
      withDurableOwnershipLossEvidence(options, () => Promise.reject(secondLoss)),
    ]);

    expect(results).toEqual([
      { status: "rejected", reason: firstLoss },
      { status: "rejected", reason: secondLoss },
    ]);

    const events = eventSink.readExecution("execution-1");
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.map((event) => event.id)).toEqual([
      "ownership-loss-1",
      "ownership-loss-2",
    ]);
    expect(events[0]).not.toHaveProperty("parentEventId");
    expect(events[1]).toMatchObject({
      parentEventId: "ownership-loss-1",
      type: "external.effect.ownership.lost",
    });
    expect(JSON.stringify(events)).not.toContain(claim.claimToken);
  });

  it("persists through the governed append capability instead of the compatibility append API", async () => {
    const eventSink = sink();
    const compatibilityAppend = vi
      .spyOn(eventSink, "append")
      .mockRejectedValue(new Error("compatibility append must not be used"));
    const ownershipLoss = new ExternalEffectOwnershipLostError(
      "provider_execution",
      claim,
      new Error("claim superseded"),
    );

    await expect(
      withDurableOwnershipLossEvidence(
        {
          eventSink,
          executionId: "execution-1",
          actor: "external-effect-runtime",
          createEventId: () => "ownership-loss-event",
          now: () => "2026-08-04T16:00:10.000Z",
        },
        () => Promise.reject(ownershipLoss),
      ),
    ).rejects.toBe(ownershipLoss);

    expect(compatibilityAppend).not.toHaveBeenCalled();
    expect(eventSink.readExecution("execution-1")).toMatchObject([
      {
        id: "ownership-loss-event",
        sequence: 1,
        type: "external.effect.ownership.lost",
      },
    ]);
  });
});

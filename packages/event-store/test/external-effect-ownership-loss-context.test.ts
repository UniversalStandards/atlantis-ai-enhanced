import { describe, expect, it } from "vitest";

import { ExternalEffectOwnershipLostError } from "@atlantis/contracts/external-effect-execution";
import { withExternalEffectOwnershipLossEvidence } from "@atlantis/contracts/external-effect-ownership-loss-evidence";
import type { ExternalEffectClaim } from "@atlantis/contracts/external-effect-ownership";

import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import { createDurableOwnershipLossEvidenceContext } from "../src/external-effect-ownership-loss-context.js";
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
});

import { describe, expect, it } from "vitest";
import { ExternalEffectOwnershipLostError } from "@atlantis/contracts/external-effect-execution";
import type { ResumableSequentialWorkflowRunner } from "@atlantis/contracts/resumable-runner";

import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
} from "../src/index.js";
import {
  GovernedResumableTaskEntrypoint,
  ResumableTaskEntrypoint,
} from "../src/resumable-task-entrypoint.js";

const budget = {
  maxToolCalls: 10,
  maxRetries: 2,
  maxIterations: 10,
  maxTokens: 1000,
  maxDurationMs: 10_000,
  maxCostUsd: 1,
};

const workflow = {
  id: "deploy",
  version: "1",
  steps: [],
};

const claim = Object.freeze({
  idempotencyKey: "effect-1",
  executionId: "execution-1",
  stepId: "publish",
  effectType: "github.pull_request.create",
  ownerId: "worker-a",
  claimToken: "opaque-secret-token",
  acquiredAt: "2026-08-04T16:00:00.000Z",
  expiresAt: "2026-08-04T16:01:00.000Z",
  generation: 3,
});

describe("resumable ownership-loss evidence composition", () => {
  it("allocates from the current durable tail after runner events and restart", async () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const firstSink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    );

    await firstSink.append({
      id: "event-1",
      executionId: "execution-1",
      sequence: 1,
      type: "workflow.step.started",
      occurredAt: "2026-08-04T16:00:00.000Z",
      actor: "runner",
      payload: {},
    });

    const restartedSink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    );
    const ownershipLoss = new ExternalEffectOwnershipLostError(
      "provider_execution",
      claim,
      new Error("renewal rejected"),
    );

    const taskEntrypoint = new ResumableTaskEntrypoint({
      eventSink: restartedSink,
      terminalExecutionLookup: { findTerminalExecution: () => undefined },
      resolveWorkflow: () => workflow,
      nextExecutionId: () => "unused",
      createRunner: () =>
        ({
          run: async () => {
            await restartedSink.append({
              id: "event-2",
              executionId: "execution-1",
              sequence: 2,
              type: "workflow.step.started",
              occurredAt: "2026-08-04T16:00:20.000Z",
              actor: "runner",
              parentEventId: "event-1",
              payload: {},
            });
            throw ownershipLoss;
          },
        }) as unknown as ResumableSequentialWorkflowRunner,
      ownershipLossEvidence: {
        actor: "runtime",
        createEventId: () => "event-3",
        now: () => "2026-08-04T16:00:30.000Z",
      },
    });
    const governed = new GovernedResumableTaskEntrypoint({
      taskEntrypoint,
      authorize: () => ({ allowed: true }),
    });

    await expect(
      governed.submit({
        workflowId: "deploy",
        executionId: "execution-1",
        input: { release: "alpha" },
        userId: "user-1",
        budget,
      }),
    ).rejects.toBe(ownershipLoss);

    const trace = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    ).readExecution("execution-1");

    expect(trace).toHaveLength(3);
    expect(trace[2]).toMatchObject({
      id: "event-3",
      executionId: "execution-1",
      sequence: 3,
      type: "external.effect.ownership.lost",
      parentEventId: "event-2",
      actor: "runtime",
      payload: {
        stage: "provider_execution",
        ownerId: "worker-a",
        generation: 3,
      },
    });
    expect(JSON.stringify(trace[2])).not.toContain(claim.claimToken);
  });
});

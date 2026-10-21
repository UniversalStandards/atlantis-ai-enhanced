import { describe, expect, it } from "vitest";
import type {
  EventSink,
  ExecutionEvent,
  ExecutionUsage,
  WorkflowContext,
} from "../src/index.js";
import { ExecutionCancelledError } from "../src/execution-control.js";
import {
  ResumableSequentialWorkflowRunner,
  type CheckpointStore,
  type WorkflowCheckpoint,
} from "../src/resumable-runner.js";
import { createAtomicMemoryTestDurability } from "./resumable-test-durability.js";

class MemoryCheckpointStore implements CheckpointStore {
  public checkpoint: WorkflowCheckpoint | undefined;

  public async load(executionId: string): Promise<WorkflowCheckpoint | undefined> {
    return this.checkpoint?.executionId === executionId
      ? structuredClone(this.checkpoint)
      : undefined;
  }

  public async save(
    checkpoint: Omit<WorkflowCheckpoint, "revision">,
    expectedRevision: number | undefined,
  ): Promise<WorkflowCheckpoint> {
    const currentRevision = this.checkpoint?.revision;
    if (currentRevision !== expectedRevision) throw new Error("checkpoint revision conflict");
    this.checkpoint = structuredClone({
      ...checkpoint,
      revision: (currentRevision ?? 0) + 1,
    });
    return structuredClone(this.checkpoint);
  }

  public async clear(executionId: string, expectedRevision: number): Promise<void> {
    if (
      this.checkpoint?.executionId !== executionId ||
      this.checkpoint.revision !== expectedRevision
    ) {
      throw new Error("checkpoint revision conflict");
    }
    this.checkpoint = undefined;
  }
}

class MemoryEvents implements EventSink {
  public readonly events: ExecutionEvent[] = [];

  public async append<T>(event: ExecutionEvent<T>): Promise<void> {
    if (event.sequence !== this.events.length + 1) throw new Error("noncontiguous event");
    this.events.push(event as ExecutionEvent);
  }

  public cursor(): { sequence: number; parentEventId?: string } {
    const tail = this.events.at(-1);
    return tail === undefined
      ? { sequence: 0 }
      : { sequence: tail.sequence, parentEventId: tail.id };
  }
}

function context(maxRetries = 3): WorkflowContext {
  const usage: ExecutionUsage = {
    toolCalls: 0,
    retries: 0,
    iterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
  };
  return {
    executionId: "execution-control-1",
    workflowId: "controlled-workflow",
    workflowVersion: "1",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries,
      maxIterations: 10,
      maxTokens: 1000,
      maxDurationMs: 10000,
      maxCostUsd: 5,
    },
    usage,
    metadata: {},
  };
}

function ids(): () => string {
  let next = 0;
  return () => `control-event-${++next}`;
}

describe("resumable execution controls", () => {
  it("records bounded retry attempts and accounts retry usage", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);
    let calls = 0;
    const executionContext = context(1);
    const runner = new ResumableSequentialWorkflowRunner({
      durability,
      checkpointStore: checkpoints,
      eventSink: events,
      loadEventCursor: () => events.cursor(),
      nextEventId: ids(),
      retryPolicyForStep: () => ({ maxAttempts: 5 }),
    });

    await expect(
      runner.run(
        {
          id: "controlled-workflow",
          version: "1",
          steps: [
            {
              id: "flaky",
              description: "flaky",
              execute: async (value) => {
                calls += 1;
                if (calls === 1) throw new Error("transient");
                return Number(value) + 1;
              },
            },
          ],
          mapOutput: Number,
        },
        1,
        executionContext,
      ),
    ).resolves.toBe(2);

    expect(calls).toBe(2);
    expect(executionContext.usage.retries).toBe(1);
    expect(
      events.events.filter((event) => event.type === "workflow.step.attempt.started"),
    ).toHaveLength(2);
    expect(
      events.events.find((event) => event.type === "workflow.step.attempt.failed")?.payload,
    ).toMatchObject({ attempt: 1, maxAttempts: 2, willRetry: true });
    expect(events.events.at(-1)?.type).toBe("execution.completed");
  });

  it("cancels terminally, clears checkpoint state, and does not repeat completed work", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);
    const cancellation = { isCancellationRequested: false, reason: "operator stop" };
    const calls = { first: 0, second: 0 };
    const runner = new ResumableSequentialWorkflowRunner({
      durability,
      checkpointStore: checkpoints,
      eventSink: events,
      loadEventCursor: () => events.cursor(),
      nextEventId: ids(),
      cancellation,
      retryPolicyForStep: () => ({ maxAttempts: 3 }),
    });

    await expect(
      runner.run(
        {
          id: "controlled-workflow",
          version: "1",
          steps: [
            {
              id: "first",
              description: "first",
              execute: async (value) => {
                calls.first += 1;
                return Number(value) + 1;
              },
            },
            {
              id: "second",
              description: "second",
              execute: async (value) => {
                calls.second += 1;
                cancellation.isCancellationRequested = true;
                return Number(value) + 1;
              },
            },
          ],
          mapOutput: Number,
        },
        1,
        context(),
      ),
    ).rejects.toBeInstanceOf(ExecutionCancelledError);

    expect(calls).toEqual({ first: 1, second: 1 });
    expect(checkpoints.checkpoint).toBeUndefined();
    expect(events.events.at(-1)?.type).toBe("execution.cancelled");
    expect(
      events.events.filter((event) =>
        ["execution.completed", "execution.failed", "execution.interrupted"].includes(event.type),
      ),
    ).toHaveLength(0);
  });
});

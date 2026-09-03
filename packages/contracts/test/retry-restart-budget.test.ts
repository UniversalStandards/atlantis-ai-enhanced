import { describe, expect, it } from "vitest";
import type {
  EventSink,
  ExecutionEvent,
  ExecutionUsage,
  WorkflowContext,
} from "../src/index.js";
import {
  ResumableSequentialWorkflowRunner,
  RetryBudgetExhaustedError,
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
    if (currentRevision !== expectedRevision) {
      throw new Error("checkpoint revision conflict");
    }
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
    if (event.sequence !== this.events.length + 1) {
      throw new Error("noncontiguous event");
    }
    this.events.push(event as ExecutionEvent);
  }

  public cursor(): { sequence: number; parentEventId?: string } {
    const tail = this.events.at(-1);
    return tail === undefined
      ? { sequence: 0 }
      : { sequence: tail.sequence, parentEventId: tail.id };
  }
}

function context(): WorkflowContext {
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
    executionId: "retry-restart-1",
    workflowId: "retry-restart-workflow",
    workflowVersion: "1",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries: 1,
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
  return () => `retry-restart-event-${++next}`;
}

describe("durable retry accounting", () => {
  it("does not restore consumed retry budget after restart", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);
    const nextEventId = ids();
    let calls = 0;

    const workflow = {
      id: "retry-restart-workflow",
      version: "1",
      steps: [
        {
          id: "always-fails",
          description: "always fails",
          execute: async () => {
            calls += 1;
            throw new Error(`failure-${calls}`);
          },
        },
      ],
      mapOutput: Number,
    } as const;

    const buildRunner = () =>
      new ResumableSequentialWorkflowRunner({
        durability,
        checkpointStore: checkpoints,
        eventSink: events,
        loadEventCursor: () => events.cursor(),
        nextEventId,
        retryPolicyForStep: () => ({ maxAttempts: 5 }),
      });

    await expect(buildRunner().run(workflow, 1, context())).rejects.toThrow("failure-2");
    expect(calls).toBe(2);
    expect(checkpoints.checkpoint?.usage.retries).toBe(1);

    // The step already spent its durable attempts, so recovery must not grant a
    // further unpaid execution on this or any later restart.
    for (let restart = 0; restart < 3; restart += 1) {
      const resumedContext = context();
      await expect(buildRunner().run(workflow, 1, resumedContext)).rejects.toThrow(
        RetryBudgetExhaustedError,
      );
      expect(calls).toBe(2);
      expect(resumedContext.usage.retries).toBe(1);
    }

    expect(checkpoints.checkpoint?.usage.retries).toBe(1);
    expect(
      events.events
        .filter((event) => event.type === "workflow.step.attempt.started")
        .map((event) => (event.payload as { maxAttempts: number }).maxAttempts),
    ).toEqual([2, 2]);
  });
});

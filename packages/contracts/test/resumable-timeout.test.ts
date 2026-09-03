import { describe, expect, it } from "vitest";
import type {
  EventSink,
  ExecutionEvent,
  ExecutionUsage,
  WorkflowContext,
} from "../src/index.js";
import { ExecutionTimedOutError } from "../src/execution-control.js";
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
    if (this.checkpoint?.revision !== expectedRevision) {
      throw new Error("checkpoint revision conflict");
    }
    this.checkpoint = structuredClone({
      ...checkpoint,
      revision: (expectedRevision ?? 0) + 1,
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

class ContiguousEventSink implements EventSink {
  public readonly events: ExecutionEvent[] = [];

  public async append<T>(event: ExecutionEvent<T>): Promise<void> {
    expect(event.sequence).toBe(this.events.length + 1);
    this.events.push(event as ExecutionEvent);
  }

  public cursor(): { sequence: number; parentEventId?: string } {
    const tail = this.events.at(-1);
    return tail === undefined
      ? { sequence: 0 }
      : { sequence: tail.sequence, parentEventId: tail.id };
  }
}

function usage(): ExecutionUsage {
  return {
    toolCalls: 0,
    retries: 0,
    iterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
  };
}

function context(): WorkflowContext {
  return {
    executionId: "timeout-execution",
    workflowId: "timeout-workflow",
    workflowVersion: "1",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries: 2,
      maxIterations: 10,
      maxTokens: 1000,
      maxDurationMs: 10000,
      maxCostUsd: 5,
    },
    usage: usage(),
    metadata: {},
  };
}

function ids(): () => string {
  let next = 0;
  return () => `timeout-event-${++next}`;
}

describe("resumable deadline integration", () => {
  it("times out a resumed execution without repeating completed steps", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new ContiguousEventSink();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);
    const nextEventId = ids();
    const calls = { first: 0, second: 0 };
    let interruptSecond = true;

    const workflow = {
      id: "timeout-workflow",
      version: "1",
      steps: [
        {
          id: "first",
          description: "first",
          execute: async (value: unknown) => {
            calls.first += 1;
            return Number(value) + 1;
          },
        },
        {
          id: "second",
          description: "second",
          execute: async (value: unknown) => {
            calls.second += 1;
            if (interruptSecond) throw new Error("worker interrupted");
            return Number(value) * 2;
          },
        },
      ],
      mapOutput: (value: unknown) => Number(value),
    } as const;

    const firstRunner = new ResumableSequentialWorkflowRunner({
      durability,
      checkpointStore: checkpoints,
      eventSink: events,
      loadEventCursor: () => events.cursor(),
      nextEventId,
    });

    await expect(firstRunner.run(workflow, 2, context())).rejects.toThrow(
      "worker interrupted",
    );
    expect(checkpoints.checkpoint?.completedStepIds).toEqual(["first"]);
    expect(calls).toEqual({ first: 1, second: 1 });

    interruptSecond = false;
    const resumedRunner = new ResumableSequentialWorkflowRunner({
      durability,
      checkpointStore: checkpoints,
      eventSink: events,
      loadEventCursor: () => events.cursor(),
      nextEventId,
      deadline: {
        deadlineAtMs: 100,
        nowMs: () => 100,
      },
    });

    await expect(resumedRunner.run(workflow, 999, context())).rejects.toBeInstanceOf(
      ExecutionTimedOutError,
    );

    expect(calls).toEqual({ first: 1, second: 1 });
    expect(checkpoints.checkpoint).toBeUndefined();
    expect(events.events.filter((event) => event.type === "workflow.step.timed_out"))
      .toHaveLength(1);
    expect(events.events.filter((event) => event.type === "execution.timed_out"))
      .toHaveLength(1);
    expect(
      events.events.filter((event) =>
        ["execution.completed", "execution.failed", "execution.cancelled"].includes(
          event.type,
        ),
      ),
    ).toHaveLength(0);
    expect(events.events.at(-1)?.type).toBe("execution.timed_out");
  });
});

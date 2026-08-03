import { describe, expect, it } from "vitest";
import type {
  EventSink,
  ExecutionEvent,
  ExecutionUsage,
  WorkflowContext,
} from "../src/index.js";
import {
  InvalidCheckpointError,
  ResumableSequentialWorkflowRunner,
  type CheckpointStore,
  type WorkflowCheckpoint,
} from "../src/resumable-runner.js";

class MemoryCheckpointStore implements CheckpointStore {
  public checkpoint: WorkflowCheckpoint | undefined;

  public async load(executionId: string): Promise<WorkflowCheckpoint | undefined> {
    return this.checkpoint?.executionId === executionId ? structuredClone(this.checkpoint) : undefined;
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

class MemoryEventSink implements EventSink {
  public readonly events: ExecutionEvent[] = [];

  public async append<T>(event: ExecutionEvent<T>): Promise<void> {
    this.events.push(event as ExecutionEvent);
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
    executionId: "execution-1",
    workflowId: "recovery-workflow",
    workflowVersion: "1",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries: 3,
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
  return () => `event-${++next}`;
}

describe("ResumableSequentialWorkflowRunner", () => {
  it("resumes at the next incomplete step without repeating completed work", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEventSink();
    const calls = { first: 0, second: 0, third: 0 };
    let failSecond = true;

    const workflow = {
      id: "recovery-workflow",
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
            if (failSecond) throw new Error("simulated interruption");
            return Number(value) * 2;
          },
        },
        {
          id: "third",
          description: "third",
          execute: async (value: unknown) => {
            calls.third += 1;
            return Number(value) + 3;
          },
        },
      ],
      mapOutput: (value: unknown) => Number(value),
    } as const;

    const firstRunner = new ResumableSequentialWorkflowRunner({
      checkpointStore: checkpoints,
      eventSink: events,
      nextEventId: ids(),
      now: () => "2026-08-03T15:00:00.000Z",
    });

    await expect(firstRunner.run(workflow, 2, context())).rejects.toThrow(
      "simulated interruption",
    );
    expect(checkpoints.checkpoint?.nextStepIndex).toBe(1);
    expect(checkpoints.checkpoint?.completedStepIds).toEqual(["first"]);

    failSecond = false;
    const secondRunner = new ResumableSequentialWorkflowRunner({
      checkpointStore: checkpoints,
      eventSink: events,
      nextEventId: ids(),
      now: () => "2026-08-03T15:01:00.000Z",
    });
    const resumedContext = context();

    await expect(secondRunner.run(workflow, 999, resumedContext)).resolves.toBe(9);
    expect(calls).toEqual({ first: 1, second: 2, third: 1 });
    expect(resumedContext.usage.iterations).toBe(3);
    expect(checkpoints.checkpoint).toBeUndefined();

    const resumedStart = events.events.find(
      (event) =>
        event.type === "execution.started" &&
        (event.payload as { resumed?: boolean }).resumed === true,
    );
    expect(resumedStart).toBeDefined();
  });

  it("fails closed when a checkpoint does not match the workflow version", async () => {
    const checkpoints = new MemoryCheckpointStore();
    checkpoints.checkpoint = {
      executionId: "execution-1",
      workflowId: "recovery-workflow",
      workflowVersion: "old",
      nextStepIndex: 0,
      completedStepIds: [],
      value: 2,
      usage: usage(),
      lastEventSequence: 0,
      revision: 1,
    };

    const runner = new ResumableSequentialWorkflowRunner({
      checkpointStore: checkpoints,
      eventSink: new MemoryEventSink(),
      nextEventId: ids(),
    });

    await expect(
      runner.run(
        { id: "recovery-workflow", version: "1", steps: [] },
        2,
        context(),
      ),
    ).rejects.toBeInstanceOf(InvalidCheckpointError);
  });

  it("fails closed when completed steps are not a valid workflow prefix", async () => {
    const checkpoints = new MemoryCheckpointStore();
    checkpoints.checkpoint = {
      executionId: "execution-1",
      workflowId: "recovery-workflow",
      workflowVersion: "1",
      nextStepIndex: 1,
      completedStepIds: ["wrong-step"],
      value: 2,
      usage: usage(),
      lastEventSequence: 3,
      revision: 1,
    };

    const runner = new ResumableSequentialWorkflowRunner({
      checkpointStore: checkpoints,
      eventSink: new MemoryEventSink(),
      nextEventId: ids(),
    });

    await expect(
      runner.run(
        {
          id: "recovery-workflow",
          version: "1",
          steps: [{ id: "first", description: "first", execute: async (value) => value }],
        },
        2,
        context(),
      ),
    ).rejects.toBeInstanceOf(InvalidCheckpointError);
  });
});

import { describe, expect, it } from "vitest";
import type {
  EventSink,
  ExecutionEvent,
  ExecutionUsage,
  WorkflowContext,
} from "../src/index.js";
import { InMemoryStepCompletionCommitPort } from "../src/in-memory-step-completion-commit.js";
import {
  InvalidCheckpointError,
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

class ContiguousMemoryEventSink implements EventSink {
  public readonly events: ExecutionEvent[] = [];

  public async append<T>(event: ExecutionEvent<T>): Promise<void> {
    const expectedSequence = this.events.length + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `event sequence ${event.sequence} does not match ${expectedSequence}`,
      );
    }
    if (this.events.some((stored) => stored.id === event.id)) {
      throw new Error(`duplicate event id ${event.id}`);
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
  it("resumes after a nonterminal interruption without repeating completed work", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new ContiguousMemoryEventSink();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);
    const nextEventId = ids();
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

    const buildRunner = (timestamp: string) =>
      new ResumableSequentialWorkflowRunner({
        durability,
        checkpointStore: checkpoints,
        eventSink: events,
        loadEventCursor: () => events.cursor(),
        nextEventId,
        now: () => timestamp,
      });

    await expect(
      buildRunner("2026-08-03T15:00:00.000Z").run(workflow, 2, context()),
    ).rejects.toThrow("simulated interruption");
    expect(checkpoints.checkpoint?.nextStepIndex).toBe(1);
    expect(checkpoints.checkpoint?.lastEventSequence).toBe(4);
    expect(events.cursor().sequence).toBe(9);
    expect(events.events.at(-1)?.type).toBe("execution.interrupted");
    expect(events.events.some((event) => event.type === "execution.failed")).toBe(false);

    failSecond = false;
    const resumedContext = context();
    await expect(
      buildRunner("2026-08-03T15:01:00.000Z").run(
        workflow,
        999,
        resumedContext,
      ),
    ).resolves.toBe(9);

    expect(calls).toEqual({ first: 1, second: 2, third: 1 });
    expect(resumedContext.usage.iterations).toBe(3);
    expect(checkpoints.checkpoint).toBeUndefined();
    expect(events.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.events.length }, (_item, index) => index + 1),
    );
    expect(events.events[9]?.parentEventId).toBe(events.events[8]?.id);
    expect(events.events.at(-1)?.type).toBe("execution.completed");
    expect(
      events.events.filter(
        (event) => event.type === "execution.completed" || event.type === "execution.failed",
      ).map((event) => event.type),
    ).toEqual(["execution.completed"]);
  });

  it("fails closed before workflow work when authoritative durability is absent", async () => {
    let calls = 0;
    const runner = new ResumableSequentialWorkflowRunner({
      checkpointStore: new MemoryCheckpointStore(),
      eventSink: new ContiguousMemoryEventSink(),
      loadEventCursor: () => ({ sequence: 0 }),
      nextEventId: ids(),
    });

    await expect(
      runner.run(
        {
          id: "recovery-workflow",
          version: "1",
          steps: [
            {
              id: "first",
              description: "first",
              execute: async (value) => {
                calls += 1;
                return value;
              },
            },
          ],
        },
        2,
        context(),
      ),
    ).rejects.toThrow("Authoritative resumable durability is required");
    expect(calls).toBe(0);
  });

  it("reconciles post-publish acknowledgement loss and never replays the completed prefix", async () => {
    const durability = new InMemoryStepCompletionCommitPort({
      failAt: "after_publish_before_ack",
    });
    const nextEventId = ids();
    const calls = { first: 0, second: 0 };
    let interruptSecond = true;
    const workflow = {
      id: "recovery-workflow",
      version: "1",
      steps: [
        {
          id: "first",
          description: "first",
          execute: async (value: unknown) => {
            calls.first += 1;
            return Number(value) + 5;
          },
        },
        {
          id: "second",
          description: "second",
          execute: async (value: unknown) => {
            calls.second += 1;
            if (interruptSecond) throw new Error("interrupt-after-first");
            return Number(value) * 2;
          },
        },
      ],
      mapOutput: Number,
    } as const;

    const buildRunner = () =>
      new ResumableSequentialWorkflowRunner({ durability, nextEventId });

    await expect(buildRunner().run(workflow, 1, context())).rejects.toThrow(
      "interrupt-after-first",
    );
    expect(calls).toEqual({ first: 1, second: 1 });
    expect(durability.loadCheckpoint("execution-1")).toMatchObject({
      nextStepIndex: 1,
      completedStepIds: ["first"],
      value: 6,
      revision: 1,
    });

    interruptSecond = false;
    const resumedContext = context();
    await expect(buildRunner().run(workflow, 999, resumedContext)).resolves.toBe(12);
    expect(calls).toEqual({ first: 1, second: 2 });
    expect(resumedContext.usage.iterations).toBe(2);
    expect(durability.loadCheckpoint("execution-1")).toBeUndefined();
  });

  it("fails closed when the event stream is behind the checkpoint", async () => {
    const checkpoints = new MemoryCheckpointStore();
    checkpoints.checkpoint = {
      executionId: "execution-1",
      workflowId: "recovery-workflow",
      workflowVersion: "1",
      nextStepIndex: 0,
      completedStepIds: [],
      value: 2,
      usage: usage(),
      lastEventSequence: 3,
      parentEventId: "event-3",
      revision: 1,
    };
    const events = new ContiguousMemoryEventSink();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);

    const runner = new ResumableSequentialWorkflowRunner({
      durability,
      checkpointStore: checkpoints,
      eventSink: events,
      loadEventCursor: () => ({ sequence: 0 }),
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
    const events = new ContiguousMemoryEventSink();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);

    const runner = new ResumableSequentialWorkflowRunner({
      durability,
      checkpointStore: checkpoints,
      eventSink: events,
      loadEventCursor: () => ({ sequence: 0 }),
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
    const events = new ContiguousMemoryEventSink();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);

    const runner = new ResumableSequentialWorkflowRunner({
      durability,
      checkpointStore: checkpoints,
      eventSink: events,
      loadEventCursor: () => ({ sequence: 3, parentEventId: "event-3" }),
      nextEventId: ids(),
    });

    await expect(
      runner.run(
        {
          id: "recovery-workflow",
          version: "1",
          steps: [
            {
              id: "first",
              description: "first",
              execute: async (value) => value,
            },
          ],
        },
        2,
        context(),
      ),
    ).rejects.toBeInstanceOf(InvalidCheckpointError);
  });
});

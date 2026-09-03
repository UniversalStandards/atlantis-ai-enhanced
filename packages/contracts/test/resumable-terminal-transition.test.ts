import { describe, expect, it } from "vitest";
import {
  type EventSink,
  type ExecutionEvent,
  type ExecutionUsage,
  type WorkflowContext,
} from "../src/index.js";
import { ExecutionCancelledError } from "../src/execution-control.js";
import {
  ResumableSequentialWorkflowRunner,
  type CheckpointStore,
  type WorkflowCheckpoint,
} from "../src/resumable-runner.js";
import {
  createAtomicMemoryTestDurability,
} from "./resumable-test-durability.js";

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

  public async clear(): Promise<void> {
    throw new Error("terminal paths must use commitTerminalExecution");
  }
}

class MemoryEvents implements EventSink {
  public readonly events: ExecutionEvent[] = [];

  public async append<T>(event: ExecutionEvent<T>): Promise<void> {
    const tail = this.events.at(-1);
    expect(event.sequence).toBe((tail?.sequence ?? 0) + 1);
    expect(event.parentEventId).toBe(tail?.id);
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
    executionId: "terminal-transition-execution",
    workflowId: "terminal-transition-workflow",
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
    usage: usage(),
    metadata: {},
  };
}

function ids(): () => string {
  let next = 0;
  return () => `terminal-transition-event-${++next}`;
}

describe("resumable terminal durability transition", () => {
  it("recovers completed output through a result reference without embedding it in the event", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);
    const nextEventId = ids();
    let calls = 0;
    const workflow = {
      id: "terminal-transition-workflow",
      version: "1",
      steps: [
        {
          id: "first",
          description: "first",
          execute: async (_value: unknown, currentContext: WorkflowContext) => {
            calls += 1;
            currentContext.usage.outputTokens = 7;
            return { secret: "must-not-enter-event-stream", value: 42 };
          },
        },
      ],
    } as const;

    const firstContext = context();
    await expect(
      new ResumableSequentialWorkflowRunner({
        durability,
        nextEventId,
      }).run(workflow, "ignored", firstContext),
    ).resolves.toEqual({ secret: "must-not-enter-event-stream", value: 42 });

    const completed = events.events.find((event) => event.type === "execution.completed");
    expect(completed).toBeDefined();
    expect(completed?.payload).toMatchObject({
      terminalSchemaVersion: 1,
      completedStepIds: ["first"],
      usage: expect.objectContaining({ iterations: 1, outputTokens: 7 }),
      result: expect.objectContaining({
        kind: "terminal-result-reference",
        version: 1,
      }),
    });
    expect(completed?.payload).not.toHaveProperty("output");
    expect(JSON.stringify(completed?.payload)).not.toContain("must-not-enter-event-stream");

    const recoveredContext = context();
    await expect(
      new ResumableSequentialWorkflowRunner({
        durability,
        nextEventId,
      }).run(workflow, "different input", recoveredContext),
    ).resolves.toEqual({ secret: "must-not-enter-event-stream", value: 42 });
    expect(calls).toBe(1);
    expect(recoveredContext.usage).toMatchObject({ iterations: 1, outputTokens: 7 });
  });

  it("fails closed for legacy completed terminal records without a schema version", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);
    await events.append({
      id: "legacy-terminal",
      executionId: "terminal-transition-execution",
      sequence: 1,
      type: "execution.completed",
      occurredAt: "2026-09-03T21:00:00.000Z",
      actor: "legacy-runner",
      payload: {
        workflowId: "terminal-transition-workflow",
        completedSteps: 1,
      },
    });
    let calls = 0;

    await expect(
      new ResumableSequentialWorkflowRunner({
        durability,
        nextEventId: ids(),
      }).run(
        {
          id: "terminal-transition-workflow",
          version: "1",
          steps: [
            {
              id: "first",
              description: "first",
              execute: async () => {
                calls += 1;
                return 1;
              },
            },
          ],
        },
        0,
        context(),
      ),
    ).rejects.toThrow("Terminal execution event schema version is invalid");
    expect(calls).toBe(0);
  });

  it.each([
    "before-publication",
    "after-publication-pre-ack",
    "before-retirement",
    "after-retirement-ack",
  ] as const)(
    "recovers without replaying the completed prefix after %s",
    async (failTerminalAt) => {
      const checkpoints = new MemoryCheckpointStore();
      const events = new MemoryEvents();
      const durabilityOptions: {
        failTerminalAt: typeof failTerminalAt | undefined;
      } = { failTerminalAt };
      const durability = createAtomicMemoryTestDurability(
        checkpoints,
        events,
        durabilityOptions,
      );
      const nextEventId = ids();
      const calls = { first: 0, second: 0 };
      let interruptSecond = true;

      const workflow = {
        id: "terminal-transition-workflow",
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
        mapOutput: Number,
      } as const;

      await expect(
        new ResumableSequentialWorkflowRunner({
          durability,
          nextEventId,
        }).run(workflow, 2, context()),
      ).rejects.toThrow("worker interrupted");
      expect(checkpoints.checkpoint?.completedStepIds).toEqual(["first"]);
      expect(calls).toEqual({ first: 1, second: 1 });

      interruptSecond = false;
      await expect(
        new ResumableSequentialWorkflowRunner({
          durability,
          nextEventId,
          cancellation: {
            isCancellationRequested: true,
            reason: "operator cancelled",
          },
        }).run(workflow, 999, context()),
      ).rejects.toThrow();

      durabilityOptions.failTerminalAt = undefined;
      const restartContext = context();
      const restart = new ResumableSequentialWorkflowRunner({
        durability,
        nextEventId,
      }).run(workflow, 999, restartContext);

      if (failTerminalAt === "before-publication") {
        await expect(restart).resolves.toBe(6);
        expect(events.events.filter((event) => event.type === "execution.cancelled"))
          .toHaveLength(0);
        expect(events.events.at(-1)?.type).toBe("execution.completed");
      } else {
        await expect(restart).rejects.toBeInstanceOf(ExecutionCancelledError);
        expect(events.events.filter((event) => event.type === "execution.cancelled"))
          .toHaveLength(1);
        expect(events.events.at(-1)?.type).toBe("execution.cancelled");
        expect(restartContext.usage.iterations).toBe(1);
      }

      expect(calls.first).toBe(1);
      expect(calls.second).toBe(failTerminalAt === "before-publication" ? 2 : 1);
      expect(checkpoints.checkpoint).toBeUndefined();
    },
  );
});

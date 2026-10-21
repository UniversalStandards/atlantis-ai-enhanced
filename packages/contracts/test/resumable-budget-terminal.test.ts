import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  type EventSink,
  type ExecutionEvent,
  type ExecutionUsage,
  type WorkflowContext,
} from "../src/index.js";
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
    const tail = this.events.at(-1);
    if (event.sequence !== (tail?.sequence ?? 0) + 1) {
      throw new Error("noncontiguous event");
    }
    if (tail !== undefined && event.parentEventId !== tail.id) {
      throw new Error("invalid event parent");
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
    executionId: "budget-terminal-execution",
    workflowId: "budget-terminal-workflow",
    workflowVersion: "1",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries: 3,
      maxIterations: 1,
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
  return () => `budget-terminal-event-${++next}`;
}

describe("terminal budget exhaustion", () => {
  it("clears the checkpoint and retained protected-step approval", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const durability = createAtomicMemoryTestDurability(checkpoints, events);
    let protectedCalls = 0;
    let resolutionCalls = 0;
    const executionContext = context();
    const runner = new ResumableSequentialWorkflowRunner({
      durability,
      checkpointStore: checkpoints,
      eventSink: events,
      loadEventCursor: () => events.cursor(),
      nextEventId: ids(),
      approvalForStep: (_step, index, currentContext) =>
        index === 1
          ? {
              approvalId: "approval-budget-terminal",
              executionId: currentContext.executionId,
              requestVersion: 1,
              stepId: "protected",
              action: "protected effect",
              reason: "requires authorization",
              requestedBy: "operator",
              requestedAt: "2026-08-04T02:00:00.000Z",
              metadata: {},
            }
          : undefined,
      loadApprovalResolution: (request) => {
        resolutionCalls += 1;
        return {
          approvalId: request.approvalId,
          executionId: request.executionId,
          requestVersion: request.requestVersion,
          decision: "approved",
          resolvedBy: "approver",
          resolvedAt: "2026-08-04T02:00:01.000Z",
        };
      },
      now: () => "2026-08-04T02:00:02.000Z",
    });

    await expect(
      runner.run(
        {
          id: "budget-terminal-workflow",
          version: "1",
          steps: [
            {
              id: "prepare",
              description: "prepare",
              execute: async (value) => Number(value) + 1,
            },
            {
              id: "protected",
              description: "protected",
              execute: async (value, currentContext) => {
                protectedCalls += 1;
                currentContext.usage.iterations = 1;
                return Number(value) + 1;
              },
            },
          ],
          mapOutput: Number,
        },
        1,
        executionContext,
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    expect(protectedCalls).toBe(1);
    expect(resolutionCalls).toBe(1);
    expect(checkpoints.checkpoint).toBeUndefined();
    expect(events.events.filter((event) => event.type === "budget.exceeded")).toHaveLength(1);
    expect(
      events.events.filter(
        (event) =>
          event.type === "execution.failed" &&
          (event.payload as { reason?: string }).reason === "budget_exceeded",
      ),
    ).toHaveLength(1);
    expect(
      events.events.filter((event) =>
        [
          "execution.completed",
          "execution.cancelled",
          "execution.timed_out",
          "execution.interrupted",
        ].includes(event.type),
      ),
    ).toHaveLength(0);
  });
});

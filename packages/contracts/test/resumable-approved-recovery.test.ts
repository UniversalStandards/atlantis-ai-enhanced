import { describe, expect, it } from "vitest";
import type {
  EventSink,
  ExecutionEvent,
  ExecutionUsage,
  WorkflowContext,
} from "../src/index.js";
import {
  ApprovalRequiredError,
  type ApprovalResolution,
} from "../src/approval-control.js";
import {
  ResumableSequentialWorkflowRunner,
  type CheckpointStore,
  type WorkflowCheckpoint,
} from "../src/resumable-runner.js";

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
    expect(event.sequence).toBe(this.events.length + 1);
    this.events.push(structuredClone(event) as ExecutionEvent);
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
    executionId: "execution-approved-recovery",
    workflowId: "approved-recovery",
    workflowVersion: "1",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries: 0,
      maxIterations: 10,
      maxTokens: 1000,
      maxDurationMs: 10_000,
      maxCostUsd: 5,
    },
    usage: usage(),
    metadata: {},
  };
}

function eventIds(): () => string {
  let next = 0;
  return () => `approved-recovery-event-${++next}`;
}

const approved: ApprovalResolution = {
  approvalId: "approval-recovery-1",
  executionId: "execution-approved-recovery",
  requestVersion: 1,
  decision: "approved",
  resolvedBy: "reviewer-1",
  resolvedAt: "2026-08-03T23:01:00.000Z",
};

const replacement: ApprovalResolution = {
  approvalId: "approval-recovery-1",
  executionId: "execution-approved-recovery",
  requestVersion: 1,
  decision: "rejected",
  resolvedBy: "replacement-reviewer",
  resolvedAt: "2026-08-03T23:02:00.000Z",
};

describe("approved protected-step recovery", () => {
  it("persists the validated approval and ignores replacement decisions after failure", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const nextEventId = eventIds();
    let resolution: ApprovalResolution | undefined;
    let resolutionLoads = 0;
    let protectedCalls = 0;

    const workflow = {
      id: "approved-recovery",
      version: "1",
      steps: [
        {
          id: "prepare",
          description: "prepare",
          execute: async (value: unknown) => Number(value) + 1,
        },
        {
          id: "protected",
          description: "protected",
          execute: async (value: unknown) => {
            protectedCalls += 1;
            if (protectedCalls === 1) {
              throw new Error("recoverable protected-step failure");
            }
            return Number(value) * 2;
          },
        },
      ],
      mapOutput: (value: unknown) => Number(value),
    } as const;

    const buildRunner = () =>
      new ResumableSequentialWorkflowRunner({
        checkpointStore: checkpoints,
        eventSink: events,
        loadEventCursor: () => events.cursor(),
        nextEventId,
        now: () => "2026-08-03T23:00:00.000Z",
        approvalForStep: (_step, index, execution) =>
          index === 1
            ? {
                approvalId: "approval-recovery-1",
                executionId: execution.executionId,
                requestVersion: 1,
                stepId: "protected",
                action: "publish protected change",
                reason: "consequential repository mutation",
                requestedBy: "atlantis",
                requestedAt: "2026-08-03T23:00:00.000Z",
                metadata: { scope: "repository" },
              }
            : undefined,
        loadApprovalResolution: () => {
          resolutionLoads += 1;
          return resolution;
        },
      });

    await expect(buildRunner().run(workflow, 2, context())).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );

    resolution = approved;
    await expect(buildRunner().run(workflow, 999, context())).rejects.toThrow(
      "recoverable protected-step failure",
    );

    expect(checkpoints.checkpoint?.nextStepIndex).toBe(1);
    expect(checkpoints.checkpoint?.pendingApproval).toBeUndefined();
    expect(checkpoints.checkpoint?.approvedApproval?.resolution).toEqual(approved);
    expect(events.events.filter((event) => event.type === "approval.requested")).toHaveLength(1);
    expect(events.events.filter((event) => event.type === "approval.resolved")).toHaveLength(1);
    expect(resolutionLoads).toBe(2);

    resolution = replacement;
    await expect(buildRunner().run(workflow, 999, context())).resolves.toBe(6);

    expect(protectedCalls).toBe(2);
    expect(resolutionLoads).toBe(2);
    expect(checkpoints.checkpoint).toBeUndefined();
    expect(events.events.filter((event) => event.type === "approval.requested")).toHaveLength(1);
    expect(events.events.filter((event) => event.type === "approval.resolved")).toHaveLength(1);
    expect(events.events.at(-1)?.type).toBe("execution.completed");
  });
});

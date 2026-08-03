import { describe, expect, it } from "vitest";
import type {
  EventSink,
  ExecutionEvent,
  ExecutionUsage,
  WorkflowContext,
} from "../src/index.js";
import {
  ApprovalRejectedError,
  ApprovalRequiredError,
  InvalidApprovalError,
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
    expect(this.events.some((stored) => stored.id === event.id)).toBe(false);
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
    executionId: "execution-approval",
    workflowId: "approval-workflow",
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
  return () => `approval-event-${++next}`;
}

const workflow = {
  id: "approval-workflow",
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
      execute: async (value: unknown) => Number(value) * 2,
    },
  ],
  mapOutput: (value: unknown) => Number(value),
} as const;

function approvalResolution(
  decision: "approved" | "rejected",
  requestVersion = 1,
): ApprovalResolution {
  return {
    approvalId: "approval-1",
    executionId: "execution-approval",
    requestVersion,
    decision,
    resolvedBy: "reviewer-1",
    resolvedAt: "2026-08-03T22:01:00.000Z",
  };
}

describe("resumable approval integration", () => {
  it("persists a protected checkpoint and resumes without repeating completed work", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const nextEventId = ids();
    const calls = { prepare: 0, protected: 0 };
    let resolution: ApprovalResolution | undefined;

    const guardedWorkflow = {
      ...workflow,
      steps: [
        {
          ...workflow.steps[0],
          execute: async (value: unknown) => {
            calls.prepare += 1;
            return Number(value) + 1;
          },
        },
        {
          ...workflow.steps[1],
          execute: async (value: unknown) => {
            calls.protected += 1;
            return Number(value) * 2;
          },
        },
      ],
    } as const;

    const buildRunner = () =>
      new ResumableSequentialWorkflowRunner({
        checkpointStore: checkpoints,
        eventSink: events,
        loadEventCursor: () => events.cursor(),
        nextEventId,
        now: () => "2026-08-03T22:00:00.000Z",
        approvalForStep: (_step, index, execution) =>
          index === 1
            ? {
                approvalId: "approval-1",
                executionId: execution.executionId,
                requestVersion: 1,
                stepId: "protected",
                action: "apply protected change",
                reason: "consequential repository mutation",
                requestedBy: "atlantis",
                requestedAt: "2026-08-03T22:00:00.000Z",
                metadata: { scope: "repository" },
              }
            : undefined,
        loadApprovalResolution: () => resolution,
      });

    await expect(buildRunner().run(guardedWorkflow, 2, context())).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );

    expect(calls).toEqual({ prepare: 1, protected: 0 });
    expect(checkpoints.checkpoint?.nextStepIndex).toBe(1);
    expect(checkpoints.checkpoint?.pendingApproval?.approvalId).toBe("approval-1");
    expect(events.events.filter((event) => event.type === "approval.requested")).toHaveLength(1);
    expect(events.events.some((event) => event.type === "execution.failed")).toBe(false);
    expect(events.events.some((event) => event.type === "execution.interrupted")).toBe(false);

    resolution = approvalResolution("approved");
    await expect(buildRunner().run(guardedWorkflow, 999, context())).resolves.toBe(6);

    expect(calls).toEqual({ prepare: 1, protected: 1 });
    expect(checkpoints.checkpoint).toBeUndefined();
    expect(events.events.filter((event) => event.type === "approval.requested")).toHaveLength(1);
    expect(events.events.filter((event) => event.type === "approval.resolved")).toHaveLength(1);
    expect(events.events.at(-1)?.type).toBe("execution.completed");
  });

  it("rejects stale approval decisions without executing protected work", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const nextEventId = ids();
    let protectedCalls = 0;
    let resolution: ApprovalResolution | undefined;

    const guardedWorkflow = {
      ...workflow,
      steps: [
        workflow.steps[0],
        {
          ...workflow.steps[1],
          execute: async (value: unknown) => {
            protectedCalls += 1;
            return value;
          },
        },
      ],
    } as const;

    const buildRunner = () =>
      new ResumableSequentialWorkflowRunner({
        checkpointStore: checkpoints,
        eventSink: events,
        loadEventCursor: () => events.cursor(),
        nextEventId,
        approvalForStep: (_step, index, execution) =>
          index === 1
            ? {
                approvalId: "approval-1",
                executionId: execution.executionId,
                requestVersion: 1,
                stepId: "protected",
                action: "apply protected change",
                reason: "consequential repository mutation",
                requestedBy: "atlantis",
                requestedAt: "2026-08-03T22:00:00.000Z",
                metadata: {},
              }
            : undefined,
        loadApprovalResolution: () => resolution,
      });

    await expect(buildRunner().run(guardedWorkflow, 2, context())).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
    resolution = approvalResolution("approved", 2);

    await expect(buildRunner().run(guardedWorkflow, 999, context())).rejects.toBeInstanceOf(
      InvalidApprovalError,
    );
    expect(protectedCalls).toBe(0);
    expect(checkpoints.checkpoint?.pendingApproval?.requestVersion).toBe(1);
    expect(events.events.filter((event) => event.type === "approval.resolved")).toHaveLength(0);
  });

  it("records rejection as one terminal failure and clears the checkpoint", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const events = new MemoryEvents();
    const nextEventId = ids();
    let resolution: ApprovalResolution | undefined;

    const buildRunner = () =>
      new ResumableSequentialWorkflowRunner({
        checkpointStore: checkpoints,
        eventSink: events,
        loadEventCursor: () => events.cursor(),
        nextEventId,
        approvalForStep: (_step, index, execution) =>
          index === 1
            ? {
                approvalId: "approval-1",
                executionId: execution.executionId,
                requestVersion: 1,
                stepId: "protected",
                action: "apply protected change",
                reason: "consequential repository mutation",
                requestedBy: "atlantis",
                requestedAt: "2026-08-03T22:00:00.000Z",
                metadata: {},
              }
            : undefined,
        loadApprovalResolution: () => resolution,
      });

    await expect(buildRunner().run(workflow, 2, context())).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
    resolution = approvalResolution("rejected");

    await expect(buildRunner().run(workflow, 999, context())).rejects.toBeInstanceOf(
      ApprovalRejectedError,
    );
    expect(checkpoints.checkpoint).toBeUndefined();
    expect(events.events.filter((event) => event.type === "approval.resolved")).toHaveLength(1);
    expect(events.events.filter((event) => event.type === "execution.failed")).toHaveLength(1);
    expect(events.events.at(-1)?.type).toBe("execution.failed");
  });
});

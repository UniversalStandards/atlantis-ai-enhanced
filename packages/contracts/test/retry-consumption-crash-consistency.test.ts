import { describe, expect, it } from "vitest";
import type { ExecutionEvent, ExecutionUsage, WorkflowContext } from "../src/index.js";
import type { ApprovalRequest, ApprovalResolution } from "../src/approval-control.js";
import { InMemoryStepCompletionCommitPort } from "../src/in-memory-step-completion-commit.js";
import { ResumableSequentialWorkflowRunner } from "../src/resumable-runner.js";
import {
  InvalidAttemptFailureCommitError,
  validateAttemptFailureCommit,
  type AttemptFailureCommitRequest,
  type AttemptFailureCommitResult,
  type AttemptFailureEventPayload,
  type ResumableDurabilityPort,
} from "../src/step-completion-commit.js";

const executionId = "retry-consumption-1";
const maxRetries = 2;

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
    executionId,
    workflowId: "retry-consumption-workflow",
    workflowVersion: "1",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries,
      maxIterations: 10,
      maxTokens: 1000,
      maxDurationMs: 10_000,
      maxCostUsd: 5,
    },
    usage: usage(),
    metadata: {},
  };
}

function alwaysFailingWorkflow(onExecute: () => void) {
  return {
    id: "retry-consumption-workflow",
    version: "1",
    steps: [
      {
        id: "always-fails",
        description: "always fails",
        execute: async (): Promise<number> => {
          onExecute();
          throw new Error("boundary failure");
        },
      },
    ],
    mapOutput: Number,
  } as const;
}

function ids(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

function retryConsumingFailures(
  port: InMemoryStepCompletionCommitPort,
): readonly ExecutionEvent<AttemptFailureEventPayload>[] {
  return port
    .loadEvents(executionId)
    .filter((event) => event.type === "workflow.step.attempt.failed")
    .map((event) => event as ExecutionEvent<AttemptFailureEventPayload>)
    .filter((event) => event.payload.willRetry);
}

describe("retry consumption crash consistency", () => {
  it("consumes the retry allowance atomically with failed-attempt evidence", async () => {
    const port = new InMemoryStepCompletionCommitPort();
    let calls = 0;

    await expect(
      new ResumableSequentialWorkflowRunner({
        durability: port,
        nextEventId: ids("event"),
        retryPolicyForStep: () => ({ maxAttempts: 5 }),
      }).run(alwaysFailingWorkflow(() => (calls += 1)), 1, context()),
    ).rejects.toThrow("boundary failure");

    expect(calls).toBe(maxRetries + 1);
    expect(port.loadCheckpoint(executionId)?.usage.retries).toBe(maxRetries);
    expect(retryConsumingFailures(port)).toHaveLength(maxRetries);
  });

  it("cannot restore retry budget when the acknowledgement is lost after commit", async () => {
    // Every retry-consuming commit publishes atomically and then loses its
    // acknowledgement, so the caller must reconcile from authoritative state.
    const port = new InMemoryStepCompletionCommitPort({
      attemptFailureFailAt: "after_publish_before_ack",
    });
    let calls = 0;

    await expect(
      new ResumableSequentialWorkflowRunner({
        durability: port,
        nextEventId: ids("event"),
        retryPolicyForStep: () => ({ maxAttempts: 5 }),
      }).run(alwaysFailingWorkflow(() => (calls += 1)), 1, context()),
    ).rejects.toThrow("boundary failure");

    expect(calls).toBe(maxRetries + 1);
    expect(port.loadCheckpoint(executionId)?.usage.retries).toBe(maxRetries);
    expect(retryConsumingFailures(port)).toHaveLength(maxRetries);
  });

  it("records neither evidence nor consumption when the commit never lands", async () => {
    const port = new InMemoryStepCompletionCommitPort({
      attemptFailureFailAt: "after_validation_before_publish",
    });
    let calls = 0;

    await expect(
      new ResumableSequentialWorkflowRunner({
        durability: port,
        nextEventId: ids("event"),
        retryPolicyForStep: () => ({ maxAttempts: 5 }),
      }).run(alwaysFailingWorkflow(() => (calls += 1)), 1, context()),
    ).rejects.toThrow("injected attempt-failure failure before atomic publish");

    expect(calls).toBe(1);
    expect(retryConsumingFailures(port)).toHaveLength(0);
    expect(port.loadCheckpoint(executionId)?.usage.retries ?? 0).toBe(0);
  });

  it("bounds retry consumption by maxRetries across repeated restarts", async () => {
    // One durable authority survives; every runner instance is a fresh process.
    const port = new InMemoryStepCompletionCommitPort({
      attemptFailureFailAt: "after_publish_before_ack",
    });
    const nextEventId = ids("event");
    let calls = 0;

    for (let restart = 0; restart < 5; restart += 1) {
      const resumed = context();
      await expect(
        new ResumableSequentialWorkflowRunner({
          durability: port,
          nextEventId,
          retryPolicyForStep: () => ({ maxAttempts: 5 }),
        }).run(alwaysFailingWorkflow(() => (calls += 1)), 1, resumed),
      ).rejects.toThrow("boundary failure");

      expect(resumed.usage.retries).toBeLessThanOrEqual(maxRetries);
      expect(port.loadCheckpoint(executionId)?.usage.retries).toBe(maxRetries);
    }

    // Retry allowance is consumed exactly once and never restored: the first
    // process spends the whole budget, and each later restart gets a single
    // bounded attempt instead of an unbounded retry loop.
    expect(retryConsumingFailures(port)).toHaveLength(maxRetries);
    expect(calls).toBe(maxRetries + 1 + 4);
  });
  it("never publishes retry-consuming evidence through the ordinary event path", async () => {
    const port = new InMemoryStepCompletionCommitPort();
    // Split publication is the defect under repair: retry-consuming evidence
    // must only ever reach durability inside the atomic transition.
    const guarded: ResumableDurabilityPort = {
      load: (id) => port.load(id),
      save: (checkpoint, expectedRevision) => port.save(checkpoint, expectedRevision),
      clear: (id, expectedRevision) => port.clear(id, expectedRevision),
      loadEventCursor: (id) => port.loadEventCursor(id),
      commitStepCompletion: (request) => port.commitStepCompletion(request),
      commitAttemptFailure: (request) => port.commitAttemptFailure(request),
      append: async <T,>(event: ExecutionEvent<T>) => {
        const payload = event.payload as Partial<AttemptFailureEventPayload>;
        if (event.type === "workflow.step.attempt.failed" && payload.willRetry === true) {
          throw new Error("retry-consuming evidence bypassed the atomic transition");
        }
        return port.append(event);
      },
    };

    await expect(
      new ResumableSequentialWorkflowRunner({
        durability: guarded,
        nextEventId: ids("event"),
        retryPolicyForStep: () => ({ maxAttempts: 5 }),
      }).run(alwaysFailingWorkflow(() => undefined), 1, context()),
    ).rejects.toThrow("boundary failure");

    expect(port.loadCheckpoint(executionId)?.usage.retries).toBe(maxRetries);
  });

  it("retains protected-step authorization across a retry-consuming commit", async () => {
    const port = new InMemoryStepCompletionCommitPort();
    const request: ApprovalRequest = {
      approvalId: "approval-1",
      executionId,
      requestVersion: 1,
      stepId: "always-fails",
      action: "execute",
      reason: "protected step",
      requestedBy: "user-1",
      requestedAt: "2026-09-03T00:00:00.000Z",
      metadata: {},
    };
    const resolution: ApprovalResolution = {
      approvalId: "approval-1",
      executionId,
      requestVersion: 1,
      decision: "approved",
      resolvedBy: "approver-1",
      resolvedAt: "2026-09-03T00:00:01.000Z",
    };

    await expect(
      new ResumableSequentialWorkflowRunner({
        durability: port,
        nextEventId: ids("event"),
        retryPolicyForStep: () => ({ maxAttempts: 5 }),
        approvalForStep: () => request,
        loadApprovalResolution: () => resolution,
      }).run(alwaysFailingWorkflow(() => undefined), 1, context()),
    ).rejects.toThrow("boundary failure");

    const checkpoint = port.loadCheckpoint(executionId);
    expect(checkpoint?.usage.retries).toBe(maxRetries);
    expect(checkpoint?.approvedApproval?.request.approvalId).toBe("approval-1");
    expect(checkpoint?.pendingApproval).toBeUndefined();
  });
});

describe("validateAttemptFailureCommit", () => {
  const event: ExecutionEvent<AttemptFailureEventPayload> = {
    id: "event-1",
    executionId,
    sequence: 1,
    type: "workflow.step.attempt.failed",
    occurredAt: "2026-09-03T00:00:00.000Z",
    actor: "runner",
    payload: {
      stepId: "always-fails",
      stepIndex: 0,
      attempt: 1,
      maxAttempts: 3,
      willRetry: true,
      error: "boundary failure",
    },
  };

  function request(
    overrides: {
      readonly payload?: Partial<AttemptFailureEventPayload>;
      readonly retries?: number;
      readonly nextStepIndex?: number;
      readonly consumedRetriesBefore?: number;
    } = {},
  ): AttemptFailureCommitRequest {
    return {
      attemptFailedEvent: {
        ...event,
        payload: { ...event.payload, ...overrides.payload },
      },
      checkpoint: {
        executionId,
        workflowId: "retry-consumption-workflow",
        workflowVersion: "1",
        nextStepIndex: overrides.nextStepIndex ?? 0,
        completedStepIds: [],
        value: 1,
        usage: { ...usage(), retries: overrides.retries ?? 1 },
        lastEventSequence: 1,
        parentEventId: "event-1",
      },
      expectedCheckpointRevision: undefined,
      consumedRetriesBefore: overrides.consumedRetriesBefore ?? 0,
    };
  }

  function result(commit: AttemptFailureCommitRequest): AttemptFailureCommitResult {
    return {
      checkpoint: { ...commit.checkpoint, revision: 1 },
      eventSequence: commit.attemptFailedEvent.sequence,
      eventId: commit.attemptFailedEvent.id,
    };
  }

  it("accepts a transition that consumes exactly one allowance", () => {
    const commit = request();
    expect(validateAttemptFailureCommit(commit, result(commit)).usage.retries).toBe(1);
  });

  it("rejects consuming more than one allowance", () => {
    const commit = request({ retries: 2 });
    expect(() => validateAttemptFailureCommit(commit, result(commit))).toThrow(
      InvalidAttemptFailureCommitError,
    );
  });

  it("rejects consuming an allowance for a terminal attempt failure", () => {
    const commit = request({ payload: { willRetry: false } });
    expect(() => validateAttemptFailureCommit(commit, result(commit))).toThrow(
      InvalidAttemptFailureCommitError,
    );
  });

  it("rejects a transition that advances past the failing step", () => {
    const commit = request({ nextStepIndex: 1 });
    expect(() => validateAttemptFailureCommit(commit, result(commit))).toThrow(
      InvalidAttemptFailureCommitError,
    );
  });

  it("rejects an acknowledgement whose revision does not advance exactly once", () => {
    const commit = request();
    const acknowledged = result(commit);
    expect(() =>
      validateAttemptFailureCommit(commit, {
        ...acknowledged,
        checkpoint: { ...acknowledged.checkpoint, revision: 2 },
      }),
    ).toThrow(InvalidAttemptFailureCommitError);
  });
});

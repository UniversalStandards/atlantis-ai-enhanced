import { describe, expect, it } from "vitest";
import type { ExecutionEvent, ExecutionUsage, WorkflowContext } from "../src/index.js";
import type { ApprovalRequest, ApprovalResolution } from "../src/approval-control.js";
import { InMemoryStepCompletionCommitPort } from "../src/in-memory-step-completion-commit.js";
import {
  ResumableSequentialWorkflowRunner,
  RetryBudgetExhaustedError,
} from "../src/resumable-runner.js";
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

function durableAttemptFailures(
  port: InMemoryStepCompletionCommitPort,
): readonly ExecutionEvent<AttemptFailureEventPayload>[] {
  return port
    .loadEvents(executionId)
    .filter((event) => event.type === "workflow.step.attempt.failed")
    .map((event) => event as ExecutionEvent<AttemptFailureEventPayload>);
}

function retryConsumingFailures(
  port: InMemoryStepCompletionCommitPort,
): readonly ExecutionEvent<AttemptFailureEventPayload>[] {
  return durableAttemptFailures(port).filter((event) => event.payload.willRetry);
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
    // One durable authority survives; every runner instance is a fresh process
    // that crashes after each attempt-failure is published but before the
    // acknowledgement reaches the caller.
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
      ).rejects.toThrow();

      // Retry allowance is only ever consumed, never restored.
      expect(port.loadCheckpoint(executionId)?.usage.retries ?? 0).toBeLessThanOrEqual(
        maxRetries,
      );
      expect(calls).toBeLessThanOrEqual(maxRetries + 1);
    }

    // Once the durable allowance is spent the step is ineligible for any
    // further execution, so restarts stay flat instead of granting one more
    // unpaid attempt each time.
    const exhausted = calls;
    for (let restart = 0; restart < 5; restart += 1) {
      await expect(
        new ResumableSequentialWorkflowRunner({
          durability: port,
          nextEventId,
          retryPolicyForStep: () => ({ maxAttempts: 5 }),
        }).run(alwaysFailingWorkflow(() => (calls += 1)), 1, context()),
      ).rejects.toBeInstanceOf(RetryBudgetExhaustedError);
      expect(calls).toBe(exhausted);
    }

    expect(calls).toBeLessThanOrEqual(maxRetries + 1);
    expect(durableAttemptFailures(port).length).toBe(calls);
  });

  it("bounds total executions by maxRetries without any crash", async () => {
    const port = new InMemoryStepCompletionCommitPort();
    const nextEventId = ids("event");
    let calls = 0;

    const run = async () =>
      new ResumableSequentialWorkflowRunner({
        durability: port,
        nextEventId,
        retryPolicyForStep: () => ({ maxAttempts: 9 }),
      }).run(alwaysFailingWorkflow(() => (calls += 1)), 1, context());

    await expect(run()).rejects.toThrow("boundary failure");
    expect(calls).toBe(maxRetries + 1);

    for (let restart = 0; restart < 3; restart += 1) {
      await expect(run()).rejects.toBeInstanceOf(RetryBudgetExhaustedError);
      expect(calls).toBe(maxRetries + 1);
    }
  });

  it("still grants an interrupted step its unpaid attempt after restart", async () => {
    const port = new InMemoryStepCompletionCommitPort();
    const nextEventId = ids("event");
    let calls = 0;
    let fail = true;

    const workflow = {
      id: "retry-consumption-workflow",
      version: "1",
      steps: [
        {
          id: "always-fails",
          description: "interrupted once",
          execute: async (value: unknown): Promise<number> => {
            calls += 1;
            if (fail) throw new Error("boundary failure");
            return Number(value) + 1;
          },
        },
      ],
      mapOutput: Number,
    } as const;

    const run = async () =>
      new ResumableSequentialWorkflowRunner({
        durability: port,
        nextEventId,
      }).run(workflow, 1, context());

    await expect(run()).rejects.toThrow("boundary failure");
    fail = false;
    await expect(run()).resolves.toBe(2);
    expect(calls).toBe(2);
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
      readonly consumedAttemptsBefore?: number;
      readonly consumedAttempts?: number;
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
        stepAttemptConsumption: {
          stepId: overrides.payload?.stepId ?? event.payload.stepId,
          stepIndex: overrides.payload?.stepIndex ?? event.payload.stepIndex,
          consumedAttempts:
            overrides.consumedAttempts ?? (overrides.consumedAttemptsBefore ?? 0) + 1,
        },
      },
      expectedCheckpointRevision: undefined,
      consumedRetriesBefore: overrides.consumedRetriesBefore ?? 0,
      consumedAttemptsBefore: overrides.consumedAttemptsBefore ?? 0,
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

  it("accepts a terminal failure that records the attempt without a retry", () => {
    const commit = request({ payload: { willRetry: false }, retries: 0 });
    const checkpoint = validateAttemptFailureCommit(commit, result(commit));
    expect(checkpoint.usage.retries).toBe(0);
    expect(checkpoint.stepAttemptConsumption?.consumedAttempts).toBe(1);
  });

  it("rejects a transition that records no attempt consumption", () => {
    const commit = request();
    const { stepAttemptConsumption: _omitted, ...checkpoint } = commit.checkpoint;
    const stripped: AttemptFailureCommitRequest = { ...commit, checkpoint };
    expect(() => validateAttemptFailureCommit(stripped, result(stripped))).toThrow(
      InvalidAttemptFailureCommitError,
    );
  });

  it("rejects attempt consumption that does not advance exactly once", () => {
    const commit = request({ consumedAttempts: 3 });
    expect(() => validateAttemptFailureCommit(commit, result(commit))).toThrow(
      InvalidAttemptFailureCommitError,
    );
  });

  it("rejects attempt consumption bound to another step identity", () => {
    const commit = request();
    const bound: AttemptFailureCommitRequest = {
      ...commit,
      checkpoint: {
        ...commit.checkpoint,
        stepAttemptConsumption: {
          stepId: "other-step",
          stepIndex: 0,
          consumedAttempts: 1,
        },
      },
    };
    expect(() => validateAttemptFailureCommit(bound, result(bound))).toThrow(
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

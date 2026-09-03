import { describe, expect, it } from "vitest";
import type { ExecutionUsage, WorkflowContext } from "../src/index.js";
import {
  CommitAuthorityRevokedError,
  ExecutionTimedOutError,
  type ExecutionAttemptContext,
} from "../src/execution-control.js";
import { InMemoryStepCompletionCommitPort } from "../src/in-memory-step-completion-commit.js";
import { ResumableSequentialWorkflowRunner } from "../src/resumable-runner.js";

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

function ids(): () => string {
  let next = 0;
  return () => `timeout-event-${++next}`;
}

describe("ResumableSequentialWorkflowRunner timeout fencing", () => {
  it("propagates attempt authority and rejects a consequential late commit after timeout", async () => {
    const durability = new InMemoryStepCompletionCommitPort();
    let releaseLateWork!: () => void;
    let markStarted!: () => void;
    let markLateFinished!: () => void;
    const lateWorkGate = new Promise<void>((resolve) => {
      releaseLateWork = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const lateFinished = new Promise<void>((resolve) => {
      markLateFinished = resolve;
    });

    let observedAttempt: ExecutionAttemptContext | undefined;
    let lateCommitError: unknown;
    let externalWrites = 0;

    const workflow = {
      id: "timeout-workflow",
      version: "1",
      steps: [
        {
          id: "consequential-step",
          description: "proves timeout fencing reaches the step/provider boundary",
          execute: async (
            value: unknown,
            _workflowContext: WorkflowContext,
            attemptContext?: ExecutionAttemptContext,
          ) => {
            if (attemptContext === undefined) {
              throw new Error("attempt fencing context was not propagated");
            }
            observedAttempt = attemptContext;
            markStarted();
            await lateWorkGate;
            try {
              await attemptContext.commitAuthority.commit(async () => {
                externalWrites += 1;
              });
            } catch (error) {
              lateCommitError = error;
            } finally {
              markLateFinished();
            }
            return value;
          },
        },
      ],
    } as const;

    const deadlineAtMs = Date.now() + 100;
    const runner = new ResumableSequentialWorkflowRunner({
      durability,
      nextEventId: ids(),
      deadline: {
        deadlineAtMs,
        nowMs: () => Date.now(),
      },
    });

    const run = runner.run(workflow, "input", context());
    await started;
    await expect(run).rejects.toBeInstanceOf(ExecutionTimedOutError);

    expect(observedAttempt).toBeDefined();
    expect(observedAttempt?.commitAuthority.isRevoked).toBe(true);
    expect(observedAttempt?.commitAuthority.revocationReason).toBe("deadline");
    expect(observedAttempt?.cancellation.isCancellationRequested).toBe(true);

    releaseLateWork();
    await lateFinished;

    expect(externalWrites).toBe(0);
    expect(lateCommitError).toBeInstanceOf(CommitAuthorityRevokedError);
    expect(durability.loadCompletionEvent("timeout-execution")).toBeUndefined();
    await expect(durability.loadEventCursor("timeout-execution")).resolves.toMatchObject({
      sequence: 5,
    });
  });
});

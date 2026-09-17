import { describe, expect, it } from "vitest";
import type { ExecutionEvent, ExecutionUsage } from "../src/index.js";
import {
  InvalidStepCompletionCommitError,
  validateStepCompletionCommit,
  type StepCompletionCommitRequest,
  type StepCompletionCommitResult,
} from "../src/step-completion-commit.js";

function usage(): ExecutionUsage {
  return {
    toolCalls: 0,
    retries: 0,
    iterations: 1,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
  };
}

function fixture(): {
  request: StepCompletionCommitRequest;
  result: StepCompletionCommitResult;
} {
  const completionEvent: ExecutionEvent<{ stepId: string; stepIndex: number }> = {
    id: "event-4",
    executionId: "execution-1",
    sequence: 4,
    type: "workflow.step.completed",
    occurredAt: "2026-09-02T18:00:00.000Z",
    actor: "runner",
    parentEventId: "event-3",
    payload: { stepId: "first", stepIndex: 0 },
  };
  const checkpoint = {
    executionId: "execution-1",
    workflowId: "recovery-workflow",
    workflowVersion: "1",
    nextStepIndex: 1,
    completedStepIds: ["first"],
    value: 3,
    usage: usage(),
    lastEventSequence: 4,
    parentEventId: "event-4",
  } as const;
  return {
    request: {
      completionEvent,
      checkpoint,
      expectedCheckpointRevision: undefined,
    },
    result: {
      checkpoint: { ...checkpoint, revision: 1 },
      eventSequence: 4,
      eventId: "event-4",
    },
  };
}

describe("step completion atomic commit acknowledgement", () => {
  it("accepts one identity-bound completion/checkpoint transition", () => {
    const { request, result } = fixture();
    expect(validateStepCompletionCommit(request, result)).toEqual(result.checkpoint);
  });

  it("fails closed when an adapter acknowledges an event without the matching checkpoint tail", () => {
    const { request, result } = fixture();
    const mismatched = {
      ...result,
      checkpoint: { ...result.checkpoint, parentEventId: "event-3" },
    };
    expect(() => validateStepCompletionCommit(request, mismatched)).toThrow(
      InvalidStepCompletionCommitError,
    );
  });

  it("fails closed when an adapter acknowledges a checkpoint that skips the completed step", () => {
    const { request, result } = fixture();
    const mismatched = {
      ...result,
      checkpoint: { ...result.checkpoint, nextStepIndex: 0 },
    };
    expect(() => validateStepCompletionCommit(request, mismatched)).toThrow(
      /does not match requested completion transition/,
    );
  });

  it("fails closed when an adapter acknowledges a different completed-step prefix", () => {
    const { request, result } = fixture();
    const mismatched = {
      ...result,
      checkpoint: { ...result.checkpoint, completedStepIds: ["different-step"] },
    };
    expect(() => validateStepCompletionCommit(request, mismatched)).toThrow(
      /does not match requested completion transition/,
    );
  });

  it("fails closed when an adapter substitutes the post-step checkpoint value", () => {
    const { request, result } = fixture();
    const mismatched = {
      ...result,
      checkpoint: { ...result.checkpoint, value: 999 },
    };
    expect(() => validateStepCompletionCommit(request, mismatched)).toThrow(
      /does not match requested completion transition/,
    );
  });

  it("fails closed when an adapter acknowledges a checkpoint revision that does not advance exactly once", () => {
    const { request, result } = fixture();
    const mismatched = {
      ...result,
      checkpoint: { ...result.checkpoint, revision: 2 },
    };
    expect(() => validateStepCompletionCommit(request, mismatched)).toThrow(
      /revision does not advance exactly once/,
    );
  });
});

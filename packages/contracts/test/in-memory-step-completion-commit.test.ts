import { describe, expect, it } from "vitest";
import type { ExecutionEvent, ExecutionUsage } from "../src/index.js";
import { InMemoryStepCompletionCommitPort } from "../src/in-memory-step-completion-commit.js";
import type { WorkflowCheckpoint } from "../src/resumable-runner.js";

function usage(iterations: number): ExecutionUsage {
  return {
    toolCalls: 0,
    retries: 0,
    iterations,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
  };
}

describe("InMemoryStepCompletionCommitPort resumed transition", () => {
  it("atomically advances from an authoritative resumed checkpoint revision", async () => {
    const initial: WorkflowCheckpoint = {
      executionId: "execution-1",
      workflowId: "recovery-workflow",
      workflowVersion: "1",
      nextStepIndex: 1,
      completedStepIds: ["first"],
      value: 3,
      usage: usage(1),
      lastEventSequence: 4,
      parentEventId: "event-4",
      revision: 1,
    };
    const completionEvent: ExecutionEvent<{ stepId: string; stepIndex: number }> = {
      id: "event-8",
      executionId: "execution-1",
      sequence: 8,
      type: "workflow.step.completed",
      occurredAt: "2026-09-02T19:00:00.000Z",
      actor: "runner",
      parentEventId: "event-7",
      payload: { stepId: "second", stepIndex: 1 },
    };
    const port = new InMemoryStepCompletionCommitPort({ initialCheckpoints: [initial] });

    const result = await port.commitStepCompletion({
      completionEvent,
      checkpoint: {
        executionId: "execution-1",
        workflowId: "recovery-workflow",
        workflowVersion: "1",
        nextStepIndex: 2,
        completedStepIds: ["first", "second"],
        value: 6,
        usage: usage(2),
        lastEventSequence: 8,
        parentEventId: "event-8",
      },
      expectedCheckpointRevision: 1,
    });

    expect(result.checkpoint.revision).toBe(2);
    expect(port.loadCheckpoint("execution-1")).toEqual(result.checkpoint);
    expect(port.loadCompletionEvent("execution-1")).toEqual(completionEvent);
  });

  it("publishes neither side when failure is injected after validation", async () => {
    const port = new InMemoryStepCompletionCommitPort({
      failAt: "after_validation_before_publish",
    });
    const completionEvent: ExecutionEvent<{ stepId: string; stepIndex: number }> = {
      id: "event-4",
      executionId: "execution-1",
      sequence: 4,
      type: "workflow.step.completed",
      occurredAt: "2026-09-02T19:00:00.000Z",
      actor: "runner",
      parentEventId: "event-3",
      payload: { stepId: "first", stepIndex: 0 },
    };

    await expect(
      port.commitStepCompletion({
        completionEvent,
        checkpoint: {
          executionId: "execution-1",
          workflowId: "recovery-workflow",
          workflowVersion: "1",
          nextStepIndex: 1,
          completedStepIds: ["first"],
          value: 3,
          usage: usage(1),
          lastEventSequence: 4,
          parentEventId: "event-4",
        },
        expectedCheckpointRevision: undefined,
      }),
    ).rejects.toThrow("injected step-completion failure before atomic publish");

    expect(port.loadCheckpoint("execution-1")).toBeUndefined();
    expect(port.loadCompletionEvent("execution-1")).toBeUndefined();
  });
});

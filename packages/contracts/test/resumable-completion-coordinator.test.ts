import { describe, expect, it } from "vitest";
import { InMemoryStepCompletionCommitPort } from "../src/in-memory-step-completion-commit.js";
import { coordinateAtomicResumableCompletion } from "../src/resumable-completion-coordinator.js";

const usage = {
  toolCalls: 0,
  retries: 0,
  iterations: 1,
  inputTokens: 0,
  outputTokens: 0,
  durationMs: 0,
  costUsd: 0,
};

describe("coordinateAtomicResumableCompletion", () => {
  it("publishes completion evidence and the advanced checkpoint as one acknowledged transition", async () => {
    const durability = new InMemoryStepCompletionCommitPort();

    const result = await coordinateAtomicResumableCompletion({
      durability,
      executionId: "execution-1",
      workflowId: "workflow-1",
      workflowVersion: "1",
      stepId: "step-1",
      stepIndex: 0,
      completedStepIds: ["step-1"],
      value: { completed: true },
      usage,
      cursor: { sequence: 4, parentEventId: "event-4" },
      expectedCheckpointRevision: undefined,
      nextEventId: () => "event-5",
      actor: "test-runner",
      occurredAt: "2026-09-03T08:00:00.000Z",
    });

    expect(result.cursor).toEqual({ sequence: 5, parentEventId: "event-5" });
    expect(result.checkpoint).toMatchObject({
      nextStepIndex: 1,
      completedStepIds: ["step-1"],
      lastEventSequence: 5,
      parentEventId: "event-5",
      revision: 1,
    });
    expect(durability.loadCompletionEvent("execution-1")).toMatchObject({
      id: "event-5",
      sequence: 5,
      parentEventId: "event-4",
      type: "workflow.step.completed",
      payload: { stepId: "step-1", stepIndex: 0 },
    });
    expect(durability.loadCheckpoint("execution-1")).toEqual(result.checkpoint);
  });

  it("does not expose completion evidence or checkpoint progress when atomic publication fails", async () => {
    const durability = new InMemoryStepCompletionCommitPort({
      failAt: "after_validation_before_publish",
    });

    await expect(
      coordinateAtomicResumableCompletion({
        durability,
        executionId: "execution-crash",
        workflowId: "workflow-1",
        workflowVersion: "1",
        stepId: "step-1",
        stepIndex: 0,
        completedStepIds: ["step-1"],
        value: "post-step-value",
        usage,
        cursor: { sequence: 9, parentEventId: "event-9" },
        expectedCheckpointRevision: undefined,
        nextEventId: () => "event-10",
        actor: "test-runner",
        occurredAt: "2026-09-03T08:00:00.000Z",
      }),
    ).rejects.toThrow("injected step-completion failure before atomic publish");

    expect(durability.loadCompletionEvent("execution-crash")).toBeUndefined();
    expect(durability.loadCheckpoint("execution-crash")).toBeUndefined();
  });
});

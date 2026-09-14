import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "../src/index.js";
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
    const precedingEvent: ExecutionEvent = {
      id: "event-1", executionId: "execution-1", sequence: 1,
      type: "execution.started", occurredAt: "2026-09-03T07:59:59.000Z",
      actor: "test-runner", payload: {},
    };
    await durability.append(precedingEvent);
    const result = await coordinateAtomicResumableCompletion({
      durability, executionId: "execution-1", workflowId: "workflow-1", workflowVersion: "1",
      stepId: "step-1", stepIndex: 0, completedStepIds: ["step-1"],
      value: { completed: true }, usage,
      cursor: { sequence: 1, parentEventId: "event-1" }, expectedCheckpointRevision: undefined,
      nextEventId: () => "event-2", actor: "test-runner", occurredAt: "2026-09-03T08:00:00.000Z",
    });
    expect(result.cursor).toEqual({ sequence: 2, parentEventId: "event-2" });
    expect(result.checkpoint).toMatchObject({ nextStepIndex: 1, completedStepIds: ["step-1"], lastEventSequence: 2, parentEventId: "event-2", revision: 1 });
    expect(durability.loadCompletionEvent("execution-1")).toMatchObject({ id: "event-2", sequence: 2, parentEventId: "event-1", type: "workflow.step.completed", payload: { stepId: "step-1", stepIndex: 0 } });
    expect(durability.loadCheckpoint("execution-1")).toEqual(result.checkpoint);
  });

  it("does not expose completion evidence or checkpoint progress when atomic publication fails", async () => {
    const durability = new InMemoryStepCompletionCommitPort({ failAt: "after_validation_before_publish" });
    await expect(coordinateAtomicResumableCompletion({
      durability, executionId: "execution-crash", workflowId: "workflow-1", workflowVersion: "1",
      stepId: "step-1", stepIndex: 0, completedStepIds: ["step-1"], value: "post-step-value", usage,
      cursor: { sequence: 0 }, expectedCheckpointRevision: undefined,
      nextEventId: () => "event-1", actor: "test-runner", occurredAt: "2026-09-03T08:00:00.000Z",
    })).rejects.toThrow("injected step-completion failure before atomic publish");
    expect(durability.loadCompletionEvent("execution-crash")).toBeUndefined();
    expect(durability.loadCheckpoint("execution-crash")).toBeUndefined();
    await expect(durability.loadEventCursor("execution-crash")).resolves.toEqual({ sequence: 0 });
  });

  it("reconciles authoritative completion and checkpoint progress when acknowledgement is lost after atomic publish", async () => {
    const durability = new InMemoryStepCompletionCommitPort({ failAt: "after_publish_before_ack" });
    const result = await coordinateAtomicResumableCompletion({
      durability, executionId: "execution-uncertain", workflowId: "workflow-1", workflowVersion: "1",
      stepId: "step-1", stepIndex: 0, completedStepIds: ["step-1"], value: "post-step-value", usage,
      cursor: { sequence: 0 }, expectedCheckpointRevision: undefined,
      nextEventId: () => "event-1", actor: "test-runner", occurredAt: "2026-09-03T08:00:00.000Z",
    });
    expect(result.cursor).toEqual({ sequence: 1, parentEventId: "event-1" });
    expect(result.checkpoint).toMatchObject({ nextStepIndex: 1, completedStepIds: ["step-1"], value: "post-step-value", lastEventSequence: 1, parentEventId: "event-1", revision: 1 });
    expect(durability.loadCompletionEvent("execution-uncertain")).toMatchObject({ id: "event-1", sequence: 1, type: "workflow.step.completed" });
    expect(durability.loadCheckpoint("execution-uncertain")).toEqual(result.checkpoint);
    await expect(durability.loadEventCursor("execution-uncertain")).resolves.toEqual({ sequence: 1, parentEventId: "event-1" });
  });

  it("fails closed when the caller cursor disagrees with authoritative durability", async () => {
    const durability = new InMemoryStepCompletionCommitPort();
    await expect(coordinateAtomicResumableCompletion({
      durability, executionId: "execution-stale-cursor", workflowId: "workflow-1", workflowVersion: "1",
      stepId: "step-1", stepIndex: 0, completedStepIds: ["step-1"], value: "post-step-value", usage,
      cursor: { sequence: 3, parentEventId: "event-3" }, expectedCheckpointRevision: undefined,
      nextEventId: () => "event-4", actor: "test-runner", occurredAt: "2026-09-03T08:00:00.000Z",
    })).rejects.toThrow("cursor does not match authoritative durability event cursor");
    expect(durability.loadCompletionEvent("execution-stale-cursor")).toBeUndefined();
    expect(durability.loadCheckpoint("execution-stale-cursor")).toBeUndefined();
  });
});
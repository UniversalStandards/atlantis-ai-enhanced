import { describe, expect, it } from "vitest";

import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
} from "../src/index.js";
import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import { TaskEntrypoint, UnknownWorkflowError } from "../src/task-entrypoint.js";

const budget = {
  maxToolCalls: 0,
  maxRetries: 0,
  maxIterations: 2,
  maxTokens: 0,
  maxDurationMs: 0,
  maxCostUsd: 0,
} as const;

function buildEntrypoint(storage: InMemoryAtomicSnapshotStorage): TaskEntrypoint {
  const sink = new DurableExecutionEventSink(new DurableSnapshotEventStore(storage));
  let event = 0;
  return new TaskEntrypoint({
    eventSink: sink,
    nextExecutionId: () => "execution-1",
    nextEventId: () => `event-${++event}`,
    now: () => "2026-08-03T07:00:00.000Z",
    resolveWorkflow: (workflowId) =>
      workflowId === "double"
        ? {
            id: "double",
            version: "1.0.0",
            steps: [
              {
                id: "multiply",
                description: "Double a numeric input",
                execute: async (value) => Number(value) * 2,
              },
            ],
          }
        : undefined,
  });
}

describe("TaskEntrypoint", () => {
  it("turns a request into a durable terminal trace recoverable after restart", async () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const result = await buildEntrypoint(storage).submit<number, number>({
      workflowId: "double",
      input: 4,
      userId: "user-1",
      budget,
      metadata: { source: "api" },
    });

    expect(result.executionId).toBe("execution-1");
    expect(result.output).toBe(8);
    expect(result.trace.map((event) => event.type)).toEqual([
      "execution.started",
      "workflow.step.started",
      "workflow.step.completed",
      "execution.completed",
    ]);

    const restartedSink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    );
    expect(restartedSink.readExecution(result.executionId)).toEqual(result.trace);
    expect(result.trace.at(-1)?.type).toBe("execution.completed");
  });

  it("rejects unknown workflows before allocating durable execution state", async () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    await expect(
      buildEntrypoint(storage).submit({
        workflowId: "missing",
        input: null,
        userId: "user-1",
        budget,
      }),
    ).rejects.toBeInstanceOf(UnknownWorkflowError);

    expect(new DurableSnapshotEventStore(storage).readAll()).toEqual([]);
  });
});

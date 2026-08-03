import { describe, expect, it } from "vitest";

import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
} from "../src/index.js";
import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import {
  GovernedTaskEntrypoint,
  InvalidTaskRequestError,
  TaskAuthorizationError,
  TaskEntrypoint,
  UnknownWorkflowError,
} from "../src/task-entrypoint.js";

const budget = {
  maxToolCalls: 0,
  maxRetries: 0,
  maxIterations: 2,
  maxTokens: 0,
  maxDurationMs: 0,
  maxCostUsd: 0,
} as const;

function buildEntrypoint(
  storage: InMemoryAtomicSnapshotStorage,
  onExecutionId: () => void = () => undefined,
): TaskEntrypoint {
  const sink = new DurableExecutionEventSink(new DurableSnapshotEventStore(storage));
  let event = 0;
  return new TaskEntrypoint({
    eventSink: sink,
    nextExecutionId: () => {
      onExecutionId();
      return "execution-1";
    },
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

describe("GovernedTaskEntrypoint", () => {
  it("normalizes and authorizes a request before durable execution", async () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const governed = new GovernedTaskEntrypoint({
      taskEntrypoint: buildEntrypoint(storage),
      authorize: (request) => ({
        allowed: request.userId === "user-1" && request.workflowId === "double",
      }),
    });

    const result = await governed.submit<number>({
      workflowId: "  double ",
      input: 5,
      userId: " user-1 ",
      budget,
      metadata: { source: "api" },
    });

    expect(result.output).toBe(10);
    expect(result.trace.at(-1)?.type).toBe("execution.completed");
  });

  it("rejects unauthorized requests before execution identity or durable state", async () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    let executionIdsAllocated = 0;
    const governed = new GovernedTaskEntrypoint({
      taskEntrypoint: buildEntrypoint(storage, () => {
        executionIdsAllocated += 1;
      }),
      authorize: () => ({ allowed: false, reason: "workflow not permitted" }),
    });

    await expect(
      governed.submit({
        workflowId: "double",
        input: 4,
        userId: "user-2",
        budget,
      }),
    ).rejects.toMatchObject({
      name: TaskAuthorizationError.name,
      message: "workflow not permitted",
    });

    expect(executionIdsAllocated).toBe(0);
    expect(new DurableSnapshotEventStore(storage).readAll()).toEqual([]);
  });

  it.each([
    ["non-object", null],
    [
      "blank user",
      { workflowId: "double", input: 4, userId: " ", budget },
    ],
    [
      "missing input",
      { workflowId: "double", userId: "user-1", budget },
    ],
    [
      "invalid budget",
      {
        workflowId: "double",
        input: 4,
        userId: "user-1",
        budget: { ...budget, maxIterations: Number.NaN },
      },
    ],
    [
      "invalid metadata",
      {
        workflowId: "double",
        input: 4,
        userId: "user-1",
        budget,
        metadata: { source: 5 },
      },
    ],
  ])("rejects malformed request: %s", async (_name, request) => {
    const storage = new InMemoryAtomicSnapshotStorage();
    let authorizationCalls = 0;
    let executionIdsAllocated = 0;
    const governed = new GovernedTaskEntrypoint({
      taskEntrypoint: buildEntrypoint(storage, () => {
        executionIdsAllocated += 1;
      }),
      authorize: () => {
        authorizationCalls += 1;
        return { allowed: true };
      },
    });

    await expect(governed.submit(request)).rejects.toBeInstanceOf(
      InvalidTaskRequestError,
    );
    expect(authorizationCalls).toBe(0);
    expect(executionIdsAllocated).toBe(0);
    expect(new DurableSnapshotEventStore(storage).readAll()).toEqual([]);
  });
});

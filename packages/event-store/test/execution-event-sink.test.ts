import { describe, expect, it } from "vitest";

import type { ExecutionEvent, WorkflowContext } from "@atlantis/contracts";
import { SequentialWorkflowRunner } from "@atlantis/contracts/sequential-runner";

import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
  InvalidEventError,
} from "../src/index.js";
import { DurableExecutionEventSink } from "../src/execution-event-sink.js";

function context(): WorkflowContext {
  return {
    executionId: "execution-1",
    workflowId: "workflow-1",
    workflowVersion: "1.0.0",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 0,
      maxRetries: 0,
      maxIterations: 10,
      maxTokens: 0,
      maxDurationMs: 0,
      maxCostUsd: 0,
    },
    usage: {
      toolCalls: 0,
      retries: 0,
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      costUsd: 0,
    },
    metadata: {},
  };
}

function terminalState(events: readonly ExecutionEvent[]): string {
  return events.reduce((state, event) => {
    if (event.type === "execution.completed") return "completed";
    if (event.type === "execution.failed") return "failed";
    return state;
  }, "running");
}

describe("DurableExecutionEventSink", () => {
  it("persists a runner trace and recovers an equivalent execution after restart", async () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const firstStore = new DurableSnapshotEventStore(storage);
    const firstSink = new DurableExecutionEventSink(firstStore);
    let eventNumber = 0;
    let timestampNumber = 0;

    const runner = new SequentialWorkflowRunner({
      eventSink: firstSink,
      nextEventId: () => `event-${++eventNumber}`,
      now: () => `2026-08-02T00:00:0${timestampNumber++}.000Z`,
    });

    const result = await runner.run(
      {
        id: "workflow-1",
        version: "1.0.0",
        steps: [
          {
            id: "increment",
            description: "increment",
            execute: async (value) => Number(value) + 1,
          },
          {
            id: "double",
            description: "double",
            execute: async (value) => Number(value) * 2,
          },
        ],
      },
      2,
      context(),
    );

    expect(result).toBe(6);

    const uninterrupted = firstSink.readExecution("execution-1");
    const restartedSink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    );
    const recovered = restartedSink.readExecution("execution-1");

    expect(recovered).toEqual(uninterrupted);
    expect(recovered.map((event) => event.type)).toEqual([
      "execution.started",
      "workflow.step.started",
      "workflow.step.completed",
      "workflow.step.started",
      "workflow.step.completed",
      "execution.completed",
    ]);
    expect(recovered.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(recovered.slice(1).map((event) => event.parentEventId)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
    ]);
    expect(terminalState(uninterrupted)).toBe("completed");
    expect(terminalState(recovered)).toBe("completed");
  });

  it("fails closed when an execution sequence is not contiguous", async () => {
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
    );

    await expect(
      sink.append({
        id: "event-2",
        executionId: "execution-1",
        sequence: 2,
        type: "execution.started",
        occurredAt: "2026-08-02T00:00:00.000Z",
        actor: "test",
        payload: {},
      }),
    ).rejects.toBeInstanceOf(InvalidEventError);

    expect(sink.readExecution("execution-1")).toEqual([]);
  });

  it("serializes independent append adapters and recovers after a failed predecessor", async () => {
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
    );
    const order: string[] = [];

    const failedAdapter = sink.withExecutionAppendLock("execution-1", async () => {
      order.push("failed-start");
      await Promise.resolve();
      order.push("failed-end");
      throw new Error("adapter append failed");
    });

    const lifecycleAdapter = sink.withExecutionAppendLock("execution-1", async () => {
      order.push("lifecycle");
      await sink.append({
        id: "lifecycle-event",
        executionId: "execution-1",
        sequence: 1,
        type: "execution.started",
        occurredAt: "2026-08-04T20:00:00.000Z",
        actor: "ownership-runtime",
        payload: { evidenceKind: "ownership.lifecycle" },
      });
    });

    const lossAdapter = sink.withExecutionAppendLock("execution-1", async () => {
      order.push("loss");
      const tail = sink.readExecution("execution-1").at(-1);
      await sink.append({
        id: "loss-event",
        executionId: "execution-1",
        sequence: 2,
        type: "external.effect.ownership.lost",
        occurredAt: "2026-08-04T20:00:01.000Z",
        actor: "ownership-runtime",
        ...(tail === undefined ? {} : { parentEventId: tail.id }),
        payload: {},
      });
    });

    await expect(failedAdapter).rejects.toThrow("adapter append failed");
    await Promise.all([lifecycleAdapter, lossAdapter]);

    expect(order).toEqual(["failed-start", "failed-end", "lifecycle", "loss"]);
    expect(sink.readExecution("execution-1")).toMatchObject([
      { id: "lifecycle-event", sequence: 1 },
      { id: "loss-event", sequence: 2, parentEventId: "lifecycle-event" },
    ]);
  });

  it("does not let a stalled execution block append work for another execution", async () => {
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
    );
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstExecution = sink.withExecutionAppendLock("execution-1", async () => {
      order.push("execution-1-start");
      await firstGate;
      order.push("execution-1-end");
    });

    await Promise.resolve();

    await sink.withExecutionAppendLock("execution-2", () => {
      order.push("execution-2");
    });

    expect(order).toEqual(["execution-1-start", "execution-2"]);

    releaseFirst();
    await firstExecution;

    expect(order).toEqual([
      "execution-1-start",
      "execution-2",
      "execution-1-end",
    ]);
  });

  it("releases the execution lock after a synchronous adapter failure", async () => {
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
    );
    const order: string[] = [];

    await expect(
      sink.withExecutionAppendLock("execution-1", () => {
        order.push("failed");
        throw new Error("synchronous adapter failure");
      }),
    ).rejects.toThrow("synchronous adapter failure");

    await sink.withExecutionAppendLock("execution-1", () => {
      order.push("recovered");
    });

    expect(order).toEqual(["failed", "recovered"]);
  });

  it("rejects padded execution identities before an adapter can bypass the lock key", async () => {
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
    );
    let operationCalls = 0;

    await expect(
      sink.withExecutionAppendLock(" execution-1 ", () => {
        operationCalls += 1;
      }),
    ).rejects.toThrow(
      "executionId must not contain leading or trailing whitespace.",
    );

    expect(operationCalls).toBe(0);
  });
});

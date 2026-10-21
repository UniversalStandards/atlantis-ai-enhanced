import { describe, expect, it } from "vitest";

import type { ExecutionEvent } from "@atlantis/contracts";

import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
  InvalidEventError,
} from "../src/index.js";

function event(
  executionId: string,
  id: string,
  sequence: number,
): ExecutionEvent {
  return {
    id,
    executionId,
    sequence,
    type: "execution.started",
    occurredAt: `2026-08-05T15:40:0${sequence}.000Z`,
    actor: "governed-identity-test",
    payload: {},
  };
}

describe("DurableExecutionEventSink governed execution identity", () => {
  it("rejects a cross-execution append without consuming either cursor", async () => {
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
    );

    const attempted = sink.enqueueExecutionAppend(
      "execution-a",
      ({ append }) => append(event("execution-b", "wrong-stream", 1)),
    );

    await expect(attempted.result).rejects.toBeInstanceOf(InvalidEventError);
    await expect(attempted.result).rejects.toThrow(
      "governed execution append event executionId must match its admitted executionId.",
    );

    expect(sink.readExecution("execution-a")).toEqual([]);
    expect(sink.readExecution("execution-b")).toEqual([]);

    const recovered = sink.enqueueExecutionAppend(
      "execution-b",
      ({ append }) => append(event("execution-b", "event-b-1", 1)),
    );
    await recovered.result;

    expect(sink.readExecution("execution-b")).toMatchObject([
      { id: "event-b-1", executionId: "execution-b", sequence: 1 },
    ]);
  });

  it("preserves independent concurrent cursors when one operation targets the wrong execution", async () => {
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
    );
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const executionA = sink.enqueueExecutionAppend(
      "execution-a",
      async ({ append }) => {
        await gateA;
        await append(event("execution-a", "event-a-1", 1));
      },
    );

    const invalidAtoB = sink.enqueueExecutionAppend(
      "execution-a",
      ({ append }) => append(event("execution-b", "cross-event", 1)),
    );

    const executionB = sink.enqueueExecutionAppend(
      "execution-b",
      ({ append }) => append(event("execution-b", "event-b-1", 1)),
    );

    await executionB.result;
    releaseA();
    await executionA.result;
    await expect(invalidAtoB.result).rejects.toBeInstanceOf(InvalidEventError);

    expect(sink.readExecution("execution-a")).toMatchObject([
      { id: "event-a-1", executionId: "execution-a", sequence: 1 },
    ]);
    expect(sink.readExecution("execution-b")).toMatchObject([
      { id: "event-b-1", executionId: "execution-b", sequence: 1 },
    ]);
  });
});

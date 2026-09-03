import { describe, expect, it } from "vitest";

import type { ExecutionEvent } from "@atlantis/contracts";

import { ExecutionCommitClosedError } from "../src/execution-commit-guard.js";
import { ExecutionWriteAbortedError } from "../src/abortable-execution-writer.js";
import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
} from "../src/index.js";

function event(
  id: string,
  sequence: number,
  payload: Readonly<Record<string, unknown>> = {},
): ExecutionEvent {
  return {
    id,
    executionId: "execution-1",
    sequence,
    type: "execution.started",
    occurredAt: `2026-08-05T15:00:0${sequence}.000Z`,
    actor: "governed-test",
    payload,
  };
}

describe("DurableExecutionEventSink governed append path", () => {
  it("prevents an abandoned operation from appending or consuming the cursor", async () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    );
    let abandonedAppend:
      | ((event: ExecutionEvent) => Promise<void>)
      | undefined;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = sink.enqueueExecutionAppend(
      "execution-1",
      async ({ signal, append, acknowledgeAbort }) => {
        abandonedAppend = append;
        firstStarted();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              acknowledgeAbort();
              resolve();
            },
            { once: true },
          );
        });
        await new Promise<never>(() => undefined);
      },
    );

    await firstStartedPromise;

    const second = sink.enqueueExecutionAppend(
      "execution-1",
      async ({ append }) => {
        await append(event("event-1", 1, { source: "second" }));
        return "committed";
      },
    );

    first.abort("deadline exceeded");
    await first.abortAcknowledged;
    await expect(first.result).rejects.toBeInstanceOf(ExecutionWriteAbortedError);
    await expect(second.result).resolves.toBe("committed");

    expect(sink.readExecution("execution-1")).toMatchObject([
      {
        id: "event-1",
        sequence: 1,
        payload: { source: "second" },
      },
    ]);

    expect(abandonedAppend).toBeDefined();
    expect(() => abandonedAppend?.(event("late-event", 2))).toThrow(
      ExecutionCommitClosedError,
    );

    expect(sink.readExecution("execution-1")).toMatchObject([
      {
        id: "event-1",
        sequence: 1,
        payload: { source: "second" },
      },
    ]);

    const restarted = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    );
    expect(restarted.readExecution("execution-1")).toMatchObject([
      {
        id: "event-1",
        sequence: 1,
        payload: { source: "second" },
      },
    ]);
  });

  it("bounds governed append admission through the sink options", async () => {
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
      { maxWritesPerExecution: 1 },
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = sink.enqueueExecutionAppend("execution-1", () => gate);

    expect(() =>
      sink.enqueueExecutionAppend("execution-1", () => undefined),
    ).toThrow("reached its limit of 1");

    release();
    await first.result;
  });
});

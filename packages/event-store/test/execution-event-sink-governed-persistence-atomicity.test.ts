import { describe, expect, it } from "vitest";

import type { ExecutionEvent } from "@atlantis/contracts";

import { ExecutionCommitClosedError } from "../src/execution-commit-guard.js";
import { ExecutionWriteAbortedError } from "../src/abortable-execution-writer.js";
import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import {
  type AtomicSnapshot,
  type AtomicSnapshotStorage,
  DurableSnapshotEventStore,
  PersistenceConflictError,
} from "../src/index.js";

class ControlledAtomicSnapshotStorage implements AtomicSnapshotStorage {
  private revision = 0;
  private value: string | null = null;
  public compareAndSwapCalls = 0;
  public allowCommit = false;

  public load(): AtomicSnapshot {
    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    this.compareAndSwapCalls += 1;
    if (!this.allowCommit || expectedRevision !== this.revision) {
      return false;
    }
    this.value = nextValue;
    this.revision += 1;
    return true;
  }
}

function event(id: string, sequence: number): ExecutionEvent {
  return Object.freeze({
    id,
    executionId: "execution-1",
    sequence,
    type: "execution.started",
    occurredAt: `2026-08-05T16:00:0${sequence}.000Z`,
    actor: "governed-persistence-test",
    payload: Object.freeze({ source: id }),
  });
}

describe("governed durable persistence atomicity", () => {
  it("does not advance revision or cursor when every atomic persistence attempt fails", async () => {
    const storage = new ControlledAtomicSnapshotStorage();
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage, 2),
    );

    const failed = sink.enqueueExecutionAppend(
      "execution-1",
      ({ append }) => append(event("failed-event", 1)),
    );

    await expect(failed.result).rejects.toEqual(new PersistenceConflictError(2));
    expect(storage.compareAndSwapCalls).toBe(2);
    expect(storage.load()).toEqual({ revision: 0, value: null });
    expect(sink.readExecution("execution-1")).toEqual([]);

    storage.allowCommit = true;
    const recovered = sink.enqueueExecutionAppend(
      "execution-1",
      ({ append }) => append(event("committed-event", 1)),
    );
    await expect(recovered.result).resolves.toBeUndefined();

    expect(storage.load().revision).toBe(1);
    expect(sink.readExecution("execution-1")).toMatchObject([
      { id: "committed-event", sequence: 1 },
    ]);

    const restarted = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage, 2),
    );
    expect(restarted.readExecution("execution-1")).toMatchObject([
      { id: "committed-event", sequence: 1 },
    ]);
  });

  it("prevents acknowledged-abandoned work from reaching atomic persistence", async () => {
    const storage = new ControlledAtomicSnapshotStorage();
    storage.allowCommit = true;
    const sink = new DurableExecutionEventSink(
      new DurableSnapshotEventStore(storage),
    );
    let retainedAppend: ((event: ExecutionEvent) => Promise<void>) | undefined;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });

    const abandoned = sink.enqueueExecutionAppend(
      "execution-1",
      async ({ signal, append, acknowledgeAbort }) => {
        retainedAppend = append;
        started();
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

    await startedPromise;
    abandoned.abort("deadline exceeded");
    await abandoned.abortAcknowledged;
    await expect(abandoned.result).rejects.toBeInstanceOf(
      ExecutionWriteAbortedError,
    );

    expect(retainedAppend).toBeDefined();
    expect(() => retainedAppend?.(event("late-event", 1))).toThrow(
      ExecutionCommitClosedError,
    );
    expect(storage.compareAndSwapCalls).toBe(0);
    expect(storage.load()).toEqual({ revision: 0, value: null });
    expect(sink.readExecution("execution-1")).toEqual([]);
  });
});

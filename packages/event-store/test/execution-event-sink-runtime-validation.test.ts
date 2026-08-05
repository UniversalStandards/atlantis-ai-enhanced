import { describe, expect, it } from "vitest";

import type { ExecutionEvent } from "@atlantis/contracts";

import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
  InvalidEventError,
} from "../src/index.js";
import { DurableExecutionEventSink } from "../src/execution-event-sink.js";

function createSink(): DurableExecutionEventSink {
  return new DurableExecutionEventSink(
    new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
  );
}

describe("DurableExecutionEventSink runtime execution identity validation", () => {
  it("rejects a non-string lock identity before invoking the operation", async () => {
    const sink = createSink();
    let operationCalls = 0;

    await expect(
      sink.withExecutionAppendLock(null as unknown as string, () => {
        operationCalls += 1;
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<InvalidEventError>>({
        message: "executionId must be a string.",
      }),
    );

    expect(operationCalls).toBe(0);
  });

  it.each([null, undefined, 42, {}, "operation"])(
    "rejects non-function append operation %p before queue mutation",
    async (malformedOperation) => {
      const sink = createSink();
      let recoveredCalls = 0;

      await expect(
        sink.withExecutionAppendLock(
          "execution-1",
          malformedOperation as unknown as () => void,
        ),
      ).rejects.toEqual(
        expect.objectContaining<Partial<InvalidEventError>>({
          message: "execution append operation must be a function.",
        }),
      );

      await sink.withExecutionAppendLock("execution-1", () => {
        recoveredCalls += 1;
      });

      expect(recoveredCalls).toBe(1);
      expect(sink.readExecution("execution-1")).toEqual([]);
    },
  );

  it("rejects a non-string event identity before durable-store access", async () => {
    const sink = createSink();
    const malformedEvent = {
      id: "event-1",
      executionId: 42,
      sequence: 1,
      type: "execution.started",
      occurredAt: "2026-08-05T00:00:00.000Z",
      actor: "test",
      payload: {},
    } as unknown as ExecutionEvent;

    await expect(sink.append(malformedEvent)).rejects.toEqual(
      expect.objectContaining<Partial<InvalidEventError>>({
        message: "executionId must be a string.",
      }),
    );

    expect(sink.readExecution("execution-1")).toEqual([]);
  });

  it.each([null, undefined, 42, [], "event"])(
    "rejects malformed non-object event input %p before durable-store access",
    async (malformedEvent) => {
      const sink = createSink();

      await expect(
        sink.append(malformedEvent as unknown as ExecutionEvent),
      ).rejects.toEqual(
        expect.objectContaining<Partial<InvalidEventError>>({
          message: "execution event must be an object.",
        }),
      );

      expect(sink.readExecution("execution-1")).toEqual([]);
    },
  );

  it("rejects a non-string read identity with the canonical typed error", () => {
    const sink = createSink();

    expect(() => sink.readExecution(undefined as unknown as string)).toThrow(
      "executionId must be a string.",
    );
  });
});

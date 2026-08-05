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

  it("rejects an accessor field without invoking its getter", async () => {
    const sink = createSink();
    let getterCalls = 0;
    const event = {
      id: "event-1",
      get executionId() {
        getterCalls += 1;
        return "execution-1";
      },
      sequence: 1,
      type: "execution.started",
      occurredAt: "2026-08-05T00:00:00.000Z",
      actor: "test",
      payload: {},
    } as unknown as ExecutionEvent;

    await expect(sink.append(event)).rejects.toThrow(
      "execution event.executionId must be an enumerable data property.",
    );

    expect(getterCalls).toBe(0);
    expect(sink.readExecution("execution-1")).toEqual([]);
  });

  it("rejects inherited event fields before durable-store access", async () => {
    const sink = createSink();
    const event = Object.create({ executionId: "execution-1" }) as Record<
      string,
      unknown
    >;
    Object.assign(event, {
      id: "event-1",
      sequence: 1,
      type: "execution.started",
      occurredAt: "2026-08-05T00:00:00.000Z",
      actor: "test",
      payload: {},
    });

    await expect(
      sink.append(event as unknown as ExecutionEvent),
    ).rejects.toThrow("execution event must be a plain data record.");

    expect(sink.readExecution("execution-1")).toEqual([]);
  });

  it("rejects symbol-keyed event fields before durable-store access", async () => {
    const sink = createSink();
    const event = {
      id: "event-1",
      executionId: "execution-1",
      sequence: 1,
      type: "execution.started",
      occurredAt: "2026-08-05T00:00:00.000Z",
      actor: "test",
      payload: {},
      [Symbol("hidden")]: true,
    } as unknown as ExecutionEvent;

    await expect(sink.append(event)).rejects.toThrow(
      "execution event must not contain symbol fields.",
    );

    expect(sink.readExecution("execution-1")).toEqual([]);
  });

  it.each([null, undefined, 42, "", "   "])(
    "rejects unrecoverable execution actor %p before persistence",
    async (actor) => {
      const sink = createSink();

      await expect(
        sink.append({
          id: "invalid-event",
          executionId: "execution-1",
          sequence: 1,
          type: "execution.started",
          occurredAt: "2026-08-05T00:00:00.000Z",
          actor: actor as unknown as string,
          payload: {},
        }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<InvalidEventError>>({
          message: "execution event actor must be a non-empty string.",
        }),
      );

      expect(sink.readExecution("execution-1")).toEqual([]);

      await sink.append({
        id: "valid-event",
        executionId: "execution-1",
        sequence: 1,
        type: "execution.started",
        occurredAt: "2026-08-05T00:00:01.000Z",
        actor: "test",
        payload: {},
      });

      expect(sink.readExecution("execution-1")).toMatchObject([
        { id: "valid-event", actor: "test", sequence: 1 },
      ]);
    },
  );
});

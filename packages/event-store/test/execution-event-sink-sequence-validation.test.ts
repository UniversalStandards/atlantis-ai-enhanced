import { describe, expect, it } from "vitest";

import type { ExecutionEvent } from "@atlantis/contracts";

import {
  InvalidEventError,
  type AppendEventInput,
  type EventStore,
  type StoredEvent,
} from "../src/index.js";
import { DurableExecutionEventSink } from "../src/execution-event-sink.js";

class AccessRecordingEventStore implements EventStore {
  public streamVersionReads = 0;
  public appends = 0;

  public append<TPayload>(
    _event: AppendEventInput<TPayload>,
    _expectedVersion: number,
  ): StoredEvent<TPayload> {
    this.appends += 1;
    throw new Error("append must not be reached for malformed sequence input");
  }

  public readStream(): readonly StoredEvent[] {
    return [];
  }

  public readAll(): readonly StoredEvent[] {
    return [];
  }

  public getStreamVersion(): number {
    this.streamVersionReads += 1;
    return 0;
  }
}

function createEvent(sequence: unknown): ExecutionEvent {
  return {
    id: "event-1",
    executionId: "execution-1",
    sequence,
    type: "execution.started",
    occurredAt: "2026-08-05T10:00:00.000Z",
    actor: "test",
    payload: {},
  } as unknown as ExecutionEvent;
}

describe("DurableExecutionEventSink sequence validation", () => {
  it.each([
    null,
    undefined,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    Symbol("sequence"),
  ])(
    "rejects malformed sequence %p before durable-store access",
    async (sequence) => {
      const store = new AccessRecordingEventStore();
      const sink = new DurableExecutionEventSink(store);

      await expect(sink.append(createEvent(sequence))).rejects.toEqual(
        expect.objectContaining<Partial<InvalidEventError>>({
          name: "InvalidEventError",
          message: "execution event sequence must be a positive safe integer.",
        }),
      );

      expect(store.streamVersionReads).toBe(0);
      expect(store.appends).toBe(0);
    },
  );
});

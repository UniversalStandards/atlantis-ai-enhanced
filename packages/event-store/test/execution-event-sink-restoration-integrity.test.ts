import { describe, expect, it } from "vitest";

import type {
  AppendEventInput,
  EventStore,
  StoredEvent,
} from "../src/index.js";
import { InvalidEventError } from "../src/index.js";
import { DurableExecutionEventSink } from "../src/execution-event-sink.js";

function storedEvent(
  overrides: Partial<StoredEvent> = {},
  payloadOverrides: Record<string, unknown> = {},
): StoredEvent {
  return {
    streamId: "execution-1",
    eventId: "event-1",
    eventType: "execution.started",
    occurredAt: "2026-08-05T07:00:00.000Z",
    traceId: "execution-1",
    correlationId: "execution-1",
    payload: {
      sequence: 1,
      actor: "test",
      payload: {},
      ...payloadOverrides,
    },
    sequence: 1,
    streamVersion: 1,
    ...overrides,
  };
}

function sinkFor(event: StoredEvent): DurableExecutionEventSink {
  const store: EventStore = {
    append<TPayload>(
      _event: AppendEventInput<TPayload>,
      _expectedVersion: number,
    ): StoredEvent<TPayload> {
      throw new Error("append is not used by restoration tests");
    },
    readStream(): readonly StoredEvent[] {
      return Object.freeze([event]);
    },
    readAll(): readonly StoredEvent[] {
      return Object.freeze([event]);
    },
    getStreamVersion(): number {
      return 1;
    },
  };

  return new DurableExecutionEventSink(store);
}

describe("DurableExecutionEventSink restoration identity integrity", () => {
  it.each([
    ["traceId", { traceId: "execution-other" }],
    ["correlationId", { correlationId: "execution-other" }],
  ] as const)(
    "rejects a persisted %s that does not match the execution stream",
    (_field, overrides) => {
      const sink = sinkFor(storedEvent(overrides));

      expect(() => sink.readExecution("execution-1")).toThrow(
        "persisted execution event trace and correlation identities must match its stream identity.",
      );
    },
  );

  it("rejects a persisted parent identity that does not match causation", () => {
    const sink = sinkFor(
      storedEvent({ causationId: "event-parent" }, { parentEventId: "event-other" }),
    );

    expect(() => sink.readExecution("execution-1")).toThrow(
      "persisted execution event parentEventId must match its causationId.",
    );
  });

  it("rejects causation without a persisted parent identity", () => {
    const sink = sinkFor(storedEvent({ causationId: "event-parent" }));

    expect(() => sink.readExecution("execution-1")).toThrow(
      "persisted execution event parentEventId must match its causationId.",
    );
  });

  it("revalidates canonical persisted actor identity during restoration", () => {
    const sink = sinkFor(storedEvent({}, { actor: " test " }));

    expect(() => sink.readExecution("execution-1")).toEqual(
      expect.objectContaining<Partial<InvalidEventError>>({
        message:
          "execution event actor must not contain leading or trailing whitespace.",
      }),
    );
  });

  it("restores a fully consistent execution event", () => {
    const sink = sinkFor(
      storedEvent({ causationId: "event-parent" }, { parentEventId: "event-parent" }),
    );

    expect(sink.readExecution("execution-1")).toEqual([
      {
        id: "event-1",
        executionId: "execution-1",
        sequence: 1,
        type: "execution.started",
        occurredAt: "2026-08-05T07:00:00.000Z",
        actor: "test",
        parentEventId: "event-parent",
        payload: {},
      },
    ]);
  });
});

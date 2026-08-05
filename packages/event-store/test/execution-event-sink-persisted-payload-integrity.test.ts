import { describe, expect, it } from "vitest";

import type {
  AppendEventInput,
  EventStore,
  StoredEvent,
} from "../src/index.js";
import { InvalidEventError } from "../src/index.js";
import { DurableExecutionEventSink } from "../src/execution-event-sink.js";

class RestorationFixtureStore implements EventStore {
  public constructor(private readonly event: StoredEvent) {}

  public append<TPayload>(
    _event: AppendEventInput<TPayload>,
    _expectedVersion: number,
  ): StoredEvent<TPayload> {
    throw new Error("append is not used by restoration fixtures");
  }

  public readStream(streamId: string): readonly StoredEvent[] {
    return streamId === "execution-1" ? [this.event] : [];
  }

  public readAll(): readonly StoredEvent[] {
    return [this.event];
  }

  public getStreamVersion(streamId: string): number {
    return streamId === "execution-1" ? 1 : 0;
  }
}

function storedEvent(payload: unknown): StoredEvent {
  return {
    streamId: "execution-1",
    eventId: "event-1",
    eventType: "execution.started",
    occurredAt: "2026-08-05T08:00:00.000Z",
    traceId: "execution-1",
    correlationId: "execution-1",
    payload,
    sequence: 1,
    streamVersion: 1,
  };
}

function sinkForEvent(event: StoredEvent): DurableExecutionEventSink {
  return new DurableExecutionEventSink(new RestorationFixtureStore(event));
}

function sinkFor(payload: unknown): DurableExecutionEventSink {
  return sinkForEvent(storedEvent(payload));
}

describe("DurableExecutionEventSink persisted payload integrity", () => {
  it("rejects a getter-bearing stored envelope without invoking the getter", () => {
    let getterCalls = 0;
    const event = storedEvent({ sequence: 1, actor: "runtime", payload: {} });
    Object.defineProperty(event, "traceId", {
      enumerable: true,
      get(): string {
        getterCalls += 1;
        return "execution-1";
      },
    });

    expect(() => sinkForEvent(event).readExecution("execution-1")).toThrow(
      "stored execution event.traceId must be an enumerable data property.",
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects inherited stored envelope fields", () => {
    const event = Object.create({ traceId: "execution-1" }) as Record<
      string,
      unknown
    >;
    Object.assign(event, storedEvent({ sequence: 1, actor: "runtime", payload: {} }));
    delete event.traceId;

    expect(() =>
      sinkForEvent(event as unknown as StoredEvent).readExecution("execution-1"),
    ).toThrow("stored execution event must be a plain data record.");
  });

  it("rejects unexpected stored envelope fields", () => {
    const event = {
      ...storedEvent({ sequence: 1, actor: "runtime", payload: {} }),
      secret: "drift",
    } as unknown as StoredEvent;

    expect(() => sinkForEvent(event).readExecution("execution-1")).toThrow(
      "stored execution event contains unexpected field secret.",
    );
  });

  it("requires correlation identity in the stored envelope", () => {
    const event = storedEvent({ sequence: 1, actor: "runtime", payload: {} });
    delete (event as Partial<StoredEvent>).correlationId;

    expect(() => sinkForEvent(event).readExecution("execution-1")).toThrow(
      "stored execution event is missing required field correlationId.",
    );
  });

  it.each([
    ["sequence", 0, "stored execution event sequence must be a positive safe integer."],
    ["sequence", Number.NaN, "stored execution event sequence must be a positive safe integer."],
    [
      "streamVersion",
      Number.POSITIVE_INFINITY,
      "stored execution event streamVersion must be a positive safe integer.",
    ],
  ] as const)("rejects invalid stored envelope %s values", (field, value, message) => {
    const event = {
      ...storedEvent({ sequence: 1, actor: "runtime", payload: {} }),
      [field]: value,
    } as StoredEvent;

    expect(() => sinkForEvent(event).readExecution("execution-1")).toThrow(message);
  });

  it("rejects a stored global sequence that precedes its stream version", () => {
    const event = {
      ...storedEvent({ sequence: 2, actor: "runtime", payload: {} }),
      sequence: 1,
      streamVersion: 2,
    };

    expect(() => sinkForEvent(event).readExecution("execution-1")).toThrow(
      "stored execution event sequence must not precede its stream version.",
    );
  });

  it.each(["2026-08-05T08:00:00Z", "not-a-timestamp", 1] as const)(
    "rejects non-canonical stored occurredAt value %p",
    (occurredAt) => {
      const event = {
        ...storedEvent({ sequence: 1, actor: "runtime", payload: {} }),
        occurredAt,
      } as unknown as StoredEvent;

      expect(() => sinkForEvent(event).readExecution("execution-1")).toThrow(
        "stored execution event occurredAt must be a canonical ISO-8601 UTC timestamp.",
      );
    },
  );

  it("rejects a getter-bearing persisted payload without invoking the getter", () => {
    let getterCalls = 0;
    const payload = {
      actor: "runtime",
      payload: {},
      get sequence(): number {
        getterCalls += 1;
        return 1;
      },
    };

    expect(() => sinkFor(payload).readExecution("execution-1")).toThrow(
      "persisted execution event payload.sequence must be an enumerable data property.",
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects inherited persisted payload fields", () => {
    const payload = Object.create({ actor: "runtime" }) as Record<string, unknown>;
    payload.sequence = 1;
    payload.payload = {};

    expect(() => sinkFor(payload).readExecution("execution-1")).toThrow(
      "persisted execution event payload must be a plain data record.",
    );
  });

  it("rejects unexpected persisted payload fields", () => {
    expect(() =>
      sinkFor({ sequence: 1, actor: "runtime", payload: {}, secret: "drift" })
        .readExecution("execution-1"),
    ).toThrow("persisted execution event payload contains unexpected field secret.");
  });

  it("rejects missing required persisted payload fields with the canonical error", () => {
    expect(() => sinkFor({ sequence: 1, payload: {} }).readExecution("execution-1"))
      .toThrow(
        expect.objectContaining<Partial<InvalidEventError>>({
          message: "persisted execution event payload is missing required field actor.",
        }),
      );
  });
});

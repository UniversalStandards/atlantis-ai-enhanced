import { describe, expect, it } from "vitest";

import {
  ConcurrencyConflictError,
  DuplicateEventError,
  InMemoryEventStore,
  InvalidEventError,
  replay,
  type AppendEventInput,
} from "../src/index.js";

function event(
  eventId: string,
  streamId = "workflow-1",
  payload: unknown = {},
): AppendEventInput {
  return {
    streamId,
    eventId,
    eventType: "workflow.step.completed",
    payload,
    occurredAt: "2026-08-01T00:00:00.000Z",
    traceId: "trace-1",
  };
}

describe("InMemoryEventStore", () => {
  it("assigns deterministic global and per-stream ordering", () => {
    const store = new InMemoryEventStore();

    const first = store.append(event("event-1"), 0);
    const otherStream = store.append(event("event-2", "workflow-2"), 0);
    const second = store.append(event("event-3"), 1);

    expect(first).toMatchObject({ sequence: 1, streamVersion: 1 });
    expect(otherStream).toMatchObject({ sequence: 2, streamVersion: 1 });
    expect(second).toMatchObject({ sequence: 3, streamVersion: 2 });
    expect(store.readStream("workflow-1").map((item) => item.eventId)).toEqual([
      "event-1",
      "event-3",
    ]);
  });

  it("rejects stale concurrent writers without appending", () => {
    const store = new InMemoryEventStore();
    store.append(event("event-1"), 0);

    expect(() => store.append(event("event-2"), 0)).toThrow(
      ConcurrencyConflictError,
    );
    expect(store.readAll()).toHaveLength(1);
    expect(store.getStreamVersion("workflow-1")).toBe(1);
  });

  it("rejects duplicate event identifiers across streams", () => {
    const store = new InMemoryEventStore();
    store.append(event("event-1"), 0);

    expect(() => store.append(event("event-1", "workflow-2"), 0)).toThrow(
      DuplicateEventError,
    );
  });

  it("supports deterministic replay from persisted event order", () => {
    const store = new InMemoryEventStore();
    store.append(event("event-1", "workflow-1", { delta: 2 }), 0);
    store.append(event("event-2", "workflow-1", { delta: 3 }), 1);

    const total = replay(0, store.readStream("workflow-1"), (state, stored) => {
      const payload = stored.payload as { delta: number };
      return state + payload.delta;
    });

    expect(total).toBe(5);
    expect(store.readStream("workflow-1", 1).map((item) => item.eventId)).toEqual([
      "event-2",
    ]);
  });

  it("detaches and deeply freezes stored payloads", () => {
    const store = new InMemoryEventStore();
    const payload = { nested: { delta: 2 } };
    const stored = store.append(event("event-1", "workflow-1", payload), 0);
    const snapshot = store.readAll();

    payload.nested.delta = 99;

    expect(stored.payload).toEqual({ nested: { delta: 2 } });
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.payload)).toBe(true);
    expect(Object.isFrozen((stored.payload as typeof payload).nested)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => {
      (stored.payload as typeof payload).nested.delta = 5;
    }).toThrow(TypeError);
  });

  it("fails closed for payloads that cannot be safely detached", () => {
    const store = new InMemoryEventStore();

    expect(() =>
      store.append(event("event-1", "workflow-1", { callback: () => undefined }), 0),
    ).toThrow(InvalidEventError);
    expect(store.readAll()).toHaveLength(0);
  });

  it.each([
    ["blank stream id", { ...event("event-1"), streamId: " " }, 0],
    ["blank event id", { ...event("event-1"), eventId: "" }, 0],
    ["blank event type", { ...event("event-1"), eventType: "" }, 0],
    ["blank trace id", { ...event("event-1"), traceId: "" }, 0],
    ["invalid timestamp", { ...event("event-1"), occurredAt: "invalid" }, 0],
    ["negative version", event("event-1"), -1],
    ["fractional version", event("event-1"), 0.5],
  ])("fails closed for %s", (_name, input, expectedVersion) => {
    const store = new InMemoryEventStore();
    expect(() => store.append(input, expectedVersion)).toThrow(InvalidEventError);
  });
});

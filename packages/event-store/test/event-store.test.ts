import { describe, expect, it } from "vitest";

import {
  ConcurrencyConflictError,
  DuplicateEventError,
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
  InMemoryEventStore,
  InvalidEventError,
  PersistenceConflictError,
  replay,
  type AppendEventInput,
  type AtomicSnapshotStorage,
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

function exerciseOrdering(store: InMemoryEventStore | DurableSnapshotEventStore): void {
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
}

describe("InMemoryEventStore", () => {
  it("assigns deterministic global and per-stream ordering", () => {
    exerciseOrdering(new InMemoryEventStore());
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
    ["blank correlation id", { ...event("event-1"), correlationId: "" }, 0],
    ["blank causation id", { ...event("event-1"), causationId: " " }, 0],
    ["invalid timestamp", { ...event("event-1"), occurredAt: "invalid" }, 0],
    [
      "non-canonical timestamp",
      { ...event("event-1"), occurredAt: "2026-08-01T00:00:00Z" },
      0,
    ],
    ["negative version", event("event-1"), -1],
    ["fractional version", event("event-1"), 0.5],
  ])("fails closed for %s", (_name, input, expectedVersion) => {
    const store = new InMemoryEventStore();
    expect(() => store.append(input, expectedVersion)).toThrow(InvalidEventError);
  });
});

describe("DurableSnapshotEventStore", () => {
  it("preserves deterministic ordering through the durable adapter", () => {
    exerciseOrdering(
      new DurableSnapshotEventStore(new InMemoryAtomicSnapshotStorage()),
    );
  });

  it("recovers complete state and replay results after restart", () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const firstProcess = new DurableSnapshotEventStore(storage);
    firstProcess.append(event("event-1", "workflow-1", { delta: 2 }), 0);
    firstProcess.append(event("event-2", "workflow-1", { delta: 3 }), 1);

    const restartedProcess = new DurableSnapshotEventStore(storage);
    const recovered = restartedProcess.readStream("workflow-1");
    const total = replay(0, recovered, (state, stored) => {
      return state + (stored.payload as { delta: number }).delta;
    });

    expect(recovered.map((item) => item.eventId)).toEqual(["event-1", "event-2"]);
    expect(restartedProcess.getStreamVersion("workflow-1")).toBe(2);
    expect(total).toBe(5);
  });

  it("prevents stale writers across independent store instances", () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const writerOne = new DurableSnapshotEventStore(storage);
    const writerTwo = new DurableSnapshotEventStore(storage);

    writerOne.append(event("event-1"), 0);

    expect(() => writerTwo.append(event("event-2"), 0)).toThrow(
      ConcurrencyConflictError,
    );
    expect(new DurableSnapshotEventStore(storage).readAll()).toHaveLength(1);
  });

  it("fails closed when atomic persistence repeatedly conflicts", () => {
    const conflictingStorage: AtomicSnapshotStorage = {
      load: () => ({ revision: 0, value: null }),
      compareAndSwap: () => false,
    };
    const store = new DurableSnapshotEventStore(conflictingStorage, 2);

    expect(() => store.append(event("event-1"), 0)).toThrow(
      PersistenceConflictError,
    );
  });

  it.each([
    "not-json",
    JSON.stringify({ events: [] }),
    JSON.stringify([
      {
        ...event("event-1"),
        sequence: 2,
        streamVersion: 1,
      },
    ]),
  ])("rejects corrupt persisted state: %s", (value) => {
    const storage: AtomicSnapshotStorage = {
      load: () => ({ revision: 0, value }),
      compareAndSwap: () => true,
    };

    expect(() => new DurableSnapshotEventStore(storage)).toThrow(InvalidEventError);
  });
});

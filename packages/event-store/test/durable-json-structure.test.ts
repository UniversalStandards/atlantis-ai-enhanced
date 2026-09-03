import { describe, expect, it } from "vitest";

import {
  DurableSnapshotEventStore,
  InMemoryAtomicSnapshotStorage,
  InvalidEventError,
  type AppendEventInput,
} from "../src/index.js";

function event(payload: unknown): AppendEventInput {
  return {
    streamId: "workflow-1",
    eventId: "event-1",
    eventType: "workflow.step.completed",
    payload,
    occurredAt: "2026-08-01T00:00:00.000Z",
    traceId: "trace-1",
  };
}

function expectRejectedWithoutWrite(payload: unknown): void {
  const storage = new InMemoryAtomicSnapshotStorage();
  const store = new DurableSnapshotEventStore(storage);

  expect(() => store.append(event(payload), 0)).toThrow(InvalidEventError);
  expect(storage.load()).toEqual({ revision: 0, value: null });
}

describe("durable JSON structural fidelity", () => {
  it("rejects sparse arrays before persistence", () => {
    const payload = ["alpha", , "omega"];
    expectRejectedWithoutWrite(payload);
  });

  it("rejects non-index array properties before persistence", () => {
    const payload: unknown[] & { metadata?: string } = ["alpha"];
    payload.metadata = "omitted by JSON.stringify";
    expectRejectedWithoutWrite(payload);
  });

  it("rejects symbol-keyed properties before persistence", () => {
    const payload = { visible: true } as Record<PropertyKey, unknown>;
    payload[Symbol("hidden")] = "omitted by JSON.stringify";
    expectRejectedWithoutWrite(payload);
  });

  it("rejects non-enumerable properties before persistence", () => {
    const payload = { visible: true };
    Object.defineProperty(payload, "hidden", {
      value: "omitted by JSON.stringify",
      enumerable: false,
    });
    expectRejectedWithoutWrite(payload);
  });

  it("rejects accessor properties without invoking getters", () => {
    let getterCalls = 0;
    const payload = Object.defineProperty({}, "derived", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "value";
      },
    });

    expectRejectedWithoutWrite(payload);
    expect(getterCalls).toBe(0);
  });
});

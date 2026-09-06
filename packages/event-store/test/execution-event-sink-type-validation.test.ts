import { describe, expect, it } from "vitest";

import {
  executionEventTypes,
  type ExecutionEvent,
  type ExecutionEventType,
} from "@atlantis/contracts";

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

function event(type: unknown): ExecutionEvent {
  return {
    id: "event-1",
    executionId: "execution-1",
    sequence: 1,
    type,
    occurredAt: "2026-08-05T05:00:00.000Z",
    actor: "test",
    payload: {},
  } as unknown as ExecutionEvent;
}

describe("DurableExecutionEventSink execution event type validation", () => {
  it.each(["execution.unknown", " execution.started ", "", 42, null])(
    "rejects unrecognized execution event type %p before persistence",
    async (type) => {
      const sink = createSink();

      await expect(sink.append(event(type))).rejects.toEqual(
        expect.objectContaining<Partial<InvalidEventError>>({
          message: "execution event type is not recognized.",
        }),
      );

      expect(sink.readExecution("execution-1")).toEqual([]);
    },
  );

  it("does not consume the stream sequence after rejecting an unknown type", async () => {
    const sink = createSink();

    await expect(sink.append(event("execution.unknown"))).rejects.toBeInstanceOf(
      InvalidEventError,
    );

    await sink.append(event("execution.started"));

    expect(sink.readExecution("execution-1")).toMatchObject([
      { id: "event-1", sequence: 1, type: "execution.started" },
    ]);
  });

  it.each(executionEventTypes)(
    "accepts contracts-owned execution event type %s",
    async (type: ExecutionEventType) => {
      const sink = createSink();

      await sink.append(event(type));

      expect(sink.readExecution("execution-1")).toMatchObject([
        { id: "event-1", sequence: 1, type },
      ]);
    },
  );
});

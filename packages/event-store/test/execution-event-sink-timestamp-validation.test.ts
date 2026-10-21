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

function eventWithOccurredAt(occurredAt: unknown): ExecutionEvent {
  return {
    id: "event-1",
    executionId: "execution-1",
    sequence: 1,
    type: "execution.started",
    occurredAt: occurredAt as string,
    actor: "test",
    payload: {},
  };
}

describe("DurableExecutionEventSink timestamp validation", () => {
  it.each([
    null,
    undefined,
    42,
    "",
    "not-a-timestamp",
    "2026-08-05T00:00:00Z",
    "2026-08-04T17:00:00.000-07:00",
    " 2026-08-05T00:00:00.000Z ",
  ])("rejects non-canonical occurredAt value %p before persistence", async (occurredAt) => {
    const sink = createSink();

    await expect(sink.append(eventWithOccurredAt(occurredAt))).rejects.toEqual(
      expect.objectContaining<Partial<InvalidEventError>>({
        message:
          "execution event occurredAt must be a canonical ISO-8601 UTC timestamp.",
      }),
    );

    expect(sink.readExecution("execution-1")).toEqual([]);
  });

  it("does not consume the stream sequence after rejecting an invalid timestamp", async () => {
    const sink = createSink();

    await expect(
      sink.append(eventWithOccurredAt("2026-08-05T00:00:00Z")),
    ).rejects.toThrow(
      "execution event occurredAt must be a canonical ISO-8601 UTC timestamp.",
    );

    await sink.append(eventWithOccurredAt("2026-08-05T00:00:00.000Z"));

    expect(sink.readExecution("execution-1")).toMatchObject([
      {
        id: "event-1",
        sequence: 1,
        occurredAt: "2026-08-05T00:00:00.000Z",
      },
    ]);
  });
});

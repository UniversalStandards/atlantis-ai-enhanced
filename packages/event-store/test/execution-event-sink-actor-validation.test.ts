import { describe, expect, it } from "vitest";

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

describe("DurableExecutionEventSink actor validation", () => {
  it.each([" actor", "actor ", " actor "])(
    "rejects padded actor label %p without consuming the stream sequence",
    async (actor) => {
      const sink = createSink();

      await expect(
        sink.append({
          id: "invalid-event",
          executionId: "execution-1",
          sequence: 1,
          type: "execution.started",
          occurredAt: "2026-08-05T04:00:00.000Z",
          actor,
          payload: {},
        }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<InvalidEventError>>({
          message:
            "execution event actor must not contain leading or trailing whitespace.",
        }),
      );

      expect(sink.readExecution("execution-1")).toEqual([]);

      await sink.append({
        id: "valid-event",
        executionId: "execution-1",
        sequence: 1,
        type: "execution.started",
        occurredAt: "2026-08-05T04:00:01.000Z",
        actor: "actor",
        payload: {},
      });

      expect(sink.readExecution("execution-1")).toMatchObject([
        { id: "valid-event", actor: "actor", sequence: 1 },
      ]);
    },
  );
});

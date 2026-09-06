import { describe, expect, it } from "vitest";

import {
  DurableSnapshotEventStore,
  InvalidEventError,
  type AppendEventInput,
  type AtomicSnapshot,
  type AtomicSnapshotStorage,
} from "../src/index.js";
import { isMonotonicAppendCandidateObserved } from "../src/monotonic-append-observation.js";

function event(
  eventId: string,
  streamId: string,
  occurredAt: string,
): AppendEventInput {
  return {
    streamId,
    eventId,
    eventType: "workflow.step.completed",
    payload: { eventId },
    occurredAt,
    traceId: `trace-${eventId}`,
  };
}

class CompetingWriterStorage implements AtomicSnapshotStorage {
  private revision = 0;
  private value: string | null = null;
  private interleave: (() => void) | null = null;
  private interleaved = false;
  public writerACandidate: string | null = null;

  public armInterleaving(writer: () => void): void {
    this.interleave = writer;
  }

  public load(): AtomicSnapshot {
    if (
      this.interleave !== null
      && !this.interleaved
      && this.revision === 1
    ) {
      this.interleaved = true;
      this.interleave();
    }

    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    if (expectedRevision !== this.revision) {
      return false;
    }

    if (expectedRevision === 0) {
      this.writerACandidate = nextValue;
    }

    this.revision += 1;
    this.value = nextValue;
    return true;
  }
}

describe("DurableSnapshotEventStore competing-writer acknowledgement", () => {
  it("exposes the durable writer-A false rejection without treating containment as a commit receipt", () => {
    const storage = new CompetingWriterStorage();
    const writerA = new DurableSnapshotEventStore(storage);
    const writerB = new DurableSnapshotEventStore(storage);

    storage.armInterleaving(() => {
      writerB.append(
        event("event-b", "workflow-b", "2026-08-07T00:00:01.000Z"),
        0,
      );
    });

    expect(() =>
      writerA.append(
        event("event-a", "workflow-a", "2026-08-07T00:00:00.000Z"),
        0,
      ),
    ).toThrowError(InvalidEventError);

    const authoritative = storage.load();
    const candidate = storage.writerACandidate;

    expect(candidate).not.toBeNull();
    expect(
      isMonotonicAppendCandidateObserved(
        0,
        candidate as string,
        authoritative,
      ),
    ).toBe(true);

    const restarted = new DurableSnapshotEventStore(storage);
    expect(restarted.readAll().map(({ eventId }) => eventId)).toEqual([
      "event-a",
      "event-b",
    ]);
    expect(authoritative.revision).toBe(2);
  });
});

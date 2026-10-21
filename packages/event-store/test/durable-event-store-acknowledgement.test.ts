import { describe, expect, it } from "vitest";

import {
  DurableSnapshotEventStore,
  InvalidEventError,
  type AppendEventInput,
  type AtomicSnapshot,
  type AtomicSnapshotStorage,
} from "../src/index.js";

function event(eventId = "event-1"): AppendEventInput {
  return {
    streamId: "workflow-1",
    eventId,
    eventType: "workflow.step.completed",
    payload: { nested: { value: 1 } },
    occurredAt: "2026-08-07T00:00:00.000Z",
    traceId: "trace-1",
  };
}

class MutableAcknowledgementStorage implements AtomicSnapshotStorage {
  private revision = 0;
  private value: string | null = null;
  public compareCount = 0;

  public constructor(
    private readonly acknowledgement: (
      revision: number,
      candidate: string,
    ) => AtomicSnapshot,
  ) {}

  public load(): AtomicSnapshot {
    if (this.compareCount === 0) {
      return Object.freeze({ revision: this.revision, value: this.value });
    }
    return this.acknowledgement(this.revision, this.value ?? "");
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    this.compareCount += 1;
    if (expectedRevision !== this.revision) {
      return false;
    }
    this.revision += 1;
    this.value = nextValue;
    return true;
  }
}

describe("DurableSnapshotEventStore append acknowledgement", () => {
  it("rejects a non-boolean compare-and-swap settlement without retrying", () => {
    let compareCount = 0;
    const storage: AtomicSnapshotStorage = {
      load: () => Object.freeze({ revision: 0, value: null }),
      compareAndSwap: () => {
        compareCount += 1;
        return Promise.resolve(true) as unknown as boolean;
      },
    };
    const store = new DurableSnapshotEventStore(storage, 3);

    expect(() => store.append(event(), 0)).toThrowError(InvalidEventError);
    expect(compareCount).toBe(1);
  });

  it("rejects an acknowledgement at the wrong successor revision", () => {
    const storage = new MutableAcknowledgementStorage(
      (_revision, candidate) => Object.freeze({ revision: 9, value: candidate }),
    );
    const store = new DurableSnapshotEventStore(storage, 3);

    expect(() => store.append(event(), 0)).toThrowError(InvalidEventError);
    expect(storage.compareCount).toBe(1);
  });

  it("rejects an acknowledgement whose durable bytes differ from the committed candidate", () => {
    const storage = new MutableAcknowledgementStorage(
      (revision, candidate) => {
        const parsed = JSON.parse(candidate) as Array<Record<string, unknown>>;
        const first = parsed[0];
        if (first !== undefined) {
          first.eventType = "workflow.step.tampered";
        }
        return Object.freeze({ revision, value: JSON.stringify(parsed) });
      },
    );
    const store = new DurableSnapshotEventStore(storage, 3);

    expect(() => store.append(event(), 0)).toThrowError(InvalidEventError);
    expect(storage.compareCount).toBe(1);
  });

  it("returns the immutable event restored from authoritative acknowledged bytes", () => {
    const storage = new MutableAcknowledgementStorage(
      (revision, candidate) => Object.freeze({ revision, value: candidate }),
    );
    const store = new DurableSnapshotEventStore(storage);
    const input = event();

    const stored = store.append(input, 0);

    expect(stored).toMatchObject({
      eventId: "event-1",
      sequence: 1,
      streamVersion: 1,
    });
    expect(stored).not.toBe(input);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.payload)).toBe(true);
    expect(Object.isFrozen((stored.payload as { nested: object }).nested)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  InvalidPersistedUncertaintyStateError,
} from "../src/persistence-uncertainty-repository.js";

const expected = {
  operationId: "append-operation-1",
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

function pendingRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-1",
    expected,
    providerOperationId: "provider-operation-1",
    firstObservedAt: "2026-08-06T00:00:00.000Z",
  });
}

class FalsePositiveStorage implements AtomicSnapshotStorage {
  public loadCalls = 0;
  public compareAndSwapCalls = 0;

  public load(): AtomicSnapshot {
    this.loadCalls += 1;
    return Object.freeze({ revision: 0, value: null });
  }

  public compareAndSwap(_expectedRevision: number, _nextValue: string): boolean {
    this.compareAndSwapCalls += 1;
    return true;
  }
}

class MutableAcknowledgementStorage implements AtomicSnapshotStorage {
  public corruptNextAcknowledgement = false;
  public loadCalls = 0;
  private revision = 0;
  private value: string | null = null;

  public load(): AtomicSnapshot {
    this.loadCalls += 1;
    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    if (expectedRevision !== this.revision) {
      return false;
    }

    this.revision += 1;
    this.value = this.corruptNextAcknowledgement ? `${nextValue} ` : nextValue;
    this.corruptNextAcknowledgement = false;
    return true;
  }
}

const acknowledgementError = new InvalidPersistedUncertaintyStateError(
  "storage acknowledged a commit without exposing the exact candidate at the expected successor revision.",
);

describe("persistence uncertainty repository commit acknowledgement", () => {
  it("rejects literal true when authoritative storage did not advance", () => {
    const storage = new FalsePositiveStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    expect(() => repository.create(pendingRecord())).toThrowError(acknowledgementError);
    expect(storage.compareAndSwapCalls).toBe(1);
    expect(storage.loadCalls).toBe(3);
  });

  it("rejects a create acknowledgement whose durable bytes differ", () => {
    const storage = new MutableAcknowledgementStorage();
    storage.corruptNextAcknowledgement = true;
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    expect(() => repository.create(pendingRecord())).toThrowError(acknowledgementError);
  });

  it("rejects a reconciliation acknowledgement whose durable bytes differ", () => {
    const storage = new MutableAcknowledgementStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    repository.create(pendingRecord());

    storage.corruptNextAcknowledgement = true;
    expect(() => repository.reconcile(
      "uncertainty-1",
      1,
      {
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:01:00.000Z",
        evidence: { expected },
      },
      { now: () => "2026-08-06T00:02:00.000Z" },
    )).toThrowError(acknowledgementError);
  });
});

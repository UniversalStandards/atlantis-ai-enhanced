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

class CorruptFirstAcknowledgementStorage implements AtomicSnapshotStorage {
  public compareAndSwapCalls = 0;
  public loadCalls = 0;
  private corruptNextAcknowledgement = true;
  private revision = 0;
  private value: string | null = null;

  public armCorruption(): void {
    this.corruptNextAcknowledgement = true;
  }

  public load(): AtomicSnapshot {
    this.loadCalls += 1;
    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    this.compareAndSwapCalls += 1;
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

describe("persistence uncertainty acknowledgement retry containment", () => {
  it("does not retry create after a literal-true acknowledgement exposes altered bytes", () => {
    const storage = new CorruptFirstAcknowledgementStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage, 3);

    expect(() => repository.create(pendingRecord())).toThrowError(acknowledgementError);
    expect(storage.compareAndSwapCalls).toBe(1);
    expect(storage.loadCalls).toBe(3);
  });

  it("does not retry reconcile after a literal-true acknowledgement exposes altered bytes", () => {
    const storage = new CorruptFirstAcknowledgementStorage();
    storage.armCorruption();
    storage.compareAndSwap(0, JSON.stringify({
      records: [{ version: 1, record: pendingRecord() }],
      proofConsumptionIndex: { entries: [] },
    }));

    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage, 3);
    const compareAndSwapCallsBeforeReconcile = storage.compareAndSwapCalls;
    const loadCallsBeforeReconcile = storage.loadCalls;
    storage.armCorruption();

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

    expect(storage.compareAndSwapCalls).toBe(compareAndSwapCallsBeforeReconcile + 1);
    expect(storage.loadCalls).toBe(loadCallsBeforeReconcile + 2);
  });
});

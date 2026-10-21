import { describe, expect, it } from "vitest";

import { createPersistenceUncertaintyRecord } from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import { DurableSnapshotPersistenceUncertaintyRepository } from "../src/persistence-uncertainty-repository.js";

class SeededAtomicSnapshotStorage implements AtomicSnapshotStorage {
  public constructor(private readonly snapshot: AtomicSnapshot) {}

  public load(): AtomicSnapshot {
    return this.snapshot;
  }

  public compareAndSwap(): boolean {
    return false;
  }
}

function pendingRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-duplicate",
    expected: {
      operationId: "append-operation-duplicate",
      eventId: "event-duplicate",
      executionId: "execution-duplicate",
      streamVersion: 4,
      contentDigest: "sha256:duplicate",
    },
    providerOperationId: "provider-operation-duplicate",
    firstObservedAt: "2026-08-07T00:00:00.000Z",
  });
}

describe("persistence uncertainty duplicate restoration boundary", () => {
  it("rejects duplicate durable record identities before repository use", () => {
    const record = pendingRecord();
    const value = JSON.stringify({
      records: [
        { version: 1, record },
        { version: 2, record },
      ],
      proofConsumptionIndex: { entries: [] },
    });
    const storage = new SeededAtomicSnapshotStorage({ revision: 2, value });

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError("persisted uncertainty recordId must be unique");
  });
});

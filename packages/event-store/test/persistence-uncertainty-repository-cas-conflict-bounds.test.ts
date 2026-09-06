import { describe, expect, it } from "vitest";

import { createPersistenceUncertaintyRecord } from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  PersistenceUncertaintyRepositoryConflictError,
} from "../src/persistence-uncertainty-repository.js";

class AlwaysConflictingStorage implements AtomicSnapshotStorage {
  public loadCalls = 0;
  public compareAndSwapCalls = 0;

  public load(): AtomicSnapshot {
    this.loadCalls += 1;
    return Object.freeze({ revision: 0, value: null });
  }

  public compareAndSwap(): boolean {
    this.compareAndSwapCalls += 1;
    return false;
  }
}

function pendingRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-cas-conflict-bounds",
    expected: {
      operationId: "append-operation-cas-conflict-bounds",
      eventId: "event-cas-conflict-bounds",
      executionId: "execution-cas-conflict-bounds",
      streamVersion: 1,
      contentDigest: "sha256:cas-conflict-bounds",
    },
    providerOperationId: "provider-operation-cas-conflict-bounds",
    firstObservedAt: "2026-08-08T00:00:00.000Z",
  });
}

describe("persistence uncertainty repository CAS conflict bounds", () => {
  it("stops after the configured conflict bound without acknowledgement reads", () => {
    const storage = new AlwaysConflictingStorage();
    const maxPersistenceAttempts = 3;
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(
      storage,
      maxPersistenceAttempts,
    );

    expect(() => repository.create(pendingRecord())).toThrowError(
      new PersistenceUncertaintyRepositoryConflictError(maxPersistenceAttempts),
    );

    expect(storage.compareAndSwapCalls).toBe(maxPersistenceAttempts);
    // One constructor validation read plus one state read per bounded attempt.
    // A false CAS settlement must never enter the post-commit acknowledgement path.
    expect(storage.loadCalls).toBe(1 + maxPersistenceAttempts);
  });
});

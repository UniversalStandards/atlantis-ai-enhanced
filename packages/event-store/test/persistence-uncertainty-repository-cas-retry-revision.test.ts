import { describe, expect, it } from "vitest";

import { createPersistenceUncertaintyRecord } from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  PersistenceUncertaintyRepositoryConflictError,
} from "../src/persistence-uncertainty-repository.js";

class AdvancingConflictStorage implements AtomicSnapshotStorage {
  public loadCalls = 0;
  public readonly expectedRevisions: number[] = [];
  private revision = 0;

  public load(): AtomicSnapshot {
    this.loadCalls += 1;
    return Object.freeze({ revision: this.revision, value: null });
  }

  public compareAndSwap(expectedRevision: number): boolean {
    this.expectedRevisions.push(expectedRevision);
    // Model unrelated durable activity winning every race while leaving this
    // repository's logical uncertainty state empty. Each retry must reload the
    // authoritative revision rather than replaying a stale CAS precondition.
    this.revision += 1;
    return false;
  }
}

function pendingRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-cas-retry-revision",
    expected: {
      operationId: "append-operation-cas-retry-revision",
      eventId: "event-cas-retry-revision",
      executionId: "execution-cas-retry-revision",
      streamVersion: 1,
      contentDigest: "sha256:cas-retry-revision",
    },
    providerOperationId: "provider-operation-cas-retry-revision",
    firstObservedAt: "2026-08-08T09:00:00.000Z",
  });
}

describe("persistence uncertainty repository CAS retry revisions", () => {
  it("reloads the authoritative revision before every bounded retry", () => {
    const storage = new AdvancingConflictStorage();
    const maxPersistenceAttempts = 3;
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(
      storage,
      maxPersistenceAttempts,
    );

    expect(() => repository.create(pendingRecord())).toThrowError(
      new PersistenceUncertaintyRepositoryConflictError(maxPersistenceAttempts),
    );

    expect(storage.expectedRevisions).toEqual([0, 1, 2]);
    // One constructor validation read plus one authoritative read per attempt.
    // False settlements never enter post-commit acknowledgement reads.
    expect(storage.loadCalls).toBe(1 + maxPersistenceAttempts);
  });
});

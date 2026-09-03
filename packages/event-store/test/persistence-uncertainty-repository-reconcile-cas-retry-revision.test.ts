import { describe, expect, it } from "vitest";

import { createPersistenceUncertaintyRecord } from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  PersistenceUncertaintyRepositoryConflictError,
} from "../src/persistence-uncertainty-repository.js";

class AdvancingReconcileConflictStorage implements AtomicSnapshotStorage {
  public readonly reconcileExpectedRevisions: number[] = [];
  private revision = 0;
  private value: string | null = null;
  private seedCommitted = false;

  public load(): AtomicSnapshot {
    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    if (!this.seedCommitted) {
      if (expectedRevision !== this.revision) {
        return false;
      }
      this.seedCommitted = true;
      this.revision += 1;
      this.value = nextValue;
      return true;
    }

    this.reconcileExpectedRevisions.push(expectedRevision);
    // Model unrelated durable activity winning every reconciliation race while
    // preserving the uncertainty record at version 1. Each retry must reload
    // the newly authoritative storage revision before issuing its next CAS.
    this.revision += 1;
    return false;
  }
}

function pendingRecord() {
  const expected = {
    operationId: "append-operation-reconcile-cas-retry-revision",
    eventId: "event-reconcile-cas-retry-revision",
    executionId: "execution-reconcile-cas-retry-revision",
    streamVersion: 1,
    contentDigest: "sha256:reconcile-cas-retry-revision",
  } as const;

  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-reconcile-cas-retry-revision",
    expected,
    providerOperationId: "provider-operation-reconcile-cas-retry-revision",
    firstObservedAt: "2026-08-08T09:00:00.000Z",
  });
}

describe("persistence uncertainty reconcile CAS retry revisions", () => {
  it("reloads the authoritative revision before every bounded reconcile retry", () => {
    const storage = new AdvancingReconcileConflictStorage();
    const maxPersistenceAttempts = 3;
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(
      storage,
      maxPersistenceAttempts,
    );
    const record = pendingRecord();
    repository.create(record);

    expect(() => repository.reconcile(
      record.recordId,
      1,
      {
        attemptId: "attempt-reconcile-cas-retry-revision",
        observedAt: "2026-08-08T09:01:00.000Z",
        evidence: { expected: record.expected },
      },
      { now: () => "2026-08-08T09:02:00.000Z" },
    )).toThrowError(new PersistenceUncertaintyRepositoryConflictError(maxPersistenceAttempts));

    expect(storage.reconcileExpectedRevisions).toEqual([1, 2, 3]);
  });
});

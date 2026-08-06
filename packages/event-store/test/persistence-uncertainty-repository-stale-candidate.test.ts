import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  PersistenceUncertaintyVersionConflictError,
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

class CommitButReportConflictStorage implements AtomicSnapshotStorage {
  public compareAndSwapCalls = 0;
  public retainedCandidates: string[] = [];
  private revision = 0;
  private value: string | null = null;

  public load(): AtomicSnapshot {
    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    this.compareAndSwapCalls += 1;
    this.retainedCandidates.push(nextValue);
    if (expectedRevision !== this.revision) {
      return false;
    }

    // Model an adapter or intermediary that durably commits the exact candidate
    // but reports an optimistic conflict to the caller. The repository must
    // reload authoritative state and must not replay this retained candidate.
    this.value = nextValue;
    this.revision += 1;
    return false;
  }
}

describe("persistence uncertainty repository stale candidate containment", () => {
  it("does not replay a retained create candidate after authoritative state advances", () => {
    const storage = new CommitButReportConflictStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage, 3);

    expect(() => repository.create(pendingRecord()))
      .toThrowError(new PersistenceUncertaintyVersionConflictError(
        "uncertainty-1",
        0,
        1,
      ));

    expect(storage.compareAndSwapCalls).toBe(1);
    expect(storage.retainedCandidates).toHaveLength(1);

    const restarted = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    expect(restarted.get("uncertainty-1").version).toBe(1);
  });

  it("does not replay a retained reconcile candidate against a later revision", () => {
    const bootstrapStorage = new CommitButReportConflictStorage();
    const bootstrapRepository = new DurableSnapshotPersistenceUncertaintyRepository(
      bootstrapStorage,
      1,
    );

    expect(() => bootstrapRepository.create(pendingRecord()))
      .toThrowError(PersistenceUncertaintyVersionConflictError);

    const repository = new DurableSnapshotPersistenceUncertaintyRepository(
      bootstrapStorage,
      3,
    );

    expect(() => repository.reconcile(
      "uncertainty-1",
      1,
      {
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:01:00.000Z",
        evidence: { expected },
      },
      { now: () => "2026-08-06T00:02:00.000Z" },
    )).toThrowError(new PersistenceUncertaintyVersionConflictError(
      "uncertainty-1",
      1,
      2,
    ));

    expect(bootstrapStorage.compareAndSwapCalls).toBe(2);
    expect(bootstrapStorage.retainedCandidates).toHaveLength(2);

    const restarted = new DurableSnapshotPersistenceUncertaintyRepository(
      bootstrapStorage,
    );
    expect(restarted.get("uncertainty-1").version).toBe(2);
  });
});

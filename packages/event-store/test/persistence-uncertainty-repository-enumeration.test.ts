import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
} from "../src/persistence-uncertainty-repository.js";

class ObservableMemorySnapshotStorage implements AtomicSnapshotStorage {
  private revision = 0;
  private value: string | null = null;
  public loadCount = 0;

  public load(): AtomicSnapshot {
    this.loadCount += 1;
    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    if (expectedRevision !== this.revision) {
      return false;
    }
    this.revision += 1;
    this.value = nextValue;
    return true;
  }

  public resetLoadCount(): void {
    this.loadCount = 0;
  }
}

function pendingRecord(index: number) {
  return createPersistenceUncertaintyRecord({
    recordId: `uncertainty-${index}`,
    expected: {
      operationId: `append-operation-${index}`,
      eventId: `event-${index}`,
      executionId: `execution-${index}`,
      streamVersion: index,
      contentDigest: `sha256:expected-${index}`,
    },
    providerOperationId: `provider-operation-${index}`,
    firstObservedAt: `2026-08-06T01:0${index}:00.000Z`,
  });
}

describe("persistence uncertainty authoritative enumeration", () => {
  it("returns a frozen empty diagnostic collection from one authoritative load", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    storage.resetLoadCount();

    const snapshots = repository.list();

    expect(snapshots).toEqual([]);
    expect(Object.isFrozen(snapshots)).toBe(true);
    expect(storage.loadCount).toBe(1);
  });

  it("preserves durable order and returns immutable authoritative snapshots", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    repository.create(pendingRecord(2));
    repository.create(pendingRecord(1));
    storage.resetLoadCount();

    const snapshots = repository.list();

    expect(storage.loadCount).toBe(1);
    expect(snapshots.map((snapshot) => snapshot.record.recordId)).toEqual([
      "uncertainty-2",
      "uncertainty-1",
    ]);
    expect(snapshots.map((snapshot) => snapshot.version)).toEqual([1, 1]);
    expect(Object.isFrozen(snapshots)).toBe(true);
    for (const snapshot of snapshots) {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.record)).toBe(true);
      expect(Object.isFrozen(snapshot.record.attempts)).toBe(true);
    }
  });

  it("keeps an enumerated diagnostic view isolated from later reconciliation", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    repository.create(pendingRecord(1));

    const before = repository.list();
    repository.reconcile(
      "uncertainty-1",
      1,
      {
        attemptId: "attempt-1",
        observedAt: "2026-08-06T01:02:00.000Z",
        evidence: {
          expected: {
            operationId: "append-operation-1",
            eventId: "event-1",
            executionId: "execution-1",
            streamVersion: 1,
            contentDigest: "sha256:expected-1",
          },
        },
      },
      { now: () => "2026-08-06T01:03:00.000Z" },
    );
    const after = repository.list();

    expect(before[0]?.version).toBe(1);
    expect(before[0]?.record.attempts).toHaveLength(0);
    expect(after[0]?.version).toBe(2);
    expect(after[0]?.record.attempts).toHaveLength(1);
    expect(before).not.toBe(after);
    expect(before[0]).not.toBe(after[0]);
    expect(before[0]?.record).not.toBe(after[0]?.record);
  });
});

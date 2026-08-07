import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
  type PersistenceUncertaintyRecord,
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

function record(index: number, status: "pending" | "quarantined" = "pending") {
  const pending = createPersistenceUncertaintyRecord({
    recordId: `uncertainty-${index}`,
    expected: {
      operationId: `operation-${index}`,
      eventId: `event-${index}`,
      executionId: `execution-${index}`,
      streamVersion: index,
      contentDigest: `sha256:digest-${index}`,
    },
    providerOperationId: `provider-operation-${index}`,
    firstObservedAt: `2026-08-06T0${index}:00:00.000Z`,
  });

  return Object.freeze({ ...pending, status }) as PersistenceUncertaintyRecord;
}

describe("persistence uncertainty repository recovery batch", () => {
  it("selects from exactly one authoritative load in durable order", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    repository.create(record(1));
    repository.create(record(2, "quarantined"));
    repository.create(record(3));
    storage.resetLoadCount();

    const selected = repository.selectRecoveryBatch({
      statuses: ["pending", "quarantined"],
      limit: 2,
    });

    expect(storage.loadCount).toBe(1);
    expect(selected.map((entry) => entry.record.recordId)).toEqual([
      "uncertainty-1",
      "uncertainty-2",
    ]);
    expect(Object.isFrozen(selected)).toBe(true);
  });

  it("is restart-stable for the same authoritative snapshot", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const first = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    first.create(record(1));
    first.create(record(2, "quarantined"));
    first.create(record(3));

    const beforeRestart = first.selectRecoveryBatch({ statuses: ["pending"], limit: 2 });
    const restarted = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const afterRestart = restarted.selectRecoveryBatch({ statuses: ["pending"], limit: 2 });

    expect(afterRestart).toEqual(beforeRestart);
    expect(afterRestart).not.toBe(beforeRestart);
    expect(afterRestart[0]).not.toBe(beforeRestart[0]);
  });

  it("gives concurrent readers the same deterministic batch without writes", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const writer = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    writer.create(record(1));
    writer.create(record(2));
    writer.create(record(3, "quarantined"));

    const readerA = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const readerB = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    storage.resetLoadCount();

    const selection = { statuses: ["pending"] as const, limit: 2 };
    const batchA = readerA.selectRecoveryBatch(selection);
    const batchB = readerB.selectRecoveryBatch(selection);

    expect(storage.loadCount).toBe(2);
    expect(batchA).toEqual(batchB);
    expect(batchA.map((entry) => entry.record.recordId)).toEqual([
      "uncertainty-1",
      "uncertainty-2",
    ]);
  });
});

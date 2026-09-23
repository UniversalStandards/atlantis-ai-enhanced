import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
} from "../src/persistence-uncertainty-repository.js";

class DurableMemorySnapshotStorage implements AtomicSnapshotStorage {
  private revision = 0;
  private value: string | null = null;

  public load(): AtomicSnapshot {
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
    firstObservedAt: `2026-08-06T00:0${index}:00.000Z`,
  });
}

describe("persistence uncertainty restart diagnostics", () => {
  it("restores independently addressable immutable diagnostic snapshots after restart", () => {
    const storage = new DurableMemorySnapshotStorage();
    const writer = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    const firstCreated = writer.create(pendingRecord(1));
    const secondCreated = writer.create(pendingRecord(2));

    const restarted = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const firstRestored = restarted.get("uncertainty-1");
    const secondRestored = restarted.get("uncertainty-2");

    expect(firstRestored).toEqual(firstCreated);
    expect(secondRestored).toEqual(secondCreated);
    expect(firstRestored).not.toBe(firstCreated);
    expect(secondRestored).not.toBe(secondCreated);
    expect(firstRestored.record).not.toBe(firstCreated.record);
    expect(secondRestored.record).not.toBe(secondCreated.record);
    expect(firstRestored.record.recordId).toBe("uncertainty-1");
    expect(secondRestored.record.recordId).toBe("uncertainty-2");
    expect(Object.isFrozen(firstRestored)).toBe(true);
    expect(Object.isFrozen(secondRestored)).toBe(true);
    expect(Object.isFrozen(firstRestored.record)).toBe(true);
    expect(Object.isFrozen(secondRestored.record)).toBe(true);
    expect(Object.isFrozen(firstRestored.record.attempts)).toBe(true);
    expect(Object.isFrozen(secondRestored.record.attempts)).toBe(true);
  });

  it("keeps previously restored diagnostics isolated from later durable revisions", () => {
    const storage = new DurableMemorySnapshotStorage();
    const writer = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    writer.create(pendingRecord(1));

    const firstRestart = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const before = firstRestart.get("uncertainty-1");

    writer.reconcile(
      "uncertainty-1",
      1,
      {
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:03:00.000Z",
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
      { now: () => "2026-08-06T00:04:00.000Z" },
    );

    const secondRestart = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const after = secondRestart.get("uncertainty-1");

    expect(before.version).toBe(1);
    expect(before.record.attempts).toHaveLength(0);
    expect(after.version).toBe(2);
    expect(after.record.attempts).toHaveLength(1);
    expect(before.record).not.toBe(after.record);
  });
});

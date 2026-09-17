import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
} from "../src/persistence-uncertainty-repository.js";

const expected = {
  operationId: "append-operation-1",
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

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

function pendingRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-1",
    expected,
    providerOperationId: "provider-operation-1",
    firstObservedAt: "2026-08-06T00:00:00.000Z",
  });
}

const reconciliationAttempt = {
  attemptId: "attempt-1",
  observedAt: "2026-08-06T00:01:00.000Z",
  evidence: { expected },
} as const;

const trustedClock = { now: () => "2026-08-06T00:02:00.000Z" } as const;

describe("persistence uncertainty authoritative mutation results", () => {
  it("returns create state restored from the acknowledged durable candidate", () => {
    const storage = new DurableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const input = pendingRecord();

    const created = repository.create(input);
    const restarted = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    expect(created).toEqual(restarted.get("uncertainty-1"));
    expect(created.record).not.toBe(input);
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.record)).toBe(true);
  });

  it("returns reconcile state restored from the acknowledged durable candidate", () => {
    const storage = new DurableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    repository.create(pendingRecord());

    const reconciled = repository.reconcile(
      "uncertainty-1",
      1,
      reconciliationAttempt,
      trustedClock,
    );
    const restarted = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    expect(reconciled).toEqual(restarted.get("uncertainty-1"));
    expect(reconciled.version).toBe(2);
    expect(Object.isFrozen(reconciled)).toBe(true);
    expect(Object.isFrozen(reconciled.record)).toBe(true);
  });
});

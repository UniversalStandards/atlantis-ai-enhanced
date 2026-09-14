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

const firstAttempt = {
  attemptId: "attempt-1",
  observedAt: "2026-08-06T00:01:00.000Z",
  evidence: { expected },
} as const;

const secondAttempt = {
  attemptId: "attempt-2",
  observedAt: "2026-08-06T00:03:00.000Z",
  evidence: { expected },
} as const;

const firstClock = { now: () => "2026-08-06T00:02:00.000Z" } as const;
const secondClock = { now: () => "2026-08-06T00:04:00.000Z" } as const;

describe("persistence uncertainty authoritative result isolation", () => {
  it("keeps an acknowledged create result detached from later durable revisions", () => {
    const storage = new DurableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    const created = repository.create(pendingRecord());
    repository.reconcile("uncertainty-1", 1, firstAttempt, firstClock);
    const current = repository.get("uncertainty-1");

    expect(created.version).toBe(1);
    expect(created.record.attempts).toHaveLength(0);
    expect(current.version).toBe(2);
    expect(current.record.attempts).toHaveLength(1);
    expect(created.record).not.toBe(current.record);
  });

  it("keeps an acknowledged reconciliation result detached from a successor reconciliation", () => {
    const storage = new DurableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    repository.create(pendingRecord());

    const first = repository.reconcile(
      "uncertainty-1",
      1,
      firstAttempt,
      firstClock,
    );
    const second = repository.reconcile(
      "uncertainty-1",
      2,
      secondAttempt,
      secondClock,
    );

    expect(first.version).toBe(2);
    expect(first.record.attempts).toHaveLength(1);
    expect(second.version).toBe(3);
    expect(second.record.attempts).toHaveLength(2);
    expect(first.record).not.toBe(second.record);
    expect(Object.isFrozen(first.record.attempts)).toBe(true);
    expect(Object.isFrozen(second.record.attempts)).toBe(true);
  });
});

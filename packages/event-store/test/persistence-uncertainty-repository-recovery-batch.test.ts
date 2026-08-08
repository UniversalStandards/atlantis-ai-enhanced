import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  PersistenceUncertaintyVersionConflictError,
} from "../src/persistence-uncertainty-repository.js";

class ObservableMemorySnapshotStorage implements AtomicSnapshotStorage {
  private revision = 0;
  private value: string | null = null;
  public loadCount = 0;
  public compareAndSwapCount = 0;

  public load(): AtomicSnapshot {
    this.loadCount += 1;
    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    this.compareAndSwapCount += 1;
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

function record(index: number) {
  return createPersistenceUncertaintyRecord({
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
}

const clock = {
  now: () => "2026-08-06T04:00:00.000Z",
};

describe("persistence uncertainty repository recovery batch", () => {
  it("selects from exactly one authoritative load in durable order", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    repository.create(record(1));
    repository.create(record(2));
    repository.create(record(3));
    storage.resetLoadCount();

    const selected = repository.selectRecoveryBatch({
      statuses: ["pending"],
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
    first.create(record(2));
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
    writer.create(record(3));

    const readerA = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const readerB = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    storage.resetLoadCount();
    const compareAndSwapCountBeforeSelection = storage.compareAndSwapCount;

    const selection = { statuses: ["pending"] as const, limit: 2 };
    const batchA = readerA.selectRecoveryBatch(selection);
    const batchB = readerB.selectRecoveryBatch(selection);

    expect(storage.loadCount).toBe(2);
    expect(storage.compareAndSwapCount).toBe(compareAndSwapCountBeforeSelection);
    expect(batchA).toEqual(batchB);
    expect(batchA.map((entry) => entry.record.recordId)).toEqual([
      "uncertainty-1",
      "uncertainty-2",
    ]);
  });

  it("rejects a stale recovery-batch handoff after another worker advances the record", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const writer = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    writer.create(record(1));

    const workerA = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const workerB = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const [handoff] = workerA.selectRecoveryBatch({ statuses: ["pending"], limit: 1 });
    expect(handoff).toBeDefined();
    if (handoff === undefined) {
      throw new Error("expected one recovery handoff");
    }

    const expected = handoff.record.expected;
    const advanced = workerB.reconcile(
      handoff.record.recordId,
      handoff.version,
      {
        attemptId: "attempt-worker-b",
        observedAt: "2026-08-06T03:30:00.000Z",
        evidence: { expected },
      },
      clock,
    );
    expect(advanced.version).toBe(handoff.version + 1);

    expect(() => workerA.reconcile(
      handoff.record.recordId,
      handoff.version,
      {
        attemptId: "attempt-worker-a-stale",
        observedAt: "2026-08-06T03:31:00.000Z",
        evidence: { expected },
      },
      clock,
    )).toThrowError(PersistenceUncertaintyVersionConflictError);

    const authoritative = writer.get(handoff.record.recordId);
    expect(authoritative).toEqual(advanced);
    expect(authoritative.record.attempts).toHaveLength(1);
    expect(authoritative.record.attempts[0]?.attemptId).toBe("attempt-worker-b");
  });

  it("never reissues terminal records into a recovery batch", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const pending = repository.create(record(1));
    repository.create(record(2));

    const expected = pending.record.expected;
    const resolved = repository.reconcile(
      pending.record.recordId,
      pending.version,
      {
        attemptId: "attempt-resolved",
        observedAt: "2026-08-06T03:30:00.000Z",
        evidence: {
          expected,
          observedAtExpectedPosition: {
            eventId: expected.eventId,
            executionId: expected.executionId,
            streamVersion: expected.streamVersion,
            contentDigest: expected.contentDigest,
          },
        },
      },
      clock,
    );
    expect(resolved.record.status).toBe("resolved_committed");

    const selected = repository.selectRecoveryBatch({
      statuses: ["pending", "quarantined"],
      limit: 10,
    });

    expect(selected.map((entry) => entry.record.recordId)).toEqual([
      "uncertainty-2",
    ]);
  });

  it("returns quarantined records only when quarantine recovery is explicitly requested", () => {
    const storage = new ObservableMemorySnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const candidate = repository.create(record(1));
    repository.create(record(2));

    const expected = candidate.record.expected;
    const quarantined = repository.reconcile(
      candidate.record.recordId,
      candidate.version,
      {
        attemptId: "attempt-conflict",
        observedAt: "2026-08-06T03:30:00.000Z",
        evidence: {
          expected,
          observedAtExpectedPosition: {
            eventId: "different-event",
            executionId: expected.executionId,
            streamVersion: expected.streamVersion,
            contentDigest: "sha256:different-content",
          },
        },
      },
      clock,
    );
    expect(quarantined.record.status).toBe("quarantined");

    expect(repository.selectRecoveryBatch({ statuses: ["pending"], limit: 10 })
      .map((entry) => entry.record.recordId)).toEqual(["uncertainty-2"]);
    expect(repository.selectRecoveryBatch({ statuses: ["quarantined"], limit: 10 })
      .map((entry) => entry.record.recordId)).toEqual(["uncertainty-1"]);
  });
});
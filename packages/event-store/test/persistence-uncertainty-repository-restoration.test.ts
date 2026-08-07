import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
} from "../src/persistence-uncertainty-repository.js";
import { InvalidPersistedUncertaintyRecordError } from "../src/persistence-uncertainty-restoration-validation.js";

const expected = {
  operationId: "append-operation-1",
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

class SeededAtomicSnapshotStorage implements AtomicSnapshotStorage {
  public constructor(
    private revision: number,
    private value: string | null,
  ) {}

  public load(): AtomicSnapshot {
    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    if (expectedRevision !== this.revision) {
      return false;
    }
    this.value = nextValue;
    this.revision += 1;
    return true;
  }

  public replace(nextValue: string): void {
    this.value = nextValue;
    this.revision += 1;
  }
}

class ArbitraryAtomicSnapshotStorage implements AtomicSnapshotStorage {
  public constructor(private readonly snapshot: unknown) {}

  public load(): AtomicSnapshot {
    return this.snapshot as AtomicSnapshot;
  }

  public compareAndSwap(): boolean {
    return false;
  }
}

function persistedState(record: unknown): string {
  return JSON.stringify({
    records: [{ version: 1, record }],
    proofConsumptionIndex: { entries: [] },
  });
}

function pendingRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-1",
    expected,
    providerOperationId: "provider-operation-1",
    firstObservedAt: "2026-08-06T00:00:00.000Z",
  });
}

describe("persistence uncertainty repository restoration boundary", () => {
  it("fails repository construction on an extra persisted record property", () => {
    const corrupted = {
      ...pendingRecord(),
      untrustedOverride: true,
    };
    const storage = new SeededAtomicSnapshotStorage(1, persistedState(corrupted));

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError(InvalidPersistedUncertaintyRecordError);
  });

  it("fails restart before read or reconciliation when durable decision evidence is contradictory", () => {
    const corrupted = {
      ...pendingRecord(),
      status: "resolved_committed",
      attempts: [{
        attemptNumber: 1,
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:01:00.000Z",
        reconciledAt: "2026-08-06T00:02:00.000Z",
        decision: { kind: "uncertain", blockFurtherMutation: true },
      }],
    };
    const storage = new SeededAtomicSnapshotStorage(2, persistedState(corrupted));

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError("record.status must match the final decision");
  });

  it("revalidates durable state on every read after an initially valid construction", () => {
    const valid = pendingRecord();
    const storage = new SeededAtomicSnapshotStorage(1, persistedState(valid));
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    storage.replace(persistedState({
      ...valid,
      attempts: [{
        attemptNumber: 1,
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:01:00.000Z",
        reconciledAt: "2026-08-06T00:02:00.000Z",
        decision: { kind: "retry_permitted" },
      }],
      status: "resolved_not_committed",
    }));

    expect(() => repository.get("uncertainty-1"))
      .toThrowError("retry_permitted requires a persisted proofId");
  });

  it("rejects extra outer persisted-state fields", () => {
    const storage = new SeededAtomicSnapshotStorage(1, JSON.stringify({
      records: [{ version: 1, record: pendingRecord() }],
      proofConsumptionIndex: { entries: [] },
      migrationOverride: "accept",
    }));

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError(
        "persisted uncertainty state must contain exactly: records, proofConsumptionIndex",
      );
  });

  it("rejects missing outer persisted-state fields", () => {
    const storage = new SeededAtomicSnapshotStorage(1, JSON.stringify({
      records: [{ version: 1, record: pendingRecord() }],
    }));

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError(
        "persisted uncertainty state must contain exactly: records, proofConsumptionIndex",
      );
  });

  it("rejects extra persisted entry fields before restoring the record", () => {
    const storage = new SeededAtomicSnapshotStorage(1, JSON.stringify({
      records: [{
        version: 1,
        record: pendingRecord(),
        trusted: true,
      }],
      proofConsumptionIndex: { entries: [] },
    }));

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError(
        "persisted uncertainty entry 1 must contain exactly: version, record",
      );
  });

  it("rejects non-array persisted records before entry restoration", () => {
    const storage = new ArbitraryAtomicSnapshotStorage({
      revision: 1,
      value: JSON.stringify({
        records: { 0: { version: 1, record: pendingRecord() }, length: 1 },
        proofConsumptionIndex: { entries: [] },
      }),
    });

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError("persisted uncertainty state.records must be a standard array");
  });

  it("rejects extra atomic snapshot fields before parsing persisted state", () => {
    const storage = new ArbitraryAtomicSnapshotStorage({
      revision: 1,
      value: persistedState(pendingRecord()),
      trustedOverride: true,
    });

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError("atomic snapshot must contain exactly: revision, value");
  });

  it("rejects accessor-backed atomic snapshot fields without invoking them", () => {
    let revisionRead = false;
    const snapshot = {
      get revision() {
        revisionRead = true;
        return 1;
      },
      value: persistedState(pendingRecord()),
    };
    const storage = new ArbitraryAtomicSnapshotStorage(snapshot);

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError("atomic snapshot.revision must be an enumerable data property");
    expect(revisionRead).toBe(false);
  });

  it("rejects invalid atomic snapshot revisions before parsing persisted state", () => {
    for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const storage = new ArbitraryAtomicSnapshotStorage({
        revision,
        value: persistedState(pendingRecord()),
      });

      expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
        .toThrowError("storage revision must be a non-negative safe integer");
    }
  });

  it("rejects malformed persisted JSON before restoration", () => {
    const storage = new ArbitraryAtomicSnapshotStorage({
      revision: 1,
      value: '{"records":',
    });

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError("persisted uncertainty state must be valid JSON");
  });

  it("rejects non-string atomic snapshot values before JSON restoration", () => {
    const storage = new ArbitraryAtomicSnapshotStorage({
      revision: 1,
      value: { records: [] },
    });

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage))
      .toThrowError("storage value must be a string or null");
  });
});

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
});

import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
  type PersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  InvalidPersistenceUncertaintyRecoverySelectionError,
} from "../src/persistence-uncertainty-recovery-selection.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  InvalidPersistedUncertaintyStateError,
} from "../src/persistence-uncertainty-repository.js";
import {
  InvalidPersistedUncertaintyRecordError,
} from "../src/persistence-uncertainty-restoration-validation.js";

class CountingStorage implements AtomicSnapshotStorage {
  public loadCalls = 0;
  public compareAndSwapCalls = 0;

  public load(): AtomicSnapshot {
    this.loadCalls += 1;
    return Object.freeze({ revision: 0, value: null });
  }

  public compareAndSwap(): boolean {
    this.compareAndSwapCalls += 1;
    return false;
  }
}

const clock = {
  now() {
    throw new Error("clock must not be sampled");
  },
};

const expected = {
  operationId: "append-operation-1",
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

const reconciliationInput = {
  attemptId: "attempt-input-validation",
  observedAt: "2026-08-07T00:00:00.000Z",
  evidence: {
    expected,
  },
} as const;

function pendingRecord(): PersistenceUncertaintyRecord {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-1",
    expected,
    providerOperationId: "provider-operation-1",
    firstObservedAt: "2026-08-07T00:00:00.000Z",
  });
}

describe("persistence uncertainty repository input validation", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid maxPersistenceAttempts %s before reading durable state",
    (maxPersistenceAttempts) => {
      const storage = new CountingStorage();

      expect(() => new DurableSnapshotPersistenceUncertaintyRepository(
        storage,
        maxPersistenceAttempts,
      )).toThrowError(
        new InvalidPersistedUncertaintyStateError(
          "maxPersistenceAttempts must be a positive safe integer.",
        ),
      );

      expect(storage.loadCalls).toBe(0);
      expect(storage.compareAndSwapCalls).toBe(0);
    },
  );

  it("rejects malformed create records before reloading or mutating durable state", () => {
    const storage = new CountingStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    expect(storage.loadCalls).toBe(1);

    const malformedRecord = {
      ...pendingRecord(),
      recordId: "   ",
    } as PersistenceUncertaintyRecord;

    expect(() => repository.create(malformedRecord)).toThrowError(
      new InvalidPersistedUncertaintyRecordError(
        "record.recordId must be a non-empty string.",
      ),
    );

    expect(storage.loadCalls).toBe(1);
    expect(storage.compareAndSwapCalls).toBe(0);
  });

  it("rejects blank get record identities before reloading durable state", () => {
    const storage = new CountingStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    expect(storage.loadCalls).toBe(1);

    expect(() => repository.get("   ")).toThrowError(
      new InvalidPersistedUncertaintyStateError("recordId must be non-empty."),
    );

    expect(storage.loadCalls).toBe(1);
    expect(storage.compareAndSwapCalls).toBe(0);
  });

  it("rejects invalid recovery selections before reloading durable state", () => {
    const storage = new CountingStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    expect(storage.loadCalls).toBe(1);

    expect(() => repository.selectRecoveryBatch({
      statuses: ["pending"],
      limit: 0,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);

    expect(storage.loadCalls).toBe(1);
    expect(storage.compareAndSwapCalls).toBe(0);
  });

  it("rejects blank reconcile record identities before durable reads or clock sampling", () => {
    const storage = new CountingStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    expect(storage.loadCalls).toBe(1);

    expect(() => repository.reconcile(
      "   ",
      1,
      reconciliationInput,
      clock,
    )).toThrowError(
      new InvalidPersistedUncertaintyStateError("recordId must be non-empty."),
    );

    expect(storage.loadCalls).toBe(1);
    expect(storage.compareAndSwapCalls).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid reconcile expectedVersion %s before durable reads or clock sampling",
    (expectedVersion) => {
      const storage = new CountingStorage();
      const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
      expect(storage.loadCalls).toBe(1);

      expect(() => repository.reconcile(
        "uncertainty-1",
        expectedVersion,
        reconciliationInput,
        clock,
      )).toThrowError(
        new InvalidPersistedUncertaintyStateError(
          "expectedVersion must be a positive safe integer.",
        ),
      );

      expect(storage.loadCalls).toBe(1);
      expect(storage.compareAndSwapCalls).toBe(0);
    },
  );
});

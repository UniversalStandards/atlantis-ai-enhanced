import { describe, expect, it } from "vitest";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  InvalidPersistedUncertaintyStateError,
} from "../src/persistence-uncertainty-repository.js";

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

const reconciliationInput = {
  attemptId: "attempt-input-validation",
  observedAt: "2026-08-07T00:00:00.000Z",
  evidence: {
    expected: {
      operationId: "append-operation-1",
      eventId: "event-1",
      executionId: "execution-1",
      streamVersion: 4,
      contentDigest: "sha256:expected",
    },
  },
} as const;

describe("persistence uncertainty repository input validation", () => {
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

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
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

import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
  type PersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import { DurableSnapshotPersistenceUncertaintyRepository } from "../src/persistence-uncertainty-repository.js";
import { InvalidPersistedUncertaintyRecordError } from "../src/persistence-uncertainty-restoration-validation.js";

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

function pendingRecord(): PersistenceUncertaintyRecord {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-create-descriptor-1",
    expected: {
      operationId: "append-operation-1",
      eventId: "event-1",
      executionId: "execution-1",
      streamVersion: 4,
      contentDigest: "sha256:expected",
    },
    providerOperationId: "provider-operation-1",
    firstObservedAt: "2026-08-07T00:00:00.000Z",
  });
}

describe("persistence uncertainty repository create descriptor hardening", () => {
  it("rejects an accessor-backed create record without invoking the getter or touching durable state", () => {
    const storage = new CountingStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    expect(storage.loadCalls).toBe(1);

    let getterCalls = 0;
    const malformed = { ...pendingRecord() } as Record<string, unknown>;
    Object.defineProperty(malformed, "recordId", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("recordId getter must not execute");
      },
    });

    expect(() => repository.create(malformed as unknown as PersistenceUncertaintyRecord)).toThrowError(
      new InvalidPersistedUncertaintyRecordError(
        "record.recordId must be an enumerable data property.",
      ),
    );

    expect(getterCalls).toBe(0);
    expect(storage.loadCalls).toBe(1);
    expect(storage.compareAndSwapCalls).toBe(0);
  });

  it("rejects a symbol-bearing create record before another durable read or mutation", () => {
    const storage = new CountingStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    expect(storage.loadCalls).toBe(1);

    const malformed = { ...pendingRecord() } as Record<PropertyKey, unknown>;
    malformed[Symbol("unexpected")] = "unexpected";

    expect(() => repository.create(malformed as unknown as PersistenceUncertaintyRecord)).toThrowError(
      new InvalidPersistedUncertaintyRecordError(
        "record contains an unexpected property.",
      ),
    );

    expect(storage.loadCalls).toBe(1);
    expect(storage.compareAndSwapCalls).toBe(0);
  });
});

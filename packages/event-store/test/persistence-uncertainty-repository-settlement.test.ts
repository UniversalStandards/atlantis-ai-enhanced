import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  InvalidPersistedUncertaintyStateError,
  PersistenceUncertaintyRepositoryConflictError,
} from "../src/persistence-uncertainty-repository.js";

const expected = {
  operationId: "append-operation-1",
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

function pendingRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-1",
    expected,
    providerOperationId: "provider-operation-1",
    firstObservedAt: "2026-08-06T00:00:00.000Z",
  });
}

class ArbitrarySettlementStorage implements AtomicSnapshotStorage {
  public calls = 0;

  public constructor(private readonly settlement: unknown) {}

  public load(): AtomicSnapshot {
    return Object.freeze({ revision: 0, value: null });
  }

  public compareAndSwap(): boolean {
    this.calls += 1;
    return this.settlement as boolean;
  }
}

class ThrowingSettlementStorage implements AtomicSnapshotStorage {
  public calls = 0;

  public constructor(private readonly failure: Error) {}

  public load(): AtomicSnapshot {
    return Object.freeze({ revision: 0, value: null });
  }

  public compareAndSwap(): boolean {
    this.calls += 1;
    throw this.failure;
  }
}

describe("persistence uncertainty repository settlement boundary", () => {
  it.each([
    ["object", { committed: true }],
    ["boxed boolean", new Boolean(true)],
    ["thenable", Promise.resolve(true)],
  ])("rejects a truthy non-boolean %s result", (_label, settlement) => {
    const storage = new ArbitrarySettlementStorage(settlement);
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    expect(() => repository.create(pendingRecord()))
      .toThrowError(new InvalidPersistedUncertaintyStateError(
        "storage compareAndSwap result must be a synchronous boolean.",
      ));
    expect(storage.calls).toBe(1);
  });

  it("rejects accessor-bearing settlements without invoking their accessors", () => {
    let accessorCalls = 0;
    const settlement = Object.defineProperty({}, "then", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        throw new Error("settlement accessor must not execute");
      },
    });
    const storage = new ArbitrarySettlementStorage(settlement);
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    expect(() => repository.create(pendingRecord()))
      .toThrowError(new InvalidPersistedUncertaintyStateError(
        "storage compareAndSwap result must be a synchronous boolean.",
      ));
    expect(storage.calls).toBe(1);
    expect(accessorCalls).toBe(0);
  });

  it("propagates storage exceptions without converting them into retries", () => {
    const failure = new Error("durable storage unavailable");
    const storage = new ThrowingSettlementStorage(failure);
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    expect(() => repository.create(pendingRecord())).toThrow(failure);
    expect(storage.calls).toBe(1);
  });

  it("uses literal false only as a bounded optimistic-concurrency retry signal", () => {
    const storage = new ArbitrarySettlementStorage(false);
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage, 3);

    expect(() => repository.create(pendingRecord()))
      .toThrowError(new PersistenceUncertaintyRepositoryConflictError(3));
    expect(storage.calls).toBe(3);
  });

  it("accepts literal true as the only successful settlement", () => {
    const storage = new ArbitrarySettlementStorage(true);
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    const created = repository.create(pendingRecord());

    expect(created.version).toBe(1);
    expect(created.record.recordId).toBe("uncertainty-1");
    expect(storage.calls).toBe(1);
  });
});

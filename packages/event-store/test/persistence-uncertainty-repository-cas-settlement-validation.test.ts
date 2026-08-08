import { describe, expect, it } from "vitest";

import { createPersistenceUncertaintyRecord } from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  InvalidPersistedUncertaintyStateError,
} from "../src/persistence-uncertainty-repository.js";

class NonBooleanSettlementStorage implements AtomicSnapshotStorage {
  public loadCalls = 0;
  public compareAndSwapCalls = 0;

  public constructor(private readonly settlement: unknown) {}

  public load(): AtomicSnapshot {
    this.loadCalls += 1;
    return Object.freeze({ revision: 0, value: null });
  }

  public compareAndSwap(): boolean {
    this.compareAndSwapCalls += 1;
    return this.settlement as boolean;
  }
}

function pendingRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-cas-settlement",
    expected: {
      operationId: "append-operation-cas-settlement",
      eventId: "event-cas-settlement",
      executionId: "execution-cas-settlement",
      streamVersion: 1,
      contentDigest: "sha256:cas-settlement",
    },
    providerOperationId: "provider-operation-cas-settlement",
    firstObservedAt: "2026-08-08T00:00:00.000Z",
  });
}

describe("persistence uncertainty repository CAS settlement validation", () => {
  it.each([
    ["truthy string", "true"],
    ["falsy number", 0],
    ["null", null],
    ["undefined", undefined],
    ["plain object", Object.freeze({})],
    ["array", Object.freeze([])],
    ["function", () => true],
    ["bigint", 1n],
    ["symbol", Symbol("true")],
  ])("rejects non-boolean CAS settlement (%s) before acknowledgement", (_label, settlement) => {
    const storage = new NonBooleanSettlementStorage(settlement);
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    expect(() => repository.create(pendingRecord())).toThrowError(
      new InvalidPersistedUncertaintyStateError(
        "storage compareAndSwap result must be a synchronous boolean.",
      ),
    );

    // One constructor read plus one mutation-attempt read. An invalid settlement
    // must fail before the post-commit acknowledgement read can occur.
    expect(storage.loadCalls).toBe(2);
    expect(storage.compareAndSwapCalls).toBe(1);
  });
});

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

  public load(): AtomicSnapshot {
    this.loadCalls += 1;
    return Object.freeze({ revision: 0, value: null });
  }

  public compareAndSwap(): boolean {
    this.compareAndSwapCalls += 1;
    return "true" as unknown as boolean;
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
  it("rejects truthy non-boolean CAS settlement instead of acknowledging a commit", () => {
    const storage = new NonBooleanSettlementStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    expect(() => repository.create(pendingRecord())).toThrowError(
      new InvalidPersistedUncertaintyStateError(
        "storage compareAndSwap result must be a synchronous boolean.",
      ),
    );

    expect(storage.loadCalls).toBe(2);
    expect(storage.compareAndSwapCalls).toBe(1);
  });
});

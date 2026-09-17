import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
} from "../src/persistence-uncertainty-repository.js";

class MemorySnapshotStorage implements AtomicSnapshotStorage {
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

function recoveryRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-reader-isolation",
    expected: {
      operationId: "operation-reader-isolation",
      eventId: "event-reader-isolation",
      executionId: "execution-reader-isolation",
      streamVersion: 1,
      contentDigest: "sha256:reader-isolation",
    },
    providerOperationId: "provider-operation-reader-isolation",
    firstObservedAt: "2026-08-08T16:40:00.000Z",
  });
}

describe("persistence uncertainty recovery handoff reader isolation", () => {
  it("returns structurally equal but independently restored frozen handoffs to separate readers", () => {
    const storage = new MemorySnapshotStorage();
    const seed = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    seed.create(recoveryRecord());

    const workerA = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const workerB = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    const [handoffA] = workerA.selectRecoveryBatch({ statuses: ["pending"], limit: 1 });
    const [handoffB] = workerB.selectRecoveryBatch({ statuses: ["pending"], limit: 1 });

    expect(handoffA).toBeDefined();
    expect(handoffB).toBeDefined();
    if (handoffA === undefined || handoffB === undefined) {
      throw new Error("expected both readers to receive a recovery handoff");
    }

    expect(handoffA).toEqual(handoffB);
    expect(handoffA).not.toBe(handoffB);
    expect(handoffA.record).toEqual(handoffB.record);
    expect(handoffA.record).not.toBe(handoffB.record);
    expect(handoffA.record.expected).toEqual(handoffB.record.expected);
    expect(handoffA.record.expected).not.toBe(handoffB.record.expected);
    expect(handoffA.record.attempts).toEqual(handoffB.record.attempts);
    expect(handoffA.record.attempts).not.toBe(handoffB.record.attempts);

    expect(Object.isFrozen(handoffA)).toBe(true);
    expect(Object.isFrozen(handoffB)).toBe(true);
    expect(Object.isFrozen(handoffA.record)).toBe(true);
    expect(Object.isFrozen(handoffB.record)).toBe(true);
    expect(Object.isFrozen(handoffA.record.expected)).toBe(true);
    expect(Object.isFrozen(handoffB.record.expected)).toBe(true);
    expect(Object.isFrozen(handoffA.record.attempts)).toBe(true);
    expect(Object.isFrozen(handoffB.record.attempts)).toBe(true);
  });
});

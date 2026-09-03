import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import { DurableSnapshotPersistenceUncertaintyRepository } from "../src/persistence-uncertainty-repository.js";

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

function createRecord(recordId: string) {
  return createPersistenceUncertaintyRecord({
    recordId,
    expected: {
      operationId: `operation-${recordId}`,
      eventId: `event-${recordId}`,
      executionId: `execution-${recordId}`,
      streamVersion: 1,
      contentDigest: `sha256:${recordId}`,
    },
    providerOperationId: `provider-operation-${recordId}`,
    firstObservedAt: "2026-08-08T12:00:00.000Z",
  });
}

describe("persistence uncertainty recovery handoff integrity", () => {
  it("returns an immutable recovery handoff graph", () => {
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(
      new MemorySnapshotStorage(),
    );

    repository.create(createRecord("uncertainty-immutable-handoff"));

    const selected = repository.selectRecoveryBatch({
      statuses: ["pending"],
      limit: 1,
    });
    const [handoff] = selected;

    expect(handoff).toBeDefined();
    if (handoff === undefined) {
      throw new Error("expected one recovery handoff");
    }

    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(Object.isFrozen(handoff.record)).toBe(true);
    expect(Object.isFrozen(handoff.record.expected)).toBe(true);
    expect(Object.isFrozen(handoff.record.attempts)).toBe(true);
  });

  it("keeps a selected recovery handoff stable after the durable record advances", () => {
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(
      new MemorySnapshotStorage(),
    );
    const record = createRecord("uncertainty-stable-handoff");
    repository.create(record);

    const selected = repository.selectRecoveryBatch({
      statuses: ["pending"],
      limit: 1,
    });
    const [handoff] = selected;
    expect(handoff).toBeDefined();
    if (handoff === undefined) {
      throw new Error("expected one recovery handoff");
    }

    const advanced = repository.reconcile(
      handoff.record.recordId,
      handoff.version,
      {
        attemptId: "attempt-after-handoff",
        observedAt: "2026-08-08T12:01:00.000Z",
        evidence: { expected: record.expected },
      },
      { now: () => "2026-08-08T12:02:00.000Z" },
    );

    expect(advanced.version).toBe(2);
    expect(advanced.record.attempts).toHaveLength(1);
    expect(advanced.record).not.toBe(handoff.record);

    expect(handoff.version).toBe(1);
    expect(handoff.record.status).toBe("pending");
    expect(handoff.record.attempts).toHaveLength(0);
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(Object.isFrozen(handoff.record)).toBe(true);
    expect(Object.isFrozen(handoff.record.attempts)).toBe(true);
  });
});

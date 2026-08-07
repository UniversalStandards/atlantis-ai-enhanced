import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  PersistenceUncertaintyVersionConflictError,
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

const clock = {
  now: () => "2026-08-07T06:00:00.000Z",
};

function recoveryRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-competing-workers",
    expected: {
      operationId: "operation-competing-workers",
      eventId: "event-competing-workers",
      executionId: "execution-competing-workers",
      streamVersion: 1,
      contentDigest: "sha256:competing-workers",
    },
    providerOperationId: "provider-operation-competing-workers",
    firstObservedAt: "2026-08-07T05:59:00.000Z",
  });
}

describe("persistence uncertainty competing recovery workers", () => {
  it("proves version fencing after selection cannot prevent duplicate pre-reconcile work", () => {
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
      throw new Error("expected both workers to receive the same recovery candidate");
    }

    expect(handoffA).toEqual(handoffB);

    const externalRecoveryAttempts: string[] = [];
    externalRecoveryAttempts.push(handoffA.record.providerOperationId);
    externalRecoveryAttempts.push(handoffB.record.providerOperationId);

    const expected = handoffA.record.expected;
    const winner = workerA.reconcile(
      handoffA.record.recordId,
      handoffA.version,
      {
        attemptId: "attempt-worker-a",
        observedAt: "2026-08-07T06:00:01.000Z",
        evidence: { expected },
      },
      clock,
    );

    expect(() => workerB.reconcile(
      handoffB.record.recordId,
      handoffB.version,
      {
        attemptId: "attempt-worker-b",
        observedAt: "2026-08-07T06:00:02.000Z",
        evidence: { expected },
      },
      clock,
    )).toThrowError(PersistenceUncertaintyVersionConflictError);

    expect(externalRecoveryAttempts).toEqual([
      "provider-operation-competing-workers",
      "provider-operation-competing-workers",
    ]);

    const authoritative = seed.get(handoffA.record.recordId);
    expect(authoritative).toEqual(winner);
    expect(authoritative.record.attempts).toHaveLength(1);
    expect(authoritative.record.attempts[0]?.attemptId).toBe("attempt-worker-a");
  });
});

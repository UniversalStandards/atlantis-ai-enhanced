import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
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

class RecordingAtomicSnapshotStorage implements AtomicSnapshotStorage {
  public readonly candidates: string[] = [];
  private revision = 0;
  private value: string | null = null;

  public load(): AtomicSnapshot {
    return Object.freeze({ revision: this.revision, value: this.value });
  }

  public compareAndSwap(expectedRevision: number, value: string): boolean {
    this.candidates.push(value);
    if (expectedRevision !== this.revision) {
      return false;
    }
    this.value = value;
    this.revision += 1;
    return true;
  }
}

describe("persistence uncertainty repository canonical candidates", () => {
  it("hands canonical, exactly restorable create and reconcile states to storage", () => {
    const storage = new RecordingAtomicSnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);

    repository.create(pendingRecord());
    repository.reconcile(
      "uncertainty-1",
      1,
      {
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:01:00.000Z",
        evidence: { expected },
      },
      { now: () => "2026-08-06T00:02:00.000Z" },
    );

    expect(storage.candidates).toHaveLength(2);
    for (const candidate of storage.candidates) {
      expect(JSON.stringify(JSON.parse(candidate))).toBe(candidate);
    }

    const restarted = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    expect(restarted.get("uncertainty-1").version).toBe(2);
  });
});

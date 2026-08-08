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

describe("persistence uncertainty recovery handoff integrity", () => {
  it("returns an immutable recovery handoff graph", () => {
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(
      new MemorySnapshotStorage(),
    );

    repository.create(createPersistenceUncertaintyRecord({
      recordId: "uncertainty-immutable-handoff",
      expected: {
        operationId: "operation-immutable-handoff",
        eventId: "event-immutable-handoff",
        executionId: "execution-immutable-handoff",
        streamVersion: 1,
        contentDigest: "sha256:immutable-handoff",
      },
      providerOperationId: "provider-operation-immutable-handoff",
      firstObservedAt: "2026-08-08T12:00:00.000Z",
    }));

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
});

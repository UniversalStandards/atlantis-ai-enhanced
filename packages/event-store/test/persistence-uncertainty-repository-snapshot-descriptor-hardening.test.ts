import { describe, expect, it } from "vitest";

import type { AtomicSnapshot, AtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  InvalidPersistedUncertaintyStateError,
} from "../src/persistence-uncertainty-repository.js";

class SingleSnapshotStorage implements AtomicSnapshotStorage {
  public loadCalls = 0;

  public constructor(private readonly snapshot: AtomicSnapshot) {}

  public load(): AtomicSnapshot {
    this.loadCalls += 1;
    return this.snapshot;
  }

  public compareAndSwap(): boolean {
    throw new Error("compareAndSwap must not be called during construction");
  }
}

function accessorSnapshot(field: "revision" | "value", onAccess: () => void): AtomicSnapshot {
  const snapshot = field === "revision"
    ? ({ value: null } as Record<string, unknown>)
    : ({ revision: 0 } as Record<string, unknown>);

  Object.defineProperty(snapshot, field, {
    enumerable: true,
    get: () => {
      onAccess();
      return field === "revision" ? 0 : null;
    },
  });

  return snapshot as unknown as AtomicSnapshot;
}

describe("persistence uncertainty repository atomic snapshot descriptor hardening", () => {
  it.each(["revision", "value"] as const)(
    "rejects accessor-backed %s without invoking the accessor",
    (field) => {
      let accessorCalls = 0;
      const storage = new SingleSnapshotStorage(
        accessorSnapshot(field, () => {
          accessorCalls += 1;
        }),
      );

      expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage)).toThrowError(
        new InvalidPersistedUncertaintyStateError(
          `atomic snapshot.${field} must be an enumerable data property.`,
        ),
      );

      expect(accessorCalls).toBe(0);
      expect(storage.loadCalls).toBe(1);
    },
  );

  it("rejects a non-enumerable snapshot field before consuming it", () => {
    const snapshot = { value: null } as Record<string, unknown>;
    Object.defineProperty(snapshot, "revision", {
      enumerable: false,
      value: 0,
    });
    const storage = new SingleSnapshotStorage(snapshot as unknown as AtomicSnapshot);

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage)).toThrowError(
      new InvalidPersistedUncertaintyStateError(
        "atomic snapshot.revision must be an enumerable data property.",
      ),
    );
    expect(storage.loadCalls).toBe(1);
  });

  it("rejects symbol-bearing snapshots before consuming their fields", () => {
    const marker = Symbol("unexpected-snapshot-field");
    const snapshot = {
      revision: 0,
      value: null,
      [marker]: "unexpected",
    } as unknown as AtomicSnapshot;
    const storage = new SingleSnapshotStorage(snapshot);

    expect(() => new DurableSnapshotPersistenceUncertaintyRepository(storage)).toThrowError(
      new InvalidPersistedUncertaintyStateError(
        "atomic snapshot must contain exactly: revision, value.",
      ),
    );
    expect(storage.loadCalls).toBe(1);
  });
});

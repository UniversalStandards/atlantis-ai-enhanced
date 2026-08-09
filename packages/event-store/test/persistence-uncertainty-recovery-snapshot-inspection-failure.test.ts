import { describe, expect, it } from "vitest";

import {
  InvalidPersistenceUncertaintyRecoverySnapshotInspectionError,
  selectPersistenceUncertaintyRecoveryBatch,
} from "../src/persistence-uncertainty-recovery-selection.js";
import type { PersistenceUncertaintySnapshot } from "../src/persistence-uncertainty-repository.js";

describe("persistence uncertainty recovery snapshot inspection failures", () => {
  it("normalizes hostile authoritative snapshot iteration into the domain error", () => {
    const snapshots = new Proxy([] as PersistenceUncertaintySnapshot[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("authoritative snapshot iterator trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() => selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending"],
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySnapshotInspectionError);
    expect(() => selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending"],
      limit: 1,
    })).toThrow("authoritative recovery snapshots could not be inspected safely.");
  });

  it("normalizes revoked authoritative snapshot iteration into the domain error", () => {
    const { proxy: snapshots, revoke } = Proxy.revocable(
      [] as PersistenceUncertaintySnapshot[],
      {},
    );
    revoke();

    expect(() => selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending"],
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySnapshotInspectionError);
    expect(() => selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending"],
      limit: 1,
    })).toThrow("authoritative recovery snapshots could not be inspected safely.");
  });

  it("normalizes hostile authoritative snapshot field inspection into the domain error", () => {
    const snapshot = new Proxy({} as PersistenceUncertaintySnapshot, {
      get() {
        throw new Error("authoritative snapshot field trap");
      },
    });

    expect(() => selectPersistenceUncertaintyRecoveryBatch([snapshot], {
      statuses: ["pending"],
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySnapshotInspectionError);
    expect(() => selectPersistenceUncertaintyRecoveryBatch([snapshot], {
      statuses: ["pending"],
      limit: 1,
    })).toThrow("authoritative recovery snapshots could not be inspected safely.");
  });
});

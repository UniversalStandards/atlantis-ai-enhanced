import { describe, expect, it } from "vitest";

import {
  InvalidPersistenceUncertaintyRecoverySnapshotInspectionError,
  selectPersistenceUncertaintyRecoveryBatch,
} from "../src/persistence-uncertainty-recovery-selection.js";
import type { PersistenceUncertaintySnapshot } from "../src/persistence-uncertainty-repository.js";

describe("persistence uncertainty recovery snapshot inspection failures", () => {
  it("rejects hostile authoritative snapshot iterators without executing them", () => {
    let iteratorReads = 0;
    const snapshots = Object.defineProperty(
      [] as PersistenceUncertaintySnapshot[],
      Symbol.iterator,
      {
        configurable: true,
        get() {
          iteratorReads += 1;
          return Array.prototype[Symbol.iterator];
        },
      },
    );

    expect(selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending"],
      limit: 1,
    })).toEqual([]);
    expect(iteratorReads).toBe(0);
  });

  it("normalizes revoked authoritative snapshot inspection into the domain error", () => {
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

  it("rejects authoritative snapshot index accessors without executing them", () => {
    let indexAccessorReads = 0;
    const snapshots = [] as PersistenceUncertaintySnapshot[];
    Object.defineProperty(snapshots, "0", {
      configurable: true,
      enumerable: true,
      get() {
        indexAccessorReads += 1;
        return {
          version: 1,
          record: { status: "pending" },
        } as PersistenceUncertaintySnapshot;
      },
    });

    expect(() => selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending"],
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySnapshotInspectionError);
    expect(indexAccessorReads).toBe(0);
  });

  it("normalizes hostile authoritative snapshot field inspection into the domain error", () => {
    const snapshot = new Proxy({} as PersistenceUncertaintySnapshot, {
      getOwnPropertyDescriptor() {
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

  it("rejects snapshot record accessors without executing them", () => {
    let recordAccessorReads = 0;
    const snapshot = Object.defineProperty(
      { version: 1 } as PersistenceUncertaintySnapshot,
      "record",
      {
        enumerable: true,
        get() {
          recordAccessorReads += 1;
          return { status: "pending" };
        },
      },
    );

    expect(() => selectPersistenceUncertaintyRecoveryBatch([snapshot], {
      statuses: ["pending"],
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySnapshotInspectionError);
    expect(recordAccessorReads).toBe(0);
  });

  it("rejects record status accessors without executing them", () => {
    let statusAccessorReads = 0;
    const record = Object.defineProperty({}, "status", {
      enumerable: true,
      get() {
        statusAccessorReads += 1;
        return "pending";
      },
    });
    const snapshot = {
      version: 1,
      record,
    } as unknown as PersistenceUncertaintySnapshot;

    expect(() => selectPersistenceUncertaintyRecoveryBatch([snapshot], {
      statuses: ["pending"],
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySnapshotInspectionError);
    expect(statusAccessorReads).toBe(0);
  });
});

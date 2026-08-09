import { describe, expect, it } from "vitest";

import type { PersistenceUncertaintyStatus } from "@atlantis/contracts/persistence-uncertainty";

import {
  InvalidPersistenceUncertaintyRecoverySelectionError,
  selectPersistenceUncertaintyRecoveryBatch,
} from "../src/persistence-uncertainty-recovery-selection.js";
import type { PersistenceUncertaintySnapshot } from "../src/persistence-uncertainty-repository.js";

describe("persistence uncertainty recovery selection limit validation ordering", () => {
  it("rejects an invalid limit before inspecting the statuses array", () => {
    let statusesInspections = 0;
    const statuses = new Proxy(["pending"] as PersistenceUncertaintyStatus[], {
      getPrototypeOf: () => {
        statusesInspections += 1;
        throw new Error("statuses must not be inspected after invalid limit");
      },
      ownKeys: () => {
        statusesInspections += 1;
        throw new Error("statuses must not be enumerated after invalid limit");
      },
      getOwnPropertyDescriptor: () => {
        statusesInspections += 1;
        throw new Error("statuses descriptors must not be inspected after invalid limit");
      },
    });

    expect(() => selectPersistenceUncertaintyRecoveryBatch([], {
      statuses,
      limit: 0,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
    expect(() => selectPersistenceUncertaintyRecoveryBatch([], {
      statuses,
      limit: 0,
    })).toThrow("recovery selection limit must be a positive safe integer.");
    expect(statusesInspections).toBe(0);
  });

  it("rejects an invalid limit before inspecting authoritative snapshots", () => {
    let snapshotInspections = 0;
    const snapshots = new Proxy([] as PersistenceUncertaintySnapshot[], {
      getPrototypeOf: () => {
        snapshotInspections += 1;
        throw new Error("snapshots must not be inspected after invalid limit");
      },
      getOwnPropertyDescriptor: () => {
        snapshotInspections += 1;
        throw new Error("snapshot descriptors must not be inspected after invalid limit");
      },
    });

    expect(() => selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending"],
      limit: 0,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
    expect(() => selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending"],
      limit: 0,
    })).toThrow("recovery selection limit must be a positive safe integer.");
    expect(snapshotInspections).toBe(0);
  });
});

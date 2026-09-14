import type { PersistenceUncertaintyStatus } from "@atlantis/contracts/persistence-uncertainty";
import { describe, expect, it } from "vitest";

import {
  InvalidPersistenceUncertaintyRecoverySelectionError,
  selectPersistenceUncertaintyRecoveryBatch,
} from "../src/persistence-uncertainty-recovery-selection.js";
import type { PersistenceUncertaintySnapshot } from "../src/persistence-uncertainty-repository.js";

describe("persistence uncertainty recovery selection validation containment", () => {
  it("rejects invalid statuses before inspecting authoritative snapshots", () => {
    let snapshotInspections = 0;
    const snapshots = new Proxy([] as PersistenceUncertaintySnapshot[], {
      get() {
        snapshotInspections += 1;
        throw new Error("authoritative snapshots must not be inspected");
      },
    });

    expect(() =>
      selectPersistenceUncertaintyRecoveryBatch(snapshots, {
        statuses: ["committed" as PersistenceUncertaintyStatus],
        limit: 1,
      }),
    ).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);

    expect(snapshotInspections).toBe(0);
  });

  it("rejects duplicate statuses before inspecting authoritative snapshots", () => {
    let snapshotInspections = 0;
    const snapshots = new Proxy([] as PersistenceUncertaintySnapshot[], {
      get() {
        snapshotInspections += 1;
        throw new Error("authoritative snapshots must not be inspected");
      },
    });

    expect(() =>
      selectPersistenceUncertaintyRecoveryBatch(snapshots, {
        statuses: ["pending", "pending"],
        limit: 1,
      }),
    ).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);

    expect(() =>
      selectPersistenceUncertaintyRecoveryBatch(snapshots, {
        statuses: ["pending", "pending"],
        limit: 1,
      }),
    ).toThrow("status pending must not be duplicated.");

    expect(snapshotInspections).toBe(0);
  });
});

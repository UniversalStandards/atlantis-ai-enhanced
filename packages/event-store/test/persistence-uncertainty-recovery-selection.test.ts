import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
  type PersistenceUncertaintyRecord,
  type PersistenceUncertaintyStatus,
} from "@atlantis/contracts/persistence-uncertainty";

import {
  InvalidPersistenceUncertaintyRecoverySelectionError,
  selectPersistenceUncertaintyRecoveryBatch,
  type PersistenceUncertaintyRecoverySelection,
} from "../src/persistence-uncertainty-recovery-selection.js";
import type {
  PersistenceUncertaintySnapshot,
} from "../src/persistence-uncertainty-repository.js";

function snapshot(
  index: number,
  status: PersistenceUncertaintyStatus = "pending",
): PersistenceUncertaintySnapshot {
  const pending = createPersistenceUncertaintyRecord({
    recordId: `uncertainty-${index}`,
    expected: {
      operationId: `operation-${index}`,
      eventId: `event-${index}`,
      executionId: `execution-${index}`,
      streamVersion: index,
      contentDigest: `sha256:digest-${index}`,
    },
    providerOperationId: `provider-operation-${index}`,
    firstObservedAt: `2026-08-06T0${index}:00:00.000Z`,
  });

  const record = Object.freeze({
    ...pending,
    status,
  }) as PersistenceUncertaintyRecord;

  return Object.freeze({ version: index, record });
}

describe("persistence uncertainty recovery selection", () => {
  it("selects a bounded batch in authoritative durable order", () => {
    const snapshots = Object.freeze([
      snapshot(1),
      snapshot(2, "resolved_committed"),
      snapshot(3),
      snapshot(4, "quarantined"),
    ]);

    const selected = selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending", "quarantined"],
      limit: 2,
    });

    expect(selected.map((entry) => entry.record.recordId)).toEqual([
      "uncertainty-1",
      "uncertainty-3",
    ]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(selected[0]).toBe(snapshots[0]);
    expect(selected[1]).toBe(snapshots[2]);
    expect(snapshots).toHaveLength(4);
  });

  it("supports quarantine-only diagnostic recovery without selecting terminal records", () => {
    const selected = selectPersistenceUncertaintyRecoveryBatch(
      [
        snapshot(1, "resolved_not_committed"),
        snapshot(2, "quarantined"),
        snapshot(3, "resolved_committed"),
        snapshot(4, "quarantined"),
      ],
      { statuses: ["quarantined"], limit: 10 },
    );

    expect(selected.map((entry) => entry.record.recordId)).toEqual([
      "uncertainty-2",
      "uncertainty-4",
    ]);
  });

  it.each([
    { statuses: [], limit: 1 },
    { statuses: ["pending"], limit: 0 },
    { statuses: ["pending"], limit: -1 },
    { statuses: ["pending"], limit: 1.5 },
    { statuses: ["pending"], limit: Number.NaN },
    { statuses: ["pending"], limit: Number.POSITIVE_INFINITY },
    { statuses: ["pending"], limit: Number.MAX_SAFE_INTEGER + 1 },
    { statuses: ["pending", "pending"], limit: 1 },
    { statuses: ["resolved_committed"], limit: 1 },
  ])("fails closed for invalid selection %#", (selection) => {
    expect(() => selectPersistenceUncertaintyRecoveryBatch(
      [],
      selection as unknown as PersistenceUncertaintyRecoverySelection,
    )).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
  });

  it.each([
    null,
    [],
    new Set(["pending"]),
    { statuses: ["pending"], limit: 1, extra: true },
    { statuses: new Set(["pending"]), limit: 1 },
    { statuses: Object.assign(["pending"], { extra: true }), limit: 1 },
    { statuses: Object.assign(Object.create(null), { 0: "pending", length: 1 }), limit: 1 },
  ])("rejects non-canonical runtime selection shapes %#", (selection) => {
    expect(() => selectPersistenceUncertaintyRecoveryBatch(
      [],
      selection as unknown as PersistenceUncertaintyRecoverySelection,
    )).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
  });

  it("rejects sparse status arrays", () => {
    const statuses = new Array(2) as PersistenceUncertaintyStatus[];
    statuses[1] = "pending";

    expect(() => selectPersistenceUncertaintyRecoveryBatch([], {
      statuses,
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
  });

  it("rejects symbol-bearing status arrays", () => {
    const statuses = ["pending"] as PersistenceUncertaintyStatus[] & {
      [key: symbol]: unknown;
    };
    statuses[Symbol("unexpected")] = true;

    expect(() => selectPersistenceUncertaintyRecoveryBatch([], {
      statuses,
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
  });

  it("rejects accessor-bearing selections without invoking the accessor", () => {
    let getterInvoked = false;
    const selection = Object.defineProperties({}, {
      statuses: {
        enumerable: true,
        get: () => {
          getterInvoked = true;
          throw new Error("selection accessor must not execute");
        },
      },
      limit: {
        enumerable: true,
        value: 1,
      },
    });

    expect(() => selectPersistenceUncertaintyRecoveryBatch(
      [],
      selection as unknown as PersistenceUncertaintyRecoverySelection,
    )).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
    expect(getterInvoked).toBe(false);
  });

  it("rejects accessor-bearing status elements without invoking the accessor", () => {
    let getterInvoked = false;
    const statuses: unknown[] = [];
    Object.defineProperty(statuses, "0", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterInvoked = true;
        throw new Error("status accessor must not execute");
      },
    });
    Object.defineProperty(statuses, "length", { value: 1 });

    expect(() => selectPersistenceUncertaintyRecoveryBatch([], {
      statuses: statuses as PersistenceUncertaintyStatus[],
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
    expect(getterInvoked).toBe(false);
  });
});

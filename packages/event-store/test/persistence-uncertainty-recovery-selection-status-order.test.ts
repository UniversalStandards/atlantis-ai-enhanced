import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
  type PersistenceUncertaintyRecord,
  type PersistenceUncertaintyStatus,
} from "@atlantis/contracts/persistence-uncertainty";

import {
  selectPersistenceUncertaintyRecoveryBatch,
} from "../src/persistence-uncertainty-recovery-selection.js";
import type {
  PersistenceUncertaintySnapshot,
} from "../src/persistence-uncertainty-repository.js";

function snapshot(
  index: number,
  status: PersistenceUncertaintyStatus,
): PersistenceUncertaintySnapshot {
  const pending = createPersistenceUncertaintyRecord({
    recordId: `uncertainty-status-order-${index}`,
    expected: {
      operationId: `operation-status-order-${index}`,
      eventId: `event-status-order-${index}`,
      executionId: `execution-status-order-${index}`,
      streamVersion: index,
      contentDigest: `sha256:status-order-${index}`,
    },
    providerOperationId: `provider-operation-status-order-${index}`,
    firstObservedAt: `2026-08-08T18:0${index}:00.000Z`,
  });

  const record = Object.freeze({
    ...pending,
    status,
  }) as PersistenceUncertaintyRecord;

  return Object.freeze({ version: index, record });
}

describe("persistence uncertainty recovery selection status ordering", () => {
  it("preserves authoritative durable order regardless of requested status order", () => {
    const snapshots = Object.freeze([
      snapshot(1, "pending"),
      snapshot(2, "quarantined"),
      snapshot(3, "pending"),
      snapshot(4, "quarantined"),
    ]);

    const pendingFirst = selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["pending", "quarantined"],
      limit: 3,
    });
    const quarantinedFirst = selectPersistenceUncertaintyRecoveryBatch(snapshots, {
      statuses: ["quarantined", "pending"],
      limit: 3,
    });

    expect(pendingFirst.map((entry) => entry.record.recordId)).toEqual([
      "uncertainty-status-order-1",
      "uncertainty-status-order-2",
      "uncertainty-status-order-3",
    ]);
    expect(quarantinedFirst.map((entry) => entry.record.recordId)).toEqual(
      pendingFirst.map((entry) => entry.record.recordId),
    );
    expect(quarantinedFirst[0]).toBe(snapshots[0]);
    expect(quarantinedFirst[1]).toBe(snapshots[1]);
    expect(quarantinedFirst[2]).toBe(snapshots[2]);
  });
});

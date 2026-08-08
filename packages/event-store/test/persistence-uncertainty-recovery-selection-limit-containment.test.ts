import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
  type PersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import {
  selectPersistenceUncertaintyRecoveryBatch,
} from "../src/persistence-uncertainty-recovery-selection.js";
import type {
  PersistenceUncertaintySnapshot,
} from "../src/persistence-uncertainty-repository.js";

function snapshot(index: number): PersistenceUncertaintySnapshot {
  const record = createPersistenceUncertaintyRecord({
    recordId: `uncertainty-${index}`,
    expected: {
      operationId: `operation-${index}`,
      eventId: `event-${index}`,
      executionId: `execution-${index}`,
      streamVersion: index,
      contentDigest: `sha256:digest-${index}`,
    },
    providerOperationId: `provider-operation-${index}`,
    firstObservedAt: `2026-08-08T0${index}:00:00.000Z`,
  });

  return Object.freeze({ version: index, record });
}

describe("persistence uncertainty recovery selection limit containment", () => {
  it("does not inspect authoritative handoffs after the bounded limit is satisfied", () => {
    let trailingRecordRead = false;
    const trailing = Object.defineProperty({ version: 3 }, "record", {
      enumerable: true,
      configurable: false,
      get: () => {
        trailingRecordRead = true;
        throw new Error("recovery selection must not inspect handoffs after its limit");
      },
    }) as unknown as PersistenceUncertaintySnapshot;

    const first = snapshot(1);
    const second = snapshot(2);
    const selected = selectPersistenceUncertaintyRecoveryBatch(
      [first, second, trailing],
      { statuses: ["pending"], limit: 2 },
    );

    expect(selected).toEqual([first, second]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(trailingRecordRead).toBe(false);
  });

  it("still inspects later handoffs when earlier entries do not satisfy the selection", () => {
    const terminal = snapshot(1);
    const terminalRecord = Object.freeze({
      ...terminal.record,
      status: "resolved_committed",
    }) as PersistenceUncertaintyRecord;
    const selectable = snapshot(2);

    const selected = selectPersistenceUncertaintyRecoveryBatch(
      [Object.freeze({ version: terminal.version, record: terminalRecord }), selectable],
      { statuses: ["pending"], limit: 1 },
    );

    expect(selected).toEqual([selectable]);
  });
});

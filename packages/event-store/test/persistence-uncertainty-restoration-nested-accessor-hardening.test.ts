import { describe, expect, it } from "vitest";

import {
  InvalidPersistedUncertaintyRecordError,
  restoreExactPersistenceUncertaintyRecord,
} from "../src/persistence-uncertainty-restoration-validation.js";

const expected = {
  operationId: "append-operation-1",
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

function pendingRecord() {
  return {
    recordId: "uncertainty-1",
    expected,
    firstObservedAt: "2026-08-07T00:00:00.000Z",
    status: "pending",
    attempts: [],
  } as const;
}

describe("nested persistence uncertainty restoration accessor hardening", () => {
  it("rejects an accessor-backed expected field without invoking its getter", () => {
    let getterCalls = 0;
    const hostileExpected: Record<string, unknown> = { ...expected };
    Object.defineProperty(hostileExpected, "contentDigest", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return "sha256:hostile";
      },
    });

    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...pendingRecord(),
      expected: hostileExpected,
    })).toThrowError(InvalidPersistedUncertaintyRecordError);
    expect(getterCalls).toBe(0);
  });

  it("rejects an accessor-backed attempt decision field without invoking its getter", () => {
    let getterCalls = 0;
    const hostileDecision: Record<string, unknown> = {
      kind: "uncertain",
      blockFurtherMutation: true,
    };
    Object.defineProperty(hostileDecision, "blockFurtherMutation", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });

    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...pendingRecord(),
      attempts: [{
        attemptNumber: 1,
        attemptId: "attempt-1",
        observedAt: "2026-08-07T00:01:00.000Z",
        reconciledAt: "2026-08-07T00:02:00.000Z",
        decision: hostileDecision,
      }],
    })).toThrowError(InvalidPersistedUncertaintyRecordError);
    expect(getterCalls).toBe(0);
  });
});

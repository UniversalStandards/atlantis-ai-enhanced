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
    providerOperationId: "provider-operation-1",
    firstObservedAt: "2026-08-06T00:00:00.000Z",
    status: "pending",
    attempts: [],
  } as const;
}

function retryResolvedRecord() {
  return {
    ...pendingRecord(),
    status: "resolved_not_committed",
    attempts: [{
      attemptNumber: 1,
      attemptId: "attempt-1",
      observedAt: "2026-08-06T00:01:00.000Z",
      reconciledAt: "2026-08-06T00:02:00.000Z",
      providerObservationId: "provider-observation-1",
      proofId: "proof-1",
      decision: { kind: "retry_permitted" },
    }],
  } as const;
}

describe("exact persistence uncertainty restoration", () => {
  it("restores and deeply freezes a valid terminal record", () => {
    const restored = restoreExactPersistenceUncertaintyRecord(retryResolvedRecord());

    expect(restored.status).toBe("resolved_not_committed");
    expect(restored.attempts[0]?.proofId).toBe("proof-1");
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.expected)).toBe(true);
    expect(Object.isFrozen(restored.attempts)).toBe(true);
    expect(Object.isFrozen(restored.attempts[0])).toBe(true);
    expect(Object.isFrozen(restored.attempts[0]?.decision)).toBe(true);
  });

  it("rejects extra properties and accessor-backed evidence without invoking getters", () => {
    let getterCalls = 0;
    const hostile = { ...pendingRecord(), unexpected: true } as Record<string, unknown>;
    Object.defineProperty(hostile, "recordId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "uncertainty-1";
      },
    });

    expect(() => restoreExactPersistenceUncertaintyRecord(hostile))
      .toThrowError(InvalidPersistedUncertaintyRecordError);
    expect(getterCalls).toBe(0);
  });

  it("rejects accessor-backed attempt elements without invoking getters", () => {
    let getterCalls = 0;
    const attempts: unknown[] = [];
    Object.defineProperty(attempts, "0", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return retryResolvedRecord().attempts[0];
      },
    });
    attempts.length = 1;

    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...retryResolvedRecord(),
      attempts,
    })).toThrowError("record.attempts[0] must be an enumerable data property");
    expect(getterCalls).toBe(0);
  });

  it("rejects sparse attempt arrays before restoration", () => {
    const attempts = new Array<unknown>(1);

    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...pendingRecord(),
      attempts,
    })).toThrowError("record.attempts[0] must be an enumerable data property");
  });

  it("rejects unexpected and symbol properties on attempt arrays", () => {
    const extraPropertyAttempts: unknown[] = [];
    Object.defineProperty(extraPropertyAttempts, "unexpected", {
      enumerable: true,
      value: true,
    });

    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...pendingRecord(),
      attempts: extraPropertyAttempts,
    })).toThrowError("record.attempts contains an unexpected property");

    const symbolPropertyAttempts: unknown[] = [];
    Object.defineProperty(symbolPropertyAttempts, Symbol("unexpected"), {
      enumerable: true,
      value: true,
    });

    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...pendingRecord(),
      attempts: symbolPropertyAttempts,
    })).toThrowError("record.attempts contains an unexpected property");
  });

  it("rejects status/decision contradictions and terminal attempts before the final attempt", () => {
    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...retryResolvedRecord(),
      status: "resolved_committed",
    })).toThrowError("record.status must match the final decision");

    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...retryResolvedRecord(),
      status: "pending",
      attempts: [
        {
          attemptNumber: 1,
          attemptId: "attempt-terminal-too-early",
          observedAt: "2026-08-06T00:01:00.000Z",
          reconciledAt: "2026-08-06T00:02:00.000Z",
          decision: { kind: "committed" },
        },
        {
          attemptNumber: 2,
          attemptId: "attempt-2",
          observedAt: "2026-08-06T00:03:00.000Z",
          reconciledAt: "2026-08-06T00:04:00.000Z",
          decision: { kind: "uncertain", blockFurtherMutation: true },
        },
      ],
    })).toThrowError("only the final attempt may be terminal");
  });

  it("rejects malformed decision flags and illegal proof placement", () => {
    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...pendingRecord(),
      attempts: [{
        attemptNumber: 1,
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:01:00.000Z",
        reconciledAt: "2026-08-06T00:02:00.000Z",
        decision: { kind: "uncertain", blockFurtherMutation: false },
      }],
    })).toThrowError("blockFurtherMutation must be true");

    expect(() => restoreExactPersistenceUncertaintyRecord({
      ...pendingRecord(),
      status: "resolved_committed",
      attempts: [{
        attemptNumber: 1,
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:01:00.000Z",
        reconciledAt: "2026-08-06T00:02:00.000Z",
        proofId: "proof-illegal",
        decision: { kind: "committed" },
      }],
    })).toThrowError("proofId is only legal for retry_permitted");
  });
});

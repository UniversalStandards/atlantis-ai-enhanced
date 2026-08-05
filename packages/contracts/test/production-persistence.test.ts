import { describe, expect, it } from "vitest";

import {
  InvalidPersistenceReconciliationEvidenceError,
  classifyPersistenceReconciliation,
} from "../src/production-persistence.js";

const expected = {
  operationId: "append-operation-1",
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

const nonCommitProof = {
  operationId: expected.operationId,
  executionId: expected.executionId,
  eventId: expected.eventId,
  expectedStreamVersion: expected.streamVersion,
  contentDigest: expected.contentDigest,
  providerObservationId: "provider-observation-1",
  observedAt: "2026-08-05T23:00:00.000Z",
  provenance: "provider_idempotency_lookup",
} as const;

describe("persistence reconciliation", () => {
  it("derives committed only from exact authoritative identity, position, and digest evidence", () => {
    const observed = {
      eventId: expected.eventId,
      executionId: expected.executionId,
      streamVersion: expected.streamVersion,
      contentDigest: expected.contentDigest,
    };

    expect(classifyPersistenceReconciliation({
      expected,
      observedAtExpectedPosition: observed,
    })).toEqual({ kind: "committed" });

    for (const observedAtExpectedPosition of [
      { ...observed, eventId: "event-2" },
      { ...observed, executionId: "execution-2" },
      { ...observed, contentDigest: "sha256:different" },
    ]) {
      expect(classifyPersistenceReconciliation({
        expected,
        observedAtExpectedPosition,
      })).toEqual({ kind: "conflict", quarantine: true });
    }
  });

  it("permits retry only from an authoritative proof bound to the exact append identity", () => {
    expect(classifyPersistenceReconciliation({
      expected,
      nonCommitProof,
    })).toEqual({ kind: "retry_permitted" });

    for (const mismatchedProof of [
      { ...nonCommitProof, operationId: "append-operation-2" },
      { ...nonCommitProof, executionId: "execution-2" },
      { ...nonCommitProof, eventId: "event-2" },
      { ...nonCommitProof, expectedStreamVersion: 5 },
      { ...nonCommitProof, contentDigest: "sha256:different" },
    ]) {
      expect(() => classifyPersistenceReconciliation({
        expected,
        nonCommitProof: mismatchedProof,
      })).toThrow(InvalidPersistenceReconciliationEvidenceError);
    }

    expect(classifyPersistenceReconciliation({ expected })).toEqual({
      kind: "uncertain",
      blockFurtherMutation: true,
    });
  });

  it("rejects contradictory, malformed, or provenance-free evidence", () => {
    const observed = {
      eventId: expected.eventId,
      executionId: expected.executionId,
      streamVersion: expected.streamVersion,
      contentDigest: expected.contentDigest,
    };

    expect(() => classifyPersistenceReconciliation({
      expected,
      observedAtExpectedPosition: observed,
      nonCommitProof,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected,
      observedAtExpectedPosition: { ...observed, streamVersion: 5 },
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected: { ...expected, operationId: " " },
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected: { ...expected, eventId: " " },
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected: { ...expected, streamVersion: 0 },
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected: { ...expected, contentDigest: "" },
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected,
      nonCommitProof: { ...nonCommitProof, providerObservationId: "" },
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected,
      nonCommitProof: { ...nonCommitProof, observedAt: "2026-08-05T23:00:00Z" },
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected,
      nonCommitProof: {
        ...nonCommitProof,
        provenance: "caller_assertion" as never,
      },
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);
  });

  it("returns an immutable decision", () => {
    const decision = classifyPersistenceReconciliation({ expected });
    expect(Object.isFrozen(decision)).toBe(true);
  });
});

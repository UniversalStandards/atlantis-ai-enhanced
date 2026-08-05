import { describe, expect, it } from "vitest";

import {
  InvalidPersistenceReconciliationEvidenceError,
  classifyPersistenceReconciliation,
} from "../src/production-persistence.js";

const expected = {
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

describe("persistence reconciliation", () => {
  it("derives committed only from exact authoritative identity, position, and digest evidence", () => {
    expect(classifyPersistenceReconciliation({
      expected,
      observedAtExpectedPosition: { ...expected },
      providerProvesNotCommitted: false,
    })).toEqual({ kind: "committed" });

    for (const observedAtExpectedPosition of [
      { ...expected, eventId: "event-2" },
      { ...expected, executionId: "execution-2" },
      { ...expected, contentDigest: "sha256:different" },
    ]) {
      expect(classifyPersistenceReconciliation({
        expected,
        observedAtExpectedPosition,
        providerProvesNotCommitted: false,
      })).toEqual({ kind: "conflict", quarantine: true });
    }
  });

  it("permits retry only from authoritative non-commit proof and otherwise remains uncertain", () => {
    expect(classifyPersistenceReconciliation({
      expected,
      providerProvesNotCommitted: true,
    })).toEqual({ kind: "retry_permitted" });

    expect(classifyPersistenceReconciliation({
      expected,
      providerProvesNotCommitted: false,
    })).toEqual({ kind: "uncertain", blockFurtherMutation: true });
  });

  it("rejects contradictory or malformed evidence", () => {
    expect(() => classifyPersistenceReconciliation({
      expected,
      observedAtExpectedPosition: { ...expected },
      providerProvesNotCommitted: true,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected,
      observedAtExpectedPosition: { ...expected, streamVersion: 5 },
      providerProvesNotCommitted: false,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected: { ...expected, eventId: " " },
      providerProvesNotCommitted: false,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected: { ...expected, streamVersion: 0 },
      providerProvesNotCommitted: false,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected: { ...expected, contentDigest: "" },
      providerProvesNotCommitted: false,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);
  });

  it("returns an immutable decision", () => {
    const decision = classifyPersistenceReconciliation({
      expected,
      providerProvesNotCommitted: false,
    });
    expect(Object.isFrozen(decision)).toBe(true);
  });
});

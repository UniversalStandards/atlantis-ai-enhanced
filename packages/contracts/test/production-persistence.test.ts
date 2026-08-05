import { describe, expect, it } from "vitest";

import {
  InvalidPersistenceReconciliationEvidenceError,
  classifyPersistenceReconciliation,
} from "../src/production-persistence.js";

describe("persistence reconciliation", () => {
  it("maps durable evidence to fail-closed decisions", () => {
    expect(classifyPersistenceReconciliation({
      exactEventMatch: true,
      conflictingEventAtExpectedPosition: false,
      providerProvesNotCommitted: false,
    })).toEqual({ kind: "committed" });

    expect(classifyPersistenceReconciliation({
      exactEventMatch: false,
      conflictingEventAtExpectedPosition: true,
      providerProvesNotCommitted: false,
    })).toEqual({ kind: "conflict", quarantine: true });

    expect(classifyPersistenceReconciliation({
      exactEventMatch: false,
      conflictingEventAtExpectedPosition: false,
      providerProvesNotCommitted: true,
    })).toEqual({ kind: "retry_permitted" });

    expect(classifyPersistenceReconciliation({
      exactEventMatch: false,
      conflictingEventAtExpectedPosition: false,
      providerProvesNotCommitted: false,
    })).toEqual({ kind: "uncertain", blockFurtherMutation: true });
  });

  it("rejects contradictory evidence", () => {
    expect(() => classifyPersistenceReconciliation({
      exactEventMatch: true,
      conflictingEventAtExpectedPosition: true,
      providerProvesNotCommitted: false,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      exactEventMatch: true,
      conflictingEventAtExpectedPosition: false,
      providerProvesNotCommitted: true,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      exactEventMatch: false,
      conflictingEventAtExpectedPosition: true,
      providerProvesNotCommitted: true,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);
  });

  it("returns an immutable decision", () => {
    const decision = classifyPersistenceReconciliation({
      exactEventMatch: false,
      conflictingEventAtExpectedPosition: false,
      providerProvesNotCommitted: false,
    });
    expect(Object.isFrozen(decision)).toBe(true);
  });
});

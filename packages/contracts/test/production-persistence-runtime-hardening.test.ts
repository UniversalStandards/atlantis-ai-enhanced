import { describe, expect, it, vi } from "vitest";

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
  proofId: "proof-1",
  uncertaintyRecordId: "uncertainty-1",
  operationId: expected.operationId,
  providerOperationId: "provider-operation-1",
  executionId: expected.executionId,
  eventId: expected.eventId,
  expectedStreamVersion: expected.streamVersion,
  contentDigest: expected.contentDigest,
  providerObservationId: "provider-observation-1",
  proofIssuer: "provider-control-plane",
  verificationMethod: "authenticated_provider_api",
  observedAt: "2026-08-05T23:00:00.000Z",
  validUntil: "2026-08-05T23:05:00.000Z",
  provenance: "provider_idempotency_lookup",
} as const;

describe("persistence reconciliation runtime hardening", () => {
  it("rejects a top-level accessor without invoking it", () => {
    const getter = vi.fn(() => expected);
    const evidence = {} as Record<string, unknown>;
    Object.defineProperty(evidence, "expected", {
      enumerable: true,
      get: getter,
    });

    expect(() => classifyPersistenceReconciliation(evidence as never)).toThrow(
      InvalidPersistenceReconciliationEvidenceError,
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects nested accessors without invoking them", () => {
    const operationIdGetter = vi.fn(() => expected.operationId);
    const accessorExpected = {
      eventId: expected.eventId,
      executionId: expected.executionId,
      streamVersion: expected.streamVersion,
      contentDigest: expected.contentDigest,
    } as Record<string, unknown>;
    Object.defineProperty(accessorExpected, "operationId", {
      enumerable: true,
      get: operationIdGetter,
    });

    expect(() => classifyPersistenceReconciliation({
      expected: accessorExpected as never,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);
    expect(operationIdGetter).not.toHaveBeenCalled();

    const proofIdGetter = vi.fn(() => nonCommitProof.proofId);
    const accessorProof = { ...nonCommitProof } as Record<string, unknown>;
    Object.defineProperty(accessorProof, "proofId", {
      enumerable: true,
      get: proofIdGetter,
    });

    expect(() => classifyPersistenceReconciliation({
      expected,
      nonCommitProof: accessorProof as never,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);
    expect(proofIdGetter).not.toHaveBeenCalled();
  });

  it("rejects unexpected, symbol, prototype-bearing, and missing fields", () => {
    const symbol = Symbol("unexpected");
    const withSymbol = { ...expected } as Record<PropertyKey, unknown>;
    withSymbol[symbol] = "unexpected";

    const prototypeBearing = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      expected,
    );

    for (const malformedExpected of [
      { ...expected, unexpected: true },
      withSymbol,
      prototypeBearing,
      {
        eventId: expected.eventId,
        executionId: expected.executionId,
        streamVersion: expected.streamVersion,
        contentDigest: expected.contentDigest,
      },
    ]) {
      expect(() => classifyPersistenceReconciliation({
        expected: malformedExpected as never,
      })).toThrow(InvalidPersistenceReconciliationEvidenceError);
    }
  });

  it("rejects explicit undefined optional evidence instead of treating it as absent", () => {
    expect(() => classifyPersistenceReconciliation({
      expected,
      observedAtExpectedPosition: undefined,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected,
      nonCommitProof: undefined,
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);
  });

  it("preserves valid committed, retry, and uncertain decisions", () => {
    expect(classifyPersistenceReconciliation({ expected })).toEqual({
      kind: "uncertain",
      blockFurtherMutation: true,
    });

    expect(classifyPersistenceReconciliation({
      expected,
      nonCommitProof,
    })).toEqual({ kind: "retry_permitted" });

    expect(classifyPersistenceReconciliation({
      expected,
      observedAtExpectedPosition: {
        eventId: expected.eventId,
        executionId: expected.executionId,
        streamVersion: expected.streamVersion,
        contentDigest: expected.contentDigest,
      },
    })).toEqual({ kind: "committed" });
  });
});

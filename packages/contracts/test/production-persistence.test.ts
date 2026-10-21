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

const validDecisionContext = {
  decisionAt: "2026-08-05T23:04:00.000Z",
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

  it("permits retry only from authoritative, identity-bound, currently valid proof", () => {
    expect(classifyPersistenceReconciliation({
      expected,
      nonCommitProof,
    }, validDecisionContext)).toEqual({ kind: "retry_permitted" });

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
      }, validDecisionContext)).toThrow(InvalidPersistenceReconciliationEvidenceError);
    }

    expect(classifyPersistenceReconciliation({ expected })).toEqual({
      kind: "uncertain",
      blockFurtherMutation: true,
    });
  });

  it("fails closed without trusted decision time and after proof expiry", () => {
    expect(classifyPersistenceReconciliation({
      expected,
      nonCommitProof,
    })).toEqual({ kind: "uncertain", blockFurtherMutation: true });

    expect(classifyPersistenceReconciliation({
      expected,
      nonCommitProof,
    }, {
      decisionAt: nonCommitProof.validUntil,
    })).toEqual({ kind: "retry_permitted" });

    expect(classifyPersistenceReconciliation({
      expected,
      nonCommitProof,
    }, {
      decisionAt: "2026-08-05T23:05:00.001Z",
    })).toEqual({ kind: "uncertain", blockFurtherMutation: true });
  });

  it("rejects trusted decision time that predates proof observation", () => {
    expect(() => classifyPersistenceReconciliation({
      expected,
      nonCommitProof,
    }, {
      decisionAt: "2026-08-05T22:59:59.999Z",
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);
  });

  it("rejects contradictory, malformed, expired-window, or unsupported proof evidence", () => {
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
    }, validDecisionContext)).toThrow(InvalidPersistenceReconciliationEvidenceError);

    expect(() => classifyPersistenceReconciliation({
      expected,
      observedAtExpectedPosition: { ...observed, streamVersion: 5 },
    })).toThrow(InvalidPersistenceReconciliationEvidenceError);

    for (const malformedProof of [
      { ...nonCommitProof, proofId: "" },
      { ...nonCommitProof, uncertaintyRecordId: "" },
      { ...nonCommitProof, providerOperationId: "" },
      { ...nonCommitProof, providerObservationId: "" },
      { ...nonCommitProof, proofIssuer: "" },
      { ...nonCommitProof, observedAt: "2026-08-05T23:00:00Z" },
      { ...nonCommitProof, validUntil: "2026-08-05T22:59:59.000Z" },
      {
        ...nonCommitProof,
        verificationMethod: "caller_assertion" as never,
      },
      {
        ...nonCommitProof,
        provenance: "caller_assertion" as never,
      },
    ]) {
      expect(() => classifyPersistenceReconciliation({
        expected,
        nonCommitProof: malformedProof,
      }, validDecisionContext)).toThrow(InvalidPersistenceReconciliationEvidenceError);
    }
  });

  it("returns an immutable decision", () => {
    const decision = classifyPersistenceReconciliation({ expected });
    expect(Object.isFrozen(decision)).toBe(true);
  });
});

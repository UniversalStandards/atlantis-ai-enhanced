import { describe, expect, it } from "vitest";

import {
  InvalidPersistenceUncertaintyTransitionError,
  createPersistenceUncertaintyRecord,
  reconcilePersistenceUncertainty,
} from "../src/persistence-uncertainty.js";

const expected = {
  operationId: "append-operation-1",
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

function createRecord() {
  return createPersistenceUncertaintyRecord({
    recordId: "uncertainty-1",
    expected,
    providerOperationId: "provider-operation-1",
    firstObservedAt: "2026-08-06T00:00:00.000Z",
  });
}

function createNonCommitProof() {
  return {
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
    observedAt: "2026-08-06T00:01:00.000Z",
    validUntil: "2026-08-06T00:06:00.000Z",
    provenance: "provider_idempotency_lookup",
  } as const;
}

describe("persistence uncertainty lifecycle", () => {
  it("records ordered unresolved attempts without mutating the prior record", () => {
    const initial = createRecord();
    const next = reconcilePersistenceUncertainty(initial, {
      attemptId: "attempt-1",
      observedAt: "2026-08-06T00:01:00.000Z",
      reconciledAt: "2026-08-06T00:01:30.000Z",
      evidence: { expected },
    });

    expect(initial.status).toBe("pending");
    expect(initial.attempts).toHaveLength(0);
    expect(next.status).toBe("pending");
    expect(next.attempts).toEqual([
      {
        attemptNumber: 1,
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:01:00.000Z",
        reconciledAt: "2026-08-06T00:01:30.000Z",
        decision: { kind: "uncertain", blockFurtherMutation: true },
      },
    ]);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.expected)).toBe(true);
    expect(Object.isFrozen(next.attempts)).toBe(true);
    expect(Object.isFrozen(next.attempts[0])).toBe(true);
  });

  it("binds retry authority and recorded audit metadata to the exact proof", () => {
    const proof = createNonCommitProof();
    const resolved = reconcilePersistenceUncertainty(createRecord(), {
      attemptId: "attempt-not-committed",
      observedAt: proof.observedAt,
      reconciledAt: "2026-08-06T00:02:00.000Z",
      providerObservationId: proof.providerObservationId,
      evidence: { expected, nonCommitProof: proof },
    });

    expect(resolved.status).toBe("resolved_not_committed");
    expect(resolved.attempts[0]).toEqual({
      attemptNumber: 1,
      attemptId: "attempt-not-committed",
      observedAt: proof.observedAt,
      reconciledAt: "2026-08-06T00:02:00.000Z",
      providerObservationId: proof.providerObservationId,
      proofId: proof.proofId,
      decision: { kind: "retry_permitted" },
    });

    for (const invalid of [
      { proof: { ...proof, uncertaintyRecordId: "uncertainty-2" } },
      { proof: { ...proof, providerOperationId: "provider-operation-2" } },
      { proof, observedAt: "2026-08-06T00:02:00.000Z" },
      { proof, providerObservationId: "provider-observation-2" },
      { proof: { ...proof, validUntil: "2026-08-06T00:00:59.000Z" } },
    ]) {
      expect(() => reconcilePersistenceUncertainty(createRecord(), {
        attemptId: "attempt-invalid-proof",
        observedAt: invalid.observedAt ?? invalid.proof.observedAt,
        reconciledAt: "2026-08-06T00:02:00.000Z",
        providerObservationId:
          invalid.providerObservationId ?? invalid.proof.providerObservationId,
        evidence: { expected, nonCommitProof: invalid.proof },
      })).toThrow(InvalidPersistenceUncertaintyTransitionError);
    }
  });

  it("rejects proof consumed after its validity window", () => {
    const proof = createNonCommitProof();

    expect(() => reconcilePersistenceUncertainty(createRecord(), {
      attemptId: "attempt-expired-proof",
      observedAt: proof.observedAt,
      reconciledAt: "2026-08-06T00:06:00.001Z",
      providerObservationId: proof.providerObservationId,
      evidence: { expected, nonCommitProof: proof },
    })).toThrowError("nonCommitProof is expired at reconciliation time");
  });

  it("maps committed and conflict evidence to closed states", () => {
    const committed = reconcilePersistenceUncertainty(createRecord(), {
      attemptId: "attempt-committed",
      observedAt: "2026-08-06T00:01:00.000Z",
      reconciledAt: "2026-08-06T00:01:30.000Z",
      evidence: {
        expected,
        observedAtExpectedPosition: {
          eventId: expected.eventId,
          executionId: expected.executionId,
          streamVersion: expected.streamVersion,
          contentDigest: expected.contentDigest,
        },
      },
    });
    expect(committed.status).toBe("resolved_committed");

    const quarantined = reconcilePersistenceUncertainty(createRecord(), {
      attemptId: "attempt-conflict",
      observedAt: "2026-08-06T00:01:00.000Z",
      reconciledAt: "2026-08-06T00:01:30.000Z",
      evidence: {
        expected,
        observedAtExpectedPosition: {
          eventId: "different-event",
          executionId: expected.executionId,
          streamVersion: expected.streamVersion,
          contentDigest: expected.contentDigest,
        },
      },
    });
    expect(quarantined.status).toBe("quarantined");

    for (const closed of [committed, quarantined]) {
      expect(() => reconcilePersistenceUncertainty(closed, {
        attemptId: "late-attempt",
        observedAt: "2026-08-06T00:02:00.000Z",
        reconciledAt: "2026-08-06T00:02:30.000Z",
        evidence: { expected },
      })).toThrow(InvalidPersistenceUncertaintyTransitionError);
    }
  });

  it("rejects cross-operation, duplicate, stale, and malformed attempts", () => {
    const record = createRecord();

    expect(() => reconcilePersistenceUncertainty(record, {
      attemptId: "attempt-cross-operation",
      observedAt: "2026-08-06T00:01:00.000Z",
      reconciledAt: "2026-08-06T00:01:30.000Z",
      evidence: {
        expected: { ...expected, operationId: "append-operation-2" },
      },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);

    expect(() => reconcilePersistenceUncertainty(record, {
      attemptId: "attempt-stale",
      observedAt: "2026-08-05T23:59:59.000Z",
      reconciledAt: "2026-08-06T00:01:00.000Z",
      evidence: { expected },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);

    expect(() => reconcilePersistenceUncertainty(record, {
      attemptId: "attempt-time-travel",
      observedAt: "2026-08-06T00:02:00.000Z",
      reconciledAt: "2026-08-06T00:01:59.999Z",
      evidence: { expected },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);

    expect(() => reconcilePersistenceUncertainty(record, {
      attemptId: " ",
      observedAt: "2026-08-06T00:01:00.000Z",
      reconciledAt: "2026-08-06T00:01:30.000Z",
      evidence: { expected },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);

    expect(() => reconcilePersistenceUncertainty(record, {
      attemptId: "attempt-malformed-time",
      observedAt: "2026-08-06T00:01:00.000Z",
      reconciledAt: "not-a-timestamp",
      evidence: { expected },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);

    const first = reconcilePersistenceUncertainty(record, {
      attemptId: "attempt-1",
      observedAt: "2026-08-06T00:01:00.000Z",
      reconciledAt: "2026-08-06T00:01:30.000Z",
      evidence: { expected },
    });
    expect(() => reconcilePersistenceUncertainty(first, {
      attemptId: "attempt-1",
      observedAt: "2026-08-06T00:02:00.000Z",
      reconciledAt: "2026-08-06T00:02:30.000Z",
      evidence: { expected },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);
  });
});

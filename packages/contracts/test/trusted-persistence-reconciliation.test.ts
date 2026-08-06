import { describe, expect, it, vi } from "vitest";

import {
  InvalidPersistenceUncertaintyTransitionError,
  createPersistenceUncertaintyRecord,
} from "../src/persistence-uncertainty.js";
import {
  reconcilePersistenceUncertaintyWithTrustedClock,
} from "../src/trusted-persistence-reconciliation.js";

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

describe("trusted persistence reconciliation clock", () => {
  it("samples the trusted clock exactly once and records that timestamp", () => {
    const now = vi.fn(() => "2026-08-06T00:01:30.000Z");

    const next = reconcilePersistenceUncertaintyWithTrustedClock(
      createRecord(),
      {
        attemptId: "attempt-1",
        observedAt: "2026-08-06T00:01:00.000Z",
        evidence: { expected },
      },
      { now },
    );

    expect(now).toHaveBeenCalledTimes(1);
    expect(next.attempts[0]?.reconciledAt).toBe("2026-08-06T00:01:30.000Z");
  });

  it("fails closed when the trusted clock returns malformed or stale time", () => {
    for (const reconciledAt of [
      "not-a-timestamp",
      "2026-08-05T23:59:59.999Z",
      "2026-08-06T00:00:59.999Z",
    ]) {
      expect(() => reconcilePersistenceUncertaintyWithTrustedClock(
        createRecord(),
        {
          attemptId: `attempt-${reconciledAt}`,
          observedAt: "2026-08-06T00:01:00.000Z",
          evidence: { expected },
        },
        { now: () => reconciledAt },
      )).toThrow(InvalidPersistenceUncertaintyTransitionError);
    }
  });

  it("enforces proof expiry against trusted consumption time", () => {
    const proof = createNonCommitProof();

    expect(() => reconcilePersistenceUncertaintyWithTrustedClock(
      createRecord(),
      {
        attemptId: "attempt-expired-proof",
        observedAt: proof.observedAt,
        providerObservationId: proof.providerObservationId,
        evidence: { expected, nonCommitProof: proof },
      },
      { now: () => "2026-08-06T00:06:00.001Z" },
    )).toThrowError("nonCommitProof is expired at reconciliation time");
  });
});

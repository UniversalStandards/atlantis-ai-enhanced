import { describe, expect, it } from "vitest";

import {
  InvalidPersistenceUncertaintyTransitionError,
  createPersistenceUncertaintyRecord,
  reconcilePersistenceUncertainty,
  type ReconcilePersistenceUncertaintyInput,
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

function reconcileWithUnsafeEvidence(evidence: unknown): void {
  reconcilePersistenceUncertainty(createRecord(), {
    attemptId: "attempt-runtime-hardening",
    observedAt: "2026-08-06T00:01:00.000Z",
    reconciledAt: "2026-08-06T00:01:30.000Z",
    evidence,
  } as ReconcilePersistenceUncertaintyInput);
}

describe("persistence uncertainty runtime hardening", () => {
  it("rejects an accessor-bearing evidence envelope without invoking the accessor", () => {
    let getterInvocations = 0;
    const evidence = Object.defineProperty({}, "expected", {
      enumerable: true,
      get() {
        getterInvocations += 1;
        return expected;
      },
    });

    expect(() => reconcileWithUnsafeEvidence(evidence)).toThrow(
      InvalidPersistenceUncertaintyTransitionError,
    );
    expect(getterInvocations).toBe(0);
  });

  it("rejects an accessor-bearing non-commit proof before lifecycle proof binding reads", () => {
    let getterInvocations = 0;
    const proof = {
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
    } as Record<string, unknown>;
    Object.defineProperty(proof, "proofId", {
      enumerable: true,
      get() {
        getterInvocations += 1;
        return "proof-1";
      },
    });

    expect(() => reconcileWithUnsafeEvidence({
      expected,
      nonCommitProof: proof,
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);
    expect(getterInvocations).toBe(0);
  });

  it("still accepts ordinary immutable reconciliation evidence", () => {
    const reconciled = reconcilePersistenceUncertainty(createRecord(), {
      attemptId: "attempt-valid-runtime-evidence",
      observedAt: "2026-08-06T00:01:00.000Z",
      reconciledAt: "2026-08-06T00:01:30.000Z",
      evidence: { expected },
    });

    expect(reconciled.status).toBe("pending");
    expect(reconciled.attempts[0]?.decision).toEqual({
      kind: "uncertain",
      blockFurtherMutation: true,
    });
  });
});

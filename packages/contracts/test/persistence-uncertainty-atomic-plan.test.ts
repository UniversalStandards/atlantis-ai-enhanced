import { describe, expect, it, vi } from "vitest";

import {
  createPersistenceProofConsumptionIndex,
  consumePersistenceProof,
} from "../src/persistence-proof-consumption.js";
import {
  planPersistenceUncertaintyAtomicTransition,
  planPersistenceUncertaintyAtomicTransitionWithTrustedClock,
} from "../src/persistence-uncertainty-atomic-plan.js";
import {
  createPersistenceUncertaintyRecord,
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

function createProof() {
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

describe("persistence uncertainty atomic plan", () => {
  it("couples retry resolution to exact proof consumption", () => {
    const proof = createProof();
    const record = createRecord();
    const index = createPersistenceProofConsumptionIndex();
    const plan = planPersistenceUncertaintyAtomicTransition(record, index, {
      attemptId: "attempt-1",
      observedAt: proof.observedAt,
      reconciledAt: "2026-08-06T00:02:00.000Z",
      providerObservationId: proof.providerObservationId,
      evidence: { expected, nonCommitProof: proof },
    });

    expect(plan.nextRecord.status).toBe("resolved_not_committed");
    expect(plan.proofConsumption).toEqual({
      proofId: proof.proofId,
      uncertaintyRecordId: record.recordId,
      providerOperationId: record.providerOperationId,
      consumedByAttemptId: "attempt-1",
      consumedAt: "2026-08-06T00:02:00.000Z",
    });
    expect(plan.nextProofConsumptionIndex.entries).toEqual([
      plan.proofConsumption,
    ]);
    expect(plan.previousRecord).toBe(record);
    expect(plan.previousProofConsumptionIndex.entries).toHaveLength(0);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.proofConsumption)).toBe(true);
  });

  it("samples the trusted clock once and binds proof consumption to it", () => {
    const proof = createProof();
    const clock = {
      now: vi.fn(() => "2026-08-06T00:03:00.000Z"),
    };

    const plan = planPersistenceUncertaintyAtomicTransitionWithTrustedClock(
      createRecord(),
      createPersistenceProofConsumptionIndex(),
      {
        attemptId: "attempt-trusted",
        observedAt: proof.observedAt,
        providerObservationId: proof.providerObservationId,
        evidence: { expected, nonCommitProof: proof },
      },
      clock,
    );

    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(plan.nextRecord.attempts.at(-1)?.reconciledAt).toBe(
      "2026-08-06T00:03:00.000Z",
    );
    expect(plan.proofConsumption?.consumedAt).toBe(
      "2026-08-06T00:03:00.000Z",
    );
  });

  it("preserves the proof index for outcomes that consume no proof", () => {
    const index = createPersistenceProofConsumptionIndex();
    const plan = planPersistenceUncertaintyAtomicTransition(
      createRecord(),
      index,
      {
        attemptId: "attempt-uncertain",
        observedAt: "2026-08-06T00:01:00.000Z",
        reconciledAt: "2026-08-06T00:01:30.000Z",
        evidence: { expected },
      },
    );

    expect(plan.nextRecord.status).toBe("pending");
    expect(plan.proofConsumption).toBeUndefined();
    expect(plan.nextProofConsumptionIndex).toBe(
      plan.previousProofConsumptionIndex,
    );
  });

  it("fails before producing a retry plan when proof was consumed previously", () => {
    const proof = createProof();
    const consumed = consumePersistenceProof(
      createPersistenceProofConsumptionIndex(),
      {
        proofId: proof.proofId,
        uncertaintyRecordId: "other-uncertainty",
        providerOperationId: "other-provider-operation",
        consumedByAttemptId: "other-attempt",
        consumedAt: "2026-08-06T00:01:30.000Z",
      },
    );

    expect(() => planPersistenceUncertaintyAtomicTransition(
      createRecord(),
      consumed,
      {
        attemptId: "attempt-replay",
        observedAt: proof.observedAt,
        reconciledAt: "2026-08-06T00:02:00.000Z",
        providerObservationId: proof.providerObservationId,
        evidence: { expected, nonCommitProof: proof },
      },
    )).toThrowError("proofId has already been consumed");
  });
});

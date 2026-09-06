import { describe, expect, it } from "vitest";

import {
  createPersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";

import { InMemoryAtomicSnapshotStorage } from "../src/index.js";
import {
  DurableSnapshotPersistenceUncertaintyRepository,
  PersistenceUncertaintyVersionConflictError,
} from "../src/persistence-uncertainty-repository.js";

const expected = {
  operationId: "append-operation-1",
  eventId: "event-1",
  executionId: "execution-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

function createRecord(recordId = "uncertainty-1") {
  return createPersistenceUncertaintyRecord({
    recordId,
    expected,
    providerOperationId: "provider-operation-1",
    firstObservedAt: "2026-08-06T00:00:00.000Z",
  });
}

function createProof(recordId = "uncertainty-1") {
  return {
    proofId: "proof-1",
    uncertaintyRecordId: recordId,
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

const clock = {
  now: () => "2026-08-06T00:02:00.000Z",
};

describe("durable snapshot persistence uncertainty repository", () => {
  it("atomically persists retry resolution and proof consumption across restart", () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    repository.create(createRecord());
    const proof = createProof();

    const resolved = repository.reconcile(
      "uncertainty-1",
      1,
      {
        attemptId: "attempt-1",
        observedAt: proof.observedAt,
        providerObservationId: proof.providerObservationId,
        evidence: { expected, nonCommitProof: proof },
      },
      clock,
    );

    expect(resolved.version).toBe(2);
    expect(resolved.record.status).toBe("resolved_not_committed");

    const restarted = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const restored = restarted.get("uncertainty-1");
    expect(restored).toEqual(resolved);
    expect(Object.isFrozen(restored.record)).toBe(true);
    expect(Object.isFrozen(restored.record.attempts)).toBe(true);
  });

  it("rejects stale competing writers by record version", () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const first = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    const second = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    first.create(createRecord());

    first.reconcile(
      "uncertainty-1",
      1,
      {
        attemptId: "attempt-uncertain",
        observedAt: "2026-08-06T00:01:00.000Z",
        evidence: { expected },
      },
      clock,
    );

    expect(() => second.reconcile(
      "uncertainty-1",
      1,
      {
        attemptId: "attempt-stale",
        observedAt: "2026-08-06T00:01:30.000Z",
        evidence: { expected },
      },
      clock,
    )).toThrowError(PersistenceUncertaintyVersionConflictError);
  });

  it("rejects cross-record proof replay after repository restart", () => {
    const storage = new InMemoryAtomicSnapshotStorage();
    const repository = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    repository.create(createRecord("uncertainty-1"));
    repository.create(createRecord("uncertainty-2"));
    const proof = createProof("uncertainty-1");

    repository.reconcile(
      "uncertainty-1",
      1,
      {
        attemptId: "attempt-1",
        observedAt: proof.observedAt,
        providerObservationId: proof.providerObservationId,
        evidence: { expected, nonCommitProof: proof },
      },
      clock,
    );

    const restarted = new DurableSnapshotPersistenceUncertaintyRepository(storage);
    expect(() => restarted.reconcile(
      "uncertainty-2",
      1,
      {
        attemptId: "attempt-replay",
        observedAt: proof.observedAt,
        providerObservationId: proof.providerObservationId,
        evidence: {
          expected,
          nonCommitProof: {
            ...proof,
            uncertaintyRecordId: "uncertainty-2",
          },
        },
      },
      clock,
    )).toThrowError("proofId has already been consumed");
  });
});

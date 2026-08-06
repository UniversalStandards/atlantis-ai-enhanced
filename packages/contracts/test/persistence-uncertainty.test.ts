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

describe("persistence uncertainty lifecycle", () => {
  it("records ordered unresolved attempts without mutating the prior record", () => {
    const initial = createRecord();
    const next = reconcilePersistenceUncertainty(initial, {
      attemptId: "attempt-1",
      observedAt: "2026-08-06T00:01:00.000Z",
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
        decision: { kind: "uncertain", blockFurtherMutation: true },
      },
    ]);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.expected)).toBe(true);
    expect(Object.isFrozen(next.attempts)).toBe(true);
    expect(Object.isFrozen(next.attempts[0])).toBe(true);
  });

  it("maps authoritative outcomes to closed terminal or quarantine states", () => {
    const committed = reconcilePersistenceUncertainty(createRecord(), {
      attemptId: "attempt-committed",
      observedAt: "2026-08-06T00:01:00.000Z",
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

    const retryPermitted = reconcilePersistenceUncertainty(createRecord(), {
      attemptId: "attempt-not-committed",
      observedAt: "2026-08-06T00:01:00.000Z",
      providerObservationId: "provider-observation-1",
      evidence: {
        expected,
        nonCommitProof: {
          operationId: expected.operationId,
          executionId: expected.executionId,
          eventId: expected.eventId,
          expectedStreamVersion: expected.streamVersion,
          contentDigest: expected.contentDigest,
          providerObservationId: "provider-observation-1",
          observedAt: "2026-08-06T00:01:00.000Z",
          provenance: "provider_idempotency_lookup",
        },
      },
    });
    expect(retryPermitted.status).toBe("resolved_not_committed");

    const quarantined = reconcilePersistenceUncertainty(createRecord(), {
      attemptId: "attempt-conflict",
      observedAt: "2026-08-06T00:01:00.000Z",
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

    for (const closed of [committed, retryPermitted, quarantined]) {
      expect(() => reconcilePersistenceUncertainty(closed, {
        attemptId: "late-attempt",
        observedAt: "2026-08-06T00:02:00.000Z",
        evidence: { expected },
      })).toThrow(InvalidPersistenceUncertaintyTransitionError);
    }
  });

  it("rejects cross-operation, duplicate, stale, and malformed attempts", () => {
    const record = createRecord();

    expect(() => reconcilePersistenceUncertainty(record, {
      attemptId: "attempt-cross-operation",
      observedAt: "2026-08-06T00:01:00.000Z",
      evidence: {
        expected: { ...expected, operationId: "append-operation-2" },
      },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);

    expect(() => reconcilePersistenceUncertainty(record, {
      attemptId: "attempt-stale",
      observedAt: "2026-08-05T23:59:59.000Z",
      evidence: { expected },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);

    expect(() => reconcilePersistenceUncertainty(record, {
      attemptId: " ",
      observedAt: "2026-08-06T00:01:00.000Z",
      evidence: { expected },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);

    const first = reconcilePersistenceUncertainty(record, {
      attemptId: "attempt-1",
      observedAt: "2026-08-06T00:01:00.000Z",
      evidence: { expected },
    });
    expect(() => reconcilePersistenceUncertainty(first, {
      attemptId: "attempt-1",
      observedAt: "2026-08-06T00:02:00.000Z",
      evidence: { expected },
    })).toThrow(InvalidPersistenceUncertaintyTransitionError);
  });
});

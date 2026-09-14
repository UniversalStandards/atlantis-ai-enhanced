import { describe, expect, it } from "vitest";

import { ExternalEffectOwnershipLostError } from "@atlantis/contracts/external-effect-execution";
import type { ExternalEffectClaim } from "@atlantis/contracts/external-effect-ownership";

import { DurableExecutionEventSink } from "../src/execution-event-sink.js";
import {
  OwnershipLossEvidenceTimeoutError,
  withDurableOwnershipLossEvidence,
} from "../src/external-effect-ownership-loss-context.js";
import {
  DurableSnapshotEventStore,
  PersistenceConflictError,
  type AtomicSnapshot,
  type AtomicSnapshotStorage,
} from "../src/index.js";

const claim: ExternalEffectClaim = Object.freeze({
  idempotencyKey: "execution-1:publish-change",
  executionId: "execution-1",
  stepId: "publish-change",
  effectType: "github.commit.create",
  ownerId: "worker-1",
  claimToken: "opaque-secret-token",
  acquiredAt: "2026-08-04T16:00:00.000Z",
  expiresAt: "2026-08-04T16:00:30.000Z",
  generation: 4,
});

class RecoverableAtomicSnapshotStorage implements AtomicSnapshotStorage {
  #revision = 0;
  #value: string | null = null;
  public rejectWrites = true;

  public load(): AtomicSnapshot {
    return Object.freeze({ revision: this.#revision, value: this.#value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    if (this.rejectWrites || expectedRevision !== this.#revision) return false;
    this.#value = nextValue;
    this.#revision += 1;
    return true;
  }
}

function ownershipLoss(): ExternalEffectOwnershipLostError {
  return new ExternalEffectOwnershipLostError(
    "provider_execution",
    claim,
    new Error("claim superseded"),
  );
}

function createHarness() {
  const storage = new RecoverableAtomicSnapshotStorage();
  const eventSink = new DurableExecutionEventSink(
    new DurableSnapshotEventStore(storage, 1),
  );
  const eventIds = ["failed-evidence", "recovered-evidence"];

  return {
    storage,
    eventSink,
    baseOptions: {
      eventSink,
      executionId: "execution-1",
      actor: "external-effect-runtime",
      createEventId: () => eventIds.shift() ?? "unexpected-event",
      now: () => "2026-08-04T16:00:10.000Z",
    },
  };
}

describe("ownership-loss evidence reporter containment", () => {
  it("contains a rejected reporter and releases the governed queue", async () => {
    const { storage, eventSink, baseOptions } = createHarness();
    const authoritativeError = ownershipLoss();
    const reportedErrors: unknown[] = [];

    await expect(
      withDurableOwnershipLossEvidence(
        {
          ...baseOptions,
          onEvidenceError: async (error) => {
            reportedErrors.push(error);
            throw new Error("reporter unavailable");
          },
        },
        () => Promise.reject(authoritativeError),
      ),
    ).rejects.toBe(authoritativeError);

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]).toBeInstanceOf(PersistenceConflictError);
    expect(storage.load()).toEqual({ revision: 0, value: null });
    expect(eventSink.readExecution("execution-1")).toEqual([]);

    storage.rejectWrites = false;
    await expect(
      withDurableOwnershipLossEvidence(baseOptions, () =>
        Promise.reject(authoritativeError),
      ),
    ).rejects.toBe(authoritativeError);

    expect(eventSink.readExecution("execution-1")).toMatchObject([
      {
        id: "recovered-evidence",
        sequence: 1,
        type: "external.effect.ownership.lost",
      },
    ]);
  });

  it("bounds a non-settling reporter without retaining the queue or cursor", async () => {
    const { storage, eventSink, baseOptions } = createHarness();
    const authoritativeError = ownershipLoss();
    const reportedErrors: unknown[] = [];

    await expect(
      withDurableOwnershipLossEvidence(
        {
          ...baseOptions,
          evidenceTimeoutMs: 5,
          onEvidenceError: (error) => {
            reportedErrors.push(error);
            return new Promise<void>(() => undefined);
          },
        },
        () => Promise.reject(authoritativeError),
      ),
    ).rejects.toBe(authoritativeError);

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]).toBeInstanceOf(PersistenceConflictError);
    expect(storage.load()).toEqual({ revision: 0, value: null });
    expect(eventSink.readExecution("execution-1")).toEqual([]);

    storage.rejectWrites = false;
    await expect(
      withDurableOwnershipLossEvidence(baseOptions, () =>
        Promise.reject(authoritativeError),
      ),
    ).rejects.toBe(authoritativeError);

    expect(eventSink.readExecution("execution-1")).toMatchObject([
      {
        id: "recovered-evidence",
        sequence: 1,
        type: "external.effect.ownership.lost",
      },
    ]);

    const timeout = new OwnershipLossEvidenceTimeoutError("report", 5);
    expect(timeout.operation).toBe("report");
    expect(timeout.timeoutMs).toBe(5);
  });
});

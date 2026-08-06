import { describe, expect, it } from "vitest";
import {
  consumePersistenceProof,
  createPersistenceProofConsumptionIndex,
  hasConsumedPersistenceProof,
  InvalidPersistenceProofConsumptionError,
} from "../src/persistence-proof-consumption.js";

const firstConsumption = {
  proofId: "proof-1",
  uncertaintyRecordId: "uncertainty-1",
  providerOperationId: "provider-operation-1",
  consumedByAttemptId: "attempt-1",
  consumedAt: "2026-08-06T02:00:00.000Z",
} as const;

describe("persistence proof consumption index", () => {
  it("records immutable proof consumption and reports membership", () => {
    const initial = createPersistenceProofConsumptionIndex();
    const next = consumePersistenceProof(initial, firstConsumption);

    expect(initial.entries).toEqual([]);
    expect(next.entries).toEqual([firstConsumption]);
    expect(hasConsumedPersistenceProof(next, firstConsumption.proofId)).toBe(true);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.entries)).toBe(true);
    expect(Object.isFrozen(next.entries[0])).toBe(true);
  });

  it("rejects proof replay across uncertainty records after restoration", () => {
    const persisted = consumePersistenceProof(
      createPersistenceProofConsumptionIndex(),
      firstConsumption,
    );
    const restored = Object.freeze({
      entries: Object.freeze([...persisted.entries]),
    });

    expect(() => consumePersistenceProof(restored, {
      ...firstConsumption,
      uncertaintyRecordId: "uncertainty-2",
      consumedByAttemptId: "attempt-2",
      consumedAt: "2026-08-06T02:01:00.000Z",
    })).toThrowError("proofId has already been consumed");
  });

  it("fails closed for malformed identity or timestamps", () => {
    const index = createPersistenceProofConsumptionIndex();

    expect(() => consumePersistenceProof(index, {
      ...firstConsumption,
      proofId: " ",
    })).toThrow(InvalidPersistenceProofConsumptionError);

    expect(() => consumePersistenceProof(index, {
      ...firstConsumption,
      consumedAt: "not-a-timestamp",
    })).toThrow(InvalidPersistenceProofConsumptionError);

    expect(() => hasConsumedPersistenceProof(index, " ")).toThrow(
      InvalidPersistenceProofConsumptionError,
    );
  });
});

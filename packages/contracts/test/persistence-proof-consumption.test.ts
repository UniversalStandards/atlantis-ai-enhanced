import { describe, expect, it } from "vitest";
import {
  consumePersistenceProof,
  createPersistenceProofConsumptionIndex,
  hasConsumedPersistenceProof,
  InvalidPersistenceProofConsumptionError,
  restorePersistenceProofConsumptionIndex,
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

  it("validates restored durable state and rejects proof replay globally", () => {
    const persisted = consumePersistenceProof(
      createPersistenceProofConsumptionIndex(),
      firstConsumption,
    );
    const restored = restorePersistenceProofConsumptionIndex(
      JSON.parse(JSON.stringify(persisted)) as unknown,
    );

    expect(restored).toEqual(persisted);
    expect(Object.isFrozen(restored.entries[0])).toBe(true);
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

  it("rejects malformed or duplicate restored entries before replay checks", () => {
    expect(() => restorePersistenceProofConsumptionIndex({
      entries: [firstConsumption, {
        ...firstConsumption,
        uncertaintyRecordId: "uncertainty-2",
      }],
    })).toThrowError("proof consumption index contains a duplicate proofId");

    expect(() => restorePersistenceProofConsumptionIndex({
      entries: [{ ...firstConsumption, providerOperationId: " " }],
    })).toThrow(InvalidPersistenceProofConsumptionError);

    expect(() => restorePersistenceProofConsumptionIndex({
      entries: [{ ...firstConsumption, unexpected: true }],
    })).toThrow(InvalidPersistenceProofConsumptionError);
  });

  it("rejects sparse, custom, and accessor-backed restored arrays without invoking getters", () => {
    const sparse = new Array(1);
    expect(() => restorePersistenceProofConsumptionIndex({ entries: sparse }))
      .toThrowError("proof consumption index.entries must not contain sparse elements");

    const custom = [firstConsumption];
    Object.setPrototypeOf(custom, null);
    expect(() => restorePersistenceProofConsumptionIndex({ entries: custom }))
      .toThrowError("proof consumption index.entries must be a standard array");

    let getterCalls = 0;
    const accessorBacked = [firstConsumption];
    Object.defineProperty(accessorBacked, "0", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return firstConsumption;
      },
    });
    expect(() => restorePersistenceProofConsumptionIndex({
      entries: accessorBacked,
    })).toThrowError(
      "proof consumption index.entries[0] must be an enumerable data property",
    );
    expect(getterCalls).toBe(0);
  });
});

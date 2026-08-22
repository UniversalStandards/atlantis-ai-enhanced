import { describe, expect, it } from "vitest";

import {
  InMemoryRecoveryOwnershipStore,
  InvalidRecoveryOwnershipDurableAdapterRegistrationError,
  observeRecoveryOwnershipDurably,
  validateRecoveryOwnershipDurableAdapterRegistration,
  type RecoveryOwnershipDurableAdapterRegistration,
} from "../src/index.js";

function createStore() {
  let now = 1_000;
  let claim = 0;
  let token = 0;
  return {
    store: new InMemoryRecoveryOwnershipStore({
      nowEpochMs: () => now,
      createClaimId: () => `claim-${String(++claim)}`,
      createOwnershipToken: () => `token-${String(++token)}`,
      maxLeaseDurationMs: 1_000,
    }),
    setNow(value: number) {
      now = value;
    },
  };
}

describe("durable recovery ownership adapter boundary", () => {
  it("normalizes and freezes a valid adapter registration", () => {
    const registration = validateRecoveryOwnershipDurableAdapterRegistration({
      adapterId: "  durable-test-adapter  ",
      createHarness: async () => {
        throw new Error("not invoked by registration validation");
      },
    });

    expect(registration.adapterId).toBe("durable-test-adapter");
    expect(Object.isFrozen(registration)).toBe(true);
  });

  it("fails closed on blank adapter identity", () => {
    expect(() =>
      validateRecoveryOwnershipDurableAdapterRegistration({
        adapterId: "   ",
        createHarness: async () => {
          throw new Error("not invoked");
        },
      }),
    ).toThrow(InvalidRecoveryOwnershipDurableAdapterRegistrationError);
  });

  it("fails closed when the harness factory is not callable at runtime", () => {
    const invalid = {
      adapterId: "durable-test-adapter",
      createHarness: null,
    } as unknown as RecoveryOwnershipDurableAdapterRegistration;

    expect(() => validateRecoveryOwnershipDurableAdapterRegistration(invalid)).toThrow(
      "createHarness must be a function",
    );
  });

  it("observes ownership through the provider-neutral durable boundary", async () => {
    const { store } = createStore();
    const acquired = store.acquire({
      recoveryId: "recovery-1",
      executionId: "execution-1",
      ownerId: "worker-1",
      leaseDurationMs: 100,
    });
    if (acquired.status !== "acquired") throw new Error("expected acquisition");

    await expect(
      observeRecoveryOwnershipDurably(store, "recovery-1", "execution-1"),
    ).resolves.toMatchObject({
      recoveryId: "recovery-1",
      executionId: "execution-1",
      result: {
        status: "owned",
        ownerId: "worker-1",
        fence: 1,
      },
    });
  });

  it("fails closed on blank durable-observation identity", async () => {
    const { store } = createStore();

    await expect(observeRecoveryOwnershipDurably(store, " ", "execution-1")).rejects.toThrow(
      InvalidRecoveryOwnershipDurableAdapterRegistrationError,
    );
    await expect(observeRecoveryOwnershipDurably(store, "recovery-1", " ")).rejects.toThrow(
      InvalidRecoveryOwnershipDurableAdapterRegistrationError,
    );
  });
});

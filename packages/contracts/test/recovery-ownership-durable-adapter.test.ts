import { describe, expect, it } from "vitest";

import {
  InMemoryRecoveryOwnershipStore,
  InvalidRecoveryOwnershipDurableAdapterRegistrationError,
  authorizeRecoveryOwnershipDurableAdapterRegistration,
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

function authorization(candidateId = "durable-test-adapter") {
  return {
    candidateId,
    productSubstrate: "approved non-production substrate",
    versionServiceMode: "approved exact version/service mode",
    driverSdk: "approved exact driver and version",
    authoritativeTopology: "approved authoritative topology",
    consistencyMode: "approved consistency semantics",
    transactionPrimitive: "approved atomic primitive",
    independentClientTopology: "approved independent-client topology",
    restartBoundary: "approved restart boundary",
    credentialClass: "approved non-secret credential class",
    networkBoundary: "approved non-secret network boundary",
    featureGate: "disabled by default",
    rollbackDisable: "remove registration and disable feature gate",
    semanticMappingEvidence: "approved semantic mapping evidence",
    errorMappingEvidence: "approved error mapping evidence",
    failureInjectionPlan: "approved deterministic failure-injection plan",
    decisionEvidence: "approved architecture decision evidence",
    approvals: [
      { role: "architecture", approvedBy: "architecture-reviewer", approvedAt: "2026-08-28T16:00:00.000Z" },
      { role: "operations", approvedBy: "operations-reviewer", approvedAt: "2026-08-28T16:01:00.000Z" },
    ],
  } as const;
}

function registration(adapterId = "durable-test-adapter"): RecoveryOwnershipDurableAdapterRegistration {
  return {
    adapterId,
    createHarness: async () => {
      throw new Error("not invoked by registration validation");
    },
  };
}

describe("durable recovery ownership adapter boundary", () => {
  it("normalizes and freezes a valid adapter registration", () => {
    const valid = registration("  durable-test-adapter  ");
    const normalized = validateRecoveryOwnershipDurableAdapterRegistration(valid);

    expect(normalized.adapterId).toBe("durable-test-adapter");
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it("binds an admitted durable adapter to exactly its approved candidate identity", () => {
    const admitted = authorizeRecoveryOwnershipDurableAdapterRegistration(
      registration(),
      authorization(),
    );

    expect(admitted.registration.adapterId).toBe("durable-test-adapter");
    expect(admitted.authorization.candidateId).toBe("durable-test-adapter");
    expect(Object.isFrozen(admitted)).toBe(true);
  });

  it("rejects replaying an approved candidate record onto a different adapter", () => {
    expect(() =>
      authorizeRecoveryOwnershipDurableAdapterRegistration(
        registration("different-adapter"),
        authorization("approved-adapter"),
      ),
    ).toThrow("adapterId must exactly match the approved durable-persistence candidateId");
  });

  it("rejects undeclared registration fields instead of preserving secret-bearing metadata", () => {
    const invalid = {
      ...registration(),
      connectionString: "postgres://secret-bearing-value",
    };

    expect(() => validateRecoveryOwnershipDurableAdapterRegistration(invalid)).toThrow(
      "registration contains unsupported field: connectionString",
    );
  });

  it("fails closed on malformed runtime registration objects", () => {
    expect(() => validateRecoveryOwnershipDurableAdapterRegistration(null)).toThrow(
      "registration must be an object record",
    );
    expect(() => validateRecoveryOwnershipDurableAdapterRegistration([])).toThrow(
      "registration must be an object record",
    );
  });

  it("does not admit registration extensions through candidate authorization", () => {
    const extended = {
      ...registration(),
      credential: "secret-bearing-runtime-value",
    };

    expect(() =>
      authorizeRecoveryOwnershipDurableAdapterRegistration(extended, authorization()),
    ).toThrow("registration contains unsupported field: credential");
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

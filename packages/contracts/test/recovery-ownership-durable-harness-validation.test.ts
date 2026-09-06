import { describe, expect, it } from "vitest";

import {
  InvalidRecoveryOwnershipDurableAdapterRegistrationError,
  validateRecoveryOwnershipDurableAdapterHarness,
  type RecoveryOwnershipDurableAdapterHarness,
} from "../src/index.js";

function validHarness(): RecoveryOwnershipDurableAdapterHarness {
  return {
    capabilities: {
      independentClientVisibility: true,
      restartPersistence: true,
      atomicAcquire: true,
      atomicRenew: true,
      atomicRelease: true,
      monotonicFencing: true,
      authoritativeReadback: true,
      failureInjection: ["pre-commit", "post-commit-pre-ack"],
    },
    failureInjection: {
      arm() {},
      clear() {},
    },
    createClient() {
      throw new Error("not invoked by harness validation");
    },
    restart() {
      throw new Error("not invoked by harness validation");
    },
    setNow() {},
  };
}

describe("durable recovery ownership harness validation", () => {
  it("accepts and freezes a complete provider-neutral harness declaration", () => {
    const validated = validateRecoveryOwnershipDurableAdapterHarness(validHarness());
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.capabilities)).toBe(true);
    expect(Object.isFrozen(validated.capabilities.failureInjection)).toBe(true);
    expect(Object.isFrozen(validated.failureInjection)).toBe(true);
  });

  it("rejects a missing required durability capability", () => {
    const harness = validHarness() as unknown as {
      capabilities: Record<string, unknown>;
    };
    harness.capabilities.restartPersistence = false;
    expect(() =>
      validateRecoveryOwnershipDurableAdapterHarness(
        harness as unknown as RecoveryOwnershipDurableAdapterHarness,
      ),
    ).toThrow("capabilities.restartPersistence must be true");
  });

  it("rejects incomplete or substituted failure-injection coverage", () => {
    const harness = validHarness() as unknown as {
      capabilities: { failureInjection: string[] };
    };
    harness.capabilities.failureInjection = ["pre-commit"];
    expect(() =>
      validateRecoveryOwnershipDurableAdapterHarness(
        harness as unknown as RecoveryOwnershipDurableAdapterHarness,
      ),
    ).toThrow("must contain exactly pre-commit and post-commit-pre-ack");
  });

  it("rejects duplicate failure-injection declarations", () => {
    const harness = validHarness() as unknown as {
      capabilities: { failureInjection: string[] };
    };
    harness.capabilities.failureInjection = [
      "pre-commit",
      "post-commit-pre-ack",
      "pre-commit",
    ];
    expect(() =>
      validateRecoveryOwnershipDurableAdapterHarness(
        harness as unknown as RecoveryOwnershipDurableAdapterHarness,
      ),
    ).toThrow("must contain exactly pre-commit and post-commit-pre-ack");
  });

  it("rejects non-callable independent-client or restart factories", () => {
    const missingClient = { ...validHarness(), createClient: null } as unknown as RecoveryOwnershipDurableAdapterHarness;
    expect(() => validateRecoveryOwnershipDurableAdapterHarness(missingClient)).toThrow(
      "createClient must be a function",
    );

    const missingRestart = { ...validHarness(), restart: null } as unknown as RecoveryOwnershipDurableAdapterHarness;
    expect(() => validateRecoveryOwnershipDurableAdapterHarness(missingRestart)).toThrow(
      "restart must be a function",
    );
  });

  it("rejects non-callable deterministic time and failure-injection controls", () => {
    const missingClock = { ...validHarness(), setNow: null } as unknown as RecoveryOwnershipDurableAdapterHarness;
    expect(() => validateRecoveryOwnershipDurableAdapterHarness(missingClock)).toThrow(
      "setNow must be a function",
    );

    const missingArm = {
      ...validHarness(),
      failureInjection: { arm: null, clear() {} },
    } as unknown as RecoveryOwnershipDurableAdapterHarness;
    expect(() => validateRecoveryOwnershipDurableAdapterHarness(missingArm)).toThrow(
      InvalidRecoveryOwnershipDurableAdapterRegistrationError,
    );
  });
});

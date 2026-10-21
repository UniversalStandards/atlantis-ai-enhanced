import {
  InvalidRecoveryOwnershipDurableAdapterRegistrationError,
  type RecoveryOwnershipDurableAdapterCapabilities,
  type RecoveryOwnershipDurableAdapterHarness,
  type RecoveryOwnershipFailurePoint,
} from "./recovery-ownership-durable-adapter.js";

const requiredFailurePoints: readonly RecoveryOwnershipFailurePoint[] = Object.freeze([
  "pre-commit",
  "post-commit-pre-ack",
]);

function requireFunction(field: string, value: unknown): void {
  if (typeof value !== "function") {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      `${field} must be a function`,
    );
  }
}

/**
 * Validates a concrete durable ownership harness before conformance execution.
 * Capability declarations are prerequisites only; they are never durability proof.
 */
export function validateRecoveryOwnershipDurableAdapterHarness(
  harness: RecoveryOwnershipDurableAdapterHarness,
): Readonly<RecoveryOwnershipDurableAdapterHarness> {
  if (harness === null || typeof harness !== "object") {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      "durable adapter harness must be an object",
    );
  }

  const capabilities = harness.capabilities;
  if (capabilities === null || typeof capabilities !== "object") {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      "capabilities must be an object",
    );
  }

  const requiredTrueCapabilities: ReadonlyArray<keyof Omit<
    RecoveryOwnershipDurableAdapterCapabilities,
    "failureInjection"
  >> = [
    "independentClientVisibility",
    "restartPersistence",
    "atomicAcquire",
    "atomicRenew",
    "atomicRelease",
    "monotonicFencing",
    "authoritativeReadback",
  ];

  for (const capability of requiredTrueCapabilities) {
    if (capabilities[capability] !== true) {
      throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
        `capabilities.${capability} must be true`,
      );
    }
  }

  if (!Array.isArray(capabilities.failureInjection)) {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      "capabilities.failureInjection must be an array",
    );
  }
  const failurePoints = new Set<unknown>(capabilities.failureInjection);
  if (
    capabilities.failureInjection.length !== requiredFailurePoints.length ||
    failurePoints.size !== requiredFailurePoints.length ||
    requiredFailurePoints.some((point) => !failurePoints.has(point))
  ) {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      "capabilities.failureInjection must contain exactly pre-commit and post-commit-pre-ack",
    );
  }

  requireFunction("createClient", harness.createClient);
  requireFunction("restart", harness.restart);
  requireFunction("setNow", harness.setNow);
  if (harness.failureInjection === null || typeof harness.failureInjection !== "object") {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      "failureInjection must be an object",
    );
  }
  requireFunction("failureInjection.arm", harness.failureInjection.arm);
  requireFunction("failureInjection.clear", harness.failureInjection.clear);

  return Object.freeze({
    ...harness,
    capabilities: Object.freeze({
      ...capabilities,
      failureInjection: Object.freeze([...requiredFailurePoints]),
    }),
    failureInjection: Object.freeze({ ...harness.failureInjection }),
  });
}

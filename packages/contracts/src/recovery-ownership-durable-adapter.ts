import type {
  RecoveryOwnershipAcquireRequest,
  RecoveryOwnershipAcquireResult,
  RecoveryOwnershipStore,
} from "./recovery-ownership-store.js";
import type { RecoveryOwnershipLeaseEvidence } from "./recovery-ownership-lease-evidence.js";

export type RecoveryOwnershipMutationKind = "acquire" | "renew" | "release";
export type RecoveryOwnershipFailurePoint = "pre-commit" | "post-commit-pre-ack";

export interface RecoveryOwnershipDurableAdapterCapabilities {
  readonly independentClientVisibility: true;
  readonly restartPersistence: true;
  readonly atomicAcquire: true;
  readonly atomicRenew: true;
  readonly atomicRelease: true;
  readonly monotonicFencing: true;
  readonly authoritativeReadback: true;
  readonly failureInjection: readonly RecoveryOwnershipFailurePoint[];
}

export interface RecoveryOwnershipFailureInjectionController {
  arm(
    mutation: RecoveryOwnershipMutationKind,
    point: RecoveryOwnershipFailurePoint,
  ): void | Promise<void>;
  clear(): void | Promise<void>;
}

/**
 * Factory supplied by a concrete durable adapter conformance registration.
 * Each client must be independently constructed against the same durable state;
 * `restart` must discard the supplied client and construct a fresh one.
 */
export interface RecoveryOwnershipDurableAdapterHarness {
  readonly capabilities: RecoveryOwnershipDurableAdapterCapabilities;
  readonly failureInjection: RecoveryOwnershipFailureInjectionController;
  createClient(clientId: string): RecoveryOwnershipStore | Promise<RecoveryOwnershipStore>;
  restart(clientId: string): RecoveryOwnershipStore | Promise<RecoveryOwnershipStore>;
  setNow(epochMs: number): void | Promise<void>;
}

export interface RecoveryOwnershipDurableAdapterRegistration {
  readonly adapterId: string;
  createHarness():
    | RecoveryOwnershipDurableAdapterHarness
    | Promise<RecoveryOwnershipDurableAdapterHarness>;
}

export class InvalidRecoveryOwnershipDurableAdapterRegistrationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRecoveryOwnershipDurableAdapterRegistrationError";
  }
}

function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      `${field} must be a non-blank string`,
    );
  }
  return value.trim();
}

export function validateRecoveryOwnershipDurableAdapterRegistration(
  registration: RecoveryOwnershipDurableAdapterRegistration,
): Readonly<RecoveryOwnershipDurableAdapterRegistration> {
  requireNonBlank("adapterId", registration.adapterId);
  if (typeof registration.createHarness !== "function") {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      "createHarness must be a function",
    );
  }
  return Object.freeze({ ...registration, adapterId: registration.adapterId.trim() });
}

export interface RecoveryOwnershipDurableObservation {
  readonly recoveryId: string;
  readonly executionId: string;
  readonly result:
    | RecoveryOwnershipAcquireResult
    | Readonly<{ status: "unclaimed"; fence: number }>;
}

export async function observeRecoveryOwnershipDurably(
  store: RecoveryOwnershipStore,
  recoveryId: string,
  executionId: string,
): Promise<Readonly<RecoveryOwnershipDurableObservation>> {
  requireNonBlank("recoveryId", recoveryId);
  requireNonBlank("executionId", executionId);
  const result = await store.observe(recoveryId, executionId);
  return Object.freeze({ recoveryId, executionId, result });
}

// These aliases make conformance adapters depend only on the provider-neutral
// ownership contract, never on a database/client SDK.
export type DurableRecoveryOwnershipAcquireRequest = RecoveryOwnershipAcquireRequest;
export type DurableRecoveryOwnershipLeaseEvidence = RecoveryOwnershipLeaseEvidence;

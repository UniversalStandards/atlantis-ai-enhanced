import type {
  RecoveryOwnershipAcquireRequest,
  RecoveryOwnershipAcquireResult,
  RecoveryOwnershipStore,
} from "./recovery-ownership-store.js";
import type { RecoveryOwnershipLeaseEvidence } from "./recovery-ownership-lease-evidence.js";
import {
  validateDurablePersistenceCandidateAuthorization,
  type DurablePersistenceCandidateAuthorization,
} from "./durable-persistence-candidate-authorization.js";

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

export interface AuthorizedRecoveryOwnershipDurableAdapterRegistration {
  readonly registration: Readonly<RecoveryOwnershipDurableAdapterRegistration>;
  readonly authorization: Readonly<DurablePersistenceCandidateAuthorization>;
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

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      "registration must be an object record",
    );
  }
  return value as Record<string, unknown>;
}

function rejectUnsupportedRegistrationFields(record: Record<string, unknown>): void {
  const allowed = new Set(["adapterId", "createHarness"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
        `registration contains unsupported field: ${key}`,
      );
    }
  }
}

export function validateRecoveryOwnershipDurableAdapterRegistration(
  registration: unknown,
): Readonly<RecoveryOwnershipDurableAdapterRegistration> {
  const record = requireRecord(registration);
  rejectUnsupportedRegistrationFields(record);
  const adapterId = requireNonBlank("adapterId", record.adapterId);
  if (typeof record.createHarness !== "function") {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      "createHarness must be a function",
    );
  }
  return Object.freeze({
    adapterId,
    createHarness: record.createHarness as RecoveryOwnershipDurableAdapterRegistration["createHarness"],
  });
}

/**
 * Admission boundary for a concrete durable adapter after architecture/operations
 * approval. The adapter identity must be exactly the approved candidate identity,
 * preventing a valid decision record from being replayed onto another adapter.
 * This still does not authorize production enablement or prove conformance.
 */
export function authorizeRecoveryOwnershipDurableAdapterRegistration(
  registration: unknown,
  authorization: unknown,
): Readonly<AuthorizedRecoveryOwnershipDurableAdapterRegistration> {
  const validatedRegistration = validateRecoveryOwnershipDurableAdapterRegistration(registration);
  const validatedAuthorization = validateDurablePersistenceCandidateAuthorization(authorization);
  if (validatedRegistration.adapterId !== validatedAuthorization.candidateId) {
    throw new InvalidRecoveryOwnershipDurableAdapterRegistrationError(
      "adapterId must exactly match the approved durable-persistence candidateId",
    );
  }
  return Object.freeze({
    registration: validatedRegistration,
    authorization: validatedAuthorization,
  });
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

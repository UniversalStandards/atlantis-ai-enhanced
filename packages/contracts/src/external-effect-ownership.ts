import {
  ExternalEffectConflictError,
  InvalidExternalEffectError,
  normalizeExternalEffectIdentity,
  reconcileExternalEffect,
  type ExternalEffectIdentity,
  type ExternalEffectReceipt,
} from "./external-effect.js";

export interface ExternalEffectOwnershipRequest {
  readonly ownerId: string;
  readonly leaseDurationMs: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ExternalEffectRenewalRequest {
  readonly leaseDurationMs: number;
}

export interface ExternalEffectClaim extends ExternalEffectIdentity {
  readonly claimToken: string;
  readonly ownerId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly generation: number;
}

export type ExternalEffectReleaseReason =
  | "pre_execution_failure"
  | "cancelled"
  | "timed_out"
  | "budget_exceeded"
  | "approval_wait"
  | "rejected";

export type ExternalEffectOwnershipRejectedReason =
  | "invalid_owner"
  | "invalid_lease_duration"
  | "invalid_metadata"
  | "generation_exhausted"
  | "claim_token_unavailable";

export type ExternalEffectOwnershipObservation =
  | Readonly<{
      status: "unclaimed";
      identity: ExternalEffectIdentity;
      generation: number;
    }>
  | Readonly<{
      status: "owned";
      identity: ExternalEffectIdentity;
      ownerId: string;
      acquiredAt: string;
      expiresAt: string;
      generation: number;
    }>
  | Readonly<{
      status: "committed";
      identity: ExternalEffectIdentity;
      receipt: ExternalEffectReceipt;
      generation: number;
    }>;

export type ExternalEffectOwnershipResult =
  | Readonly<{
      status: "acquired";
      identity: ExternalEffectIdentity;
      claim: ExternalEffectClaim;
      acquisition: "new" | "released" | "expired";
    }>
  | Readonly<{
      status: "committed";
      identity: ExternalEffectIdentity;
      receipt: ExternalEffectReceipt;
      generation: number;
    }>
  | Readonly<{
      status: "owned";
      identity: ExternalEffectIdentity;
      ownerId: string;
      acquiredAt: string;
      expiresAt: string;
      generation: number;
    }>
  | Readonly<{
      status: "rejected";
      identity: ExternalEffectIdentity;
      reason: ExternalEffectOwnershipRejectedReason;
      message: string;
    }>;

export interface ExternalEffectOwnershipStore {
  acquire(
    identity: ExternalEffectIdentity,
    request: ExternalEffectOwnershipRequest,
  ): ExternalEffectOwnershipResult | Promise<ExternalEffectOwnershipResult>;

  renew(
    claim: ExternalEffectClaim,
    request: ExternalEffectRenewalRequest,
  ): ExternalEffectClaim | Promise<ExternalEffectClaim>;

  commit(
    claim: ExternalEffectClaim,
    receipt: ExternalEffectReceipt,
  ): ExternalEffectReceipt | Promise<ExternalEffectReceipt>;

  release(
    claim: ExternalEffectClaim,
    reason: ExternalEffectReleaseReason,
  ): void | Promise<void>;

  observe(
    identity: ExternalEffectIdentity,
  ): ExternalEffectOwnershipObservation | Promise<ExternalEffectOwnershipObservation>;
}

export class ExternalEffectOwnershipConflictError extends ExternalEffectConflictError {
  public constructor(message: string) {
    super(message);
    this.name = "ExternalEffectOwnershipConflictError";
  }
}

export class InvalidExternalEffectOwnershipError extends InvalidExternalEffectError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidExternalEffectOwnershipError";
  }
}

export interface InMemoryExternalEffectOwnershipStoreOptions {
  readonly now: () => string;
  readonly createClaimToken: () => string;
  readonly maxLeaseDurationMs: number;
}

interface OwnershipState {
  readonly identity: ExternalEffectIdentity;
  generation: number;
  claim?: ExternalEffectClaim;
  receipt?: ExternalEffectReceipt;
}

interface NormalizedOwnershipRequest {
  readonly ownerId: string;
  readonly leaseDurationMs: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidExternalEffectOwnershipError(
      `${field} must be a non-blank string`,
    );
  }
  return value.trim();
}

function requirePositiveSafeInteger(field: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new InvalidExternalEffectOwnershipError(
      `${field} must be a positive safe integer`,
    );
  }
  return value as number;
}

function requireCanonicalTimestamp(field: string, value: unknown): string {
  const timestamp = requireNonBlank(field, value);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new InvalidExternalEffectOwnershipError(
      `${field} must be a canonical ISO timestamp`,
    );
  }
  return timestamp;
}

function normalizeMetadata(
  metadata: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new InvalidExternalEffectOwnershipError(
      "ownership request metadata must be a plain string record",
    );
  }
  const prototype = Object.getPrototypeOf(metadata);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidExternalEffectOwnershipError(
      "ownership request metadata must be a plain string record",
    );
  }

  const normalized: Record<string, string> = {};
  for (const key of Reflect.ownKeys(metadata)) {
    if (typeof key !== "string") {
      throw new InvalidExternalEffectOwnershipError(
        "ownership request metadata must not contain symbol keys",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(metadata, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new InvalidExternalEffectOwnershipError(
        `ownership request metadata.${key} must be an enumerable data property`,
      );
    }
    const normalizedKey = requireNonBlank(
      "ownership request metadata key",
      key,
    );
    if (Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) {
      throw new InvalidExternalEffectOwnershipError(
        `ownership request metadata contains duplicate normalized key ${normalizedKey}`,
      );
    }
    normalized[normalizedKey] = requireNonBlank(
      `ownership request metadata.${normalizedKey}`,
      descriptor.value,
    );
  }
  return Object.freeze(normalized);
}

function identityKey(identity: ExternalEffectIdentity): string {
  return JSON.stringify([
    identity.idempotencyKey,
    identity.executionId,
    identity.stepId,
    identity.effectType,
  ]);
}

function assertIdentityMatch(
  expected: ExternalEffectIdentity,
  observed: ExternalEffectIdentity,
  subject: string,
): void {
  const fields: readonly (keyof ExternalEffectIdentity)[] = [
    "idempotencyKey",
    "executionId",
    "stepId",
    "effectType",
  ];
  for (const field of fields) {
    if (expected[field] !== observed[field]) {
      throw new ExternalEffectOwnershipConflictError(
        `${subject} ${field} does not match the durable ownership identity`,
      );
    }
  }
}

function normalizeClaim(claim: ExternalEffectClaim): ExternalEffectClaim {
  const identity = normalizeExternalEffectIdentity(claim);
  const generation = requirePositiveSafeInteger(
    "claim.generation",
    claim.generation,
  );
  const acquiredAt = requireCanonicalTimestamp(
    "claim.acquiredAt",
    claim.acquiredAt,
  );
  const expiresAt = requireCanonicalTimestamp(
    "claim.expiresAt",
    claim.expiresAt,
  );
  if (Date.parse(expiresAt) <= Date.parse(acquiredAt)) {
    throw new InvalidExternalEffectOwnershipError(
      "claim.expiresAt must be later than claim.acquiredAt",
    );
  }
  return Object.freeze({
    ...identity,
    claimToken: requireNonBlank("claim.claimToken", claim.claimToken),
    ownerId: requireNonBlank("claim.ownerId", claim.ownerId),
    acquiredAt,
    expiresAt,
    generation,
  });
}

function claimsMatch(
  left: ExternalEffectClaim,
  right: ExternalEffectClaim,
): boolean {
  return (
    left.claimToken === right.claimToken &&
    left.ownerId === right.ownerId &&
    left.acquiredAt === right.acquiredAt &&
    left.expiresAt === right.expiresAt &&
    left.generation === right.generation &&
    left.idempotencyKey === right.idempotencyKey &&
    left.executionId === right.executionId &&
    left.stepId === right.stepId &&
    left.effectType === right.effectType
  );
}

function ownedResult(
  identity: ExternalEffectIdentity,
  claim: ExternalEffectClaim,
): Extract<ExternalEffectOwnershipResult, { status: "owned" }> {
  return Object.freeze({
    status: "owned",
    identity,
    ownerId: claim.ownerId,
    acquiredAt: claim.acquiredAt,
    expiresAt: claim.expiresAt,
    generation: claim.generation,
  });
}

function ownedObservation(
  identity: ExternalEffectIdentity,
  claim: ExternalEffectClaim,
): Extract<ExternalEffectOwnershipObservation, { status: "owned" }> {
  return Object.freeze({
    status: "owned",
    identity,
    ownerId: claim.ownerId,
    acquiredAt: claim.acquiredAt,
    expiresAt: claim.expiresAt,
    generation: claim.generation,
  });
}

/**
 * Deterministic, process-local reference implementation for contract tests.
 * It demonstrates required semantics but is not durable production persistence.
 */
export class InMemoryExternalEffectOwnershipStore
  implements ExternalEffectOwnershipStore
{
  readonly #states = new Map<string, OwnershipState>();
  readonly #issuedTokens = new Set<string>();
  readonly #now: () => string;
  readonly #createClaimToken: () => string;
  readonly #maxLeaseDurationMs: number;

  public constructor(options: InMemoryExternalEffectOwnershipStoreOptions) {
    this.#now = options.now;
    this.#createClaimToken = options.createClaimToken;
    this.#maxLeaseDurationMs = requirePositiveSafeInteger(
      "maxLeaseDurationMs",
      options.maxLeaseDurationMs,
    );
  }

  public acquire(
    rawIdentity: ExternalEffectIdentity,
    request: ExternalEffectOwnershipRequest,
  ): ExternalEffectOwnershipResult {
    const identity = normalizeExternalEffectIdentity(rawIdentity);
    const normalized = this.#normalizeAcquisitionRequest(identity, request);
    if (normalized.status === "rejected") {
      return normalized;
    }

    const now = this.#readNow();
    const key = identityKey(identity);
    const existing = this.#states.get(key);

    if (existing?.receipt !== undefined) {
      const receipt = this.#normalizeReceipt(identity, existing.receipt);
      return Object.freeze({
        status: "committed",
        identity,
        receipt,
        generation: existing.generation,
      });
    }

    if (
      existing?.claim !== undefined &&
      Date.parse(existing.claim.expiresAt) > now.epochMs
    ) {
      return ownedResult(identity, existing.claim);
    }

    const priorGeneration = existing?.generation ?? 0;
    if (priorGeneration >= Number.MAX_SAFE_INTEGER) {
      return Object.freeze({
        status: "rejected",
        identity,
        reason: "generation_exhausted",
        message: "External-effect ownership fencing generation is exhausted",
      });
    }

    let claimToken: string;
    try {
      claimToken = requireNonBlank(
        "claim token",
        this.#createClaimToken(),
      );
    } catch (error) {
      return Object.freeze({
        status: "rejected",
        identity,
        reason: "claim_token_unavailable",
        message:
          error instanceof Error ? error.message : "Claim token generation failed",
      });
    }
    if (this.#issuedTokens.has(claimToken)) {
      return Object.freeze({
        status: "rejected",
        identity,
        reason: "claim_token_unavailable",
        message: "Claim token generator returned a previously issued token",
      });
    }

    const expiry = this.#expiryFrom(
      now.epochMs,
      normalized.request.leaseDurationMs,
    );
    const acquisition =
      existing?.claim !== undefined
        ? "expired"
        : priorGeneration === 0
          ? "new"
          : "released";
    const claim = Object.freeze({
      ...identity,
      claimToken,
      ownerId: normalized.request.ownerId,
      acquiredAt: now.timestamp,
      expiresAt: expiry,
      generation: priorGeneration + 1,
    });
    this.#issuedTokens.add(claimToken);
    this.#states.set(key, {
      identity,
      generation: claim.generation,
      claim,
    });

    return Object.freeze({
      status: "acquired",
      identity,
      claim,
      acquisition,
    });
  }

  public renew(
    rawClaim: ExternalEffectClaim,
    request: ExternalEffectRenewalRequest,
  ): ExternalEffectClaim {
    const claim = normalizeClaim(rawClaim);
    const leaseDurationMs = this.#normalizeRenewalRequest(request);
    const now = this.#readNow();
    const state = this.#requireStateForClaim(claim, "renew");
    const current = state.claim;
    if (current === undefined || !claimsMatch(current, claim)) {
      throw new ExternalEffectOwnershipConflictError(
        "Only the exact live external-effect claim may be renewed",
      );
    }
    if (Date.parse(current.expiresAt) <= now.epochMs) {
      throw new ExternalEffectOwnershipConflictError(
        "An expired external-effect claim cannot be renewed",
      );
    }

    const candidateExpiry = this.#expiryFrom(now.epochMs, leaseDurationMs);
    if (Date.parse(candidateExpiry) <= Date.parse(current.expiresAt)) {
      return current;
    }

    const renewed = Object.freeze({
      ...current,
      expiresAt: candidateExpiry,
    });
    state.claim = renewed;
    return renewed;
  }

  public commit(
    rawClaim: ExternalEffectClaim,
    rawReceipt: ExternalEffectReceipt,
  ): ExternalEffectReceipt {
    const claim = normalizeClaim(rawClaim);
    const now = this.#readNow();
    const state = this.#requireStateForClaim(claim, "commit");
    const current = state.claim;
    if (current === undefined || !claimsMatch(current, claim)) {
      throw new ExternalEffectOwnershipConflictError(
        "Only the exact live external-effect claim may commit a receipt",
      );
    }
    if (Date.parse(current.expiresAt) <= now.epochMs) {
      throw new ExternalEffectOwnershipConflictError(
        "An expired external-effect claim cannot commit a receipt",
      );
    }

    const receipt = this.#normalizeReceipt(state.identity, rawReceipt);
    state.receipt = receipt;
    delete state.claim;
    return receipt;
  }

  public release(
    rawClaim: ExternalEffectClaim,
    reason: ExternalEffectReleaseReason,
  ): void {
    if (!isReleaseReason(reason)) {
      throw new InvalidExternalEffectOwnershipError(
        "release reason is not supported",
      );
    }
    const claim = normalizeClaim(rawClaim);
    const now = this.#readNow();
    const state = this.#states.get(identityKey(claim));
    if (state === undefined || state.receipt !== undefined) {
      return;
    }
    assertIdentityMatch(state.identity, claim, "External-effect claim");
    const current = state.claim;
    if (current === undefined || !claimsMatch(current, claim)) {
      return;
    }
    if (Date.parse(current.expiresAt) <= now.epochMs) {
      return;
    }
    delete state.claim;
  }

  public observe(
    rawIdentity: ExternalEffectIdentity,
  ): ExternalEffectOwnershipObservation {
    const identity = normalizeExternalEffectIdentity(rawIdentity);
    const now = this.#readNow();
    const state = this.#states.get(identityKey(identity));
    if (state?.receipt !== undefined) {
      return Object.freeze({
        status: "committed",
        identity,
        receipt: this.#normalizeReceipt(identity, state.receipt),
        generation: state.generation,
      });
    }
    if (
      state?.claim !== undefined &&
      Date.parse(state.claim.expiresAt) > now.epochMs
    ) {
      return ownedObservation(identity, state.claim);
    }
    return Object.freeze({
      status: "unclaimed",
      identity,
      generation: state?.generation ?? 0,
    });
  }

  #normalizeAcquisitionRequest(
    identity: ExternalEffectIdentity,
    request: ExternalEffectOwnershipRequest,
  ):
    | Readonly<{
        status: "accepted";
        request: NormalizedOwnershipRequest;
      }>
    | Extract<ExternalEffectOwnershipResult, { status: "rejected" }> {
    let ownerId: string;
    try {
      ownerId = requireNonBlank("ownerId", request.ownerId);
    } catch (error) {
      return Object.freeze({
        status: "rejected",
        identity,
        reason: "invalid_owner",
        message:
          error instanceof Error ? error.message : "ownerId is invalid",
      });
    }

    let leaseDurationMs: number;
    try {
      leaseDurationMs = requirePositiveSafeInteger(
        "leaseDurationMs",
        request.leaseDurationMs,
      );
      if (leaseDurationMs > this.#maxLeaseDurationMs) {
        throw new InvalidExternalEffectOwnershipError(
          `leaseDurationMs exceeds configured maximum ${String(
            this.#maxLeaseDurationMs,
          )}`,
        );
      }
    } catch (error) {
      return Object.freeze({
        status: "rejected",
        identity,
        reason: "invalid_lease_duration",
        message:
          error instanceof Error
            ? error.message
            : "leaseDurationMs is invalid",
      });
    }

    if (request.metadata === undefined) {
      return Object.freeze({
        status: "accepted",
        request: Object.freeze({ ownerId, leaseDurationMs }),
      });
    }

    try {
      const metadata = normalizeMetadata(request.metadata);
      return Object.freeze({
        status: "accepted",
        request: Object.freeze({ ownerId, leaseDurationMs, metadata }),
      });
    } catch (error) {
      return Object.freeze({
        status: "rejected",
        identity,
        reason: "invalid_metadata",
        message:
          error instanceof Error ? error.message : "metadata is invalid",
      });
    }
  }

  #normalizeRenewalRequest(request: ExternalEffectRenewalRequest): number {
    const leaseDurationMs = requirePositiveSafeInteger(
      "leaseDurationMs",
      request.leaseDurationMs,
    );
    if (leaseDurationMs > this.#maxLeaseDurationMs) {
      throw new InvalidExternalEffectOwnershipError(
        `leaseDurationMs exceeds configured maximum ${String(
          this.#maxLeaseDurationMs,
        )}`,
      );
    }
    return leaseDurationMs;
  }

  #normalizeReceipt(
    identity: ExternalEffectIdentity,
    receipt: ExternalEffectReceipt,
  ): ExternalEffectReceipt {
    const reconciliation = reconcileExternalEffect(identity, receipt);
    if (reconciliation.status !== "committed") {
      throw new ExternalEffectOwnershipConflictError(
        "External-effect receipt unexpectedly failed reconciliation",
      );
    }
    return reconciliation.receipt;
  }

  #readNow(): Readonly<{ timestamp: string; epochMs: number }> {
    const timestamp = requireCanonicalTimestamp(
      "authoritative time",
      this.#now(),
    );
    return Object.freeze({
      timestamp,
      epochMs: Date.parse(timestamp),
    });
  }

  #expiryFrom(epochMs: number, leaseDurationMs: number): string {
    const expiryMs = epochMs + leaseDurationMs;
    if (!Number.isSafeInteger(expiryMs)) {
      throw new InvalidExternalEffectOwnershipError(
        "lease expiry exceeds the safe timestamp range",
      );
    }
    try {
      return new Date(expiryMs).toISOString();
    } catch {
      throw new InvalidExternalEffectOwnershipError(
        "lease expiry cannot be represented as a canonical timestamp",
      );
    }
  }

  #requireStateForClaim(
    claim: ExternalEffectClaim,
    operation: "renew" | "commit",
  ): OwnershipState {
    const state = this.#states.get(identityKey(claim));
    if (state === undefined) {
      throw new ExternalEffectOwnershipConflictError(
        `External-effect claim cannot ${operation} because no durable ownership state exists`,
      );
    }
    assertIdentityMatch(
      state.identity,
      claim,
      "External-effect claim",
    );
    if (state.receipt !== undefined) {
      throw new ExternalEffectOwnershipConflictError(
        `External-effect claim cannot ${operation} after a receipt is committed`,
      );
    }
    return state;
  }
}

function isReleaseReason(
  value: string,
): value is ExternalEffectReleaseReason {
  return (
    value === "pre_execution_failure" ||
    value === "cancelled" ||
    value === "timed_out" ||
    value === "budget_exceeded" ||
    value === "approval_wait" ||
    value === "rejected"
  );
}

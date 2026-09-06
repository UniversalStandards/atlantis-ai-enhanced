import {
  verifyRecoveryOwnershipLeaseEvidence,
  type ExpectedRecoveryOwnershipIdentity,
  type RecoveryOwnershipLeaseEvidence,
} from "./recovery-ownership-lease-evidence.js";

export interface RecoveryOwnershipAcquireRequest
  extends ExpectedRecoveryOwnershipIdentity {
  readonly leaseDurationMs: number;
}

export type RecoveryOwnershipAcquireResult =
  | Readonly<{
      status: "acquired";
      acquisition: "new" | "released" | "expired";
      lease: Readonly<RecoveryOwnershipLeaseEvidence>;
    }>
  | Readonly<{
      status: "owned";
      recoveryId: string;
      executionId: string;
      ownerId: string;
      fence: number;
      expiresAtEpochMs: number;
    }>;

export interface RecoveryOwnershipStore {
  acquire(request: RecoveryOwnershipAcquireRequest):
    | RecoveryOwnershipAcquireResult
    | Promise<RecoveryOwnershipAcquireResult>;
  renew(
    lease: RecoveryOwnershipLeaseEvidence,
    leaseDurationMs: number,
  ):
    | Readonly<RecoveryOwnershipLeaseEvidence>
    | Promise<Readonly<RecoveryOwnershipLeaseEvidence>>;
  release(lease: RecoveryOwnershipLeaseEvidence): void | Promise<void>;
  observe(
    recoveryId: string,
    executionId: string,
  ):
    | RecoveryOwnershipAcquireResult
    | Readonly<{ status: "unclaimed"; fence: number }>
    | Promise<
        | RecoveryOwnershipAcquireResult
        | Readonly<{ status: "unclaimed"; fence: number }>
      >;
}

export class RecoveryOwnershipConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RecoveryOwnershipConflictError";
  }
}

export class InvalidRecoveryOwnershipStoreRequestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRecoveryOwnershipStoreRequestError";
  }
}

export interface InMemoryRecoveryOwnershipStoreOptions {
  readonly nowEpochMs: () => number;
  readonly createClaimId: () => string;
  readonly createOwnershipToken: () => string;
  readonly maxLeaseDurationMs: number;
}

interface RecoveryOwnershipState {
  fence: number;
  lease?: Readonly<RecoveryOwnershipLeaseEvidence>;
  released: boolean;
}

function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidRecoveryOwnershipStoreRequestError(
      `${field} must be a non-blank string`,
    );
  }
  return value.trim();
}

function requirePositiveSafeInteger(field: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new InvalidRecoveryOwnershipStoreRequestError(
      `${field} must be a positive safe integer`,
    );
  }
  return value as number;
}

function keyFor(recoveryId: string, executionId: string): string {
  return JSON.stringify([recoveryId, executionId]);
}

function sameLease(
  left: RecoveryOwnershipLeaseEvidence,
  right: RecoveryOwnershipLeaseEvidence,
): boolean {
  return (
    left.claimId === right.claimId &&
    left.recoveryId === right.recoveryId &&
    left.executionId === right.executionId &&
    left.ownerId === right.ownerId &&
    left.ownershipToken === right.ownershipToken &&
    left.fence === right.fence &&
    left.acquiredAtEpochMs === right.acquiredAtEpochMs &&
    left.expiresAtEpochMs === right.expiresAtEpochMs
  );
}

/**
 * Deterministic process-local reference implementation for contract and
 * conformance testing. It deliberately makes no production persistence choice.
 * A production adapter must provide equivalent atomicity across processes and
 * survive restart/crash according to its acceptance harness.
 */
export class InMemoryRecoveryOwnershipStore implements RecoveryOwnershipStore {
  readonly #states = new Map<string, RecoveryOwnershipState>();
  readonly #issuedClaimIds = new Set<string>();
  readonly #issuedTokens = new Set<string>();
  readonly #nowEpochMs: () => number;
  readonly #createClaimId: () => string;
  readonly #createOwnershipToken: () => string;
  readonly #maxLeaseDurationMs: number;

  public constructor(options: InMemoryRecoveryOwnershipStoreOptions) {
    this.#nowEpochMs = options.nowEpochMs;
    this.#createClaimId = options.createClaimId;
    this.#createOwnershipToken = options.createOwnershipToken;
    this.#maxLeaseDurationMs = requirePositiveSafeInteger(
      "maxLeaseDurationMs",
      options.maxLeaseDurationMs,
    );
  }

  public acquire(
    request: RecoveryOwnershipAcquireRequest,
  ): RecoveryOwnershipAcquireResult {
    const recoveryId = requireNonBlank("request.recoveryId", request.recoveryId);
    const executionId = requireNonBlank("request.executionId", request.executionId);
    const ownerId = requireNonBlank("request.ownerId", request.ownerId);
    const leaseDurationMs = this.#requireLeaseDuration(request.leaseDurationMs);
    const now = this.#readNow();
    const key = keyFor(recoveryId, executionId);
    const state = this.#states.get(key);

    if (state?.lease !== undefined && state.lease.expiresAtEpochMs > now) {
      return this.#owned(state.lease);
    }

    const priorFence = state?.fence ?? 0;
    if (priorFence >= Number.MAX_SAFE_INTEGER) {
      throw new RecoveryOwnershipConflictError(
        "Recovery ownership fencing counter is exhausted",
      );
    }

    const claimId = requireNonBlank("claimId", this.#createClaimId());
    const ownershipToken = requireNonBlank(
      "ownershipToken",
      this.#createOwnershipToken(),
    );
    if (this.#issuedClaimIds.has(claimId) || this.#issuedTokens.has(ownershipToken)) {
      throw new RecoveryOwnershipConflictError(
        "Recovery ownership authority generator reused issued material",
      );
    }

    const fence = priorFence + 1;
    const lease = verifyRecoveryOwnershipLeaseEvidence(
      { recoveryId, executionId, ownerId },
      {
        claimId,
        recoveryId,
        executionId,
        ownerId,
        ownershipToken,
        fence,
        acquiredAtEpochMs: now,
        expiresAtEpochMs: this.#expiry(now, leaseDurationMs),
      },
    );
    const acquisition =
      state?.lease !== undefined
        ? "expired"
        : state?.released === true
          ? "released"
          : "new";

    this.#issuedClaimIds.add(claimId);
    this.#issuedTokens.add(ownershipToken);
    this.#states.set(key, { fence, lease, released: false });
    return Object.freeze({ status: "acquired", acquisition, lease });
  }

  public renew(
    rawLease: RecoveryOwnershipLeaseEvidence,
    leaseDurationMs: number,
  ): Readonly<RecoveryOwnershipLeaseEvidence> {
    const lease = this.#verifyCallerLease(rawLease);
    const duration = this.#requireLeaseDuration(leaseDurationMs);
    const now = this.#readNow();
    const state = this.#states.get(keyFor(lease.recoveryId, lease.executionId));
    if (state?.lease === undefined || !sameLease(state.lease, lease)) {
      throw new RecoveryOwnershipConflictError(
        "Only the exact live recovery ownership lease may be renewed",
      );
    }
    if (state.lease.expiresAtEpochMs <= now) {
      throw new RecoveryOwnershipConflictError(
        "An expired recovery ownership lease cannot be renewed",
      );
    }
    const expiresAtEpochMs = this.#expiry(now, duration);
    if (expiresAtEpochMs <= state.lease.expiresAtEpochMs) {
      return state.lease;
    }
    const renewed = verifyRecoveryOwnershipLeaseEvidence(
      {
        recoveryId: lease.recoveryId,
        executionId: lease.executionId,
        ownerId: lease.ownerId,
      },
      { ...state.lease, expiresAtEpochMs },
    );
    state.lease = renewed;
    return renewed;
  }

  public release(rawLease: RecoveryOwnershipLeaseEvidence): void {
    const lease = this.#verifyCallerLease(rawLease);
    const state = this.#states.get(keyFor(lease.recoveryId, lease.executionId));
    if (state?.lease === undefined || !sameLease(state.lease, lease)) {
      return;
    }
    if (state.lease.expiresAtEpochMs <= this.#readNow()) {
      return;
    }
    delete state.lease;
    state.released = true;
  }

  public observe(
    rawRecoveryId: string,
    rawExecutionId: string,
  ):
    | RecoveryOwnershipAcquireResult
    | Readonly<{ status: "unclaimed"; fence: number }> {
    const recoveryId = requireNonBlank("recoveryId", rawRecoveryId);
    const executionId = requireNonBlank("executionId", rawExecutionId);
    const state = this.#states.get(keyFor(recoveryId, executionId));
    if (state?.lease !== undefined && state.lease.expiresAtEpochMs > this.#readNow()) {
      return this.#owned(state.lease);
    }
    return Object.freeze({ status: "unclaimed", fence: state?.fence ?? 0 });
  }

  #verifyCallerLease(
    lease: RecoveryOwnershipLeaseEvidence,
  ): Readonly<RecoveryOwnershipLeaseEvidence> {
    return verifyRecoveryOwnershipLeaseEvidence(
      {
        recoveryId: lease.recoveryId,
        executionId: lease.executionId,
        ownerId: lease.ownerId,
      },
      lease,
    );
  }

  #owned(
    lease: RecoveryOwnershipLeaseEvidence,
  ): Extract<RecoveryOwnershipAcquireResult, { status: "owned" }> {
    return Object.freeze({
      status: "owned",
      recoveryId: lease.recoveryId,
      executionId: lease.executionId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      expiresAtEpochMs: lease.expiresAtEpochMs,
    });
  }

  #requireLeaseDuration(value: unknown): number {
    const duration = requirePositiveSafeInteger("leaseDurationMs", value);
    if (duration > this.#maxLeaseDurationMs) {
      throw new InvalidRecoveryOwnershipStoreRequestError(
        "leaseDurationMs exceeds maxLeaseDurationMs",
      );
    }
    return duration;
  }

  #readNow(): number {
    const now = this.#nowEpochMs();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new InvalidRecoveryOwnershipStoreRequestError(
        "nowEpochMs must return a non-negative safe integer",
      );
    }
    return now;
  }

  #expiry(now: number, duration: number): number {
    const expiry = now + duration;
    if (!Number.isSafeInteger(expiry) || expiry <= now) {
      throw new InvalidRecoveryOwnershipStoreRequestError(
        "lease expiry is outside the safe integer range",
      );
    }
    return expiry;
  }
}

export interface CancellationSignal {
  readonly isCancellationRequested: boolean;
  readonly reason?: string;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export interface ExecutionDeadline {
  readonly deadlineAtMs: number;
  readonly nowMs: () => number;
}

export type CommitAuthorityRevocationReason =
  | "deadline"
  | "cancellation"
  | "attempt_settled";

/**
 * Provider-neutral cancellation token handed to every attempt. Adapters that
 * own an external abort primitive (for example `AbortController`) bind to it
 * through `onCancellationRequested`; nothing provider specific crosses the
 * boundary.
 */
export interface AttemptCancellationToken {
  readonly isCancellationRequested: boolean;
  readonly reason?: CommitAuthorityRevocationReason | undefined;
  onCancellationRequested(
    listener: (reason: CommitAuthorityRevocationReason) => void,
  ): () => void;
}

/**
 * Revocable authority to perform an externally consequential commit. Every
 * externally consequential effect must be executed through `commit` so that a
 * timed-out or cancelled attempt cannot commit after the fence closes.
 */
export interface CommitAuthority {
  readonly isRevoked: boolean;
  readonly revocationReason?: CommitAuthorityRevocationReason | undefined;
  readonly pendingCommitCount: number;
  assertActive(): void;
  commit<T>(effect: () => Promise<T> | T): Promise<T>;
  acknowledgeRevocation(): void;
}

export interface ExecutionAttemptContext {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly cancellation: AttemptCancellationToken;
  readonly commitAuthority: CommitAuthority;
}

export interface ExecutionFenceStatus {
  readonly revoked: boolean;
  readonly revocationReason?: CommitAuthorityRevocationReason | undefined;
  readonly acknowledged: boolean;
  readonly pendingCommitCount: number;
}

export interface ExecutionTimeoutContext extends ExecutionAttemptContext {
  readonly deadlineAtMs: number;
  readonly observedAtMs: number;
  readonly fence: ExecutionFenceStatus;
}

export type LateSettlementKind = "resolved" | "rejected";

export interface ExecutionLateSettlementContext extends ExecutionAttemptContext {
  readonly kind: LateSettlementKind;
  readonly value?: unknown;
  readonly error?: unknown | undefined;
}

export interface ExecutionControlHooks {
  readonly onAttemptStarted?: (context: ExecutionAttemptContext) => void | Promise<void>;
  readonly onAttemptFailed?: (
    context: ExecutionAttemptContext,
    error: unknown,
    willRetry: boolean,
  ) => void | Promise<void>;
  readonly onTimedOut?: (context: ExecutionTimeoutContext) => void | Promise<void>;
  readonly onLateSettlement?: (
    context: ExecutionLateSettlementContext,
  ) => void | Promise<void>;
}

export interface ExecutionFencingOptions {
  /**
   * Require the operation to call `commitAuthority.acknowledgeRevocation()`
   * after revocation. Use this for adapters whose external effects cannot be
   * proven fenced by commit-authority mediation alone; unacknowledged fences
   * fail closed.
   */
  readonly requireAcknowledgement?: boolean | undefined;
  /** Bound on how long terminal finalization waits for fence acknowledgement. */
  readonly acknowledgementTimeoutMs?: number | undefined;
}

export interface ExecutionControlOptions {
  readonly cancellation?: CancellationSignal | undefined;
  readonly deadline?: ExecutionDeadline | undefined;
  readonly hooks?: ExecutionControlHooks | undefined;
  readonly fencing?: ExecutionFencingOptions | undefined;
}

export const DEFAULT_FENCE_ACKNOWLEDGEMENT_TIMEOUT_MS = 5_000;

export class ExecutionCancelledError extends Error {
  public constructor(public readonly reason = "Execution cancelled") {
    super(reason);
    this.name = "ExecutionCancelledError";
  }
}

export class ExecutionTimedOutError extends Error {
  public constructor(
    public readonly deadlineAtMs: number,
    public readonly observedAtMs: number,
  ) {
    super(`Execution deadline exceeded: ${observedAtMs} >= ${deadlineAtMs}`);
    this.name = "ExecutionTimedOutError";
  }
}

export class CommitAuthorityRevokedError extends Error {
  public constructor(
    public readonly revocationReason: CommitAuthorityRevocationReason,
  ) {
    super(`Commit authority revoked: ${revocationReason}`);
    this.name = "CommitAuthorityRevokedError";
  }
}

export class ExecutionFenceNotAcknowledgedError extends Error {
  public constructor(
    public readonly deadlineAtMs: number,
    public readonly observedAtMs: number,
    public readonly pendingCommitCount: number,
    public readonly acknowledgementTimeoutMs: number,
  ) {
    super(
      `Execution fence was not acknowledged within ${acknowledgementTimeoutMs}ms after deadline ${deadlineAtMs} ` +
        `(pending externally consequential commits: ${pendingCommitCount})`,
    );
    this.name = "ExecutionFenceNotAcknowledgedError";
  }
}

export class InvalidRetryPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRetryPolicyError";
  }
}

export class InvalidExecutionDeadlineError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidExecutionDeadlineError";
  }
}

export class InvalidExecutionFencingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidExecutionFencingError";
  }
}

export function assertValidRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new InvalidRetryPolicyError(
      "Retry policy maxAttempts must be a positive safe integer",
    );
  }
}

export function assertValidExecutionDeadline(deadline: ExecutionDeadline): void {
  if (!Number.isSafeInteger(deadline.deadlineAtMs) || deadline.deadlineAtMs < 0) {
    throw new InvalidExecutionDeadlineError(
      "Execution deadline must be a non-negative safe integer timestamp",
    );
  }
  if (typeof deadline.nowMs !== "function") {
    throw new InvalidExecutionDeadlineError("Execution deadline requires a clock");
  }
}

export function assertValidExecutionFencing(fencing: ExecutionFencingOptions): void {
  const { acknowledgementTimeoutMs } = fencing;
  if (acknowledgementTimeoutMs === undefined) return;
  if (
    !Number.isSafeInteger(acknowledgementTimeoutMs) ||
    acknowledgementTimeoutMs < 0
  ) {
    throw new InvalidExecutionFencingError(
      "Fence acknowledgement timeout must be a non-negative safe integer duration",
    );
  }
}

/**
 * Attempt-scoped fence. It owns the cancellation token and the revocable
 * commit authority for exactly one attempt, so authority never outlives the
 * attempt window that the deadline governs.
 */
class AttemptFence {
  #revoked = false;
  #revocationReason: CommitAuthorityRevocationReason | undefined;
  #acknowledged = false;
  #pendingCommitCount = 0;
  readonly #cancellationListeners = new Set<
    (reason: CommitAuthorityRevocationReason) => void
  >();
  readonly #stateListeners = new Set<() => void>();

  public readonly cancellation: AttemptCancellationToken;
  public readonly commitAuthority: CommitAuthority;

  public constructor() {
    const fence = this;
    this.cancellation = {
      get isCancellationRequested(): boolean {
        return fence.#revoked;
      },
      get reason(): CommitAuthorityRevocationReason | undefined {
        return fence.#revocationReason;
      },
      onCancellationRequested: (listener) => fence.#onCancellationRequested(listener),
    };
    this.commitAuthority = {
      get isRevoked(): boolean {
        return fence.#revoked;
      },
      get revocationReason(): CommitAuthorityRevocationReason | undefined {
        return fence.#revocationReason;
      },
      get pendingCommitCount(): number {
        return fence.#pendingCommitCount;
      },
      assertActive: () => fence.#assertActive(),
      commit: <T>(effect: () => Promise<T> | T) => fence.#commit(effect),
      acknowledgeRevocation: () => fence.#acknowledgeRevocation(),
    };
  }

  public get isRevoked(): boolean {
    return this.#revoked;
  }

  public get pendingCommitCount(): number {
    return this.#pendingCommitCount;
  }

  public status(): ExecutionFenceStatus {
    return {
      revoked: this.#revoked,
      ...(this.#revocationReason === undefined
        ? {}
        : { revocationReason: this.#revocationReason }),
      acknowledged: this.#acknowledged,
      pendingCommitCount: this.#pendingCommitCount,
    };
  }

  public revoke(reason: CommitAuthorityRevocationReason): void {
    if (this.#revoked) return;
    this.#revoked = true;
    this.#revocationReason = reason;
    for (const listener of [...this.#cancellationListeners]) {
      try {
        listener(reason);
      } catch {
        // A misbehaving adapter listener must not block fencing.
      }
    }
    this.#cancellationListeners.clear();
    this.#notifyStateChanged();
  }

  public isAcknowledgementSatisfied(requireExplicit: boolean): boolean {
    if (this.#pendingCommitCount > 0) return false;
    return requireExplicit ? this.#acknowledged : true;
  }

  public onStateChanged(listener: () => void): () => void {
    this.#stateListeners.add(listener);
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  #onCancellationRequested(
    listener: (reason: CommitAuthorityRevocationReason) => void,
  ): () => void {
    if (this.#revoked) {
      const reason = this.#revocationReason ?? "cancellation";
      listener(reason);
      return () => undefined;
    }
    this.#cancellationListeners.add(listener);
    return () => {
      this.#cancellationListeners.delete(listener);
    };
  }

  #assertActive(): void {
    if (this.#revoked) {
      throw new CommitAuthorityRevokedError(this.#revocationReason ?? "cancellation");
    }
  }

  async #commit<T>(effect: () => Promise<T> | T): Promise<T> {
    this.#assertActive();
    this.#pendingCommitCount += 1;
    this.#notifyStateChanged();
    try {
      return await effect();
    } finally {
      this.#pendingCommitCount -= 1;
      this.#notifyStateChanged();
    }
  }

  #acknowledgeRevocation(): void {
    if (!this.#revoked) return;
    this.#acknowledged = true;
    this.#notifyStateChanged();
  }

  #notifyStateChanged(): void {
    for (const listener of [...this.#stateListeners]) {
      try {
        listener();
      } catch {
        // Fence observation must not affect fence state.
      }
    }
  }
}

function assertNotCancelled(signal?: CancellationSignal): void {
  if (signal?.isCancellationRequested === true) {
    throw new ExecutionCancelledError(signal.reason?.trim() || undefined);
  }
}

function readDeadlineClock(deadline: ExecutionDeadline): number {
  const observedAtMs = deadline.nowMs();
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) {
    throw new InvalidExecutionDeadlineError(
      "Execution deadline clock must return a non-negative safe integer timestamp",
    );
  }
  return observedAtMs;
}

function resolveFencing(
  fencing: ExecutionFencingOptions | undefined,
): { readonly requireAcknowledgement: boolean; readonly acknowledgementTimeoutMs: number } {
  return {
    requireAcknowledgement: fencing?.requireAcknowledgement === true,
    acknowledgementTimeoutMs:
      fencing?.acknowledgementTimeoutMs ?? DEFAULT_FENCE_ACKNOWLEDGEMENT_TIMEOUT_MS,
  };
}

/**
 * Waits, within a hard bound, until no externally consequential commit is in
 * flight and (when required) the operation acknowledged the revocation.
 */
async function awaitFenceAcknowledgement(
  fence: AttemptFence,
  requireExplicit: boolean,
  acknowledgementTimeoutMs: number,
): Promise<boolean> {
  if (fence.isAcknowledgementSatisfied(requireExplicit)) return true;

  return await new Promise<boolean>((resolve) => {
    let unsubscribe: (() => void) | undefined;
    let handle: ReturnType<typeof setTimeout> | undefined;

    const settle = (acknowledged: boolean): void => {
      unsubscribe?.();
      if (handle !== undefined) clearTimeout(handle);
      resolve(acknowledged);
    };

    handle = setTimeout(() => settle(false), acknowledgementTimeoutMs);
    unsubscribe = fence.onStateChanged(() => {
      if (fence.isAcknowledgementSatisfied(requireExplicit)) settle(true);
    });

    if (fence.isAcknowledgementSatisfied(requireExplicit)) settle(true);
  });
}

async function emitTimeout(
  deadline: ExecutionDeadline,
  context: ExecutionAttemptContext,
  hooks: ExecutionControlHooks | undefined,
  observedAtMs: number,
  fence: ExecutionFenceStatus,
  acknowledgementTimeoutMs: number,
): Promise<never> {
  const timeoutContext = {
    ...context,
    deadlineAtMs: deadline.deadlineAtMs,
    observedAtMs,
    fence,
  } as const;
  await hooks?.onTimedOut?.(timeoutContext);

  if (fence.revoked && !fence.acknowledged) {
    throw new ExecutionFenceNotAcknowledgedError(
      deadline.deadlineAtMs,
      observedAtMs,
      fence.pendingCommitCount,
      acknowledgementTimeoutMs,
    );
  }
  throw new ExecutionTimedOutError(deadline.deadlineAtMs, observedAtMs);
}

async function assertBeforeDeadline(
  deadline: ExecutionDeadline | undefined,
  context: ExecutionAttemptContext,
  hooks: ExecutionControlHooks | undefined,
  fence: AttemptFence,
): Promise<number | undefined> {
  if (deadline === undefined) return undefined;

  const observedAtMs = readDeadlineClock(deadline);
  if (observedAtMs >= deadline.deadlineAtMs) {
    fence.revoke("deadline");
    await emitTimeout(
      deadline,
      context,
      hooks,
      observedAtMs,
      { ...fence.status(), acknowledged: fence.pendingCommitCount === 0 },
      0,
    );
  }
  return observedAtMs;
}

/**
 * Absorbs a settlement that arrives after the attempt was fenced. The value or
 * error can no longer influence authoritative workflow progress; it is only
 * reported for audit.
 */
function observeLateSettlement(
  operation: Promise<unknown>,
  context: ExecutionAttemptContext,
  hooks: ExecutionControlHooks | undefined,
): void {
  const report = (settlement: ExecutionLateSettlementContext): void => {
    void (async () => {
      try {
        await hooks?.onLateSettlement?.(settlement);
      } catch {
        // Late-settlement observation must never affect terminal finalization.
      }
    })();
  };

  operation.then(
    (value) => {
      report({ ...context, kind: "resolved", value });
    },
    (error: unknown) => {
      report({ ...context, kind: "rejected", error });
    },
  );
}

async function executeAttemptWithDeadline<T>(
  operation: (context: ExecutionAttemptContext) => Promise<T>,
  context: ExecutionAttemptContext,
  fence: AttemptFence,
  deadline: ExecutionDeadline | undefined,
  hooks: ExecutionControlHooks | undefined,
  fencing: ReturnType<typeof resolveFencing>,
  observedAtStartMs: number | undefined,
): Promise<T> {
  const attempt = (async () => await operation(context))();

  if (deadline === undefined || observedAtStartMs === undefined) return await attempt;

  const remainingMs = Math.max(0, deadline.deadlineAtMs - observedAtStartMs);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let fenced = false;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      fenced = true;
      void (async () => {
        const clockAtTimeout = readDeadlineClock(deadline);
        const enforcedObservedAtMs = Math.max(clockAtTimeout, deadline.deadlineAtMs);
        // Commit authority is revoked before any terminal publication so a
        // still-running operation cannot start a new external commit.
        fence.revoke("deadline");
        const acknowledged = await awaitFenceAcknowledgement(
          fence,
          fencing.requireAcknowledgement,
          fencing.acknowledgementTimeoutMs,
        );
        const status = { ...fence.status(), acknowledged };
        await emitTimeout(
          deadline,
          context,
          hooks,
          enforcedObservedAtMs,
          status,
          fencing.acknowledgementTimeoutMs,
        );
      })().catch(reject);
    }, remainingMs);
  });

  try {
    const result = await Promise.race([attempt, timeout]);
    // The operation may win the race while fencing is still finalizing; the
    // fenced outcome always wins so a revoked attempt cannot report success.
    if (fenced) return await timeout;
    return result;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (fenced) observeLateSettlement(attempt, context, hooks);
  }
}

export async function executeWithControl<T>(
  operation: (context: ExecutionAttemptContext) => Promise<T>,
  policy: RetryPolicy,
  options: ExecutionControlOptions = {},
): Promise<T> {
  assertValidRetryPolicy(policy);
  if (options.deadline !== undefined) {
    assertValidExecutionDeadline(options.deadline);
  }
  if (options.fencing !== undefined) {
    assertValidExecutionFencing(options.fencing);
  }
  const fencing = resolveFencing(options.fencing);

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const fence = new AttemptFence();
    const context: ExecutionAttemptContext = {
      attempt,
      maxAttempts: policy.maxAttempts,
      cancellation: fence.cancellation,
      commitAuthority: fence.commitAuthority,
    };
    assertNotCancelled(options.cancellation);
    const observedAtStartMs = await assertBeforeDeadline(
      options.deadline,
      context,
      options.hooks,
      fence,
    );
    await options.hooks?.onAttemptStarted?.(context);

    try {
      const result = await executeAttemptWithDeadline(
        operation,
        context,
        fence,
        options.deadline,
        options.hooks,
        fencing,
        observedAtStartMs,
      );
      assertNotCancelled(options.cancellation);
      await assertBeforeDeadline(options.deadline, context, options.hooks, fence);
      return result;
    } catch (error) {
      if (
        error instanceof ExecutionCancelledError ||
        error instanceof ExecutionTimedOutError ||
        error instanceof ExecutionFenceNotAcknowledgedError ||
        error instanceof InvalidExecutionDeadlineError
      ) {
        throw error;
      }

      assertNotCancelled(options.cancellation);
      await assertBeforeDeadline(options.deadline, context, options.hooks, fence);
      const permittedByPolicy = policy.shouldRetry?.(error, attempt) ?? true;
      const willRetry = attempt < policy.maxAttempts && permittedByPolicy;
      await options.hooks?.onAttemptFailed?.(context, error, willRetry);

      if (!willRetry) {
        throw error;
      }
    } finally {
      // Authority never outlives its attempt window, so a leaked reference
      // cannot commit externally consequential state later.
      fence.revoke("attempt_settled");
    }
  }

  throw new InvalidRetryPolicyError("Retry loop exited without a result");
}

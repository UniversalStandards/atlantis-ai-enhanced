import {
  assertWithinBudget,
  BudgetExceededError,
  type WorkflowContext,
} from "./index.js";

/**
 * Identity of a single step attempt inside one execution.
 *
 * Retry accounting is authoritative only when failed-attempt evidence and the
 * retry allowance it consumes are one durable transition keyed by this identity.
 */
export interface FailedAttemptIdentity {
  readonly executionId: string;
  readonly stepId: string;
  /** 1-based ordinal of the failed attempt for this step. */
  readonly attempt: number;
}

export interface FailedAttemptRecord extends FailedAttemptIdentity {
  /** Identity of the `workflow.step.attempt.failed` event carrying this evidence. */
  readonly eventId: string;
  readonly occurredAt: string;
  readonly reason: string;
  /** Whether the failure is eligible for re-execution at all. */
  readonly retryable: boolean;
}

export interface RetryConsumptionState {
  readonly executionId: string;
  readonly stepId: string;
  /** Retry allowances consumed by durable failed-attempt evidence. */
  readonly consumedRetries: number;
  readonly failedAttempts: readonly FailedAttemptRecord[];
  readonly revision: number;
}

export interface RetryConsumptionKey {
  readonly executionId: string;
  readonly stepId: string;
}

/**
 * Durable authority for failed-attempt evidence and retry-budget consumption.
 *
 * Implementations must apply `commitFailedAttempt` as a single atomic
 * transition: no observer may see the evidence without its consumed allowance,
 * and acknowledgement loss must never restore retry budget.
 */
export interface RetryConsumptionStore {
  load(key: RetryConsumptionKey): Promise<RetryConsumptionState | undefined>;
  commitFailedAttempt(
    record: FailedAttemptRecord,
  ): Promise<RetryConsumptionState>;
}

export class InvalidFailedAttemptRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFailedAttemptRecordError";
  }
}

export class RetryConsumptionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryConsumptionConflictError";
  }
}

export class RetryConsumptionReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryConsumptionReconciliationError";
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidFailedAttemptRecordError(
      `Failed-attempt record field ${field} must be a non-empty string`,
    );
  }
}

export function validateFailedAttemptRecord(
  record: FailedAttemptRecord,
): FailedAttemptRecord {
  assertNonEmpty("executionId", record.executionId);
  assertNonEmpty("stepId", record.stepId);
  assertNonEmpty("eventId", record.eventId);
  assertNonEmpty("reason", record.reason);
  assertNonEmpty("occurredAt", record.occurredAt);
  if (Number.isNaN(Date.parse(record.occurredAt))) {
    throw new InvalidFailedAttemptRecordError(
      "Failed-attempt record occurredAt must be a parsable timestamp",
    );
  }
  if (!Number.isSafeInteger(record.attempt) || record.attempt < 1) {
    throw new InvalidFailedAttemptRecordError(
      "Failed-attempt record attempt must be a positive integer ordinal",
    );
  }
  if (typeof record.retryable !== "boolean") {
    throw new InvalidFailedAttemptRecordError(
      "Failed-attempt record retryable must be a boolean",
    );
  }
  return {
    executionId: record.executionId,
    stepId: record.stepId,
    attempt: record.attempt,
    eventId: record.eventId,
    occurredAt: record.occurredAt,
    reason: record.reason,
    retryable: record.retryable,
  };
}

function sameRecord(
  left: FailedAttemptRecord,
  right: FailedAttemptRecord,
): boolean {
  return (
    left.executionId === right.executionId &&
    left.stepId === right.stepId &&
    left.attempt === right.attempt &&
    left.eventId === right.eventId &&
    left.occurredAt === right.occurredAt &&
    left.reason === right.reason &&
    left.retryable === right.retryable
  );
}

/**
 * Validates that a durable state's retry counter is exactly the allowance
 * implied by its failed-attempt evidence. Divergence fails closed rather than
 * being repaired by a heuristic.
 */
export function reconcileRetryConsumption(
  state: RetryConsumptionState,
): RetryConsumptionState {
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) {
    throw new RetryConsumptionReconciliationError(
      "Retry consumption revision is invalid",
    );
  }
  state.failedAttempts.forEach((record, index) => {
    const validated = validateFailedAttemptRecord(record);
    if (
      validated.executionId !== state.executionId ||
      validated.stepId !== state.stepId
    ) {
      throw new RetryConsumptionReconciliationError(
        "Failed-attempt evidence does not belong to this step identity",
      );
    }
    if (validated.attempt !== index + 1) {
      throw new RetryConsumptionReconciliationError(
        "Failed-attempt evidence is not a gapless ordered attempt sequence",
      );
    }
  });
  if (state.consumedRetries !== state.failedAttempts.length) {
    throw new RetryConsumptionReconciliationError(
      `Retry counter ${state.consumedRetries} does not match ${state.failedAttempts.length} durable failed attempts`,
    );
  }
  return state;
}

export interface RetryAllowanceDecision {
  readonly state: RetryConsumptionState;
  readonly consumedRetries: number;
  readonly remainingRetries: number;
  /** Ordinal the next attempt must use, if one is permitted. */
  readonly nextAttempt: number;
  readonly mayRetry: boolean;
}

function assertRetryLimit(maxRetries: number): void {
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new InvalidFailedAttemptRecordError(
      "maxRetries must be a non-negative integer",
    );
  }
}

function decide(
  state: RetryConsumptionState,
  maxRetries: number,
): RetryAllowanceDecision {
  const consumedRetries = state.consumedRetries;
  const last = state.failedAttempts[state.failedAttempts.length - 1];
  if (consumedRetries > maxRetries) {
    throw new BudgetExceededError("maxRetries", maxRetries, consumedRetries);
  }
  return {
    state,
    consumedRetries,
    remainingRetries: maxRetries - consumedRetries,
    nextAttempt: consumedRetries + 1,
    mayRetry:
      consumedRetries < maxRetries && (last === undefined || last.retryable),
  };
}

/**
 * Records failed-attempt evidence and consumes its retry allowance in one
 * durable transition, then enforces `maxRetries` from the reconciled state.
 *
 * Replaying the same attempt identity (for example after acknowledgement loss)
 * consumes exactly one allowance.
 */
export async function consumeRetryAllowance(
  store: RetryConsumptionStore,
  record: FailedAttemptRecord,
  maxRetries: number,
): Promise<RetryAllowanceDecision> {
  assertRetryLimit(maxRetries);
  const validated = validateFailedAttemptRecord(record);
  const state = reconcileRetryConsumption(
    await store.commitFailedAttempt(validated),
  );
  return decide(state, maxRetries);
}

/**
 * Reads retry consumption without recording new evidence, for recovery paths
 * that must know the surviving allowance before re-executing a step.
 */
export async function loadRetryAllowance(
  store: RetryConsumptionStore,
  key: RetryConsumptionKey,
  maxRetries: number,
): Promise<RetryAllowanceDecision> {
  assertRetryLimit(maxRetries);
  const stored = await store.load(key);
  const state =
    stored === undefined
      ? {
          executionId: key.executionId,
          stepId: key.stepId,
          consumedRetries: 0,
          failedAttempts: [],
          revision: 1,
        }
      : reconcileRetryConsumption(stored);
  return decide(state, maxRetries);
}

/**
 * Rebuilds execution retry usage from durable failed-attempt evidence during
 * recovery, so restarts cannot restore already consumed retry budget.
 */
export async function reconcileRetryUsageFromDurableEvidence(
  store: RetryConsumptionStore,
  context: WorkflowContext,
  stepIds: readonly string[],
): Promise<number> {
  let consumed = 0;
  const seen = new Set<string>();
  for (const stepId of stepIds) {
    if (seen.has(stepId)) {
      continue;
    }
    seen.add(stepId);
    const stored = await store.load({
      executionId: context.executionId,
      stepId,
    });
    if (stored !== undefined) {
      consumed += reconcileRetryConsumption(stored).consumedRetries;
    }
  }
  context.usage.retries = consumed;
  assertWithinBudget(context);
  return consumed;
}

/** Points at which a durable commit can be interrupted, for failure injection. */
export type RetryConsumptionFailurePoint =
  | "before_commit"
  | "after_commit_before_acknowledgement";

export interface RetryConsumptionFailureInjection {
  readonly point: RetryConsumptionFailurePoint;
  readonly attempt: number;
  readonly stepId?: string;
}

export class SimulatedRetryConsumptionCrashError extends Error {
  constructor(public readonly point: RetryConsumptionFailurePoint) {
    super(`Simulated durable retry-consumption crash at ${point}`);
    this.name = "SimulatedRetryConsumptionCrashError";
  }
}

export interface InMemoryRetryConsumptionStoreOptions {
  /** Durable state surviving a simulated restart. */
  readonly initialState?: readonly RetryConsumptionState[];
  /** One-shot interruptions used to prove crash consistency. */
  readonly failureInjections?: readonly RetryConsumptionFailureInjection[];
}

function stateKey(key: RetryConsumptionKey): string {
  return `${key.executionId}\u0000${key.stepId}`;
}

/**
 * Reference durable authority: evidence and counter are published by one
 * indivisible assignment, so no interruption can separate them.
 */
export class InMemoryRetryConsumptionStore implements RetryConsumptionStore {
  readonly #states = new Map<string, RetryConsumptionState>();
  readonly #failures: RetryConsumptionFailureInjection[];

  constructor(options: InMemoryRetryConsumptionStoreOptions = {}) {
    for (const state of options.initialState ?? []) {
      this.#states.set(stateKey(state), reconcileRetryConsumption(state));
    }
    this.#failures = [...(options.failureInjections ?? [])];
  }

  public snapshot(): readonly RetryConsumptionState[] {
    return [...this.#states.values()];
  }

  public async load(
    key: RetryConsumptionKey,
  ): Promise<RetryConsumptionState | undefined> {
    return this.#states.get(stateKey(key));
  }

  public async commitFailedAttempt(
    record: FailedAttemptRecord,
  ): Promise<RetryConsumptionState> {
    const validated = validateFailedAttemptRecord(record);
    const key = stateKey(validated);
    const current = this.#states.get(key);

    if (current !== undefined) {
      const existing = current.failedAttempts[validated.attempt - 1];
      if (existing !== undefined) {
        if (!sameRecord(existing, validated)) {
          throw new RetryConsumptionConflictError(
            `Attempt ${validated.attempt} of step ${validated.stepId} is already recorded with different evidence`,
          );
        }
        // Idempotent replay after acknowledgement loss: no added allowance.
        return current;
      }
    }

    const consumed = current?.consumedRetries ?? 0;
    if (validated.attempt !== consumed + 1) {
      throw new RetryConsumptionConflictError(
        `Attempt ${validated.attempt} of step ${validated.stepId} does not follow ${consumed} recorded attempts`,
      );
    }

    this.#trip("before_commit", validated);

    const next: RetryConsumptionState = {
      executionId: validated.executionId,
      stepId: validated.stepId,
      consumedRetries: consumed + 1,
      failedAttempts: [...(current?.failedAttempts ?? []), validated],
      revision: (current?.revision ?? 0) + 1,
    };
    this.#states.set(key, next);

    this.#trip("after_commit_before_acknowledgement", validated);

    return next;
  }

  #trip(
    point: RetryConsumptionFailurePoint,
    record: FailedAttemptRecord,
  ): void {
    const index = this.#failures.findIndex(
      (failure) =>
        failure.point === point &&
        failure.attempt === record.attempt &&
        (failure.stepId === undefined || failure.stepId === record.stepId),
    );
    if (index >= 0) {
      this.#failures.splice(index, 1);
      throw new SimulatedRetryConsumptionCrashError(point);
    }
  }
}

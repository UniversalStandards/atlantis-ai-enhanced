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

export interface ExecutionAttemptContext {
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface ExecutionTimeoutContext extends ExecutionAttemptContext {
  readonly deadlineAtMs: number;
  readonly observedAtMs: number;
}

export interface ExecutionControlHooks {
  readonly onAttemptStarted?: (context: ExecutionAttemptContext) => void | Promise<void>;
  readonly onAttemptFailed?: (
    context: ExecutionAttemptContext,
    error: unknown,
    willRetry: boolean,
  ) => void | Promise<void>;
  readonly onTimedOut?: (context: ExecutionTimeoutContext) => void | Promise<void>;
}

export interface ExecutionControlOptions {
  readonly cancellation?: CancellationSignal | undefined;
  readonly deadline?: ExecutionDeadline | undefined;
  readonly hooks?: ExecutionControlHooks | undefined;
}

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

async function emitTimeout(
  deadline: ExecutionDeadline,
  context: ExecutionAttemptContext,
  hooks: ExecutionControlHooks | undefined,
  observedAtMs: number,
): Promise<never> {
  const timeoutContext = {
    ...context,
    deadlineAtMs: deadline.deadlineAtMs,
    observedAtMs,
  } as const;
  await hooks?.onTimedOut?.(timeoutContext);
  throw new ExecutionTimedOutError(deadline.deadlineAtMs, observedAtMs);
}

async function assertBeforeDeadline(
  deadline: ExecutionDeadline | undefined,
  context: ExecutionAttemptContext,
  hooks: ExecutionControlHooks | undefined,
): Promise<number | undefined> {
  if (deadline === undefined) return undefined;

  const observedAtMs = readDeadlineClock(deadline);
  if (observedAtMs >= deadline.deadlineAtMs) {
    await emitTimeout(deadline, context, hooks, observedAtMs);
  }
  return observedAtMs;
}

async function executeAttemptWithDeadline<T>(
  operation: (context: ExecutionAttemptContext) => Promise<T>,
  context: ExecutionAttemptContext,
  deadline: ExecutionDeadline | undefined,
  hooks: ExecutionControlHooks | undefined,
  observedAtStartMs: number | undefined,
): Promise<T> {
  if (deadline === undefined || observedAtStartMs === undefined) return operation(context);

  const remainingMs = deadline.deadlineAtMs - observedAtStartMs;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      try {
        const clockAtTimeout = readDeadlineClock(deadline);
        const enforcedObservedAtMs = Math.max(clockAtTimeout, deadline.deadlineAtMs);
        void emitTimeout(deadline, context, hooks, enforcedObservedAtMs).catch(reject);
      } catch (error) {
        reject(error);
      }
    }, remainingMs);
  });

  try {
    return await Promise.race([operation(context), timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
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

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const context = { attempt, maxAttempts: policy.maxAttempts } as const;
    assertNotCancelled(options.cancellation);
    const observedAtStartMs = await assertBeforeDeadline(
      options.deadline,
      context,
      options.hooks,
    );
    await options.hooks?.onAttemptStarted?.(context);

    try {
      const result = await executeAttemptWithDeadline(
        operation,
        context,
        options.deadline,
        options.hooks,
        observedAtStartMs,
      );
      assertNotCancelled(options.cancellation);
      await assertBeforeDeadline(options.deadline, context, options.hooks);
      return result;
    } catch (error) {
      if (
        error instanceof ExecutionCancelledError ||
        error instanceof ExecutionTimedOutError ||
        error instanceof InvalidExecutionDeadlineError
      ) {
        throw error;
      }

      assertNotCancelled(options.cancellation);
      await assertBeforeDeadline(options.deadline, context, options.hooks);
      const permittedByPolicy = policy.shouldRetry?.(error, attempt) ?? true;
      const willRetry = attempt < policy.maxAttempts && permittedByPolicy;
      await options.hooks?.onAttemptFailed?.(context, error, willRetry);

      if (!willRetry) {
        throw error;
      }
    }
  }

  throw new InvalidRetryPolicyError("Retry loop exited without a result");
}

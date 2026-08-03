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

async function assertBeforeDeadline(
  deadline: ExecutionDeadline | undefined,
  context: ExecutionAttemptContext,
  hooks: ExecutionControlHooks | undefined,
): Promise<void> {
  if (deadline === undefined) return;

  const observedAtMs = deadline.nowMs();
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) {
    throw new InvalidExecutionDeadlineError(
      "Execution deadline clock must return a non-negative safe integer timestamp",
    );
  }
  if (observedAtMs >= deadline.deadlineAtMs) {
    const timeoutContext = {
      ...context,
      deadlineAtMs: deadline.deadlineAtMs,
      observedAtMs,
    } as const;
    await hooks?.onTimedOut?.(timeoutContext);
    throw new ExecutionTimedOutError(deadline.deadlineAtMs, observedAtMs);
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
    await assertBeforeDeadline(options.deadline, context, options.hooks);
    await options.hooks?.onAttemptStarted?.(context);

    try {
      const result = await operation(context);
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

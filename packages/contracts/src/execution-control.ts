export interface CancellationSignal {
  readonly isCancellationRequested: boolean;
  readonly reason?: string;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export interface ExecutionAttemptContext {
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface ExecutionControlHooks {
  readonly onAttemptStarted?: (context: ExecutionAttemptContext) => void | Promise<void>;
  readonly onAttemptFailed?: (
    context: ExecutionAttemptContext,
    error: unknown,
    willRetry: boolean,
  ) => void | Promise<void>;
}

export class ExecutionCancelledError extends Error {
  public constructor(public readonly reason = "Execution cancelled") {
    super(reason);
    this.name = "ExecutionCancelledError";
  }
}

export class InvalidRetryPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRetryPolicyError";
  }
}

export function assertValidRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new InvalidRetryPolicyError(
      "Retry policy maxAttempts must be a positive safe integer",
    );
  }
}

function assertNotCancelled(signal?: CancellationSignal): void {
  if (signal?.isCancellationRequested === true) {
    throw new ExecutionCancelledError(signal.reason?.trim() || undefined);
  }
}

export async function executeWithControl<T>(
  operation: (context: ExecutionAttemptContext) => Promise<T>,
  policy: RetryPolicy,
  options: {
    readonly cancellation?: CancellationSignal;
    readonly hooks?: ExecutionControlHooks;
  } = {},
): Promise<T> {
  assertValidRetryPolicy(policy);

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    assertNotCancelled(options.cancellation);
    const context = { attempt, maxAttempts: policy.maxAttempts } as const;
    await options.hooks?.onAttemptStarted?.(context);

    try {
      const result = await operation(context);
      assertNotCancelled(options.cancellation);
      return result;
    } catch (error) {
      if (error instanceof ExecutionCancelledError) {
        throw error;
      }

      assertNotCancelled(options.cancellation);
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

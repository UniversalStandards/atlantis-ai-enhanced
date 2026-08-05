import { InvalidEventError } from "./index.js";

const DEFAULT_MAX_WRITES_PER_EXECUTION = 64;

export type ExecutionWriteState =
  | "queued"
  | "running"
  | "committed"
  | "failed"
  | "aborted";

export class ExecutionWriteAbortedError extends Error {
  public constructor(
    public readonly executionId: string,
    public readonly reason: unknown,
  ) {
    super(`Execution write for ${executionId} was aborted.`);
    this.name = "ExecutionWriteAbortedError";
  }
}

export class ExecutionWriteQueueCapacityError extends Error {
  public constructor(
    public readonly executionId: string,
    public readonly maxWritesPerExecution: number,
  ) {
    super(
      `Execution write queue for ${executionId} reached its limit of ${maxWritesPerExecution}.`,
    );
    this.name = "ExecutionWriteQueueCapacityError";
  }
}

export interface AbortAcknowledgedExecutionWriterOptions {
  readonly maxWritesPerExecution?: number;
}

export interface AbortableExecutionWriteContext {
  readonly executionId: string;
  readonly signal: AbortSignal;
  acknowledgeAbort(): void;
}

export interface AbortableExecutionWriteHandle<T> {
  readonly executionId: string;
  readonly result: Promise<T>;
  readonly abortAcknowledged: Promise<void>;
  getState(): ExecutionWriteState;
  abort(reason?: unknown): void;
}

interface QueuedExecutionWrite {
  readonly executionId: string;
  readonly operation: (
    context: AbortableExecutionWriteContext,
  ) => unknown | Promise<unknown>;
  readonly controller: AbortController;
  readonly result: Promise<unknown>;
  readonly resolveResult: (value: unknown) => void;
  readonly rejectResult: (reason?: unknown) => void;
  readonly abortAcknowledged: Promise<void>;
  readonly acknowledgeAbort: () => void;
  state: ExecutionWriteState;
  abortReason: unknown;
}

function assertCanonicalExecutionId(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidEventError("executionId must be a string.");
  }
  const canonical = value.trim();
  if (canonical.length === 0) {
    throw new InvalidEventError("executionId must be non-empty.");
  }
  if (canonical !== value) {
    throw new InvalidEventError(
      "executionId must not contain leading or trailing whitespace.",
    );
  }
  return canonical;
}

function assertOperation<T>(
  operation: unknown,
): (context: AbortableExecutionWriteContext) => T | Promise<T> {
  if (typeof operation !== "function") {
    throw new InvalidEventError("execution write operation must be a function.");
  }
  return operation as (
    context: AbortableExecutionWriteContext,
  ) => T | Promise<T>;
}

function requireMaxWritesPerExecution(value: number | undefined): number {
  const maxWritesPerExecution = value ?? DEFAULT_MAX_WRITES_PER_EXECUTION;
  if (!Number.isSafeInteger(maxWritesPerExecution) || maxWritesPerExecution < 1) {
    throw new InvalidEventError(
      "maxWritesPerExecution must be a positive safe integer.",
    );
  }
  return maxWritesPerExecution;
}

/**
 * Event-store-owned per-execution writer queue.
 *
 * Queued writes may be aborted immediately. A running write retains its ordering
 * slot until it either settles or explicitly acknowledges abort. This prevents a
 * late settlement from escaping its assigned slot and corrupting trace order.
 * Queue capacity is bounded independently for each execution identity.
 */
export class AbortAcknowledgedExecutionWriter {
  private readonly queues = new Map<string, QueuedExecutionWrite[]>();
  private readonly maxWritesPerExecution: number;

  public constructor(options: AbortAcknowledgedExecutionWriterOptions = {}) {
    this.maxWritesPerExecution = requireMaxWritesPerExecution(
      options.maxWritesPerExecution,
    );
  }

  public enqueue<T>(
    executionId: string,
    operation: (context: AbortableExecutionWriteContext) => T | Promise<T>,
  ): AbortableExecutionWriteHandle<T> {
    const canonicalExecutionId = assertCanonicalExecutionId(executionId);
    const validatedOperation = assertOperation<T>(operation);
    const queue = this.queues.get(canonicalExecutionId) ?? [];
    if (queue.length >= this.maxWritesPerExecution) {
      throw new ExecutionWriteQueueCapacityError(
        canonicalExecutionId,
        this.maxWritesPerExecution,
      );
    }

    const controller = new AbortController();

    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    let acknowledgeAbort!: () => void;
    const abortAcknowledged = new Promise<void>((resolve) => {
      acknowledgeAbort = resolve;
    });

    const write: QueuedExecutionWrite = {
      executionId: canonicalExecutionId,
      operation: validatedOperation,
      controller,
      result,
      resolveResult: (value) => resolveResult(value as T),
      rejectResult,
      abortAcknowledged,
      acknowledgeAbort,
      state: "queued",
      abortReason: undefined,
    };

    queue.push(write);
    this.queues.set(canonicalExecutionId, queue);
    if (queue.length === 1) {
      void this.drain(canonicalExecutionId);
    }

    return Object.freeze({
      executionId: canonicalExecutionId,
      result,
      abortAcknowledged,
      getState: () => write.state,
      abort: (reason?: unknown) => {
        if (
          write.state === "committed" ||
          write.state === "failed" ||
          write.state === "aborted"
        ) {
          return;
        }

        write.abortReason = reason;
        controller.abort(reason);

        if (write.state === "queued") {
          write.state = "aborted";
          write.acknowledgeAbort();
          write.rejectResult(
            new ExecutionWriteAbortedError(canonicalExecutionId, reason),
          );
          this.removeQueuedWrite(canonicalExecutionId, write);
        }
      },
    });
  }

  private removeQueuedWrite(
    executionId: string,
    write: QueuedExecutionWrite,
  ): void {
    const queue = this.queues.get(executionId);
    if (queue === undefined) return;
    const index = queue.indexOf(write);
    if (index > 0) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      this.queues.delete(executionId);
    }
  }

  private async drain(executionId: string): Promise<void> {
    const queue = this.queues.get(executionId);
    if (queue === undefined || queue.length === 0) return;

    while (queue.length > 0) {
      const write = queue[0]!;
      if (write.state === "aborted") {
        queue.shift();
        continue;
      }

      write.state = "running";
      let operationSettled = false;
      let abortWasAcknowledged = false;

      const context: AbortableExecutionWriteContext = Object.freeze({
        executionId,
        signal: write.controller.signal,
        acknowledgeAbort: () => {
          if (!write.controller.signal.aborted || abortWasAcknowledged) return;
          abortWasAcknowledged = true;
          write.state = "aborted";
          write.acknowledgeAbort();
          write.rejectResult(
            new ExecutionWriteAbortedError(executionId, write.abortReason),
          );
        },
      });

      const operationPromise = Promise.resolve().then(() => write.operation(context));
      const releasePromise = new Promise<"settled" | "aborted">((resolve) => {
        void operationPromise.then(
          () => {
            operationSettled = true;
            resolve("settled");
          },
          () => {
            operationSettled = true;
            resolve("settled");
          },
        );
        void write.abortAcknowledged.then(() => resolve("aborted"));
      });

      const releaseReason = await releasePromise;
      if (releaseReason === "settled") {
        try {
          const value = await operationPromise;
          if (!abortWasAcknowledged) {
            write.state = "committed";
            write.resolveResult(value);
          }
        } catch (error) {
          if (!abortWasAcknowledged) {
            write.state = "failed";
            write.rejectResult(error);
          }
        }
      } else if (!operationSettled) {
        void operationPromise.catch(() => undefined);
      }

      queue.shift();
    }

    this.queues.delete(executionId);
  }
}

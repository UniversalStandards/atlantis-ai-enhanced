import { InvalidEventError } from "./index.js";

export class ExecutionCommitClosedError extends Error {
  public constructor(
    public readonly executionId: string,
    public readonly reason: unknown,
  ) {
    super(`Execution commit gate for ${executionId} is closed.`);
    this.name = "ExecutionCommitClosedError";
  }
}

function requireCanonicalExecutionId(value: unknown): string {
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

function requireCommit<T>(operation: unknown): () => T {
  if (typeof operation !== "function") {
    throw new InvalidEventError("execution commit operation must be a function.");
  }
  return operation as () => T;
}

/**
 * Synchronous mutation gate for a single execution write attempt.
 *
 * JavaScript cannot interleave an abort with a synchronous commit callback.
 * Closing the gate therefore proves that no later callback using this boundary
 * can mutate durable state after abort acknowledgement or abandonment.
 */
export class ExecutionCommitGuard {
  private readonly canonicalExecutionId: string;
  private closed = false;
  private closeReason: unknown;

  public constructor(executionId: string) {
    this.canonicalExecutionId = requireCanonicalExecutionId(executionId);
  }

  public get executionId(): string {
    return this.canonicalExecutionId;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public close(reason?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
  }

  public commit<T>(operation: () => T): T {
    const validatedOperation = requireCommit<T>(operation);
    if (this.closed) {
      throw new ExecutionCommitClosedError(
        this.canonicalExecutionId,
        this.closeReason,
      );
    }
    return validatedOperation();
  }
}

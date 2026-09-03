import type { ExecutionEvent, ExecutionUsage } from "./index.js";
import type { WorkflowCheckpoint } from "./resumable-runner.js";

export interface StepCompletionCommitRequest {
  readonly completionEvent: ExecutionEvent<{
    readonly stepId: string;
    readonly stepIndex: number;
  }>;
  readonly checkpoint: Omit<WorkflowCheckpoint, "revision">;
  readonly expectedCheckpointRevision: number | undefined;
}

export interface StepCompletionCommitResult {
  readonly checkpoint: WorkflowCheckpoint;
  readonly eventSequence: number;
  readonly eventId: string;
}

/**
 * Provider-neutral durability boundary for a completed workflow step.
 *
 * A conforming implementation MUST make the completion event and the advanced
 * checkpoint visible atomically: after any acknowledged success both are
 * durable, and after any reported failure recovery must never observe only one
 * of them as committed. Concrete persistence/provider selection is deliberately
 * outside this contract.
 */
export interface StepCompletionCommitPort {
  commitStepCompletion(
    request: Readonly<StepCompletionCommitRequest>,
  ): Promise<Readonly<StepCompletionCommitResult>>;
}

export class InvalidStepCompletionCommitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidStepCompletionCommitError";
  }
}

function sameUsage(left: ExecutionUsage, right: ExecutionUsage): boolean {
  return (
    left.toolCalls === right.toolCalls &&
    left.retries === right.retries &&
    left.iterations === right.iterations &&
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.durationMs === right.durationMs &&
    left.costUsd === right.costUsd
  );
}

function sameCompletedStepIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((stepId, index) => stepId === right[index]);
}

/**
 * Validates the acknowledgement returned by an atomic completion adapter.
 * This does not manufacture durability; it prevents a provider adapter from
 * acknowledging a commit whose checkpoint/event identity does not match the
 * requested transition.
 */
export function validateStepCompletionCommit(
  request: Readonly<StepCompletionCommitRequest>,
  result: Readonly<StepCompletionCommitResult>,
): WorkflowCheckpoint {
  const event = request.completionEvent;
  const requested = request.checkpoint;
  const committed = result.checkpoint;

  if (event.type !== "workflow.step.completed") {
    throw new InvalidStepCompletionCommitError("completion event type is invalid");
  }
  if (event.executionId !== requested.executionId) {
    throw new InvalidStepCompletionCommitError("completion event executionId does not match checkpoint");
  }
  if (event.sequence !== requested.lastEventSequence || result.eventSequence !== event.sequence) {
    throw new InvalidStepCompletionCommitError("completion event sequence does not match checkpoint");
  }
  if (event.id !== requested.parentEventId || result.eventId !== event.id) {
    throw new InvalidStepCompletionCommitError("completion event identity does not match checkpoint tail");
  }
  if (event.payload.stepIndex + 1 !== requested.nextStepIndex) {
    throw new InvalidStepCompletionCommitError("completion event step index does not advance checkpoint exactly once");
  }
  if (requested.completedStepIds.at(-1) !== event.payload.stepId) {
    throw new InvalidStepCompletionCommitError("completion event stepId does not match completed checkpoint prefix");
  }
  if (
    committed.executionId !== requested.executionId ||
    committed.workflowId !== requested.workflowId ||
    committed.workflowVersion !== requested.workflowVersion ||
    committed.nextStepIndex !== requested.nextStepIndex ||
    !sameCompletedStepIds(committed.completedStepIds, requested.completedStepIds) ||
    committed.lastEventSequence !== requested.lastEventSequence ||
    committed.parentEventId !== requested.parentEventId ||
    !sameUsage(committed.usage, requested.usage)
  ) {
    throw new InvalidStepCompletionCommitError("acknowledged checkpoint does not match requested completion transition");
  }
  if (!Number.isInteger(committed.revision) || committed.revision < 1) {
    throw new InvalidStepCompletionCommitError("acknowledged checkpoint revision is invalid");
  }
  return committed;
}

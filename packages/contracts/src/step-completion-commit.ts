import type { EventSink, ExecutionEvent, ExecutionUsage } from "./index.js";
import type {
  CheckpointStore,
  ExecutionEventCursor,
  WorkflowCheckpoint,
} from "./resumable-runner.js";

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

export type TerminalExecutionEventType = Extract<
  ExecutionEvent["type"],
  "execution.completed" | "execution.failed" | "execution.cancelled" | "execution.timed_out"
>;

export interface TerminalExecutionCommitRequest {
  readonly terminalEvent: ExecutionEvent<unknown>;
  readonly checkpoint: WorkflowCheckpoint | undefined;
  readonly expectedCheckpointRevision: number | undefined;
  readonly completedStepIds: readonly string[];
}

export interface TerminalExecutionCommitResult {
  readonly terminalEvent: ExecutionEvent<unknown>;
  readonly eventSequence: number;
  readonly eventId: string;
  readonly checkpoint: WorkflowCheckpoint | undefined;
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

export interface TerminalExecutionCommitPort {
  commitTerminalExecution(
    request: Readonly<TerminalExecutionCommitRequest>,
  ): Promise<Readonly<TerminalExecutionCommitResult>>;
  loadTerminalEvent(executionId: string): Promise<ExecutionEvent<unknown> | undefined>;
}

/**
 * Authoritative provider-neutral persistence boundary used by resumable
 * execution. The same consistency domain owns ordinary execution events,
 * restart-visible event cursors, checkpoint lifecycle, and atomic completed-step
 * publication. This prevents recovery from reading completion/checkpoint state
 * from one authority while deriving its event tail from another.
 *
 * This is an interface invariant only; it does not select a production
 * database, transaction mechanism, credential model, or deployment authority.
 */
export interface ResumableDurabilityPort
  extends CheckpointStore,
    StepCompletionCommitPort,
    TerminalExecutionCommitPort,
    EventSink {
  loadEventCursor(executionId: string): Promise<ExecutionEventCursor>;
}

export class InvalidStepCompletionCommitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidStepCompletionCommitError";
  }
}

export class InvalidTerminalExecutionCommitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidTerminalExecutionCommitError";
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

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Conservative structural equality for checkpoint data. Persisted plain data
 * may be deserialized into a distinct object identity, while functions,
 * accessors, symbols, exotic prototypes, and structurally ambiguous values are
 * intentionally rejected unless they retain exact identity.
 */
function sameCheckpointValue(
  left: unknown,
  right: unknown,
  seen: WeakMap<object, object> = new WeakMap<object, object>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;

  const leftObject = left as object;
  const rightObject = right as object;
  const previous = seen.get(leftObject);
  if (previous !== undefined) return previous === rightObject;
  seen.set(leftObject, rightObject);

  if (Array.isArray(leftObject) || Array.isArray(rightObject)) {
    if (!Array.isArray(leftObject) || !Array.isArray(rightObject)) return false;
    if (leftObject.length !== rightObject.length) return false;
    return leftObject.every((item, index) =>
      sameCheckpointValue(item, rightObject[index], seen),
    );
  }

  if (!isPlainObject(leftObject) || !isPlainObject(rightObject)) return false;
  const leftKeys = Reflect.ownKeys(leftObject);
  const rightKeys = Reflect.ownKeys(rightObject);
  if (
    leftKeys.some((key) => typeof key !== "string") ||
    rightKeys.some((key) => typeof key !== "string") ||
    leftKeys.length !== rightKeys.length
  ) {
    return false;
  }

  const rightKeySet = new Set(rightKeys as string[]);
  for (const key of leftKeys as string[]) {
    if (!rightKeySet.has(key)) return false;
    const leftDescriptor = Object.getOwnPropertyDescriptor(leftObject, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(rightObject, key);
    if (
      leftDescriptor === undefined ||
      rightDescriptor === undefined ||
      !("value" in leftDescriptor) ||
      !("value" in rightDescriptor) ||
      leftDescriptor.enumerable !== rightDescriptor.enumerable ||
      !sameCheckpointValue(leftDescriptor.value, rightDescriptor.value, seen)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Validates the acknowledgement returned by an atomic completion adapter.
 * This does not manufacture durability; it prevents a provider adapter from
 * acknowledging a commit whose checkpoint/event identity or post-step state
 * does not match the requested transition.
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
    !sameUsage(committed.usage, requested.usage) ||
    !sameCheckpointValue(committed.value, requested.value) ||
    !sameCheckpointValue(committed.pendingApproval, requested.pendingApproval) ||
    !sameCheckpointValue(committed.approvedApproval, requested.approvedApproval)
  ) {
    throw new InvalidStepCompletionCommitError("acknowledged checkpoint does not match requested completion transition");
  }
  const expectedCommittedRevision = (request.expectedCheckpointRevision ?? 0) + 1;
  if (
    !Number.isSafeInteger(expectedCommittedRevision) ||
    expectedCommittedRevision < 1 ||
    committed.revision !== expectedCommittedRevision
  ) {
    throw new InvalidStepCompletionCommitError("acknowledged checkpoint revision does not advance exactly once");
  }
  return committed;
}

export function isTerminalExecutionEvent(
  event: Readonly<ExecutionEvent<unknown>>,
): event is ExecutionEvent<unknown> & { readonly type: TerminalExecutionEventType } {
  return (
    event.type === "execution.completed" ||
    event.type === "execution.failed" ||
    event.type === "execution.cancelled" ||
    event.type === "execution.timed_out"
  );
}

export function terminalExecutionEventsEqual(
  left: Readonly<ExecutionEvent<unknown>>,
  right: Readonly<ExecutionEvent<unknown>>,
): boolean {
  return (
    left.id === right.id &&
    left.executionId === right.executionId &&
    left.sequence === right.sequence &&
    left.type === right.type &&
    left.occurredAt === right.occurredAt &&
    left.actor === right.actor &&
    left.parentEventId === right.parentEventId &&
    sameCheckpointValue(left.payload, right.payload)
  );
}

function payloadCompletedStepIds(event: Readonly<ExecutionEvent<unknown>>): readonly string[] {
  const payload = event.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidTerminalExecutionCommitError(
      "terminal event payload must include completedStepIds",
    );
  }
  const completedStepIds = (payload as { readonly completedStepIds?: unknown }).completedStepIds;
  if (
    !Array.isArray(completedStepIds) ||
    completedStepIds.some((stepId) => typeof stepId !== "string" || stepId.length === 0)
  ) {
    throw new InvalidTerminalExecutionCommitError(
      "terminal event payload completedStepIds must be a string prefix array",
    );
  }
  return completedStepIds as readonly string[];
}

export function validateTerminalExecutionCommit(
  request: Readonly<TerminalExecutionCommitRequest>,
  result: Readonly<TerminalExecutionCommitResult>,
): ExecutionEvent<unknown> {
  const event = request.terminalEvent;
  if (!isTerminalExecutionEvent(event)) {
    throw new InvalidTerminalExecutionCommitError("terminal execution event type is invalid");
  }
  if (request.checkpoint === undefined && request.expectedCheckpointRevision !== undefined) {
    throw new InvalidTerminalExecutionCommitError(
      "terminal execution without checkpoint cannot expect a checkpoint revision",
    );
  }
  if (
    request.checkpoint !== undefined &&
    request.checkpoint.revision !== request.expectedCheckpointRevision
  ) {
    throw new InvalidTerminalExecutionCommitError(
      "terminal execution expected checkpoint revision does not match checkpoint",
    );
  }
  if (!sameCompletedStepIds(payloadCompletedStepIds(event), request.completedStepIds)) {
    throw new InvalidTerminalExecutionCommitError(
      "terminal event completedStepIds does not match requested completed prefix",
    );
  }
  if (
    request.checkpoint !== undefined &&
    (!sameCompletedStepIds(request.checkpoint.completedStepIds, request.completedStepIds) ||
      request.checkpoint.executionId !== event.executionId)
  ) {
    throw new InvalidTerminalExecutionCommitError(
      "terminal event must preserve the active checkpoint execution prefix",
    );
  }
  if (
    !terminalExecutionEventsEqual(result.terminalEvent, event) ||
    result.eventSequence !== event.sequence ||
    result.eventId !== event.id
  ) {
    throw new InvalidTerminalExecutionCommitError(
      "acknowledged terminal event does not match requested terminal transition",
    );
  }
  if (result.checkpoint !== undefined) {
    throw new InvalidTerminalExecutionCommitError(
      "acknowledged terminal transition must retire the checkpoint",
    );
  }
  return result.terminalEvent;
}

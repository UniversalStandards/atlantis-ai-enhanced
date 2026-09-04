import type { ApprovalRequest, ResolvedApproval } from "./approval-control.js";
import type { ExecutionEvent, ExecutionUsage } from "./index.js";
import type { ExecutionEventCursor, WorkflowCheckpoint } from "./resumable-runner.js";
import {
  validateAttemptFailureCommit,
  type AttemptFailureCommitRequest,
  type AttemptFailureCommitResult,
  type AttemptFailureEventPayload,
  type ResumableDurabilityPort,
} from "./step-completion-commit.js";

export interface AtomicAttemptFailureInput {
  readonly durability: ResumableDurabilityPort;
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly stepId: string;
  readonly stepIndex: number;
  readonly completedStepIds: readonly string[];
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly error: string;
  readonly value: unknown;
  /** Usage before the retry allowance for this failure is consumed. */
  readonly usage: ExecutionUsage;
  /** Attempts of this step already accounted for by authoritative state. */
  readonly consumedAttemptsBefore: number;
  /** Whether this failure is followed by another attempt in this process. */
  readonly willRetry: boolean;
  readonly cursor: ExecutionEventCursor;
  readonly expectedCheckpointRevision: number | undefined;
  readonly pendingApproval?: ApprovalRequest;
  readonly approvedApproval?: ResolvedApproval;
  readonly nextEventId: () => string;
  readonly actor: string;
  readonly occurredAt: string;
}

export interface AtomicAttemptFailureResult {
  readonly checkpoint: WorkflowCheckpoint;
  readonly cursor: ExecutionEventCursor;
}

function cursorsEqual(
  left: Readonly<ExecutionEventCursor>,
  right: Readonly<ExecutionEventCursor>,
): boolean {
  return left.sequence === right.sequence && left.parentEventId === right.parentEventId;
}

async function reconcileCommitAfterError(
  durability: ResumableDurabilityPort,
  request: Readonly<AttemptFailureCommitRequest>,
): Promise<WorkflowCheckpoint | undefined> {
  const checkpoint = await durability.load(request.checkpoint.executionId);
  if (checkpoint === undefined) return undefined;

  const cursor = await durability.loadEventCursor(request.checkpoint.executionId);
  if (
    cursor.sequence !== request.attemptFailedEvent.sequence ||
    cursor.parentEventId !== request.attemptFailedEvent.id
  ) {
    return undefined;
  }

  const result: AttemptFailureCommitResult = {
    checkpoint,
    eventSequence: cursor.sequence,
    eventId: cursor.parentEventId,
  };
  return validateAttemptFailureCommit(request, result);
}

/**
 * Single provider-neutral execution-path transition for a failed attempt. The
 * `workflow.step.attempt.failed` evidence and the checkpoint that consumes the
 * attempt (and, when another attempt follows, its retry allowance) are
 * submitted together to the same durability authority,
 * and the acknowledgement is validated before execution may continue. There is
 * therefore no window in which durable failure evidence exists while the
 * consumed allowance can still be restored by a crash.
 *
 * If the adapter reports an error after authoritative publication but before
 * acknowledgement reaches the caller, the transition performs readback-only
 * reconciliation: it treats the operation as committed only when the validator
 * proves the authoritative checkpoint and event tail are the exact requested
 * transition, so acknowledgement loss can neither restore nor double-consume a
 * retry allowance. Otherwise the original failure remains authoritative.
 *
 * Production persistence/provider selection remains outside this helper.
 */
export async function commitAtomicAttemptFailure(
  input: Readonly<AtomicAttemptFailureInput>,
): Promise<Readonly<AtomicAttemptFailureResult>> {
  if (input.completedStepIds.length !== input.stepIndex) {
    throw new Error("completedStepIds must be the exact prefix before the failing step");
  }

  const authoritativeCursor = await input.durability.loadEventCursor(input.executionId);
  if (!cursorsEqual(input.cursor, authoritativeCursor)) {
    throw new Error("cursor does not match authoritative durability event cursor");
  }

  const payload: AttemptFailureEventPayload = {
    stepId: input.stepId,
    stepIndex: input.stepIndex,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    willRetry: input.willRetry,
    error: input.error,
  };
  const event: ExecutionEvent<AttemptFailureEventPayload> = {
    id: input.nextEventId(),
    executionId: input.executionId,
    sequence: authoritativeCursor.sequence + 1,
    type: "workflow.step.attempt.failed",
    occurredAt: input.occurredAt,
    actor: input.actor,
    ...(authoritativeCursor.parentEventId === undefined
      ? {}
      : { parentEventId: authoritativeCursor.parentEventId }),
    payload,
  };

  const request: AttemptFailureCommitRequest = {
    attemptFailedEvent: event,
    checkpoint: {
      executionId: input.executionId,
      workflowId: input.workflowId,
      workflowVersion: input.workflowVersion,
      nextStepIndex: input.stepIndex,
      completedStepIds: [...input.completedStepIds],
      value: input.value,
      usage: {
        ...input.usage,
        retries: input.usage.retries + (input.willRetry ? 1 : 0),
      },
      lastEventSequence: event.sequence,
      parentEventId: event.id,
      stepAttemptConsumption: {
        stepId: input.stepId,
        stepIndex: input.stepIndex,
        consumedAttempts: input.consumedAttemptsBefore + 1,
      },
      ...(input.pendingApproval === undefined
        ? {}
        : { pendingApproval: input.pendingApproval }),
      ...(input.approvedApproval === undefined
        ? {}
        : { approvedApproval: input.approvedApproval }),
    },
    expectedCheckpointRevision: input.expectedCheckpointRevision,
    consumedRetriesBefore: input.usage.retries,
    consumedAttemptsBefore: input.consumedAttemptsBefore,
  };

  let checkpoint: WorkflowCheckpoint;
  try {
    const result = await input.durability.commitAttemptFailure(request);
    checkpoint = validateAttemptFailureCommit(request, result);
  } catch (error) {
    let reconciled: WorkflowCheckpoint | undefined;
    try {
      reconciled = await reconcileCommitAfterError(input.durability, request);
    } catch {
      // Reconciliation is evidence, not a replacement error. Preserve the
      // original adapter failure unless exact committed state can be proven.
      reconciled = undefined;
    }
    if (reconciled === undefined) throw error;
    checkpoint = reconciled;
  }

  return {
    checkpoint,
    cursor: {
      sequence: checkpoint.lastEventSequence,
      ...(checkpoint.parentEventId === undefined
        ? {}
        : { parentEventId: checkpoint.parentEventId }),
    },
  };
}

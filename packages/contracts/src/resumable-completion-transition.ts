import type { ExecutionEvent, ExecutionUsage } from "./index.js";
import type { WorkflowCheckpoint } from "./resumable-runner.js";
import {
  validateStepCompletionCommit,
  type ResumableDurabilityPort,
  type StepCompletionCommitRequest,
  type StepCompletionCommitResult,
} from "./step-completion-commit.js";

export interface AtomicResumableCompletionInput {
  readonly durability: ResumableDurabilityPort;
  readonly completionEvent: ExecutionEvent<{
    readonly stepId: string;
    readonly stepIndex: number;
  }>;
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly completedStepIds: readonly string[];
  readonly value: unknown;
  readonly usage: ExecutionUsage;
  readonly expectedCheckpointRevision: number | undefined;
}

function createRequest(
  input: Readonly<AtomicResumableCompletionInput>,
): Readonly<StepCompletionCommitRequest> {
  const event = input.completionEvent;
  const checkpoint: Omit<WorkflowCheckpoint, "revision"> = {
    executionId: input.executionId,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
    nextStepIndex: event.payload.stepIndex + 1,
    completedStepIds: [...input.completedStepIds],
    value: input.value,
    usage: { ...input.usage },
    lastEventSequence: event.sequence,
    parentEventId: event.id,
  };

  return {
    completionEvent: event,
    checkpoint,
    expectedCheckpointRevision: input.expectedCheckpointRevision,
  };
}

async function reconcileCommitAfterError(
  durability: ResumableDurabilityPort,
  request: Readonly<StepCompletionCommitRequest>,
): Promise<WorkflowCheckpoint | undefined> {
  const checkpoint = await durability.load(request.checkpoint.executionId);
  if (checkpoint === undefined) return undefined;

  const cursor = await durability.loadEventCursor(request.checkpoint.executionId);
  if (
    cursor.sequence !== request.completionEvent.sequence ||
    cursor.parentEventId !== request.completionEvent.id
  ) {
    return undefined;
  }

  const result: StepCompletionCommitResult = {
    checkpoint,
    eventSequence: cursor.sequence,
    eventId: cursor.parentEventId,
  };
  return validateStepCompletionCommit(request, result);
}

/**
 * Single provider-neutral execution-path transition for acknowledged step
 * completion. The completion event and the checkpoint that advances beyond the
 * step are submitted to the same durability authority and the acknowledgement
 * is validated before execution may continue.
 *
 * If the adapter reports an error after authoritative publication but before
 * acknowledgement reaches the caller, the transition performs readback-only
 * reconciliation. It treats the operation as committed only when the existing
 * validator proves the authoritative checkpoint and event tail are the exact
 * requested transition; otherwise the original failure remains authoritative.
 *
 * Production persistence/provider selection remains outside this helper.
 */
export async function commitAtomicResumableCompletion(
  input: Readonly<AtomicResumableCompletionInput>,
): Promise<WorkflowCheckpoint> {
  const request = createRequest(input);

  try {
    const result = await input.durability.commitStepCompletion(request);
    return validateStepCompletionCommit(request, result);
  } catch (error) {
    try {
      const reconciled = await reconcileCommitAfterError(input.durability, request);
      if (reconciled !== undefined) return reconciled;
    } catch {
      // Reconciliation itself is evidence, not a replacement error. Preserve the
      // original adapter failure unless exact committed state can be proven.
    }
    throw error;
  }
}

import type { ExecutionEvent, ExecutionUsage } from "./index.js";
import type { WorkflowCheckpoint } from "./resumable-runner.js";
import {
  validateStepCompletionCommit,
  type ResumableDurabilityPort,
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

/**
 * Single provider-neutral execution-path transition for acknowledged step
 * completion. The completion event and the checkpoint that advances beyond the
 * step are submitted to the same durability authority and the acknowledgement
 * is validated before execution may continue.
 *
 * Production persistence/provider selection remains outside this helper.
 */
export async function commitAtomicResumableCompletion(
  input: Readonly<AtomicResumableCompletionInput>,
): Promise<WorkflowCheckpoint> {
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

  const request = {
    completionEvent: event,
    checkpoint,
    expectedCheckpointRevision: input.expectedCheckpointRevision,
  } as const;

  const result = await input.durability.commitStepCompletion(request);
  return validateStepCompletionCommit(request, result);
}

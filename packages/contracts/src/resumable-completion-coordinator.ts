import type { ExecutionEvent, ExecutionUsage } from "./index.js";
import type { ExecutionEventCursor, WorkflowCheckpoint } from "./resumable-runner.js";
import type { ResumableDurabilityPort } from "./step-completion-commit.js";
import { commitAtomicResumableCompletion } from "./resumable-completion-transition.js";

export interface ResumableCompletionCoordinatorInput {
  readonly durability: ResumableDurabilityPort;
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly stepId: string;
  readonly stepIndex: number;
  readonly completedStepIds: readonly string[];
  readonly value: unknown;
  readonly usage: ExecutionUsage;
  readonly cursor: ExecutionEventCursor;
  readonly expectedCheckpointRevision: number | undefined;
  readonly nextEventId: () => string;
  readonly actor: string;
  readonly occurredAt: string;
}

export interface ResumableCompletionCoordinatorResult {
  readonly checkpoint: WorkflowCheckpoint;
  readonly cursor: ExecutionEventCursor;
}

function cursorsEqual(
  left: Readonly<ExecutionEventCursor>,
  right: Readonly<ExecutionEventCursor>,
): boolean {
  return left.sequence === right.sequence && left.parentEventId === right.parentEventId;
}

/**
 * Constructs and atomically commits the execution-path completion transition.
 * The caller's cursor can advance only from the acknowledged result, preventing
 * in-memory progress from outrunning durable completion/checkpoint visibility.
 *
 * This coordinator is provider-neutral and deliberately grants no production
 * persistence, credential, deployment, or permission semantics.
 */
export async function coordinateAtomicResumableCompletion(
  input: Readonly<ResumableCompletionCoordinatorInput>,
): Promise<Readonly<ResumableCompletionCoordinatorResult>> {
  if (input.completedStepIds.at(-1) !== input.stepId) {
    throw new Error("completedStepIds must end with the completing step");
  }
  if (input.completedStepIds.length !== input.stepIndex + 1) {
    throw new Error("completedStepIds must be the exact completed workflow prefix");
  }

  const authoritativeCursor = await input.durability.loadEventCursor(input.executionId);
  if (!cursorsEqual(input.cursor, authoritativeCursor)) {
    throw new Error("cursor does not match authoritative durability event cursor");
  }

  const event: ExecutionEvent<{ readonly stepId: string; readonly stepIndex: number }> = {
    id: input.nextEventId(),
    executionId: input.executionId,
    sequence: authoritativeCursor.sequence + 1,
    type: "workflow.step.completed",
    occurredAt: input.occurredAt,
    actor: input.actor,
    ...(authoritativeCursor.parentEventId === undefined
      ? {}
      : { parentEventId: authoritativeCursor.parentEventId }),
    payload: { stepId: input.stepId, stepIndex: input.stepIndex },
  };

  const checkpoint = await commitAtomicResumableCompletion({
    durability: input.durability,
    completionEvent: event,
    executionId: input.executionId,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
    completedStepIds: input.completedStepIds,
    value: input.value,
    usage: input.usage,
    expectedCheckpointRevision: input.expectedCheckpointRevision,
  });

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

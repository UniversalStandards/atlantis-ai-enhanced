import type { EventSink, ExecutionEvent } from "../src/index.js";
import type {
  CheckpointStore,
  ExecutionEventCursor,
  WorkflowCheckpoint,
} from "../src/resumable-runner.js";
import {
  InvalidStepCompletionCommitError,
  validateAttemptFailureCommit,
  validateStepCompletionCommit,
  type AttemptFailureCommitRequest,
  type AttemptFailureCommitResult,
  type ResumableDurabilityPort,
  type StepCompletionCommitRequest,
  type StepCompletionCommitResult,
} from "../src/step-completion-commit.js";

export interface MutableCheckpointHarness extends CheckpointStore {
  checkpoint: WorkflowCheckpoint | undefined;
}

export interface MutableEventHarness extends EventSink {
  readonly events: ExecutionEvent[];
  cursor(): ExecutionEventCursor;
}

/**
 * Test-only adapter for the pre-existing memory fixtures. Atomic completed-step
 * publication mutates both fixture records synchronously in one JavaScript turn;
 * there is no production durability claim. This lets the existing behavioral
 * suites exercise the same authoritative runner path without duplicating their
 * approval/retry/timeout fixture logic.
 */
export function createAtomicMemoryTestDurability(
  checkpoints: MutableCheckpointHarness,
  events: MutableEventHarness,
): ResumableDurabilityPort {
  return {
    load: (executionId) => checkpoints.load(executionId),
    save: (checkpoint, expectedRevision) => checkpoints.save(checkpoint, expectedRevision),
    clear: (executionId, expectedRevision) => checkpoints.clear(executionId, expectedRevision),
    append: <T>(event: ExecutionEvent<T>) => events.append(event),
    loadEventCursor: async () => ({ ...events.cursor() }),
    commitStepCompletion: async (
      request: Readonly<StepCompletionCommitRequest>,
    ): Promise<Readonly<StepCompletionCommitResult>> => {
      const current = checkpoints.checkpoint;
      if (current?.revision !== request.expectedCheckpointRevision) {
        throw new InvalidStepCompletionCommitError(
          "expected checkpoint revision does not match authoritative test state",
        );
      }

      const cursor = events.cursor();
      if (
        request.completionEvent.sequence !== cursor.sequence + 1 ||
        request.completionEvent.parentEventId !== cursor.parentEventId
      ) {
        throw new InvalidStepCompletionCommitError(
          "completion event does not extend authoritative test event tail",
        );
      }

      const committed: WorkflowCheckpoint = structuredClone({
        ...request.checkpoint,
        revision: (current?.revision ?? 0) + 1,
      });
      const result: StepCompletionCommitResult = {
        checkpoint: committed,
        eventSequence: request.completionEvent.sequence,
        eventId: request.completionEvent.id,
      };
      validateStepCompletionCommit(request, result);

      events.events.push(request.completionEvent as ExecutionEvent);
      checkpoints.checkpoint = committed;
      return structuredClone(result);
    },
    commitAttemptFailure: async (
      request: Readonly<AttemptFailureCommitRequest>,
    ): Promise<Readonly<AttemptFailureCommitResult>> => {
      const current = checkpoints.checkpoint;
      if (current?.revision !== request.expectedCheckpointRevision) {
        throw new InvalidStepCompletionCommitError(
          "expected checkpoint revision does not match authoritative test state",
        );
      }
      if ((current?.usage.retries ?? 0) !== request.consumedRetriesBefore) {
        throw new InvalidStepCompletionCommitError(
          "consumed retry count does not match authoritative test state",
        );
      }

      const cursor = events.cursor();
      if (
        request.attemptFailedEvent.sequence !== cursor.sequence + 1 ||
        request.attemptFailedEvent.parentEventId !== cursor.parentEventId
      ) {
        throw new InvalidStepCompletionCommitError(
          "attempt failure event does not extend authoritative test event tail",
        );
      }

      const committed: WorkflowCheckpoint = structuredClone({
        ...request.checkpoint,
        revision: (current?.revision ?? 0) + 1,
      });
      const result: AttemptFailureCommitResult = {
        checkpoint: committed,
        eventSequence: request.attemptFailedEvent.sequence,
        eventId: request.attemptFailedEvent.id,
      };
      validateAttemptFailureCommit(request, result);

      events.events.push(request.attemptFailedEvent as ExecutionEvent);
      checkpoints.checkpoint = committed;
      return structuredClone(result);
    },
  };
}

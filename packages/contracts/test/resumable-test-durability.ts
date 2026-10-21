import type { EventSink, ExecutionEvent } from "../src/index.js";
import type {
  CheckpointStore,
  ExecutionEventCursor,
  WorkflowCheckpoint,
} from "../src/resumable-runner.js";
import {
  InvalidStepCompletionCommitError,
  validateAttemptFailureCommit,
  isTerminalExecutionEvent,
  terminalExecutionEventsEqual,
  validateTerminalExecutionCommit,
  validateStepCompletionCommit,
  type AttemptFailureCommitRequest,
  type AttemptFailureCommitResult,
  type ResumableDurabilityPort,
  type StepCompletionCommitRequest,
  type StepCompletionCommitResult,
  type TerminalExecutionCommitRequest,
  type TerminalExecutionCommitResult,
  type TerminalExecutionResultRecord,
  type TerminalExecutionResultReference,
} from "../src/step-completion-commit.js";

export interface MutableCheckpointHarness extends CheckpointStore {
  checkpoint: WorkflowCheckpoint | undefined;
}

export interface MutableEventHarness extends EventSink {
  readonly events: ExecutionEvent[];
  cursor(): ExecutionEventCursor;
}

export interface AtomicMemoryTestDurabilityOptions {
  readonly failTerminalAt?:
    | "before-publication"
    | "after-publication-pre-ack"
    | "before-retirement"
    | "after-retirement-ack"
    | undefined;
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
  options: AtomicMemoryTestDurabilityOptions = {},
): ResumableDurabilityPort {
  const terminalResults = new Map<string, TerminalExecutionResultRecord>();
  const findTerminalEvent = (executionId: string): ExecutionEvent<unknown> | undefined => {
    for (let index = events.events.length - 1; index >= 0; index -= 1) {
      const event = events.events[index];
      if (event !== undefined && event.executionId === executionId && isTerminalExecutionEvent(event)) {
        return event;
      }
    }
    return undefined;
  };

  return {
    load: (executionId) => checkpoints.load(executionId),
    save: (checkpoint, expectedRevision) => checkpoints.save(checkpoint, expectedRevision),
    clear: (executionId, expectedRevision) => checkpoints.clear(executionId, expectedRevision),
    append: <T>(event: ExecutionEvent<T>) => events.append(event),
    loadEventCursor: async () => ({ ...events.cursor() }),
    loadTerminalEvent: async (executionId) => {
      const event = findTerminalEvent(executionId);
      return event === undefined ? undefined : structuredClone(event);
    },
    loadTerminalResult: async (reference: TerminalExecutionResultReference) =>
      structuredClone(terminalResults.get(reference.reference)),
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
    commitTerminalExecution: async (
      request: Readonly<TerminalExecutionCommitRequest>,
    ): Promise<Readonly<TerminalExecutionCommitResult>> => {
      if (options.failTerminalAt === "before-publication") {
        throw new Error("injected terminal failure before publication");
      }

      const current = checkpoints.checkpoint;
      if (current?.revision !== request.expectedCheckpointRevision) {
        throw new InvalidStepCompletionCommitError(
          "expected checkpoint revision does not match authoritative test state",
        );
      }
      validateTerminalExecutionCommit(request, {
        terminalEvent: request.terminalEvent,
        eventSequence: request.terminalEvent.sequence,
        eventId: request.terminalEvent.id,
        checkpoint: undefined,
      });

      const existingTerminal = findTerminalEvent(request.terminalEvent.executionId);
      if (existingTerminal === undefined) {
        const cursor = events.cursor();
        if (
          request.terminalEvent.sequence !== cursor.sequence + 1 ||
          request.terminalEvent.parentEventId !== cursor.parentEventId
        ) {
          throw new InvalidStepCompletionCommitError(
            "terminal event does not extend authoritative test event tail",
          );
        }
        events.events.push(request.terminalEvent as ExecutionEvent);
      } else if (!terminalExecutionEventsEqual(existingTerminal, request.terminalEvent)) {
        throw new InvalidStepCompletionCommitError(
          "execution already has different terminal evidence",
        );
      }
      if (request.terminalResult !== undefined) {
        terminalResults.set(
          request.terminalResult.reference.reference,
          structuredClone(request.terminalResult),
        );
      }

      if (options.failTerminalAt === "after-publication-pre-ack") {
        throw new Error("injected terminal acknowledgement loss after publication");
      }
      if (options.failTerminalAt === "before-retirement") {
        throw new Error("injected terminal failure before checkpoint retirement");
      }

      checkpoints.checkpoint = undefined;
      const result: TerminalExecutionCommitResult = {
        terminalEvent: request.terminalEvent,
        eventSequence: request.terminalEvent.sequence,
        eventId: request.terminalEvent.id,
        checkpoint: checkpoints.checkpoint,
      };
      validateTerminalExecutionCommit(request, result);

      if (options.failTerminalAt === "after-retirement-ack") {
        throw new Error("injected terminal acknowledgement loss after retirement");
      }

      return structuredClone(result);
    },
  };
}

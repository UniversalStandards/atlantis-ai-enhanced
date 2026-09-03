import type { ExecutionEvent } from "./index.js";
import {
  InvalidStepCompletionCommitError,
  validateAttemptFailureCommit,
  validateStepCompletionCommit,
  type AttemptFailureCommitRequest,
  type AttemptFailureCommitResult,
  type ResumableDurabilityPort,
  type StepCompletionCommitRequest,
  type StepCompletionCommitResult,
} from "./step-completion-commit.js";
import type { ExecutionEventCursor, WorkflowCheckpoint } from "./resumable-runner.js";

export type StepCompletionFailurePoint =
  | "before_commit"
  | "after_validation_before_publish"
  | "after_publish_before_ack";

export interface InMemoryStepCompletionCommitOptions {
  readonly failAt?: StepCompletionFailurePoint;
  /** Independent injection for the retry-consuming attempt-failure transition. */
  readonly attemptFailureFailAt?: StepCompletionFailurePoint;
  readonly initialCheckpoints?: readonly WorkflowCheckpoint[];
}

function cloneCheckpoint(checkpoint: WorkflowCheckpoint): WorkflowCheckpoint {
  return {
    ...checkpoint,
    completedStepIds: [...checkpoint.completedStepIds],
    usage: { ...checkpoint.usage },
  };
}

function eventCursor(sequence: number, parentEventId?: string): ExecutionEventCursor {
  return parentEventId === undefined ? { sequence } : { sequence, parentEventId };
}

function assertExpectedRevision(
  current: WorkflowCheckpoint | undefined,
  expectedRevision: number | undefined,
): void {
  if (current?.revision !== expectedRevision) {
    throw new InvalidStepCompletionCommitError(
      "expected checkpoint revision does not match authoritative state",
    );
  }
}

function assertEventExtendsCursor(
  event: Readonly<ExecutionEvent>,
  cursor: Readonly<ExecutionEventCursor>,
  label: string,
): void {
  const expectedSequence = cursor.sequence + 1;
  if (event.sequence !== expectedSequence) {
    throw new InvalidStepCompletionCommitError(
      `${label} does not extend authoritative execution stream`,
    );
  }
  if (cursor.sequence === 0) {
    if (event.parentEventId !== undefined) {
      throw new InvalidStepCompletionCommitError(`first ${label} cannot identify a parent`);
    }
    return;
  }
  if (event.parentEventId !== cursor.parentEventId) {
    throw new InvalidStepCompletionCommitError(
      `${label} parent does not match authoritative execution stream tail`,
    );
  }
}

/** Reference-only authoritative durability adapter; no production durability claim. */
export class InMemoryStepCompletionCommitPort implements ResumableDurabilityPort {
  private readonly checkpoints = new Map<string, WorkflowCheckpoint>();
  private readonly events = new Map<string, ExecutionEvent[]>();
  private readonly eventCursors = new Map<string, ExecutionEventCursor>();

  public constructor(private readonly options: InMemoryStepCompletionCommitOptions = {}) {
    for (const checkpoint of options.initialCheckpoints ?? []) {
      if (this.checkpoints.has(checkpoint.executionId)) {
        throw new InvalidStepCompletionCommitError("initial checkpoint executionId must be unique");
      }
      this.checkpoints.set(checkpoint.executionId, cloneCheckpoint(checkpoint));
      this.eventCursors.set(
        checkpoint.executionId,
        eventCursor(checkpoint.lastEventSequence, checkpoint.parentEventId),
      );
    }
  }

  public async load(executionId: string): Promise<WorkflowCheckpoint | undefined> {
    return this.loadCheckpoint(executionId);
  }

  public async save(
    checkpoint: Omit<WorkflowCheckpoint, "revision">,
    expectedRevision: number | undefined,
  ): Promise<WorkflowCheckpoint> {
    const current = this.checkpoints.get(checkpoint.executionId);
    assertExpectedRevision(current, expectedRevision);
    const committed: WorkflowCheckpoint = {
      ...checkpoint,
      completedStepIds: [...checkpoint.completedStepIds],
      usage: { ...checkpoint.usage },
      revision: (current?.revision ?? 0) + 1,
    };
    this.checkpoints.set(checkpoint.executionId, committed);
    return cloneCheckpoint(committed);
  }

  public async clear(executionId: string, expectedRevision: number): Promise<void> {
    const current = this.checkpoints.get(executionId);
    if (current === undefined || current.revision !== expectedRevision) {
      throw new InvalidStepCompletionCommitError(
        "expected checkpoint revision does not match authoritative state",
      );
    }
    this.checkpoints.delete(executionId);
  }

  public async append<T>(event: ExecutionEvent<T>): Promise<void> {
    const cursor = this.eventCursors.get(event.executionId) ?? { sequence: 0 };
    assertEventExtendsCursor(event, cursor, "event");
    const stream = this.events.get(event.executionId) ?? [];
    stream.push(event as ExecutionEvent);
    this.events.set(event.executionId, stream);
    this.eventCursors.set(event.executionId, eventCursor(event.sequence, event.id));
  }

  public async loadEventCursor(executionId: string): Promise<ExecutionEventCursor> {
    const cursor = this.eventCursors.get(executionId);
    return cursor === undefined ? { sequence: 0 } : { ...cursor };
  }

  public async commitStepCompletion(
    request: Readonly<StepCompletionCommitRequest>,
  ): Promise<Readonly<StepCompletionCommitResult>> {
    if (this.options.failAt === "before_commit") {
      throw new Error("injected step-completion failure before commit");
    }

    const current = this.checkpoints.get(request.checkpoint.executionId);
    assertExpectedRevision(current, request.expectedCheckpointRevision);
    const cursor = this.eventCursors.get(request.checkpoint.executionId) ?? { sequence: 0 };
    assertEventExtendsCursor(request.completionEvent, cursor, "completion event");

    const committed: WorkflowCheckpoint = {
      ...request.checkpoint,
      completedStepIds: [...request.checkpoint.completedStepIds],
      usage: { ...request.checkpoint.usage },
      revision: (current?.revision ?? 0) + 1,
    };
    const result: StepCompletionCommitResult = {
      checkpoint: committed,
      eventSequence: request.completionEvent.sequence,
      eventId: request.completionEvent.id,
    };
    validateStepCompletionCommit(request, result);

    if (this.options.failAt === "after_validation_before_publish") {
      throw new Error("injected step-completion failure before atomic publish");
    }

    const stream = this.events.get(request.checkpoint.executionId) ?? [];
    stream.push(request.completionEvent);
    this.events.set(request.checkpoint.executionId, stream);
    this.eventCursors.set(
      request.checkpoint.executionId,
      eventCursor(request.completionEvent.sequence, request.completionEvent.id),
    );
    this.checkpoints.set(request.checkpoint.executionId, committed);

    // Models an uncertain acknowledgement: authoritative state committed atomically,
    // but the caller loses the acknowledgement and must reconcile from durability.
    if (this.options.failAt === "after_publish_before_ack") {
      throw new Error("injected step-completion acknowledgement loss after atomic publish");
    }

    return result;
  }

  public async commitAttemptFailure(
    request: Readonly<AttemptFailureCommitRequest>,
  ): Promise<Readonly<AttemptFailureCommitResult>> {
    if (this.options.attemptFailureFailAt === "before_commit") {
      throw new Error("injected attempt-failure failure before commit");
    }

    const current = this.checkpoints.get(request.checkpoint.executionId);
    assertExpectedRevision(current, request.expectedCheckpointRevision);
    if ((current?.usage.retries ?? 0) !== request.consumedRetriesBefore) {
      throw new InvalidStepCompletionCommitError(
        "consumed retry count does not match authoritative state",
      );
    }
    const cursor = this.eventCursors.get(request.checkpoint.executionId) ?? { sequence: 0 };
    assertEventExtendsCursor(request.attemptFailedEvent, cursor, "attempt failure event");

    const committed: WorkflowCheckpoint = {
      ...request.checkpoint,
      completedStepIds: [...request.checkpoint.completedStepIds],
      usage: { ...request.checkpoint.usage },
      revision: (current?.revision ?? 0) + 1,
    };
    const result: AttemptFailureCommitResult = {
      checkpoint: committed,
      eventSequence: request.attemptFailedEvent.sequence,
      eventId: request.attemptFailedEvent.id,
    };
    validateAttemptFailureCommit(request, result);

    if (this.options.attemptFailureFailAt === "after_validation_before_publish") {
      throw new Error("injected attempt-failure failure before atomic publish");
    }

    const stream = this.events.get(request.checkpoint.executionId) ?? [];
    stream.push(request.attemptFailedEvent as ExecutionEvent);
    this.events.set(request.checkpoint.executionId, stream);
    this.eventCursors.set(
      request.checkpoint.executionId,
      eventCursor(request.attemptFailedEvent.sequence, request.attemptFailedEvent.id),
    );
    this.checkpoints.set(request.checkpoint.executionId, committed);

    // Models an uncertain acknowledgement: evidence and consumed allowance are
    // committed atomically, but the caller must reconcile from durability.
    if (this.options.attemptFailureFailAt === "after_publish_before_ack") {
      throw new Error("injected attempt-failure acknowledgement loss after atomic publish");
    }

    return result;
  }

  public loadCheckpoint(executionId: string): WorkflowCheckpoint | undefined {
    const checkpoint = this.checkpoints.get(executionId);
    return checkpoint === undefined ? undefined : cloneCheckpoint(checkpoint);
  }

  public loadEvents(executionId: string): readonly ExecutionEvent[] {
    return [...(this.events.get(executionId) ?? [])];
  }

  public loadCompletionEvent(
    executionId: string,
  ): Readonly<StepCompletionCommitRequest>["completionEvent"] | undefined {
    const events = this.events.get(executionId) ?? [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type === "workflow.step.completed") {
        return event as StepCompletionCommitRequest["completionEvent"];
      }
    }
    return undefined;
  }
}

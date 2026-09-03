import {
  InvalidStepCompletionCommitError,
  validateStepCompletionCommit,
  type StepCompletionCommitPort,
  type StepCompletionCommitRequest,
  type StepCompletionCommitResult,
} from "./step-completion-commit.js";
import type { WorkflowCheckpoint } from "./resumable-runner.js";

export type StepCompletionFailurePoint =
  | "before_commit"
  | "after_validation_before_publish";

export interface InMemoryStepCompletionCommitOptions {
  readonly failAt?: StepCompletionFailurePoint;
}

/**
 * Reference-only atomic completion adapter used to verify the provider-neutral
 * contract. It deliberately has no production durability claim.
 */
export class InMemoryStepCompletionCommitPort implements StepCompletionCommitPort {
  private readonly checkpoints = new Map<string, WorkflowCheckpoint>();
  private readonly events = new Map<string, Readonly<StepCompletionCommitRequest>["completionEvent"]>();

  public constructor(private readonly options: InMemoryStepCompletionCommitOptions = {}) {}

  public async commitStepCompletion(
    request: Readonly<StepCompletionCommitRequest>,
  ): Promise<Readonly<StepCompletionCommitResult>> {
    if (this.options.failAt === "before_commit") {
      throw new Error("injected step-completion failure before commit");
    }

    const current = this.checkpoints.get(request.checkpoint.executionId);
    const currentRevision = current?.revision;
    if (currentRevision !== request.expectedCheckpointRevision) {
      throw new InvalidStepCompletionCommitError(
        "expected checkpoint revision does not match authoritative state",
      );
    }

    const committed: WorkflowCheckpoint = {
      ...request.checkpoint,
      completedStepIds: [...request.checkpoint.completedStepIds],
      usage: { ...request.checkpoint.usage },
      revision: (currentRevision ?? 0) + 1,
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

    // Publish both observable records only after the complete transition validates.
    // No await or externally observable mutation occurs between these assignments.
    this.events.set(request.checkpoint.executionId, request.completionEvent);
    this.checkpoints.set(request.checkpoint.executionId, committed);
    return result;
  }

  public loadCheckpoint(executionId: string): WorkflowCheckpoint | undefined {
    const checkpoint = this.checkpoints.get(executionId);
    return checkpoint === undefined
      ? undefined
      : {
          ...checkpoint,
          completedStepIds: [...checkpoint.completedStepIds],
          usage: { ...checkpoint.usage },
        };
  }

  public loadCompletionEvent(
    executionId: string,
  ): Readonly<StepCompletionCommitRequest>["completionEvent"] | undefined {
    return this.events.get(executionId);
  }
}

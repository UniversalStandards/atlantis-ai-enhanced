import {
  assertWithinBudget,
  BudgetExceededError,
  type EventSink,
  type ExecutionEvent,
  type ExecutionUsage,
  type WorkflowContext,
  type WorkflowStep,
} from "./index.js";
import {
  assertValidRetryPolicy,
  executeWithControl,
  ExecutionCancelledError,
  type CancellationSignal,
  type RetryPolicy,
} from "./execution-control.js";

export interface ResumableWorkflow<I, O> {
  readonly id: string;
  readonly version: string;
  readonly steps: readonly WorkflowStep<unknown, unknown>[];
  readonly mapInput?: (input: I) => unknown;
  readonly mapOutput?: (value: unknown) => O;
}

export interface WorkflowCheckpoint {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly nextStepIndex: number;
  readonly completedStepIds: readonly string[];
  readonly value: unknown;
  readonly usage: ExecutionUsage;
  readonly lastEventSequence: number;
  readonly parentEventId?: string;
  readonly revision: number;
}

export interface CheckpointStore {
  load(executionId: string): Promise<WorkflowCheckpoint | undefined>;
  save(
    checkpoint: Omit<WorkflowCheckpoint, "revision">,
    expectedRevision: number | undefined,
  ): Promise<WorkflowCheckpoint>;
  clear(executionId: string, expectedRevision: number): Promise<void>;
}

export interface ExecutionEventCursor {
  readonly sequence: number;
  readonly parentEventId?: string;
}

export class InvalidCheckpointError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidCheckpointError";
  }
}

export interface ResumableRunnerOptions {
  readonly checkpointStore: CheckpointStore;
  readonly eventSink: EventSink;
  readonly loadEventCursor: (
    executionId: string,
  ) => ExecutionEventCursor | Promise<ExecutionEventCursor>;
  readonly nextEventId: () => string;
  readonly retryPolicyForStep?: (
    step: WorkflowStep<unknown, unknown>,
    stepIndex: number,
  ) => RetryPolicy;
  readonly cancellation?: CancellationSignal;
  readonly actor?: string;
  readonly now?: () => string;
}

function copyUsage(usage: ExecutionUsage): ExecutionUsage {
  return { ...usage };
}

function restoreUsage(target: ExecutionUsage, source: ExecutionUsage): void {
  Object.assign(target, copyUsage(source));
}

function validateEventCursor(cursor: ExecutionEventCursor): void {
  if (!Number.isSafeInteger(cursor.sequence) || cursor.sequence < 0) {
    throw new InvalidCheckpointError("Execution event cursor sequence is invalid");
  }
  if (
    cursor.parentEventId !== undefined &&
    (typeof cursor.parentEventId !== "string" || cursor.parentEventId.trim().length === 0)
  ) {
    throw new InvalidCheckpointError("Execution event cursor parentEventId is invalid");
  }
  if (cursor.sequence === 0 && cursor.parentEventId !== undefined) {
    throw new InvalidCheckpointError("An empty execution stream cannot have a parent event");
  }
  if (cursor.sequence > 0 && cursor.parentEventId === undefined) {
    throw new InvalidCheckpointError("A non-empty execution stream must identify its tail event");
  }
}

function validateCheckpoint<I, O>(
  checkpoint: WorkflowCheckpoint,
  workflow: ResumableWorkflow<I, O>,
  context: WorkflowContext,
): void {
  if (checkpoint.executionId !== context.executionId) {
    throw new InvalidCheckpointError("Checkpoint execution identity does not match context");
  }
  if (
    checkpoint.workflowId !== workflow.id ||
    checkpoint.workflowVersion !== workflow.version ||
    context.workflowId !== workflow.id ||
    context.workflowVersion !== workflow.version
  ) {
    throw new InvalidCheckpointError("Checkpoint workflow identity or version does not match");
  }
  if (
    !Number.isInteger(checkpoint.nextStepIndex) ||
    checkpoint.nextStepIndex < 0 ||
    checkpoint.nextStepIndex > workflow.steps.length
  ) {
    throw new InvalidCheckpointError("Checkpoint nextStepIndex is outside the workflow");
  }
  const expectedCompleted = workflow.steps
    .slice(0, checkpoint.nextStepIndex)
    .map((step) => step.id);
  if (
    checkpoint.completedStepIds.length !== expectedCompleted.length ||
    checkpoint.completedStepIds.some((stepId, index) => stepId !== expectedCompleted[index])
  ) {
    throw new InvalidCheckpointError("Checkpoint completed steps are not a valid workflow prefix");
  }
  if (!Number.isSafeInteger(checkpoint.lastEventSequence) || checkpoint.lastEventSequence < 0) {
    throw new InvalidCheckpointError("Checkpoint event sequence is invalid");
  }
  if (!Number.isInteger(checkpoint.revision) || checkpoint.revision < 1) {
    throw new InvalidCheckpointError("Checkpoint revision is invalid");
  }
}

export class ResumableSequentialWorkflowRunner {
  private readonly actor: string;
  private readonly now: () => string;

  public constructor(private readonly options: ResumableRunnerOptions) {
    this.actor = options.actor ?? "resumable-sequential-workflow-runner";
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async run<I, O>(
    workflow: ResumableWorkflow<I, O>,
    input: I,
    context: WorkflowContext,
  ): Promise<O> {
    const loaded = await this.options.checkpointStore.load(context.executionId);
    if (loaded !== undefined) {
      validateCheckpoint(loaded, workflow, context);
      restoreUsage(context.usage, loaded.usage);
    }

    const cursor = await this.options.loadEventCursor(context.executionId);
    validateEventCursor(cursor);
    if (loaded !== undefined && cursor.sequence < loaded.lastEventSequence) {
      throw new InvalidCheckpointError(
        "Execution event stream is behind the durable checkpoint",
      );
    }

    let checkpoint = loaded;
    let value: unknown = checkpoint?.value ?? workflow.mapInput?.(input) ?? input;
    let nextStepIndex = checkpoint?.nextStepIndex ?? 0;
    let sequence = cursor.sequence;
    let parentEventId = cursor.parentEventId;

    const append = async <T>(type: ExecutionEvent<T>["type"], payload: T): Promise<void> => {
      const id = this.options.nextEventId();
      const event: ExecutionEvent<T> = {
        id,
        executionId: context.executionId,
        sequence: ++sequence,
        type,
        occurredAt: this.now(),
        actor: this.actor,
        ...(parentEventId === undefined ? {} : { parentEventId }),
        payload,
      };
      await this.options.eventSink.append(event);
      parentEventId = id;
    };

    const saveCheckpoint = async (): Promise<void> => {
      checkpoint = await this.options.checkpointStore.save(
        {
          executionId: context.executionId,
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          nextStepIndex,
          completedStepIds: workflow.steps.slice(0, nextStepIndex).map((item) => item.id),
          value,
          usage: copyUsage(context.usage),
          lastEventSequence: sequence,
          ...(parentEventId === undefined ? {} : { parentEventId }),
        },
        checkpoint?.revision,
      );
    };

    await append("execution.started", {
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      stepCount: workflow.steps.length,
      resumed: checkpoint !== undefined,
      nextStepIndex,
    });

    try {
      assertWithinBudget(context);

      for (let index = nextStepIndex; index < workflow.steps.length; index += 1) {
        const step = workflow.steps[index];
        if (step === undefined) {
          throw new InvalidCheckpointError(`Workflow step ${index} is missing`);
        }

        assertWithinBudget(context);
        await append("workflow.step.started", { stepId: step.id, stepIndex: index });

        const requestedPolicy = this.options.retryPolicyForStep?.(step, index) ?? {
          maxAttempts: 1,
        };
        assertValidRetryPolicy(requestedPolicy);
        const remainingRetries = context.budget.maxRetries - context.usage.retries;
        const retryPolicy: RetryPolicy = {
          ...requestedPolicy,
          maxAttempts: Math.min(requestedPolicy.maxAttempts, remainingRetries + 1),
        };

        try {
          value = await executeWithControl(
            async ({ attempt, maxAttempts }) => {
              await append("workflow.step.attempt.started", {
                stepId: step.id,
                stepIndex: index,
                attempt,
                maxAttempts,
              });
              return step.execute(value, context);
            },
            retryPolicy,
            {
              cancellation: this.options.cancellation,
              hooks: {
                onAttemptFailed: async ({ attempt, maxAttempts }, error, willRetry) => {
                  await append("workflow.step.attempt.failed", {
                    stepId: step.id,
                    stepIndex: index,
                    attempt,
                    maxAttempts,
                    willRetry,
                    error: error instanceof Error ? error.message : String(error),
                  });
                  if (willRetry) {
                    context.usage.retries += 1;
                    assertWithinBudget(context);
                    await saveCheckpoint();
                  }
                },
              },
            },
          );
          context.usage.iterations += 1;
          assertWithinBudget(context);
          await append("workflow.step.completed", { stepId: step.id, stepIndex: index });

          nextStepIndex = index + 1;
          await saveCheckpoint();
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            await append("budget.exceeded", {
              dimension: error.dimension,
              limit: error.limit,
              observed: error.observed,
              stepId: step.id,
            });
          } else if (!(error instanceof ExecutionCancelledError)) {
            await append("workflow.step.failed", {
              stepId: step.id,
              stepIndex: index,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          throw error;
        }
      }

      assertWithinBudget(context);
      const output = workflow.mapOutput ? workflow.mapOutput(value) : (value as O);
      await append("execution.completed", {
        workflowId: workflow.id,
        completedSteps: workflow.steps.length,
      });

      if (checkpoint !== undefined) {
        await this.options.checkpointStore.clear(context.executionId, checkpoint.revision);
      }
      return output;
    } catch (error) {
      if (error instanceof ExecutionCancelledError) {
        if (checkpoint !== undefined) {
          await this.options.checkpointStore.clear(context.executionId, checkpoint.revision);
          checkpoint = undefined;
        }
        await append("execution.cancelled", {
          workflowId: workflow.id,
          reason: error.reason,
          nextStepIndex,
        });
      } else if (error instanceof BudgetExceededError) {
        await append("execution.failed", {
          workflowId: workflow.id,
          reason: "budget_exceeded",
          error: error.message,
        });
      } else {
        await append("execution.interrupted", {
          workflowId: workflow.id,
          reason: "recoverable_error",
          error: error instanceof Error ? error.message : String(error),
          nextStepIndex,
        });
      }
      throw error;
    }
  }
}

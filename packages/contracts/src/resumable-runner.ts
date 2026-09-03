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
  ApprovalRejectedError,
  ApprovalRequiredError,
  InvalidApprovalError,
  normalizeApprovalRequest,
  resolveApproval,
  type ApprovalRequest,
  type ApprovalResolution,
  type ResolvedApproval,
} from "./approval-control.js";
import {
  assertValidRetryPolicy,
  executeWithControl,
  ExecutionCancelledError,
  ExecutionTimedOutError,
  type CancellationSignal,
  type ExecutionDeadline,
  type RetryPolicy,
} from "./execution-control.js";
import { coordinateAtomicResumableCompletion } from "./resumable-completion-coordinator.js";
import type { ResumableDurabilityPort } from "./step-completion-commit.js";

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
  readonly pendingApproval?: ApprovalRequest;
  readonly approvedApproval?: ResolvedApproval;
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
  /**
   * Authoritative consistency domain for checkpoints, ordinary execution events,
   * restart cursor state, and atomic completed-step publication.
   *
   * Optional only as a source-compatibility bridge while callers migrate. A run
   * without this authority fails closed before workflow work begins; the legacy
   * split stores below are never used as an execution fallback.
   */
  readonly durability?: ResumableDurabilityPort;
  /** @deprecated Supply `durability`; retained only so unmigrated callers fail at runtime, not compile time. */
  readonly checkpointStore?: CheckpointStore;
  /** @deprecated Supply `durability`; retained only so unmigrated callers fail at runtime, not compile time. */
  readonly eventSink?: EventSink;
  /** @deprecated Supply `durability`; retained only so unmigrated callers fail at runtime, not compile time. */
  readonly loadEventCursor?: (
    executionId: string,
  ) => ExecutionEventCursor | Promise<ExecutionEventCursor>;
  readonly nextEventId: () => string;
  readonly retryPolicyForStep?: (
    step: WorkflowStep<unknown, unknown>,
    stepIndex: number,
  ) => RetryPolicy;
  readonly approvalForStep?: (
    step: WorkflowStep<unknown, unknown>,
    stepIndex: number,
    context: WorkflowContext,
  ) => ApprovalRequest | undefined | Promise<ApprovalRequest | undefined>;
  readonly loadApprovalResolution?: (
    request: ApprovalRequest,
  ) => ApprovalResolution | undefined | Promise<ApprovalResolution | undefined>;
  readonly cancellation?: CancellationSignal;
  readonly deadline?: ExecutionDeadline;
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

function validateApprovalBinding(
  request: ApprovalRequest,
  executionId: string,
  stepId: string,
): ApprovalRequest {
  const normalized = normalizeApprovalRequest(request);
  if (normalized.executionId !== executionId) {
    throw new InvalidApprovalError("approval request executionId does not match context");
  }
  if (normalized.stepId !== stepId) {
    throw new InvalidApprovalError("approval request stepId does not match workflow step");
  }
  return normalized;
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
  if (
    checkpoint.pendingApproval !== undefined &&
    checkpoint.approvedApproval !== undefined
  ) {
    throw new InvalidCheckpointError(
      "Checkpoint cannot retain pending and approved authorization simultaneously",
    );
  }

  const step = workflow.steps[checkpoint.nextStepIndex];
  if (checkpoint.pendingApproval !== undefined) {
    if (step === undefined) {
      throw new InvalidCheckpointError("Completed workflow cannot retain a pending approval");
    }
    try {
      validateApprovalBinding(checkpoint.pendingApproval, context.executionId, step.id);
    } catch (error) {
      throw new InvalidCheckpointError(
        error instanceof Error ? error.message : "Checkpoint approval is invalid",
      );
    }
  }

  if (checkpoint.approvedApproval !== undefined) {
    if (step === undefined) {
      throw new InvalidCheckpointError("Completed workflow cannot retain an approved authorization");
    }
    try {
      const request = validateApprovalBinding(
        checkpoint.approvedApproval.request,
        context.executionId,
        step.id,
      );
      const approval = resolveApproval(request, checkpoint.approvedApproval.resolution);
      if (approval.resolution.decision !== "approved") {
        throw new InvalidApprovalError(
          "checkpoint approved authorization must contain an approved decision",
        );
      }
    } catch (error) {
      throw new InvalidCheckpointError(
        error instanceof Error
          ? error.message
          : "Checkpoint approved authorization is invalid",
      );
    }
  }
}

function requireDurability(options: Readonly<ResumableRunnerOptions>): ResumableDurabilityPort {
  if (options.durability === undefined) {
    throw new InvalidCheckpointError(
      "Authoritative resumable durability is required; split checkpoint/event authorities are not permitted",
    );
  }
  return options.durability;
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
    const durability = requireDurability(this.options);
    const loaded = await durability.load(context.executionId);
    if (loaded !== undefined) {
      validateCheckpoint(loaded, workflow, context);
      restoreUsage(context.usage, loaded.usage);
    }

    const cursor = await durability.loadEventCursor(context.executionId);
    validateEventCursor(cursor);
    if (loaded !== undefined && cursor.sequence < loaded.lastEventSequence) {
      throw new InvalidCheckpointError(
        "Execution event stream is behind the durable checkpoint",
      );
    }

    let checkpoint = loaded;
    let value: unknown = checkpoint?.value ?? workflow.mapInput?.(input) ?? input;
    let nextStepIndex = checkpoint?.nextStepIndex ?? 0;
    let pendingApproval = checkpoint?.pendingApproval;
    let approvedApproval = checkpoint?.approvedApproval;
    let sequence = cursor.sequence;
    let parentEventId = cursor.parentEventId;

    const append = async <T>(type: ExecutionEvent<T>["type"], payload: T): Promise<void> => {
      const id = this.options.nextEventId();
      const event: ExecutionEvent<T> = {
        id,
        executionId: context.executionId,
        sequence: sequence + 1,
        type,
        occurredAt: this.now(),
        actor: this.actor,
        ...(parentEventId === undefined ? {} : { parentEventId }),
        payload,
      };
      await durability.append(event);
      sequence = event.sequence;
      parentEventId = id;
    };

    const saveCheckpoint = async (): Promise<void> => {
      checkpoint = await durability.save(
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
          ...(pendingApproval === undefined ? {} : { pendingApproval }),
          ...(approvedApproval === undefined ? {} : { approvedApproval }),
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

        const requestedApproval =
          pendingApproval ??
          approvedApproval?.request ??
          (await this.options.approvalForStep?.(step, index, context));
        if (requestedApproval !== undefined) {
          const request = validateApprovalBinding(
            requestedApproval,
            context.executionId,
            step.id,
          );

          if (approvedApproval !== undefined) {
            const restored = resolveApproval(request, approvedApproval.resolution);
            if (restored.resolution.decision !== "approved") {
              throw new InvalidApprovalError(
                "persisted protected-step authorization is not approved",
              );
            }
            approvedApproval = restored;
          } else {
            if (pendingApproval === undefined) {
              pendingApproval = request;
              await append("approval.requested", request);
              await saveCheckpoint();
            }

            const resolution = await this.options.loadApprovalResolution?.(request);
            if (resolution === undefined) {
              throw new ApprovalRequiredError(request);
            }

            const approval = resolveApproval(request, resolution);
            await append("approval.resolved", {
              approvalId: approval.request.approvalId,
              executionId: approval.request.executionId,
              requestVersion: approval.request.requestVersion,
              stepId: approval.request.stepId,
              decision: approval.resolution.decision,
              resolvedBy: approval.resolution.resolvedBy,
              resolvedAt: approval.resolution.resolvedAt,
              ...(approval.resolution.comment === undefined
                ? {}
                : { comment: approval.resolution.comment }),
            });
            if (approval.resolution.decision === "rejected") {
              throw new ApprovalRejectedError(approval);
            }
            pendingApproval = undefined;
            approvedApproval = approval;
            await saveCheckpoint();
          }
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
            async (attemptContext) => {
              const { attempt, maxAttempts } = attemptContext;
              await append("workflow.step.attempt.started", {
                stepId: step.id,
                stepIndex: index,
                attempt,
                maxAttempts,
              });
              return step.execute(value, context, attemptContext);
            },
            retryPolicy,
            {
              cancellation: this.options.cancellation,
              deadline: this.options.deadline,
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
                onTimedOut: async ({ attempt, maxAttempts, deadlineAtMs, observedAtMs }) => {
                  await append("workflow.step.timed_out", {
                    stepId: step.id,
                    stepIndex: index,
                    attempt,
                    maxAttempts,
                    deadlineAtMs,
                    observedAtMs,
                  });
                },
              },
            },
          );
          context.usage.iterations += 1;
          assertWithinBudget(context);

          const completion = await coordinateAtomicResumableCompletion({
            durability,
            executionId: context.executionId,
            workflowId: workflow.id,
            workflowVersion: workflow.version,
            stepId: step.id,
            stepIndex: index,
            completedStepIds: workflow.steps.slice(0, index + 1).map((item) => item.id),
            value,
            usage: copyUsage(context.usage),
            cursor: {
              sequence,
              ...(parentEventId === undefined ? {} : { parentEventId }),
            },
            expectedCheckpointRevision: checkpoint?.revision,
            nextEventId: this.options.nextEventId,
            actor: this.actor,
            occurredAt: this.now(),
          });

          checkpoint = completion.checkpoint;
          validateCheckpoint(checkpoint, workflow, context);
          restoreUsage(context.usage, checkpoint.usage);
          value = checkpoint.value;
          nextStepIndex = checkpoint.nextStepIndex;
          pendingApproval = checkpoint.pendingApproval;
          approvedApproval = checkpoint.approvedApproval;
          sequence = completion.cursor.sequence;
          parentEventId = completion.cursor.parentEventId;
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            await append("budget.exceeded", {
              dimension: error.dimension,
              limit: error.limit,
              observed: error.observed,
              stepId: step.id,
            });
          } else if (
            !(error instanceof ExecutionCancelledError) &&
            !(error instanceof ExecutionTimedOutError)
          ) {
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
        await durability.clear(context.executionId, checkpoint.revision);
      }
      return output;
    } catch (error) {
      if (error instanceof ApprovalRequiredError) {
        throw error;
      }
      if (error instanceof ApprovalRejectedError) {
        if (checkpoint !== undefined) {
          await durability.clear(context.executionId, checkpoint.revision);
          checkpoint = undefined;
        }
        await append("execution.failed", {
          workflowId: workflow.id,
          reason: "approval_rejected",
          approvalId: error.approval.request.approvalId,
          stepId: error.approval.request.stepId,
        });
      } else if (error instanceof ExecutionCancelledError) {
        if (checkpoint !== undefined) {
          await durability.clear(context.executionId, checkpoint.revision);
          checkpoint = undefined;
        }
        await append("execution.cancelled", {
          workflowId: workflow.id,
          reason: error.reason,
          nextStepIndex,
        });
      } else if (error instanceof ExecutionTimedOutError) {
        if (checkpoint !== undefined) {
          await durability.clear(context.executionId, checkpoint.revision);
          checkpoint = undefined;
        }
        await append("execution.timed_out", {
          workflowId: workflow.id,
          deadlineAtMs: error.deadlineAtMs,
          observedAtMs: error.observedAtMs,
          nextStepIndex,
        });
      } else if (error instanceof BudgetExceededError) {
        if (checkpoint !== undefined) {
          await durability.clear(context.executionId, checkpoint.revision);
          checkpoint = undefined;
        }
        await append("execution.failed", {
          workflowId: workflow.id,
          reason: "budget_exceeded",
          error: error.message,
        });
      } else {
        const authoritativeCursor = await durability.loadEventCursor(context.executionId);
        validateEventCursor(authoritativeCursor);
        sequence = authoritativeCursor.sequence;
        parentEventId = authoritativeCursor.parentEventId;
        const authoritativeCheckpoint = await durability.load(context.executionId);
        if (authoritativeCheckpoint !== undefined) {
          validateCheckpoint(authoritativeCheckpoint, workflow, context);
          checkpoint = authoritativeCheckpoint;
          restoreUsage(context.usage, checkpoint.usage);
          value = checkpoint.value;
          nextStepIndex = checkpoint.nextStepIndex;
          pendingApproval = checkpoint.pendingApproval;
          approvedApproval = checkpoint.approvedApproval;
        }
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

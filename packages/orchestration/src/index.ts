import { randomUUID } from "node:crypto";
import {
  assertValidBudget,
  assertWithinBudget,
  BudgetExceededError,
  type ActionDescriptor,
  type ApprovalGate,
  type PolicyDecision,
  type PolicyEvaluator,
  createUsage,
  type EvaluationResult,
  type Evaluator,
  type EventStore,
  type ExecutionBudget,
  type ExecutionMode,
  type ExecutionStatus,
  type ExecutionUsage,
  type SupervisorEscalation,
  type WorkflowContext,
  type WorkflowStep,
} from "@atlantis/contracts";
import { EventRecorder } from "@atlantis/events";

/** Bounded evaluate → revise loop applied to a step's output (ADR-0001 §4–5). */
export interface RefinementPolicy<I, O> {
  readonly evaluator: Evaluator<O>;
  /** Maximum number of revisions after the first output. Must be ≥ 0. */
  readonly maxRevisions: number;
  revise(
    input: I,
    previous: O,
    evaluation: EvaluationResult,
    context: WorkflowContext,
  ): Promise<O>;
  /**
   * What to do when no output passes within `maxRevisions`.
   * `"fail"` (default) fails the step; `"accept_best"` continues with the
   * highest-scoring output and records `acceptedWithoutPassing` on the step's
   * completion event.
   */
  readonly onExhausted?: "fail" | "accept_best";
}

export interface SequentialStep<I, O> extends WorkflowStep<I, O> {
  /** Total attempts including the first. Defaults to 1 (no retry). */
  readonly maxAttempts?: number;
  readonly refinement?: RefinementPolicy<I, O>;
  /**
   * Declares that this step has a consequential effect. A step with an action
   * runs only after the configured policy allows it and, where the policy
   * requires, after an explicit approval. With no policy configured the step
   * is denied.
   */
  readonly action?: ActionDescriptor;
  /**
   * Builds a supervisor escalation once every attempt has failed. Only used
   * when the workflow mode is `"hybrid"` or `"supervisor"`; in `"workflow"`
   * mode a failed step fails the execution.
   */
  escalate?(error: unknown, input: I): SupervisorEscalation<I, O>;
}

export interface SequentialWorkflow<I, O> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly mode: ExecutionMode;
  /** Type-erased steps. Build with {@link sequence} to keep I/O types aligned. */
  readonly steps: ReadonlyArray<SequentialStep<never, unknown>>;
  /** Phantom marker carrying the workflow's input and output types. */
  readonly __io?: (input: I) => O;
}

export interface WorkflowMetadata {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly mode?: ExecutionMode;
}

export interface SequenceBuilder<I, C> {
  step<N>(step: SequentialStep<C, N>): SequenceBuilder<I, N>;
  build(): SequentialWorkflow<I, C>;
}

/** Type-safe builder: each step's input must match the previous step's output. */
export function sequence<I>(meta: WorkflowMetadata): SequenceBuilder<I, I> {
  const build = <C>(
    steps: ReadonlyArray<SequentialStep<never, unknown>>,
  ): SequenceBuilder<I, C> => ({
    step: <N>(step: SequentialStep<C, N>) =>
      build<N>([...steps, step as SequentialStep<never, unknown>]),
    build: () => {
      const ids = new Set<string>();
      for (const { id } of steps) {
        if (ids.has(id)) {
          throw new WorkflowDefinitionError(
            `Workflow ${meta.id} has duplicate step id "${id}"`,
          );
        }
        ids.add(id);
      }
      return Object.freeze({
        id: meta.id,
        version: meta.version,
        description: meta.description,
        mode: meta.mode ?? "workflow",
        steps: Object.freeze([...steps]),
      });
    },
  });
  return build<I>([]);
}

export class WorkflowDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowDefinitionError";
  }
}

export class ExecutionCancelledError extends Error {
  constructor() {
    super("Execution was cancelled");
    this.name = "ExecutionCancelledError";
  }
}

export class StepFailedError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly attempts: number,
    cause: unknown,
  ) {
    super(
      `Step "${stepId}" failed after ${attempts} attempt(s): ${describe(cause).message}`,
      { cause },
    );
    this.name = "StepFailedError";
  }
}

/** A policy denied the step, or no policy was configured to decide. */
export class PolicyDeniedError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly policyId: string,
    reason: string,
  ) {
    super(`Step "${stepId}" denied by policy ${policyId}: ${reason}`);
    this.name = "PolicyDeniedError";
  }
}

/** An approver declined the step, or no approval gate was configured. */
export class ApprovalRejectedError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly approver: string,
  ) {
    super(`Step "${stepId}" was not approved by ${approver}`);
    this.name = "ApprovalRejectedError";
  }
}

export class RefinementExhaustedError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly bestScore: number,
    public readonly revisions: number,
  ) {
    super(
      `Step "${stepId}" did not pass evaluation after ${revisions} revision(s); best score ${bestScore}`,
    );
    this.name = "RefinementExhaustedError";
  }
}

export interface ExecutionFailure {
  readonly name: string;
  readonly message: string;
  readonly stepId?: string;
}

export interface ExecutionResult<O> {
  readonly executionId: string;
  readonly status: Extract<
    ExecutionStatus,
    "succeeded" | "failed" | "cancelled" | "budget_exceeded"
  >;
  /** Present only when `status` is `"succeeded"`. */
  readonly output?: O;
  /** Present for every status other than `"succeeded"`. */
  readonly error?: ExecutionFailure;
  readonly usage: Readonly<ExecutionUsage>;
}

export interface RunOptions {
  /** Every execution is recorded. If the store rejects an event, the run rejects. */
  readonly store: EventStore;
  readonly userId: string;
  readonly budget: ExecutionBudget;
  readonly executionId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  /** Required for any workflow containing a step with an `action`. */
  readonly policy?: PolicyEvaluator;
  /** Required for any step the policy gates behind approval. */
  readonly approvals?: ApprovalGate;
  /** Caller-controlled cancellation. */
  readonly signal?: AbortSignal;
  /** Actor recorded on events. Defaults to `"workflow-runner"`. */
  readonly actor?: string;
  /** Monotonic millisecond clock; injectable for deterministic replay. */
  readonly monotonicNow?: () => number;
  /** Wall clock for event timestamps; injectable for deterministic replay. */
  readonly now?: () => Date;
  /** Event id generator; injectable for deterministic replay. */
  readonly generateId?: () => string;
}

const MAX_ERROR_MESSAGE_LENGTH = 500;

function describe(error: unknown): { name: string; message: string } {
  const name = error instanceof Error ? error.name : "NonError";
  const raw = error instanceof Error ? error.message : String(error);
  return {
    name,
    message:
      raw.length > MAX_ERROR_MESSAGE_LENGTH
        ? `${raw.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
        : raw,
  };
}

/** Usage as recorded in events; unreadable counters become null, not a crash. */
function auditableUsage(
  usage: ExecutionUsage,
): Record<keyof ExecutionUsage, number | null> {
  const entries = Object.entries(usage).map(([key, value]) => [
    key,
    typeof value === "number" && Number.isFinite(value) ? value : null,
  ]);
  return Object.fromEntries(entries) as Record<
    keyof ExecutionUsage,
    number | null
  >;
}

function isControlFlow(error: unknown): boolean {
  return (
    error instanceof BudgetExceededError ||
    error instanceof ExecutionCancelledError
  );
}

function assertPositiveInteger(
  label: string,
  value: number,
  min: number,
): void {
  if (!Number.isInteger(value) || value < min) {
    throw new WorkflowDefinitionError(
      `${label} must be an integer ≥ ${min} (received ${value})`,
    );
  }
}

/**
 * Runs a workflow's steps in order, feeding each output to the next step.
 *
 * - Budgets are checked before and after every step, attempt, and revision;
 *   a step that outlives the remaining duration budget is abandoned and its
 *   `context.signal` is aborted.
 * - Step failures, cancellation, and budget violations resolve to an
 *   {@link ExecutionResult}; they never reject.
 * - The promise rejects only for an invalid budget or workflow definition
 *   (before anything runs) or when the event store refuses an event — an
 *   execution that cannot be audited does not continue.
 * - Steps that declare an `action` are denied unless policy allows them, and
 *   run only after approval when policy requires it. Retries and supervisor
 *   escalation never bypass a denial.
 * - Event payloads carry identifiers, counters, scores, and error
 *   names/messages only; step inputs, outputs, and evaluator reasons are never
 *   written to the event history.
 */
export async function runSequentialWorkflow<I, O>(
  workflow: SequentialWorkflow<I, O>,
  input: I,
  options: RunOptions,
): Promise<ExecutionResult<O>> {
  assertValidBudget(options.budget);
  for (const step of workflow.steps) {
    assertPositiveInteger(
      `Step "${step.id}" maxAttempts`,
      step.maxAttempts ?? 1,
      1,
    );
    if (step.refinement) {
      assertPositiveInteger(
        `Step "${step.id}" refinement.maxRevisions`,
        step.refinement.maxRevisions,
        0,
      );
    }
  }

  const executionId = options.executionId ?? randomUUID();
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  const controller = new AbortController();
  const context: WorkflowContext = {
    executionId,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    userId: options.userId,
    mode: workflow.mode,
    budget: Object.freeze({ ...options.budget }),
    usage: createUsage(),
    metadata: Object.freeze({ ...options.metadata }),
    signal: controller.signal,
  };
  const recorder = new EventRecorder(options.store, executionId, {
    actor: options.actor ?? "workflow-runner",
    ...(options.now ? { now: options.now } : {}),
    ...(options.generateId ? { generateId: options.generateId } : {}),
  });

  /** Refreshes elapsed time, then enforces cancellation and every budget. */
  const checkpoint = (): void => {
    context.usage.durationMs = Math.max(0, monotonicNow() - startedAt);
    if (options.signal?.aborted) throw new ExecutionCancelledError();
    assertWithinBudget(context);
  };

  /** Settles with the work, or throws at cancellation or the duration limit. */
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    checkpoint();
    const remainingMs = context.budget.maxDurationMs - context.usage.durationMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      // Node timers overflow above ~24.8 days; longer budgets rely on checkpoints.
      if (remainingMs <= 2_147_483_647) {
        timer = setTimeout(() => {
          context.usage.durationMs = Math.max(
            monotonicNow() - startedAt,
            context.budget.maxDurationMs + 1,
          );
          reject(
            new BudgetExceededError(
              "maxDurationMs",
              context.budget.maxDurationMs,
              context.usage.durationMs,
            ),
          );
        }, remainingMs + 1);
      }
      onAbort = () => {
        reject(new ExecutionCancelledError());
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const result = await Promise.race([work(), interrupted]);
      checkpoint();
      return result;
    } finally {
      clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    }
  };

  const runStep = async (
    step: SequentialStep<unknown, unknown>,
    index: number,
    stepInput: unknown,
  ): Promise<unknown> => {
    const started = await recorder.record("workflow.step.started", {
      stepId: step.id,
      index,
    });
    const maxAttempts = step.maxAttempts ?? 1;
    let attempts = 0;
    let output: unknown;
    let acceptedWithoutPassing = false;
    try {
      if (step.action) await authorize(step.id, step.action, started.id);
      for (;;) {
        attempts += 1;
        try {
          output = await bounded(() => step.execute(stepInput, context));
          break;
        } catch (error) {
          if (isControlFlow(error)) throw error;
          if (attempts < maxAttempts) {
            context.usage.retries += 1;
            checkpoint();
            continue;
          }
          if (!step.escalate || context.mode === "workflow") {
            throw new StepFailedError(step.id, attempts, error);
          }
          const escalation = step.escalate(error, stepInput);
          const escalated = await recorder.record(
            "supervisor.escalated",
            { stepId: step.id, reason: escalation.reason, attempts },
            started.id,
          );
          try {
            output = await bounded(() => escalation.resolve(context));
          } catch (supervisorError) {
            if (isControlFlow(supervisorError)) throw supervisorError;
            throw new StepFailedError(step.id, attempts, supervisorError);
          }
          await recorder.record(
            "supervisor.returned",
            { stepId: step.id },
            escalated.id,
          );
          break;
        }
      }

      if (step.refinement) {
        const refined = await refine(
          step,
          step.refinement,
          stepInput,
          output,
          started.id,
        );
        output = refined.output;
        acceptedWithoutPassing = !refined.passed;
      }
    } catch (error) {
      if (!isControlFlow(error)) {
        await recorder.record(
          "workflow.step.failed",
          { stepId: step.id, index, attempts, error: describe(error) },
          started.id,
        );
      }
      throw error;
    }
    await recorder.record(
      "workflow.step.completed",
      {
        stepId: step.id,
        index,
        attempts,
        ...(acceptedWithoutPassing ? { acceptedWithoutPassing: true } : {}),
      },
      started.id,
    );
    return output;
  };

  /** Policy evaluation and, where required, approval. Throws unless allowed. */
  const authorize = async (
    stepId: string,
    action: ActionDescriptor,
    parentEventId: string,
  ): Promise<void> => {
    const policy = options.policy;
    if (!policy) {
      throw new PolicyDeniedError(
        stepId,
        "none",
        "no policy evaluator configured",
      );
    }
    const decision: PolicyDecision = await bounded(() =>
      policy.evaluate({ stepId, action }, context),
    );
    const effect: unknown = decision.effect;
    const evaluated = await recorder.record(
      "policy.evaluated",
      {
        stepId,
        action: action.action,
        reversible: action.reversible,
        external: action.external,
        policyId: decision.policyId,
        effect: typeof effect === "string" ? effect : "invalid",
      },
      parentEventId,
    );
    if (decision.effect === "allow") return;
    if (decision.effect !== "require_approval") {
      // Anything other than an explicit allow or approval requirement is a denial.
      throw new PolicyDeniedError(
        stepId,
        decision.policyId,
        (decision as { reason?: string }).reason ??
          "unrecognized policy decision",
      );
    }
    const approvals = options.approvals;
    if (!approvals) {
      throw new ApprovalRejectedError(stepId, "no approval gate configured");
    }
    const approvalId = (options.generateId ?? randomUUID)();
    const requested = await recorder.record(
      "approval.requested",
      {
        stepId,
        approvalId,
        action: action.action,
        policyId: decision.policyId,
      },
      evaluated.id,
    );
    const resolution = await bounded(() =>
      approvals.request(
        {
          approvalId,
          executionId,
          userId: options.userId,
          stepId,
          action,
          reason: decision.reason,
        },
        controller.signal,
      ),
    );
    const approved = (resolution.approved as unknown) === true;
    await recorder.record(
      "approval.resolved",
      { stepId, approvalId, approved, approver: resolution.approver },
      requested.id,
    );
    if (!approved) throw new ApprovalRejectedError(stepId, resolution.approver);
  };

  const refine = async (
    step: SequentialStep<unknown, unknown>,
    policy: RefinementPolicy<unknown, unknown>,
    stepInput: unknown,
    first: unknown,
    parentEventId: string,
  ): Promise<{ output: unknown; passed: boolean }> => {
    let candidate = first;
    let best: { output: unknown; score: number } | undefined;
    for (let revision = 0; ; revision += 1) {
      const evaluation = await bounded(() =>
        policy.evaluator.evaluate(candidate, context),
      );
      const score = Number.isFinite(evaluation.score) ? evaluation.score : null;
      // Only a literal `true` passes; a truthy non-boolean does not.
      const passed = (evaluation.passed as unknown) === true;
      await recorder.record(
        "evaluation.completed",
        {
          stepId: step.id,
          revision,
          // Reasons and metrics come from the evaluator (often a model) and
          // may quote the candidate, so only non-content fields are recorded.
          score,
          passed,
          reasonCount: Array.isArray(evaluation.reasons)
            ? evaluation.reasons.length
            : 0,
        },
        parentEventId,
      );
      if (score === null) {
        throw new StepFailedError(
          step.id,
          revision + 1,
          new Error("evaluator returned a non-finite score"),
        );
      }
      if (passed) return { output: candidate, passed: true };
      if (best === undefined || score > best.score) {
        best = { output: candidate, score };
      }
      if (revision >= policy.maxRevisions) {
        if (policy.onExhausted === "accept_best") {
          return { output: best.output, passed: false };
        }
        throw new RefinementExhaustedError(step.id, best.score, revision);
      }
      context.usage.iterations += 1;
      const previous = candidate;
      candidate = await bounded(() =>
        policy.revise(stepInput, previous, evaluation, context),
      );
    }
  };

  const finish = (
    status: ExecutionResult<O>["status"],
    extra: { output?: O; error?: ExecutionFailure },
  ): ExecutionResult<O> => {
    return { executionId, status, usage: { ...context.usage }, ...extra };
  };

  // Abort on every exit, including rejection, so abandoned steps stop work.
  try {
    return await execute();
  } finally {
    controller.abort();
  }

  async function execute(): Promise<ExecutionResult<O>> {
    await recorder.record("execution.started", {
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      mode: workflow.mode,
      stepCount: workflow.steps.length,
      userId: options.userId,
      budget: context.budget,
    });

    try {
      let value: unknown = input;
      for (const [index, step] of workflow.steps.entries()) {
        value = await runStep(step, index, value);
      }
      checkpoint();
      await recorder.record("execution.completed", {
        usage: auditableUsage(context.usage),
      });
      return finish("succeeded", { output: value as O });
    } catch (error) {
      const failure: ExecutionFailure = {
        ...describe(error),
        ...(error instanceof StepFailedError ||
        error instanceof RefinementExhaustedError ||
        error instanceof PolicyDeniedError ||
        error instanceof ApprovalRejectedError
          ? { stepId: error.stepId }
          : {}),
      };
      if (error instanceof BudgetExceededError) {
        await recorder.record("budget.exceeded", {
          dimension: error.dimension,
          limit: error.limit,
          observed: error.observed,
          usage: auditableUsage(context.usage),
        });
        return finish("budget_exceeded", { error: failure });
      }
      if (error instanceof ExecutionCancelledError) {
        await recorder.record("execution.cancelled", {
          usage: auditableUsage(context.usage),
        });
        return finish("cancelled", { error: failure });
      }
      await recorder.record("execution.failed", {
        error: failure,
        usage: auditableUsage(context.usage),
      });
      return finish("failed", { error: failure });
    }
  }
}

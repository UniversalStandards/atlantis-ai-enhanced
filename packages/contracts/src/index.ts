export type ExecutionMode = "workflow" | "supervisor" | "hybrid";

export type ExecutionStatus =
  | "pending"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "budget_exceeded";

export interface ExecutionBudget {
  readonly maxToolCalls: number;
  readonly maxRetries: number;
  readonly maxIterations: number;
  readonly maxTokens: number;
  readonly maxDurationMs: number;
  readonly maxCostUsd: number;
}

export interface ExecutionUsage {
  toolCalls: number;
  retries: number;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number;
}

export interface WorkflowContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly userId: string;
  readonly mode: ExecutionMode;
  readonly budget: ExecutionBudget;
  usage: ExecutionUsage;
  readonly metadata: Readonly<Record<string, string>>;
  /**
   * Aborted when the execution is cancelled, exceeds its duration budget, or
   * ends. Long-running steps should stop work when it fires.
   */
  readonly signal?: AbortSignal;
}

export interface WorkflowStep<I, O> {
  readonly id: string;
  readonly description: string;
  execute(input: I, context: WorkflowContext): Promise<O>;
}

export interface WorkflowDefinition<I, O> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly mode: ExecutionMode;
  run(input: I, context: WorkflowContext): Promise<O>;
}

export type ExecutionEventType =
  | "execution.started"
  | "execution.completed"
  | "execution.failed"
  | "execution.cancelled"
  | "workflow.step.started"
  | "workflow.step.completed"
  | "workflow.step.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "evaluation.completed"
  | "policy.evaluated"
  | "approval.requested"
  | "approval.resolved"
  | "supervisor.escalated"
  | "supervisor.returned"
  | "budget.exceeded";

export interface ExecutionEvent<T = unknown> {
  readonly id: string;
  readonly executionId: string;
  readonly sequence: number;
  readonly type: ExecutionEventType;
  readonly occurredAt: string;
  readonly actor: string;
  readonly parentEventId?: string;
  readonly payload: T;
}

export interface EventSink {
  append<T>(event: ExecutionEvent<T>): Promise<void>;
}

/**
 * Append-only, replayable event history for executions (ADR 0003 §7).
 * Implementations must reject out-of-order or duplicate events rather than
 * silently reordering them.
 */
export interface EventStore extends EventSink {
  /** Events for one execution, ordered by `sequence`, starting at 0. */
  read(executionId: string): Promise<readonly ExecutionEvent[]>;
}

export interface EvaluationResult {
  readonly score: number;
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly metrics: Readonly<Record<string, number>>;
}

export interface Evaluator<T> {
  evaluate(value: T, context: WorkflowContext): Promise<EvaluationResult>;
}

export interface SupervisorEscalation<I, O> {
  readonly reason: string;
  readonly input: I;
  resolve(context: WorkflowContext): Promise<O>;
}

/** What a step is about to do, as presented to policy and to approvers. */
export interface ActionDescriptor {
  /** Stable, non-secret action name, e.g. `"email.send"`. */
  readonly action: string;
  /** Whether the effect can be undone after the fact. */
  readonly reversible: boolean;
  /** Whether the effect is visible outside the execution (messages, payments, writes). */
  readonly external: boolean;
}

export interface PolicyRequest {
  readonly stepId: string;
  readonly action: ActionDescriptor;
}

export type PolicyDecision =
  | { readonly effect: "allow"; readonly policyId: string }
  | {
      readonly effect: "deny" | "require_approval";
      readonly policyId: string;
      readonly reason: string;
    };

/** Decides whether a consequential action may proceed (AGENTS.md rule 2). */
export interface PolicyEvaluator {
  evaluate(
    request: PolicyRequest,
    context: WorkflowContext,
  ): Promise<PolicyDecision>;
}

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly executionId: string;
  readonly userId: string;
  readonly stepId: string;
  readonly action: ActionDescriptor;
  readonly reason: string;
}

export interface ApprovalResolution {
  readonly approved: boolean;
  /** Identity of the person or authority that decided. */
  readonly approver: string;
}

/** Obtains an explicit human decision for a gated action (AGENTS.md rule 7). */
export interface ApprovalGate {
  request(
    request: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<ApprovalResolution>;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly dimension: keyof ExecutionBudget,
    public readonly limit: number,
    public readonly observed: number,
  ) {
    super(`Execution budget exceeded for ${dimension}: ${observed} > ${limit}`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Raised when a budget or usage record contains a value that cannot be
 * compared safely (NaN, Infinity, negative). Budget enforcement fails closed:
 * an unreadable counter is treated as a violation, never as "within budget".
 */
export class InvalidBudgetStateError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: unknown,
  ) {
    super(
      `Execution budget state is invalid: ${field} must be a finite, non-negative number (received ${String(value)})`,
    );
    this.name = "InvalidBudgetStateError";
  }
}

const BUDGET_FIELDS = [
  "maxToolCalls",
  "maxRetries",
  "maxIterations",
  "maxTokens",
  "maxDurationMs",
  "maxCostUsd",
] as const satisfies ReadonlyArray<keyof ExecutionBudget>;

const USAGE_FIELDS = [
  "toolCalls",
  "retries",
  "iterations",
  "inputTokens",
  "outputTokens",
  "durationMs",
  "costUsd",
] as const satisfies ReadonlyArray<keyof ExecutionUsage>;

function assertCounter(field: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new InvalidBudgetStateError(field, value);
  }
}

/** A zeroed usage record. Always start an execution from this. */
export function createUsage(): ExecutionUsage {
  return {
    toolCalls: 0,
    retries: 0,
    iterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
  };
}

/** Validates every limit in a budget. Throws {@link InvalidBudgetStateError}. */
export function assertValidBudget(budget: ExecutionBudget): void {
  for (const field of BUDGET_FIELDS) {
    assertCounter(`budget.${field}`, budget[field]);
  }
}

/** Validates every counter in a usage record. Throws {@link InvalidBudgetStateError}. */
export function assertValidUsage(usage: ExecutionUsage): void {
  for (const field of USAGE_FIELDS) {
    assertCounter(`usage.${field}`, usage[field]);
  }
}

/**
 * Throws if any usage counter exceeds its limit, or if any limit or counter is
 * not a finite, non-negative number. Usage exactly at a limit is allowed.
 */
export function assertWithinBudget(context: WorkflowContext): void {
  const { budget, usage } = context;
  assertValidBudget(budget);
  assertValidUsage(usage);

  const checks: ReadonlyArray<
    readonly [keyof ExecutionBudget, number, number]
  > = [
    ["maxToolCalls", budget.maxToolCalls, usage.toolCalls],
    ["maxRetries", budget.maxRetries, usage.retries],
    ["maxIterations", budget.maxIterations, usage.iterations],
    ["maxTokens", budget.maxTokens, usage.inputTokens + usage.outputTokens],
    ["maxDurationMs", budget.maxDurationMs, usage.durationMs],
    ["maxCostUsd", budget.maxCostUsd, usage.costUsd],
  ];

  for (const [dimension, limit, observed] of checks) {
    if (observed > limit) {
      throw new BudgetExceededError(dimension, limit, observed);
    }
  }
}

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
  | "workflow.step.started"
  | "workflow.step.completed"
  | "workflow.step.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "evaluation.completed"
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

export function assertWithinBudget(context: WorkflowContext): void {
  const { budget, usage } = context;
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

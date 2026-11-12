export type ExecutionMode = "workflow" | "supervisor" | "hybrid";
export type ExecutionStatus = "pending" | "running" | "waiting_for_approval" | "succeeded" | "failed" | "cancelled" | "budget_exceeded";
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
export type ExecutionEventType = "execution.started" | "execution.completed" | "execution.failed" | "execution.cancelled" | "workflow.step.started" | "workflow.step.completed" | "workflow.step.failed" | "tool.started" | "tool.completed" | "tool.failed" | "evaluation.completed" | "policy.evaluated" | "approval.requested" | "approval.resolved" | "supervisor.escalated" | "supervisor.returned" | "budget.exceeded";
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
export type PolicyDecision = {
    readonly effect: "allow";
    readonly policyId: string;
} | {
    readonly effect: "deny" | "require_approval";
    readonly policyId: string;
    readonly reason: string;
};
/** Decides whether a consequential action may proceed (AGENTS.md rule 2). */
export interface PolicyEvaluator {
    evaluate(request: PolicyRequest, context: WorkflowContext): Promise<PolicyDecision>;
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
    request(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalResolution>;
}
export declare class BudgetExceededError extends Error {
    readonly dimension: keyof ExecutionBudget;
    readonly limit: number;
    readonly observed: number;
    constructor(dimension: keyof ExecutionBudget, limit: number, observed: number);
}
/**
 * Raised when a budget or usage record contains a value that cannot be
 * compared safely (NaN, Infinity, negative). Budget enforcement fails closed:
 * an unreadable counter is treated as a violation, never as "within budget".
 */
export declare class InvalidBudgetStateError extends Error {
    readonly field: string;
    readonly value: unknown;
    constructor(field: string, value: unknown);
}
/** A zeroed usage record. Always start an execution from this. */
export declare function createUsage(): ExecutionUsage;
/** Validates every limit in a budget. Throws {@link InvalidBudgetStateError}. */
export declare function assertValidBudget(budget: ExecutionBudget): void;
/** Validates every counter in a usage record. Throws {@link InvalidBudgetStateError}. */
export declare function assertValidUsage(usage: ExecutionUsage): void;
/**
 * Throws if any usage counter exceeds its limit, or if any limit or counter is
 * not a finite, non-negative number. Usage exactly at a limit is allowed.
 */
export declare function assertWithinBudget(context: WorkflowContext): void;
//# sourceMappingURL=index.d.ts.map
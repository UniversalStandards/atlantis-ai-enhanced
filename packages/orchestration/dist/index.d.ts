import { type ActionDescriptor, type ApprovalGate, type PolicyEvaluator, type EvaluationResult, type Evaluator, type EventStore, type ExecutionBudget, type ExecutionMode, type ExecutionStatus, type ExecutionUsage, type SupervisorEscalation, type WorkflowContext, type WorkflowStep } from "@atlantis/contracts";
/** Bounded evaluate → revise loop applied to a step's output (ADR 0003 §4–5). */
export interface RefinementPolicy<I, O> {
    readonly evaluator: Evaluator<O>;
    /** Maximum number of revisions after the first output. Must be ≥ 0. */
    readonly maxRevisions: number;
    revise(input: I, previous: O, evaluation: EvaluationResult, context: WorkflowContext): Promise<O>;
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
export declare function sequence<I>(meta: WorkflowMetadata): SequenceBuilder<I, I>;
export declare class WorkflowDefinitionError extends Error {
    constructor(message: string);
}
export declare class ExecutionCancelledError extends Error {
    constructor();
}
export declare class StepFailedError extends Error {
    readonly stepId: string;
    readonly attempts: number;
    constructor(stepId: string, attempts: number, cause: unknown);
}
/** A policy denied the step, or no policy was configured to decide. */
export declare class PolicyDeniedError extends Error {
    readonly stepId: string;
    readonly policyId: string;
    constructor(stepId: string, policyId: string, reason: string);
}
/** An approver declined the step, or no approval gate was configured. */
export declare class ApprovalRejectedError extends Error {
    readonly stepId: string;
    readonly approver: string;
    constructor(stepId: string, approver: string);
}
export declare class RefinementExhaustedError extends Error {
    readonly stepId: string;
    readonly bestScore: number;
    readonly revisions: number;
    constructor(stepId: string, bestScore: number, revisions: number);
}
export interface ExecutionFailure {
    readonly name: string;
    readonly message: string;
    readonly stepId?: string;
}
export interface ExecutionResult<O> {
    readonly executionId: string;
    readonly status: Extract<ExecutionStatus, "succeeded" | "failed" | "cancelled" | "budget_exceeded">;
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
export declare function runSequentialWorkflow<I, O>(workflow: SequentialWorkflow<I, O>, input: I, options: RunOptions): Promise<ExecutionResult<O>>;
//# sourceMappingURL=index.d.ts.map
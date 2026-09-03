export type ExecutionMode = "workflow" | "supervisor" | "hybrid";

export type ExecutionStatus =
  | "pending"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "budget_exceeded"
  | "timed_out"
  | "rejected";

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
  | "execution.cancelled"
  | "execution.timed_out"
  | "execution.rejected"
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

export type TerminalExecutionStatus = Extract<
  ExecutionStatus,
  "succeeded" | "failed" | "cancelled" | "budget_exceeded" | "timed_out" | "rejected"
>;

export type TerminalExecutionEventType = Extract<
  ExecutionEventType,
  | "execution.completed"
  | "execution.failed"
  | "execution.cancelled"
  | "execution.timed_out"
  | "execution.rejected"
  | "budget.exceeded"
>;

export interface TerminalExecutionPayload {
  readonly status: TerminalExecutionStatus;
  readonly completedPrefix: number;
  readonly reason?: string;
}

export interface DurableExecutionCheckpoint {
  readonly id: string;
  readonly executionId: string;
  readonly nextSequence: number;
  readonly completedPrefix: number;
  readonly updatedAt: string;
}

export interface CheckpointRetirement {
  readonly checkpointId: string;
  readonly executionId: string;
  readonly terminalEventId: string;
  readonly retiredAt: string;
}

export interface TerminalDurabilityTransition {
  readonly checkpoint: DurableExecutionCheckpoint;
  readonly terminalEvent: ExecutionEvent<TerminalExecutionPayload>;
  readonly retiredAt: string;
}

export interface TerminalDurabilityAuthority {
  appendTerminalEvent(event: ExecutionEvent<TerminalExecutionPayload>): Promise<void>;
  retireCheckpoint(retirement: CheckpointRetirement): Promise<void>;
}

export type TerminalRecoverySnapshot =
  | {
      readonly checkpoint: DurableExecutionCheckpoint;
      readonly terminalEvent?: ExecutionEvent<TerminalExecutionPayload>;
      readonly checkpointRetired?: false;
    }
  | {
      readonly checkpoint?: undefined;
      readonly terminalEvent: ExecutionEvent<TerminalExecutionPayload>;
      readonly checkpointRetired: true;
    }
  | {
      readonly checkpoint?: undefined;
      readonly terminalEvent?: undefined;
      readonly checkpointRetired: true;
    };

export type TerminalRecoveryDecision =
  | {
      readonly kind: "terminal";
      readonly outcome: TerminalExecutionPayload;
      readonly terminalEvent: ExecutionEvent<TerminalExecutionPayload>;
      readonly shouldRetireCheckpoint: boolean;
    }
  | {
      readonly kind: "resume";
      readonly checkpoint: DurableExecutionCheckpoint;
      readonly resumeFromSequence: number;
    };

const terminalStatusByEventType: Readonly<
  Record<TerminalExecutionEventType, TerminalExecutionStatus>
> = {
  "execution.completed": "succeeded",
  "execution.failed": "failed",
  "execution.cancelled": "cancelled",
  "execution.timed_out": "timed_out",
  "execution.rejected": "rejected",
  "budget.exceeded": "budget_exceeded",
};

export class DurabilityInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurabilityInvariantError";
  }
}

export function isTerminalExecutionEvent(
  event: ExecutionEvent<unknown>,
): event is ExecutionEvent<TerminalExecutionPayload> {
  return event.type in terminalStatusByEventType;
}

export function terminalStatusForEventType(
  type: TerminalExecutionEventType,
): TerminalExecutionStatus {
  return terminalStatusByEventType[type];
}

export async function publishTerminalDurabilityTransition(
  authority: TerminalDurabilityAuthority,
  transition: TerminalDurabilityTransition,
): Promise<void> {
  validateTerminalDurabilityTransition(transition);

  await authority.appendTerminalEvent(transition.terminalEvent);
  await authority.retireCheckpoint({
    checkpointId: transition.checkpoint.id,
    executionId: transition.checkpoint.executionId,
    terminalEventId: transition.terminalEvent.id,
    retiredAt: transition.retiredAt,
  });
}

export function recoverTerminalExecution(
  snapshot: TerminalRecoverySnapshot,
): TerminalRecoveryDecision {
  if (snapshot.terminalEvent !== undefined) {
    validateTerminalEvent(snapshot.terminalEvent);

    return {
      kind: "terminal",
      outcome: snapshot.terminalEvent.payload,
      terminalEvent: snapshot.terminalEvent,
      shouldRetireCheckpoint: snapshot.checkpoint !== undefined,
    };
  }

  if (snapshot.checkpoint !== undefined) {
    return {
      kind: "resume",
      checkpoint: snapshot.checkpoint,
      resumeFromSequence: snapshot.checkpoint.nextSequence,
    };
  }

  throw new DurabilityInvariantError(
    "terminal execution recovery requires either durable terminal evidence or an active checkpoint",
  );
}

function validateTerminalDurabilityTransition(
  transition: TerminalDurabilityTransition,
): void {
  validateTerminalEvent(transition.terminalEvent);

  if (transition.checkpoint.executionId !== transition.terminalEvent.executionId) {
    throw new DurabilityInvariantError(
      "terminal event and checkpoint must belong to the same execution",
    );
  }

  if (transition.terminalEvent.payload.completedPrefix < transition.checkpoint.completedPrefix) {
    throw new DurabilityInvariantError(
      "terminal evidence must preserve the checkpoint completed prefix",
    );
  }
}

function validateTerminalEvent(
  event: ExecutionEvent<TerminalExecutionPayload>,
): void {
  if (!isTerminalExecutionEvent(event)) {
    throw new DurabilityInvariantError("checkpoint retirement requires terminal evidence");
  }

  const eventType = event.type as TerminalExecutionEventType;
  const expectedStatus = terminalStatusForEventType(eventType);
  if (event.payload.status !== expectedStatus) {
    throw new DurabilityInvariantError(
      `terminal event payload status ${event.payload.status} does not match event type ${event.type}`,
    );
  }
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

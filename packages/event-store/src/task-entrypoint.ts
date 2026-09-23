import type {
  ExecutionBudget,
  ExecutionEvent,
  WorkflowContext,
} from "@atlantis/contracts";
import {
  SequentialWorkflowRunner,
  type SequentialWorkflow,
} from "@atlantis/contracts/sequential-runner";

import { DurableExecutionEventSink } from "./execution-event-sink.js";

export interface TaskRequest<I = unknown> {
  readonly workflowId: string;
  readonly input: I;
  readonly userId: string;
  readonly budget: ExecutionBudget;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface TaskResult<O = unknown> {
  readonly executionId: string;
  readonly output: O;
  readonly trace: readonly ExecutionEvent[];
}

export interface TaskEntrypointOptions {
  readonly eventSink: DurableExecutionEventSink;
  readonly resolveWorkflow: (workflowId: string) => SequentialWorkflow<unknown, unknown> | undefined;
  readonly nextExecutionId: () => string;
  readonly nextEventId: () => string;
  readonly now?: () => string;
}

export interface TaskAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface GovernedTaskEntrypointOptions {
  readonly taskEntrypoint: TaskEntrypoint;
  readonly authorize: (
    request: TaskRequest,
  ) => TaskAuthorizationDecision | Promise<TaskAuthorizationDecision>;
  readonly normalize?: (request: unknown) => TaskRequest;
}

export class UnknownWorkflowError extends Error {
  public constructor(public readonly workflowId: string) {
    super(`Unknown workflow: ${workflowId}`);
    this.name = "UnknownWorkflowError";
  }
}

export class InvalidTaskRequestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidTaskRequestError";
  }
}

export class TaskAuthorizationError extends Error {
  public constructor(public readonly reason = "Task request was not authorized.") {
    super(reason);
    this.name = "TaskAuthorizationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: "workflowId" | "userId",
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidTaskRequestError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredBudget(value: unknown): ExecutionBudget {
  if (!isRecord(value)) {
    throw new InvalidTaskRequestError("budget must be an object.");
  }

  const fields = [
    "maxToolCalls",
    "maxRetries",
    "maxIterations",
    "maxTokens",
    "maxDurationMs",
    "maxCostUsd",
  ] as const;
  const normalized = {} as Record<(typeof fields)[number], number>;

  for (const field of fields) {
    const candidate = value[field];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      throw new InvalidTaskRequestError(
        `budget.${field} must be a finite non-negative number.`,
      );
    }
    normalized[field] = candidate;
  }

  return Object.freeze(normalized) as unknown as ExecutionBudget;
}

function optionalMetadata(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new InvalidTaskRequestError("metadata must be an object of string values.");
  }

  const normalized: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (key.trim().length === 0 || typeof candidate !== "string") {
      throw new InvalidTaskRequestError(
        "metadata must contain non-empty keys and string values.",
      );
    }
    normalized[key] = candidate;
  }
  return Object.freeze(normalized);
}

export function normalizeTaskRequest(request: unknown): TaskRequest {
  if (!isRecord(request)) {
    throw new InvalidTaskRequestError("Task request must be an object.");
  }
  if (!("input" in request)) {
    throw new InvalidTaskRequestError("input is required.");
  }

  const metadata = optionalMetadata(request.metadata);
  return Object.freeze({
    workflowId: requiredString(request.workflowId, "workflowId"),
    input: request.input,
    userId: requiredString(request.userId, "userId"),
    budget: requiredBudget(request.budget),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

export class TaskEntrypoint {
  public constructor(private readonly options: TaskEntrypointOptions) {}

  public async submit<I, O>(request: TaskRequest<I>): Promise<TaskResult<O>> {
    const workflow = this.options.resolveWorkflow(request.workflowId) as
      | SequentialWorkflow<I, O>
      | undefined;
    if (workflow === undefined) {
      throw new UnknownWorkflowError(request.workflowId);
    }

    const executionId = this.options.nextExecutionId();
    const context: WorkflowContext = {
      executionId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      userId: request.userId,
      mode: "workflow",
      budget: request.budget,
      usage: {
        toolCalls: 0,
        retries: 0,
        iterations: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        costUsd: 0,
      },
      metadata: request.metadata ?? {},
    };

    const runner = new SequentialWorkflowRunner({
      eventSink: this.options.eventSink,
      nextEventId: this.options.nextEventId,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });

    const output = await runner.run(workflow, request.input, context);
    return Object.freeze({
      executionId,
      output,
      trace: this.options.eventSink.readExecution(executionId),
    });
  }
}

export class GovernedTaskEntrypoint {
  private readonly normalize: (request: unknown) => TaskRequest;

  public constructor(private readonly options: GovernedTaskEntrypointOptions) {
    this.normalize = options.normalize ?? normalizeTaskRequest;
  }

  public async submit<O = unknown>(request: unknown): Promise<TaskResult<O>> {
    const normalized = this.normalize(request);
    const decision = await this.options.authorize(normalized);
    if (!decision.allowed) {
      throw new TaskAuthorizationError(decision.reason);
    }
    return this.options.taskEntrypoint.submit<unknown, O>(normalized);
  }
}

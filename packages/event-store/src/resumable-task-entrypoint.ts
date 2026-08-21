import type {
  ExecutionBudget,
  ExecutionEvent,
  ExecutionUsage,
  WorkflowContext,
} from "@atlantis/contracts";
import {
  ApprovalRequiredError,
  type ApprovalRequest,
  type ApprovalResolution,
} from "@atlantis/contracts/approval-control";
import type {
  ResumableSequentialWorkflowRunner,
  ResumableWorkflow,
} from "@atlantis/contracts/resumable-runner";

import type { DurableExecutionEventSink } from "./execution-event-sink.js";
import {
  withDurableOwnershipLossEvidence,
  type DurableOwnershipLossEvidenceContextOptions,
} from "./external-effect-ownership-loss-context.js";
import {
  InvalidTaskRequestError,
  TaskAuthorizationError,
  UnknownWorkflowError,
  normalizeTaskRequest,
  type TaskAuthorizationDecision,
  type TaskRequest,
} from "./task-entrypoint.js";

export interface ResumableTaskRequest<I = unknown> extends TaskRequest<I> {
  readonly executionId?: string;
  readonly approvalResolution?: ApprovalResolution;
}

export interface AuthoritativeExecutionAccounting {
  readonly budget: Readonly<ExecutionBudget>;
  readonly usage: Readonly<ExecutionUsage>;
}

export type ResumableTaskResult<O = unknown> =
  | Readonly<{
      status: "waiting_for_approval";
      executionId: string;
      approval: ApprovalRequest;
      trace: readonly ExecutionEvent[];
    }>
  | Readonly<{
      status: "completed";
      executionId: string;
      output: O;
      trace: readonly ExecutionEvent[];
      accounting: AuthoritativeExecutionAccounting;
    }>;

export type TerminalExecutionOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface TerminalExecutionRecord {
  readonly executionId: string;
  readonly outcome: TerminalExecutionOutcome;
  readonly eventId: string;
  readonly occurredAt: string;
}

export interface TerminalExecutionLookup {
  findTerminalExecution(
    executionId: string,
  ): TerminalExecutionRecord | undefined | Promise<TerminalExecutionRecord | undefined>;
}

export type ResumableOwnershipLossEvidenceOptions = Omit<
  DurableOwnershipLossEvidenceContextOptions,
  "eventSink" | "executionId"
>;

export class TerminalExecutionAlreadyFinalizedError extends Error {
  public constructor(public readonly terminal: TerminalExecutionRecord) {
    super(
      `Execution ${terminal.executionId} already has terminal outcome ${terminal.outcome}.`,
    );
    this.name = "TerminalExecutionAlreadyFinalizedError";
  }
}

export interface ResumableTaskEntrypointOptions {
  readonly eventSink: DurableExecutionEventSink;
  readonly terminalExecutionLookup: TerminalExecutionLookup;
  readonly resolveWorkflow: (
    workflowId: string,
  ) => ResumableWorkflow<unknown, unknown> | undefined;
  readonly createRunner: (
    request: Readonly<ResumableTaskRequest>,
  ) => ResumableSequentialWorkflowRunner;
  readonly nextExecutionId: () => string;
  readonly ownershipLossEvidence?: ResumableOwnershipLossEvidenceOptions;
}

export interface GovernedResumableTaskEntrypointOptions {
  readonly taskEntrypoint: ResumableTaskEntrypoint;
  readonly authorize: (
    request: Readonly<ResumableTaskRequest>,
  ) => TaskAuthorizationDecision | Promise<TaskAuthorizationDecision>;
  readonly normalize?: (request: unknown) => ResumableTaskRequest;
}

function optionalNonBlankString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidTaskRequestError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function normalizeResumableTaskRequest(
  request: unknown,
): ResumableTaskRequest {
  const normalized = normalizeTaskRequest(request);
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new InvalidTaskRequestError("Task request must be an object.");
  }

  const source = request as Record<string, unknown>;
  const executionId = optionalNonBlankString(source.executionId, "executionId");
  const approvalResolution = source.approvalResolution as
    | ApprovalResolution
    | undefined;

  if (approvalResolution !== undefined && executionId === undefined) {
    throw new InvalidTaskRequestError(
      "executionId is required when approvalResolution is supplied.",
    );
  }

  return Object.freeze({
    ...normalized,
    ...(executionId === undefined ? {} : { executionId }),
    ...(approvalResolution === undefined ? {} : { approvalResolution }),
  });
}

function createContext<I, O>(
  request: Readonly<ResumableTaskRequest<I>>,
  workflow: ResumableWorkflow<I, O>,
  executionId: string,
): WorkflowContext {
  return {
    executionId,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    userId: request.userId,
    mode: "workflow",
    budget: request.budget as ExecutionBudget,
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
}

function authoritativeAccounting(context: WorkflowContext): AuthoritativeExecutionAccounting {
  return Object.freeze({
    budget: Object.freeze({ ...context.budget }),
    usage: Object.freeze({ ...context.usage }),
  });
}

export class ResumableTaskEntrypoint {
  public constructor(private readonly options: ResumableTaskEntrypointOptions) {}

  public async submit<I, O>(
    request: Readonly<ResumableTaskRequest<I>>,
  ): Promise<ResumableTaskResult<O>> {
    const workflow = this.options.resolveWorkflow(request.workflowId) as
      | ResumableWorkflow<I, O>
      | undefined;
    if (workflow === undefined) {
      throw new UnknownWorkflowError(request.workflowId);
    }

    const executionId = request.executionId ?? this.options.nextExecutionId();
    const terminal = await this.options.terminalExecutionLookup.findTerminalExecution(
      executionId,
    );
    if (terminal !== undefined) {
      throw new TerminalExecutionAlreadyFinalizedError(terminal);
    }

    const context = createContext(request, workflow, executionId);
    const runner = this.options.createRunner(request);
    const run = () => runner.run(workflow, request.input, context);

    try {
      const output =
        this.options.ownershipLossEvidence === undefined
          ? await run()
          : await withDurableOwnershipLossEvidence(
              {
                ...this.options.ownershipLossEvidence,
                eventSink: this.options.eventSink,
                executionId,
              },
              run,
            );
      return Object.freeze({
        status: "completed",
        executionId,
        output,
        trace: this.options.eventSink.readExecution(executionId),
        accounting: authoritativeAccounting(context),
      });
    } catch (error) {
      if (error instanceof ApprovalRequiredError) {
        return Object.freeze({
          status: "waiting_for_approval",
          executionId,
          approval: error.request,
          trace: this.options.eventSink.readExecution(executionId),
        });
      }
      throw error;
    }
  }
}

export class GovernedResumableTaskEntrypoint {
  private readonly normalize: (request: unknown) => ResumableTaskRequest;

  public constructor(
    private readonly options: GovernedResumableTaskEntrypointOptions,
  ) {
    this.normalize = options.normalize ?? normalizeResumableTaskRequest;
  }

  public async submit<O = unknown>(
    request: unknown,
  ): Promise<ResumableTaskResult<O>> {
    const normalized = this.normalize(request);
    const decision = await this.options.authorize(normalized);
    if (!decision.allowed) {
      throw new TaskAuthorizationError(decision.reason);
    }
    return this.options.taskEntrypoint.submit<unknown, O>(normalized);
  }
}

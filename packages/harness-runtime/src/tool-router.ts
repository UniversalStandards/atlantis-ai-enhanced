import type {
  ExecutionBudget,
  ExecutionUsage,
  WorkflowContext,
} from "@atlantis/contracts";
import { assertWithinBudget } from "@atlantis/contracts";
import {
  ApprovalRejectedError,
  ApprovalRequiredError,
  requireApproved,
  type ApprovalRequest,
  type ApprovalResolution,
} from "@atlantis/contracts/approval-control";
import {
  assertValidRetryPolicy,
  type RetryPolicy,
} from "@atlantis/contracts/execution-control";
import {
  normalizeExternalEffectIdentity,
  type ExternalEffectIdentity,
} from "@atlantis/contracts/external-effect";

import {
  normalizeEvidenceInput,
  normalizeJsonValue,
  normalizeString,
  normalizeStringRecord,
  normalizeTimestamp,
  normalizeToolFailure,
  stableStringify,
  type ActionAttemptRecord,
  type HarnessApprovalDecisionRecord,
  type HarnessEvidenceInput,
  type HarnessEvidenceRecord,
  type HarnessPlanAction,
  type HarnessPolicyDecisionRecord,
  type JsonValue,
  type ToolFailure,
  type ToolAttemptRecord,
} from "./work-delta.js";

export interface HarnessClock {
  nowIso(): string;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}

export interface HarnessIdSource {
  nextId(prefix: string): string;
}

export interface ToolInputSchema<TInput extends JsonValue = JsonValue> {
  parse(input: unknown): TInput;
}

export interface ToolRetryPolicy extends RetryPolicy {
  readonly backoffMs?: readonly number[];
}

export interface ToolPolicyDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ToolPolicyEvaluationRequest<TInput extends JsonValue = JsonValue> {
  readonly toolName: string;
  readonly capability: string;
  readonly input: TInput;
  readonly executionId: string;
  readonly correlationId: string;
  readonly actionId: string;
  readonly executionMetadata: Readonly<Record<string, string>>;
  readonly metadata: ExternalEffectIdentity;
}

export interface ToolPolicyEvaluator {
  evaluate<TInput extends JsonValue>(
    request: ToolPolicyEvaluationRequest<TInput>,
  ): ToolPolicyDecision | Promise<ToolPolicyDecision>;
}

export interface ToolApprovalRequirement<TInput extends JsonValue = JsonValue> {
  readonly action: string;
  readonly reason: string | ((input: TInput) => string);
  readonly requestedBy?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly requestVersion?: number;
}

export interface ToolExecutionMetadata {
  readonly executionId: string;
  readonly correlationId: string;
  readonly actionId: string;
  readonly toolName: string;
  readonly idempotency: ExternalEffectIdentity;
}

export interface ToolSuccess<TOutput extends JsonValue = JsonValue> {
  readonly status: "succeeded";
  readonly output: TOutput;
  readonly evidence?: readonly HarnessEvidenceInput[];
  readonly usage?: Partial<ExecutionUsage>;
}

export interface ToolFailureResult {
  readonly status: "failed";
  readonly failure: ToolFailure;
  readonly evidence?: readonly HarnessEvidenceInput[];
  readonly usage?: Partial<ExecutionUsage>;
}

export type ToolHandlerResult<TOutput extends JsonValue = JsonValue> =
  | ToolSuccess<TOutput>
  | ToolFailureResult;

export interface ToolDescriptor<
  TInput extends JsonValue = JsonValue,
  TOutput extends JsonValue = JsonValue,
> {
  readonly name: string;
  readonly capability: string;
  readonly description: string;
  readonly schema: ToolInputSchema<TInput>;
  readonly retry?: ToolRetryPolicy;
  readonly approval?: ToolApprovalRequirement<TInput>;
  readonly execute: (
    input: TInput,
    metadata: ToolExecutionMetadata,
  ) => ToolHandlerResult<TOutput> | Promise<ToolHandlerResult<TOutput>>;
}

export interface ToolRouterOptions {
  readonly tools: readonly ToolDescriptor[];
  readonly policy?: ToolPolicyEvaluator;
  readonly approvals?: {
    resolve(request: ApprovalRequest): ApprovalResolution | undefined | Promise<ApprovalResolution | undefined>;
  };
}

export type ToolInvocationStatus =
  | "succeeded"
  | "policy_denied"
  | "approval_denied"
  | "budget_exhausted"
  | "tool_failed";

export interface ToolInvocationResult {
  readonly status: ToolInvocationStatus;
  readonly actionRecord: ActionAttemptRecord;
  readonly policyDecisions: readonly HarnessPolicyDecisionRecord[];
  readonly policyDecision?: HarnessPolicyDecisionRecord;
  readonly approvalDecision?: HarnessApprovalDecisionRecord;
  readonly evidenceReads: readonly HarnessEvidenceRecord[];
}

export class DuplicateToolNameError extends Error {
  public constructor(toolName: string) {
    super(`Tool ${toolName} is already registered`);
    this.name = "DuplicateToolNameError";
  }
}

export class UnknownToolError extends Error {
  public constructor(toolName: string) {
    super(`Unknown tool: ${toolName}`);
    this.name = "UnknownToolError";
  }
}

export class InvalidToolInputError extends Error {
  public constructor(toolName: string, cause: unknown) {
    super(
      `Tool ${toolName} input validation failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "InvalidToolInputError";
  }
}

export interface ToolInvocationContext {
  readonly iteration: number;
  readonly action: HarnessPlanAction;
  readonly executionId: string;
  readonly executionStartedAtMs: number;
  readonly correlationId: string;
  readonly executionMetadata: Readonly<Record<string, string>>;
  readonly budget: ExecutionBudget;
  readonly usage: ExecutionUsage;
  readonly clock: HarnessClock;
  readonly ids: HarnessIdSource;
}

export class ToolRouter {
  readonly #tools = new Map<string, ToolDescriptor>();

  public constructor(private readonly options: ToolRouterOptions) {
    for (const tool of options.tools) {
      if (this.#tools.has(tool.name)) {
        throw new DuplicateToolNameError(tool.name);
      }
      this.#tools.set(tool.name, tool);
      if (tool.retry !== undefined) {
        assertValidRetryPolicy(tool.retry);
        tool.retry.backoffMs?.forEach((delay, index) => {
          if (!Number.isFinite(delay) || delay < 0) {
            throw new Error(
              `Tool ${tool.name} retry backoffMs[${index}] must be a finite non-negative number`,
            );
          }
        });
      }
    }
  }

  public async invoke(context: ToolInvocationContext): Promise<ToolInvocationResult> {
    const tool = this.#tools.get(context.action.toolName);
    const actionStartedAt = context.clock.nowIso();
    if (tool === undefined) {
      return this.#failureWithoutAttempts(context, actionStartedAt, {
        kind: "deterministic",
        code: "unknown_tool",
        message: new UnknownToolError(context.action.toolName).message,
      });
    }

    let input: JsonValue;
    try {
      input = tool.schema.parse(context.action.input);
    } catch (error) {
      return this.#failureWithoutAttempts(context, actionStartedAt, {
        kind: "deterministic",
        code: "invalid_input",
        message: new InvalidToolInputError(tool.name, error).message,
      }, tool.capability);
    }

    const idempotency = normalizeExternalEffectIdentity({
      idempotencyKey: `${context.executionId}:${context.action.actionId}`,
      executionId: context.executionId,
      stepId: context.action.actionId,
      effectType: tool.capability,
    });

    this.#synchronizeDuration(context);
    const budgetStatus = this.#checkBudget(context.budget, context.usage, { toolCalls: 1 }, tool);
    if (budgetStatus !== undefined) {
      return this.#budgetExceeded(
        context,
        actionStartedAt,
        input,
        tool.capability,
        idempotency,
      );
    }

    const policyDecisions: HarnessPolicyDecisionRecord[] = [];
    const policyDecision = await this.#evaluatePolicy(
      context,
      tool,
      input,
      idempotency,
    );
    policyDecisions.push(policyDecision);
    if (!policyDecision.allowed) {
      return this.#policyDenied(
        context,
        actionStartedAt,
        input,
        tool.capability,
        idempotency,
        Object.freeze([...policyDecisions]),
      );
    }
    const policyBudgetResult = this.#preDispatchBudgetExceeded(
      context,
      actionStartedAt,
      input,
      tool,
      idempotency,
      Object.freeze([]),
      Object.freeze([...policyDecisions]),
    );
    if (policyBudgetResult !== undefined) {
      return policyBudgetResult;
    }

    const approvalDecision = await this.#evaluateApproval(
      context,
      tool,
      input,
      idempotency,
    );
    if (approvalDecision !== undefined && approvalDecision.outcome !== "approved") {
      return Object.freeze({
        status: "approval_denied",
        actionRecord: Object.freeze({
          iteration: context.iteration,
          actionId: context.action.actionId,
          toolName: context.action.toolName,
          capability: tool.capability,
          startedAt: normalizeTimestamp("action.startedAt", actionStartedAt),
          completedAt: context.clock.nowIso(),
          correlationId: context.correlationId,
          idempotency,
          input,
          outcome: "approval_denied",
          attempts: Object.freeze([]),
        }),
        policyDecisions: Object.freeze([...policyDecisions]),
        policyDecision,
        approvalDecision,
        evidenceReads: Object.freeze([]),
      });
    }
    const approvalBudgetResult = this.#preDispatchBudgetExceeded(
      context,
      actionStartedAt,
      input,
      tool,
      idempotency,
      Object.freeze([]),
      Object.freeze([...policyDecisions]),
      approvalDecision,
    );
    if (approvalBudgetResult !== undefined) {
      return approvalBudgetResult;
    }

    const metadata: ToolExecutionMetadata = Object.freeze({
      executionId: context.executionId,
      correlationId: context.correlationId,
      actionId: context.action.actionId,
      toolName: context.action.toolName,
      idempotency,
    });
    const attempts: ToolAttemptRecord[] = [];
    const evidenceReads: HarnessEvidenceRecord[] = [];
    let output: JsonValue | undefined;
    let finalFailure: ToolFailure | undefined;
    const retryPolicy = tool.retry ?? { maxAttempts: 1 };

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      if (attempt > 1) {
        this.#synchronizeDuration(context);
        const retryBudgetStatus = this.#checkBudget(
          context.budget,
          context.usage,
          { toolCalls: 1 },
          tool,
        );
        if (retryBudgetStatus !== undefined) {
          return this.#budgetExceeded(
            context,
            actionStartedAt,
            input,
            tool.capability,
            idempotency,
            attempts,
            Object.freeze([...policyDecisions]),
            approvalDecision,
          );
        }
      }

      const attemptStartedAt = context.clock.nowIso();
      if (attempt > 1) {
        const retryPolicyDecision = await this.#evaluatePolicy(
          context,
          tool,
          input,
          idempotency,
        );
        policyDecisions.push(retryPolicyDecision);
        if (!retryPolicyDecision.allowed) {
          return this.#policyDenied(
            context,
            actionStartedAt,
            input,
            tool.capability,
            idempotency,
            Object.freeze([...policyDecisions]),
            Object.freeze(attempts),
            approvalDecision,
          );
        }
        const retryDispatchBudgetResult = this.#preDispatchBudgetExceeded(
          context,
          actionStartedAt,
          input,
          tool,
          idempotency,
          Object.freeze([...attempts]),
          Object.freeze([...policyDecisions]),
          approvalDecision,
        );
        if (retryDispatchBudgetResult !== undefined) {
          return retryDispatchBudgetResult;
        }
      }
      let resultSettled = false;
      let result: ToolHandlerResult | undefined;
      try {
        result = await tool.execute(input, metadata);
        resultSettled = true;
        context.usage.toolCalls += 1;
        const normalizedUsage = normalizeUsageContribution(result.usage);
        const normalizedEvidence = Object.freeze(
          (result.evidence ?? []).map((entry) =>
            normalizeEvidenceInput(context.iteration, "action", context.clock.nowIso(), entry),
          ),
        );
        const normalizedOutput =
          result.status === "succeeded"
            ? normalizeJsonValue("tool.output", result.output)
            : undefined;
        const normalizedFailure =
          result.status === "failed"
            ? normalizeToolFailure("tool.failure", result.failure)
            : undefined;
        applyUsageDelta(context.usage, normalizedUsage);
        this.#synchronizeDuration(context);
        const withinBudget = this.#isWithinBudget(context.budget, context.usage);
        evidenceReads.push(...normalizedEvidence);
        const attemptCompletedAt = context.clock.nowIso();
        if (result.status === "succeeded") {
          output = normalizedOutput as JsonValue;
          attempts.push(
            Object.freeze({
              attempt,
              startedAt: normalizeTimestamp("attempt.startedAt", attemptStartedAt),
              completedAt: normalizeTimestamp("attempt.completedAt", attemptCompletedAt),
              status: "succeeded",
            }),
          );
          return Object.freeze({
            status: "succeeded",
            actionRecord: Object.freeze({
              iteration: context.iteration,
              actionId: context.action.actionId,
              toolName: context.action.toolName,
              capability: tool.capability,
              startedAt: normalizeTimestamp("action.startedAt", actionStartedAt),
              completedAt: attemptCompletedAt,
              correlationId: context.correlationId,
              idempotency,
              input,
              outcome: "succeeded",
              attempts: Object.freeze(attempts),
              output: output as JsonValue,
            }),
            policyDecisions: Object.freeze([...policyDecisions]),
            ...this.#latestPolicyDecision(policyDecisions),
            ...(approvalDecision === undefined ? {} : { approvalDecision }),
            evidenceReads: Object.freeze(evidenceReads),
          });
        }

        finalFailure = normalizedFailure as ToolFailure;
        const shouldRetry =
          finalFailure.kind === "transient" &&
          attempt < retryPolicy.maxAttempts &&
          (retryPolicy.shouldRetry?.(finalFailure, attempt) ?? true);
        if (shouldRetry) {
          context.usage.retries += 1;
        }
        const backoffMsAfter = shouldRetry ? retryPolicy.backoffMs?.[attempt - 1] ?? 0 : undefined;
        attempts.push(
          Object.freeze({
            attempt,
            startedAt: normalizeTimestamp("attempt.startedAt", attemptStartedAt),
            completedAt: normalizeTimestamp("attempt.completedAt", attemptCompletedAt),
            status: "failed",
            failure: finalFailure as ToolFailure,
            ...(backoffMsAfter === undefined ? {} : { backoffMsAfter }),
          }),
        );

        if (!withinBudget) {
          return this.#budgetExceeded(
            context,
            actionStartedAt,
            input,
            tool.capability,
            idempotency,
            Object.freeze(attempts),
            Object.freeze([...policyDecisions]),
            approvalDecision,
          );
        }

        if (!shouldRetry) {
          return Object.freeze({
            status: "tool_failed",
            actionRecord: Object.freeze({
              iteration: context.iteration,
              actionId: context.action.actionId,
              toolName: context.action.toolName,
              capability: tool.capability,
              startedAt: normalizeTimestamp("action.startedAt", actionStartedAt),
              completedAt: attemptCompletedAt,
              correlationId: context.correlationId,
              idempotency,
              input,
              outcome: "tool_failed",
              attempts: Object.freeze(attempts),
              failure: finalFailure as ToolFailure,
            }),
            policyDecisions: Object.freeze([...policyDecisions]),
            ...this.#latestPolicyDecision(policyDecisions),
            ...(approvalDecision === undefined ? {} : { approvalDecision }),
            evidenceReads: Object.freeze(evidenceReads),
          });
        }

        const retryBudgetResult = await this.#sleepForRetry(
          context,
          actionStartedAt,
          input,
          tool,
          idempotency,
          attempts,
          Object.freeze([...policyDecisions]),
          approvalDecision,
          backoffMsAfter,
        );
        if (retryBudgetResult !== undefined) {
          return retryBudgetResult;
        }
      } catch (error) {
        const attemptCompletedAt = context.clock.nowIso();
        const isInvalidToolResult = resultSettled;
        if (!resultSettled) {
          context.usage.toolCalls += 1;
        }
        this.#synchronizeDuration(context);
        const shouldRetry =
          !isInvalidToolResult &&
          attempt < retryPolicy.maxAttempts &&
          retryPolicy.shouldRetry?.(error, attempt) === true;
        if (shouldRetry) {
          context.usage.retries += 1;
        }
        const executionFailure = normalizeToolFailure("tool.failure", {
          kind: shouldRetry ? "transient" : "deterministic",
          code: isInvalidToolResult ? "invalid_tool_result" : "tool_execution_error",
          message: error instanceof Error ? error.message : String(error),
          details: {
            ...(isInvalidToolResult
              ? {
                  returnedUsage:
                    result?.usage === undefined ? null : describeInvalidToolResult(result.usage),
                  returnedPayload:
                    result?.status === "succeeded"
                      ? describeInvalidToolResult(result.output)
                      : describeInvalidToolResult(result?.failure),
                }
              : {
                  thrown: describeInvalidToolResult(error),
                }),
          },
        });
        const backoffMsAfter = shouldRetry ? retryPolicy.backoffMs?.[attempt - 1] ?? 0 : undefined;
        attempts.push(
          Object.freeze({
            attempt,
            startedAt: normalizeTimestamp("attempt.startedAt", attemptStartedAt),
            completedAt: normalizeTimestamp("attempt.completedAt", attemptCompletedAt),
            status: "failed",
            failure: executionFailure,
            ...(backoffMsAfter === undefined ? {} : { backoffMsAfter }),
          }),
        );
        finalFailure = executionFailure;

        if (!shouldRetry) {
          return Object.freeze({
            status: "tool_failed",
            actionRecord: Object.freeze({
              iteration: context.iteration,
              actionId: context.action.actionId,
              toolName: context.action.toolName,
              capability: tool.capability,
              startedAt: normalizeTimestamp("action.startedAt", actionStartedAt),
              completedAt: attemptCompletedAt,
              correlationId: context.correlationId,
              idempotency,
              input,
              outcome: "tool_failed",
              attempts: Object.freeze(attempts),
              failure: executionFailure,
            }),
            policyDecisions: Object.freeze([...policyDecisions]),
            ...this.#latestPolicyDecision(policyDecisions),
            ...(approvalDecision === undefined ? {} : { approvalDecision }),
            evidenceReads: Object.freeze(evidenceReads),
          });
        }

        const retryBudgetResult = await this.#sleepForRetry(
          context,
          actionStartedAt,
          input,
          tool,
          idempotency,
          attempts,
          Object.freeze([...policyDecisions]),
          approvalDecision,
          backoffMsAfter,
        );
        if (retryBudgetResult !== undefined) {
          return retryBudgetResult;
        }
      }
    }

    return Object.freeze({
      status: "tool_failed",
      actionRecord: Object.freeze({
        iteration: context.iteration,
        actionId: context.action.actionId,
        toolName: context.action.toolName,
        capability: tool.capability,
        startedAt: normalizeTimestamp("action.startedAt", actionStartedAt),
        completedAt: context.clock.nowIso(),
        correlationId: context.correlationId,
        idempotency,
        input,
        outcome: "tool_failed",
        attempts: Object.freeze(attempts),
        ...(finalFailure === undefined ? {} : { failure: finalFailure }),
      }),
      policyDecisions: Object.freeze([...policyDecisions]),
      ...this.#latestPolicyDecision(policyDecisions),
      ...(approvalDecision === undefined ? {} : { approvalDecision }),
      evidenceReads: Object.freeze(evidenceReads),
    });
  }

  #assertBudget(budget: ExecutionBudget, usage: ExecutionUsage): void {
    const budgetContext: WorkflowContext = {
      executionId: "harness-runtime-budget-check",
      workflowId: "harness-runtime",
      workflowVersion: "1",
      userId: "harness-runtime",
      mode: "workflow",
      budget,
      usage,
      metadata: {},
    };
    assertWithinBudget(budgetContext);
  }

  #isWithinBudget(budget: ExecutionBudget, usage: ExecutionUsage): boolean {
    try {
      this.#assertBudget(budget, usage);
      return true;
    } catch {
      return false;
    }
  }

  #checkBudget(
    budget: ExecutionBudget,
    usage: ExecutionUsage,
    delta: Partial<ExecutionUsage>,
    _tool: ToolDescriptor,
  ): boolean | undefined {
    try {
      this.#assertBudget(budget, projectedUsage(usage, delta));
      return undefined;
    } catch {
      return true;
    }
  }

  async #evaluatePolicy(
    context: ToolInvocationContext,
    tool: ToolDescriptor,
    input: JsonValue,
    idempotency: ExternalEffectIdentity,
  ): Promise<HarnessPolicyDecisionRecord> {
    const decidedAt = context.clock.nowIso();
    let decision: ToolPolicyDecision;
    if (this.options.policy === undefined) {
      decision = { allowed: false, reason: "policy evaluator required", metadata: {} };
    } else {
      try {
        decision = normalizePolicyDecision(
          await this.options.policy.evaluate({
            toolName: tool.name,
            capability: tool.capability,
            input,
            executionId: context.executionId,
            correlationId: context.correlationId,
            actionId: context.action.actionId,
            executionMetadata: context.executionMetadata,
            metadata: idempotency,
          }),
        );
      } catch (error) {
        decision = {
          allowed: false,
          reason: "invalid policy decision",
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
    return Object.freeze({
      iteration: context.iteration,
      actionId: context.action.actionId,
      toolName: tool.name,
      decidedAt: normalizeTimestamp("policy.decidedAt", decidedAt),
      allowed: decision.allowed,
      reason: normalizeString("policy.reason", decision.reason),
      metadata: normalizeStringRecord("policy.metadata", decision.metadata ?? {}),
    });
  }

  async #evaluateApproval(
    context: ToolInvocationContext,
    tool: ToolDescriptor,
    input: JsonValue,
    idempotency: ExternalEffectIdentity,
  ): Promise<HarnessApprovalDecisionRecord | undefined> {
    if (tool.approval === undefined) {
      return undefined;
    }
    let request: ApprovalRequest | undefined;
    try {
      request = Object.freeze({
        approvalId: context.ids.nextId("approval"),
        executionId: context.executionId,
        requestVersion: tool.approval.requestVersion ?? 1,
        stepId: context.action.actionId,
        action: normalizeString("approval.action", tool.approval.action),
        reason: normalizeString(
          "approval.reason",
          typeof tool.approval.reason === "function"
            ? tool.approval.reason(input)
            : tool.approval.reason,
        ),
        requestedBy: normalizeString(
          "approval.requestedBy",
          tool.approval.requestedBy ?? "harness-runtime",
        ),
        requestedAt: context.clock.nowIso(),
        metadata: Object.freeze({
          ...normalizeStringRecord("approval.metadata", tool.approval.metadata ?? {}),
          correlationId: context.correlationId,
          idempotencyKey: idempotency.idempotencyKey,
        }),
      });
      const resolution = await this.options.approvals?.resolve(request);
      const approved = requireApproved(request, resolution);
      return Object.freeze({
        iteration: context.iteration,
        actionId: context.action.actionId,
        toolName: tool.name,
        outcome: "approved",
        recordedAt: context.clock.nowIso(),
        request,
        resolution: approved.resolution,
      });
    } catch (error) {
      if (error instanceof ApprovalRequiredError) {
        return Object.freeze({
          iteration: context.iteration,
          actionId: context.action.actionId,
          toolName: tool.name,
          outcome: "required",
          recordedAt: context.clock.nowIso(),
          request: request ?? this.#fallbackApprovalRequest(context, tool, idempotency),
        });
      }
      if (error instanceof ApprovalRejectedError) {
        return Object.freeze({
          iteration: context.iteration,
          actionId: context.action.actionId,
          toolName: tool.name,
          outcome: "rejected",
          recordedAt: context.clock.nowIso(),
          request: request ?? this.#fallbackApprovalRequest(context, tool, idempotency),
          resolution: error.approval.resolution,
        });
      }
      return Object.freeze({
        iteration: context.iteration,
        actionId: context.action.actionId,
        toolName: tool.name,
        outcome: "required",
        recordedAt: context.clock.nowIso(),
        request: request ?? this.#fallbackApprovalRequest(context, tool, idempotency),
        failure: normalizeToolFailure("approval.failure", {
          kind: "deterministic",
          code: "approval_resolution_error",
          message: error instanceof Error ? error.message : String(error),
          details: {
            thrown: describeInvalidToolResult(error),
          },
        }),
      });
    }
  }

  #fallbackApprovalRequest(
    context: ToolInvocationContext,
    tool: ToolDescriptor,
    idempotency: ExternalEffectIdentity,
  ): ApprovalRequest {
    return Object.freeze({
      approvalId: context.ids.nextId("approval-failed"),
      executionId: context.executionId,
      requestVersion: tool.approval?.requestVersion ?? 1,
      stepId: context.action.actionId,
      action: normalizeString("approval.action", tool.approval?.action ?? "tool-approval"),
      reason: "approval resolution failed before a canonical request could be recorded",
      requestedBy: normalizeString(
        "approval.requestedBy",
        tool.approval?.requestedBy ?? "harness-runtime",
      ),
      requestedAt: context.clock.nowIso(),
      metadata: Object.freeze({
        ...normalizeStringRecord("approval.metadata", tool.approval?.metadata ?? {}),
        correlationId: context.correlationId,
        idempotencyKey: idempotency.idempotencyKey,
      }),
    });
  }

  #failureWithoutAttempts(
    context: ToolInvocationContext,
    actionStartedAt: string,
    failure: ToolFailure,
    capability = "unknown",
  ): ToolInvocationResult {
    return Object.freeze({
      status: "tool_failed",
      actionRecord: Object.freeze({
        iteration: context.iteration,
        actionId: context.action.actionId,
        toolName: context.action.toolName,
        capability,
        startedAt: normalizeTimestamp("action.startedAt", actionStartedAt),
        completedAt: context.clock.nowIso(),
        correlationId: context.correlationId,
        idempotency: normalizeExternalEffectIdentity({
          idempotencyKey: `${context.executionId}:${context.action.actionId}`,
          executionId: context.executionId,
          stepId: context.action.actionId,
          effectType: capability,
        }),
        input: normalizeJsonValue("action.input", context.action.input),
        outcome: "tool_failed",
        attempts: Object.freeze([]),
        failure: normalizeToolFailure("failure", failure),
      }),
      policyDecisions: Object.freeze([]),
      evidenceReads: Object.freeze([]),
    });
  }

  #budgetExceeded(
    context: ToolInvocationContext,
    actionStartedAt: string,
    input: JsonValue,
    capability: string,
    idempotency: ExternalEffectIdentity,
    attempts: readonly ToolAttemptRecord[] = Object.freeze([]),
    policyDecisions: readonly HarnessPolicyDecisionRecord[] = Object.freeze([]),
    approvalDecision?: HarnessApprovalDecisionRecord,
  ): ToolInvocationResult {
    return Object.freeze({
      status: "budget_exhausted",
      actionRecord: Object.freeze({
        iteration: context.iteration,
        actionId: context.action.actionId,
        toolName: context.action.toolName,
        capability,
        startedAt: normalizeTimestamp("action.startedAt", actionStartedAt),
        completedAt: context.clock.nowIso(),
        correlationId: context.correlationId,
        idempotency,
        input,
        outcome: "budget_exhausted",
        attempts,
      }),
      policyDecisions,
      ...this.#latestPolicyDecision(policyDecisions),
      ...(approvalDecision === undefined ? {} : { approvalDecision }),
      evidenceReads: Object.freeze([]),
    });
  }

  #policyDenied(
    context: ToolInvocationContext,
    actionStartedAt: string,
    input: JsonValue,
    capability: string,
    idempotency: ExternalEffectIdentity,
    policyDecisions: readonly HarnessPolicyDecisionRecord[],
    attempts: readonly ToolAttemptRecord[] = Object.freeze([]),
    approvalDecision?: HarnessApprovalDecisionRecord,
  ): ToolInvocationResult {
    return Object.freeze({
      status: "policy_denied",
      actionRecord: Object.freeze({
        iteration: context.iteration,
        actionId: context.action.actionId,
        toolName: context.action.toolName,
        capability,
        startedAt: normalizeTimestamp("action.startedAt", actionStartedAt),
        completedAt: context.clock.nowIso(),
        correlationId: context.correlationId,
        idempotency,
        input,
        outcome: "policy_denied",
        attempts,
      }),
      policyDecisions,
      ...this.#latestPolicyDecision(policyDecisions),
      ...(approvalDecision === undefined ? {} : { approvalDecision }),
      evidenceReads: Object.freeze([]),
    });
  }

  #preDispatchBudgetExceeded(
    context: ToolInvocationContext,
    actionStartedAt: string,
    input: JsonValue,
    tool: ToolDescriptor,
    idempotency: ExternalEffectIdentity,
    attempts: readonly ToolAttemptRecord[],
    policyDecisions: readonly HarnessPolicyDecisionRecord[],
    approvalDecision?: HarnessApprovalDecisionRecord,
  ): ToolInvocationResult | undefined {
    this.#synchronizeDuration(context);
    const dispatchBudgetStatus = this.#checkBudget(
      context.budget,
      context.usage,
      { toolCalls: 1 },
      tool,
    );
    if (dispatchBudgetStatus !== undefined) {
      return this.#budgetExceeded(
        context,
        actionStartedAt,
        input,
        tool.capability,
        idempotency,
        attempts,
        policyDecisions,
        approvalDecision,
      );
    }
    return undefined;
  }

  async #sleepForRetry(
    context: ToolInvocationContext,
    actionStartedAt: string,
    input: JsonValue,
    tool: ToolDescriptor,
    idempotency: ExternalEffectIdentity,
    attempts: ToolAttemptRecord[],
    policyDecisions: readonly HarnessPolicyDecisionRecord[] = Object.freeze([]),
    approvalDecision?: HarnessApprovalDecisionRecord,
    backoffMsAfter = 0,
  ): Promise<ToolInvocationResult | undefined> {
    await context.clock.sleep(backoffMsAfter);
    this.#synchronizeDuration(context);
    const budgetStatus = this.#checkBudget(context.budget, context.usage, { toolCalls: 1 }, tool);
    if (budgetStatus !== undefined) {
      return this.#budgetExceeded(
        context,
        actionStartedAt,
        input,
        tool.capability,
        idempotency,
        Object.freeze(attempts),
        policyDecisions,
        approvalDecision,
      );
    }
    return undefined;
  }

  #synchronizeDuration(context: ToolInvocationContext): void {
    context.usage.durationMs = Math.max(
      context.usage.durationMs,
      context.clock.nowMs() - context.executionStartedAtMs,
    );
  }

  #latestPolicyDecision(
    policyDecisions: readonly HarnessPolicyDecisionRecord[],
  ): { readonly policyDecision: HarnessPolicyDecisionRecord } | {} {
    const policyDecision = policyDecisions.at(-1);
    return policyDecision === undefined ? {} : { policyDecision };
  }
}

function applyUsageDelta(
  usage: ExecutionUsage,
  delta: Partial<ExecutionUsage> | undefined,
): void {
  if (delta === undefined) {
    return;
  }
  if (delta.toolCalls !== undefined) usage.toolCalls += normalizeUsageDelta("toolCalls", delta.toolCalls);
  if (delta.retries !== undefined) usage.retries += normalizeUsageDelta("retries", delta.retries);
  if (delta.iterations !== undefined) usage.iterations += normalizeUsageDelta("iterations", delta.iterations);
  if (delta.inputTokens !== undefined) usage.inputTokens += normalizeUsageDelta("inputTokens", delta.inputTokens);
  if (delta.outputTokens !== undefined) usage.outputTokens += normalizeUsageDelta("outputTokens", delta.outputTokens);
  if (delta.durationMs !== undefined) usage.durationMs += normalizeUsageDelta("durationMs", delta.durationMs);
  if (delta.costUsd !== undefined) usage.costUsd += normalizeUsageDelta("costUsd", delta.costUsd);
}

function projectedUsage(
  usage: ExecutionUsage,
  delta: Partial<ExecutionUsage>,
): ExecutionUsage {
  return Object.freeze({
    toolCalls: usage.toolCalls + (delta.toolCalls ?? 0),
    retries: usage.retries + (delta.retries ?? 0),
    iterations: usage.iterations + (delta.iterations ?? 0),
    inputTokens: usage.inputTokens + (delta.inputTokens ?? 0),
    outputTokens: usage.outputTokens + (delta.outputTokens ?? 0),
    durationMs: usage.durationMs + (delta.durationMs ?? 0),
    costUsd: usage.costUsd + (delta.costUsd ?? 0),
  }) as ExecutionUsage;
}

function normalizeUsageDelta(field: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Tool usage delta ${field} must be a finite non-negative number`);
  }
  return value;
}

function normalizeUsageContribution(
  delta: Partial<ExecutionUsage> | undefined,
): Partial<ExecutionUsage> {
  if (delta === undefined) {
    return {};
  }
  return Object.freeze({
    ...(delta.toolCalls === undefined
      ? {}
      : { toolCalls: normalizeUsageDelta("toolCalls", delta.toolCalls) }),
    ...(delta.retries === undefined
      ? {}
      : { retries: normalizeUsageDelta("retries", delta.retries) }),
    ...(delta.iterations === undefined
      ? {}
      : { iterations: normalizeUsageDelta("iterations", delta.iterations) }),
    ...(delta.inputTokens === undefined
      ? {}
      : { inputTokens: normalizeUsageDelta("inputTokens", delta.inputTokens) }),
    ...(delta.outputTokens === undefined
      ? {}
      : { outputTokens: normalizeUsageDelta("outputTokens", delta.outputTokens) }),
    ...(delta.durationMs === undefined
      ? {}
      : { durationMs: normalizeUsageDelta("durationMs", delta.durationMs) }),
    ...(delta.costUsd === undefined
      ? {}
      : { costUsd: normalizeUsageDelta("costUsd", delta.costUsd) }),
  });
}

function describeInvalidToolResult(value: unknown): string {
  try {
    return stableStringify(value);
  } catch {
    return JSON.stringify({ fallback: String(value) });
  }
}

function normalizePolicyDecision(value: unknown): ToolPolicyDecision {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("policy decision must be a plain object");
  }
  const decision = value as Partial<ToolPolicyDecision>;
  if (typeof decision.allowed !== "boolean") {
    throw new Error("policy.allowed must be boolean");
  }
  return Object.freeze({
    allowed: decision.allowed,
    reason: normalizeString("policy.reason", decision.reason),
    metadata: normalizeStringRecord("policy.metadata", decision.metadata ?? {}),
  });
}

import type {
  EvaluationResult,
  ExecutionBudget,
  ExecutionUsage,
  WorkflowContext,
} from "@atlantis/contracts";
import { assertWithinBudget } from "@atlantis/contracts";

import {
  ToolRouter,
  type HarnessClock,
  type HarnessIdSource,
} from "./tool-router.js";
import {
  normalizeEvidenceInput,
  normalizeHarnessPlan,
  normalizeJsonValue,
  normalizeString,
  normalizeStringRecord,
  stableStringify,
  validateWorkDelta,
  type HarnessApprovalDecisionRecord,
  type HarnessEvidenceInput,
  type HarnessEvaluationRecord,
  type HarnessPlan,
  type HarnessPlanRecord,
  type HarnessPolicyDecisionRecord,
  type HarnessStateChangeRecord,
  type HarnessTerminalState,
  type JsonValue,
  type WorkDelta,
  type ToolFailure,
} from "./work-delta.js";

export interface HarnessInspectResult {
  readonly startState: JsonValue;
  readonly evidence?: readonly HarnessEvidenceInput[];
  readonly unresolvedItems?: readonly string[];
}

export interface HarnessObservation {
  readonly summary: JsonValue;
  readonly evidence?: readonly HarnessEvidenceInput[];
  readonly unresolvedItems?: readonly string[];
}

export interface HarnessEvaluation extends EvaluationResult {
  readonly summary?: JsonValue;
  readonly unresolvedItems?: readonly string[];
}

export type ProposedHarnessPlan = Omit<HarnessPlan, "planId" | "action"> & {
  readonly actionId?: string;
  readonly toolName: string;
  readonly input: JsonValue;
};

export type HarnessRefinement =
  | Readonly<{
      status: "continue";
      nextState: JsonValue;
      progressToken?: string;
      stateChangeSummary?: JsonValue;
      unresolvedItems?: readonly string[];
    }>
  | Readonly<{
      status: "complete";
      finalState: JsonValue;
      output: JsonValue;
      progressToken?: string;
      stateChangeSummary?: JsonValue;
      unresolvedItems?: readonly string[];
    }>;

export interface HarnessRunRequest {
  readonly input: JsonValue;
  readonly budget: ExecutionBudget;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly executionId?: string;
  readonly correlationId?: string;
  readonly maxConsecutiveNonProgress?: number;
  inspect(input: JsonValue, context: HarnessExecutionContext): HarnessInspectResult | Promise<HarnessInspectResult>;
  plan(args: {
    readonly input: JsonValue;
    readonly state: JsonValue;
    readonly iteration: number;
    readonly context: HarnessExecutionContext;
  }): ProposedHarnessPlan | Promise<ProposedHarnessPlan>;
  observe(args: {
    readonly input: JsonValue;
    readonly state: JsonValue;
    readonly plan: HarnessPlan;
    readonly toolOutput: JsonValue;
    readonly iteration: number;
    readonly context: HarnessExecutionContext;
  }): HarnessObservation | Promise<HarnessObservation>;
  evaluate(args: {
    readonly input: JsonValue;
    readonly state: JsonValue;
    readonly plan: HarnessPlan;
    readonly observation: HarnessObservation;
    readonly toolOutput: JsonValue;
    readonly iteration: number;
    readonly context: HarnessExecutionContext;
  }): HarnessEvaluation | Promise<HarnessEvaluation>;
  refine(args: {
    readonly input: JsonValue;
    readonly state: JsonValue;
    readonly plan: HarnessPlan;
    readonly observation: HarnessObservation;
    readonly evaluation: HarnessEvaluation;
    readonly toolOutput: JsonValue;
    readonly iteration: number;
    readonly context: HarnessExecutionContext;
  }): HarnessRefinement | Promise<HarnessRefinement>;
}

export interface HarnessExecutionContext {
  readonly executionId: string;
  readonly correlationId: string;
  readonly startedAt: string;
  readonly budget: ExecutionBudget;
  readonly usage: ExecutionUsage;
  readonly metadata: Readonly<Record<string, string>>;
  reportUsage(report: HarnessUsageReport): void;
}

export interface HarnessRunResult {
  readonly terminalState: HarnessTerminalState;
  readonly workDelta: WorkDelta;
  readonly output?: JsonValue;
}

export interface HarnessUsageReport {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

export interface HarnessRuntimeOptions {
  readonly toolRouter: ToolRouter;
  readonly clock?: HarnessClock;
  readonly ids?: HarnessIdSource;
}

const defaultClock: HarnessClock = {
  nowIso: () => new Date().toISOString(),
  nowMs: () => Date.now(),
  sleep: async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
};

const defaultIds: HarnessIdSource = {
  nextId: (prefix) => `${prefix}-${crypto.randomUUID()}`,
};

export class HarnessRuntime {
  readonly #clock: HarnessClock;
  readonly #ids: HarnessIdSource;

  public constructor(private readonly options: HarnessRuntimeOptions) {
    this.#clock = options.clock ?? defaultClock;
    this.#ids = options.ids ?? defaultIds;
  }

  public async run(request: HarnessRunRequest): Promise<HarnessRunResult> {
    const input = normalizeJsonValue("request.input", request.input);
    const requestMetadata = normalizeStringRecord("request.metadata", request.metadata ?? {});
    const startedAt = this.#clock.nowIso();
    const startedAtMs = this.#clock.nowMs();
    const usage = createUsage();
    const executionId = request.executionId ?? this.#ids.nextId("execution");
    const correlationId = request.correlationId ?? executionId;
    const executionContext = (): HarnessExecutionContext =>
      Object.freeze({
        executionId,
        correlationId,
        startedAt,
        budget: request.budget,
        usage: snapshotUsage(usage),
        metadata: requestMetadata,
        reportUsage: (report: HarnessUsageReport) => applyLifecycleUsage(usage, report),
      });

    const selectedPlans: HarnessPlanRecord[] = [];
    const evidenceReads = [] as ReturnType<typeof normalizeEvidenceInput>[];
    const attemptedActions = [] as Awaited<ReturnType<ToolRouter["invoke"]>>["actionRecord"][];
    const policyDecisions: HarnessPolicyDecisionRecord[] = [];
    const approvalDecisions: HarnessApprovalDecisionRecord[] = [];
    const evaluations: HarnessEvaluationRecord[] = [];
    const stateChanges: HarnessStateChangeRecord[] = [];
    const unresolvedItems = new Set<string>();

    let inspect: HarnessInspectResult;
    try {
      inspect = await request.inspect(input, executionContext());
    } catch (error) {
      return this.#lifecycleFailure({
        phase: "inspect",
        iteration: 1,
        failure: normalizeLifecycleFailure("inspect", error),
        input,
        startState: null,
        finalState: null,
        startedAt,
        startedAtMs,
        executionId,
        correlationId,
        usage,
        selectedPlans,
        evidenceReads,
        attemptedActions,
        policyDecisions,
        approvalDecisions,
        evaluations,
        stateChanges,
        unresolvedItems,
      });
    }
    const startState = normalizeJsonValue("inspect.startState", inspect.startState);
    let currentState = startState;
    inspect.evidence?.forEach((entry) => {
      evidenceReads.push(normalizeEvidenceInput(1, "inspect", startedAt, entry));
    });
    inspect.unresolvedItems?.forEach((item) =>
      unresolvedItems.add(normalizeString("inspect.unresolvedItems", item)),
    );
    this.#synchronizeDuration(usage, startedAtMs);
    if (!this.#isWithinBudget(request.budget, usage)) {
      return this.#finish({
        input,
        startState,
        startedAt,
        executionId,
        correlationId,
        usage,
        terminalState: "budget_exhausted",
        finalState: currentState,
        selectedPlans,
        evidenceReads,
        attemptedActions,
        policyDecisions,
        approvalDecisions,
        evaluations,
        stateChanges,
        unresolvedItems,
      });
    }

    let lastProgressToken: string | undefined;
    let repeatedProgressCount = 0;
    const maxConsecutiveNonProgress = request.maxConsecutiveNonProgress ?? 2;

    for (let iteration = 1; ; iteration += 1) {
      this.#synchronizeDuration(usage, startedAtMs);
      if (iteration > request.budget.maxIterations) {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: "budget_exhausted",
          finalState: currentState,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }
      if (!this.#isWithinBudget(request.budget, usage)) {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: "budget_exhausted",
          finalState: currentState,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }

      let proposedPlan: ProposedHarnessPlan;
      try {
        proposedPlan = await request.plan({
          input,
          state: currentState,
          iteration,
          context: executionContext(),
        });
      } catch (error) {
        return this.#lifecycleFailure({
          phase: "plan",
          iteration,
          failure: normalizeLifecycleFailure("plan", error),
          input,
          startState,
          finalState: currentState,
          startedAt,
          startedAtMs,
          executionId,
          correlationId,
          usage,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }
      const selectedAt = this.#clock.nowIso();
      const plan = normalizeHarnessPlan({
        planId: this.#ids.nextId("plan"),
        summary: proposedPlan.summary,
        rationale: proposedPlan.rationale,
        desiredOutcome: proposedPlan.desiredOutcome,
        action: {
          actionId: proposedPlan.actionId ?? this.#ids.nextId("action"),
          toolName: proposedPlan.toolName,
          input: proposedPlan.input,
        },
        metadata: proposedPlan.metadata,
      });
      selectedPlans.push(
        Object.freeze({ iteration, selectedAt, plan }),
      );
      this.#synchronizeDuration(usage, startedAtMs);
      if (!this.#isWithinBudget(request.budget, usage)) {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: "budget_exhausted",
          finalState: currentState,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }

      const actionResult = await this.options.toolRouter.invoke({
        iteration,
        action: plan.action,
        executionId,
        executionStartedAtMs: startedAtMs,
        correlationId,
        executionMetadata: requestMetadata,
        budget: request.budget,
        usage,
        clock: this.#clock,
        ids: this.#ids,
      });
      attemptedActions.push(actionResult.actionRecord);
      policyDecisions.push(...actionResult.policyDecisions);
      if (actionResult.approvalDecision !== undefined) {
        approvalDecisions.push(actionResult.approvalDecision);
      }
      evidenceReads.push(...actionResult.evidenceReads);

      if (actionResult.status !== "succeeded") {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: actionResult.status,
          finalState: currentState,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }
      this.#synchronizeDuration(usage, startedAtMs);
      if (!this.#isWithinBudget(request.budget, usage)) {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: "budget_exhausted",
          finalState: currentState,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }

      const toolOutput = actionResult.actionRecord.output ?? normalizeJsonValue("toolOutput", null);
      let observation: HarnessObservation;
      try {
        observation = await request.observe({
          input,
          state: currentState,
          plan,
          toolOutput,
          iteration,
          context: executionContext(),
        });
      } catch (error) {
        return this.#lifecycleFailure({
          phase: "observe",
          iteration,
          failure: normalizeLifecycleFailure("observe", error),
          input,
          startState,
          finalState: currentState,
          startedAt,
          startedAtMs,
          executionId,
          correlationId,
          usage,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }
      const normalizedObservation: HarnessObservation = Object.freeze({
        summary: normalizeJsonValue("observation.summary", observation.summary),
        ...(observation.evidence === undefined
          ? {}
          : { evidence: Object.freeze(observation.evidence.map((entry) => ({ ...entry }))) }),
        ...(observation.unresolvedItems === undefined
          ? {}
          : {
              unresolvedItems: Object.freeze(
                observation.unresolvedItems.map((item) =>
                  normalizeString("observation.unresolvedItem", item),
                ),
              ),
            }),
      });
      normalizedObservation.evidence?.forEach((entry) => {
        evidenceReads.push(
          normalizeEvidenceInput(iteration, "observe", this.#clock.nowIso(), entry),
        );
      });
      normalizedObservation.unresolvedItems?.forEach((item) => unresolvedItems.add(item));
      this.#synchronizeDuration(usage, startedAtMs);
      if (!this.#isWithinBudget(request.budget, usage)) {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: "budget_exhausted",
          finalState: currentState,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }

      let evaluation: HarnessEvaluation;
      try {
        evaluation = await request.evaluate({
          input,
          state: currentState,
          plan,
          observation: normalizedObservation,
          toolOutput,
          iteration,
          context: executionContext(),
        });
      } catch (error) {
        return this.#lifecycleFailure({
          phase: "evaluate",
          iteration,
          failure: normalizeLifecycleFailure("evaluate", error),
          input,
          startState,
          finalState: currentState,
          startedAt,
          startedAtMs,
          executionId,
          correlationId,
          usage,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }
      const normalizedEvaluation = normalizeEvaluation(evaluation, this.#clock.nowIso(), iteration);
      evaluations.push(normalizedEvaluation);
      evaluation.unresolvedItems?.forEach((item) =>
        unresolvedItems.add(normalizeString("evaluation.unresolvedItems", item)),
      );
      this.#synchronizeDuration(usage, startedAtMs);
      if (!this.#isWithinBudget(request.budget, usage)) {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: "budget_exhausted",
          finalState: currentState,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }

      let refinement: HarnessRefinement;
      try {
        refinement = await request.refine({
          input,
          state: currentState,
          plan,
          observation: normalizedObservation,
          evaluation,
          toolOutput,
          iteration,
          context: executionContext(),
        });
      } catch (error) {
        return this.#lifecycleFailure({
          phase: "refine",
          iteration,
          failure: normalizeLifecycleFailure("refine", error),
          input,
          startState,
          finalState: currentState,
          startedAt,
          startedAtMs,
          executionId,
          correlationId,
          usage,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }

      const nextState =
        refinement.status === "complete"
          ? normalizeJsonValue("refinement.finalState", refinement.finalState)
          : normalizeJsonValue("refinement.nextState", refinement.nextState);
      stateChanges.push(
        Object.freeze({
          iteration,
          recordedAt: this.#clock.nowIso(),
          before: currentState,
          after: nextState,
          ...(refinement.stateChangeSummary === undefined
            ? {}
            : {
                summary: normalizeJsonValue(
                  "refinement.stateChangeSummary",
                  refinement.stateChangeSummary,
                ),
              }),
        }),
      );
      currentState = nextState;
      usage.iterations += 1;
      this.#synchronizeDuration(usage, startedAtMs);
      if (!this.#isWithinBudget(request.budget, usage)) {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: "budget_exhausted",
          finalState: currentState,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }
      refinement.unresolvedItems?.forEach((item) =>
        unresolvedItems.add(normalizeString("refinement.unresolvedItems", item)),
      );

      const progressToken =
        refinement.progressToken ??
        stableStringify({
          plan: {
            summary: plan.summary,
            rationale: plan.rationale,
            desiredOutcome: plan.desiredOutcome,
            toolName: plan.action.toolName,
            input: plan.action.input,
            metadata: plan.metadata,
          },
          state: currentState,
          evaluation: {
            passed: normalizedEvaluation.passed,
            score: normalizedEvaluation.score,
            summary: normalizedEvaluation.summary ?? null,
          },
        });
      if (progressToken === lastProgressToken) {
        repeatedProgressCount += 1;
      } else {
        lastProgressToken = progressToken;
        repeatedProgressCount = 1;
      }

      if (refinement.status === "complete") {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: normalizedEvaluation.passed ? "succeeded" : "evaluation_failed",
          finalState: currentState,
          ...(normalizedEvaluation.passed
            ? { output: normalizeJsonValue("refinement.output", refinement.output) }
            : {}),
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }

      if (repeatedProgressCount >= maxConsecutiveNonProgress) {
        return this.#finish({
          input,
          startState,
          startedAt,
          executionId,
          correlationId,
          usage,
          terminalState: "no_progress",
          finalState: currentState,
          selectedPlans,
          evidenceReads,
          attemptedActions,
          policyDecisions,
          approvalDecisions,
          evaluations,
          stateChanges,
          unresolvedItems,
        });
      }
    }
  }

  #finish(args: {
    readonly input: JsonValue;
    readonly startState: JsonValue;
    readonly startedAt: string;
    readonly executionId: string;
    readonly correlationId: string;
    readonly usage: ExecutionUsage;
    readonly terminalState: HarnessTerminalState;
    readonly finalState: JsonValue;
    readonly output?: JsonValue;
    readonly failure?: ToolFailure;
    readonly selectedPlans: readonly HarnessPlanRecord[];
    readonly evidenceReads: readonly ReturnType<typeof normalizeEvidenceInput>[];
    readonly attemptedActions: readonly Awaited<ReturnType<ToolRouter["invoke"]>>["actionRecord"][];
    readonly policyDecisions: readonly HarnessPolicyDecisionRecord[];
    readonly approvalDecisions: readonly HarnessApprovalDecisionRecord[];
    readonly evaluations: readonly HarnessEvaluationRecord[];
    readonly stateChanges: readonly HarnessStateChangeRecord[];
    readonly unresolvedItems: ReadonlySet<string>;
  }): HarnessRunResult {
    const delta = validateWorkDelta({
      schemaVersion: 1,
      executionId: args.executionId,
      correlationId: args.correlationId,
      startedAt: args.startedAt,
      completedAt: this.#clock.nowIso(),
      input: args.input,
      startState: args.startState,
      selectedPlans: args.selectedPlans,
      evidenceReads: args.evidenceReads,
      attemptedActions: args.attemptedActions,
      policyDecisions: args.policyDecisions,
      approvalDecisions: args.approvalDecisions,
      evaluations: args.evaluations,
      stateChanges: args.stateChanges,
      usage: snapshotUsage(args.usage),
      terminalState: args.terminalState,
      finalState: args.finalState,
      ...(args.output === undefined ? {} : { output: args.output }),
      ...(args.failure === undefined ? {} : { failure: args.failure }),
      unresolvedItems: [...args.unresolvedItems],
    });
    return Object.freeze({
      terminalState: args.terminalState,
      workDelta: delta,
      ...(args.output === undefined ? {} : { output: args.output }),
    });
  }

  #lifecycleFailure(args: {
    readonly phase: "inspect" | "plan" | "observe" | "evaluate" | "refine";
    readonly iteration: number;
    readonly failure: ToolFailure;
    readonly input: JsonValue;
    readonly startState: JsonValue;
    readonly finalState: JsonValue;
    readonly startedAt: string;
    readonly startedAtMs: number;
    readonly executionId: string;
    readonly correlationId: string;
    readonly usage: ExecutionUsage;
    readonly selectedPlans: readonly HarnessPlanRecord[];
    readonly evidenceReads: ReturnType<typeof normalizeEvidenceInput>[];
    readonly attemptedActions: readonly Awaited<ReturnType<ToolRouter["invoke"]>>["actionRecord"][];
    readonly policyDecisions: readonly HarnessPolicyDecisionRecord[];
    readonly approvalDecisions: readonly HarnessApprovalDecisionRecord[];
    readonly evaluations: readonly HarnessEvaluationRecord[];
    readonly stateChanges: readonly HarnessStateChangeRecord[];
    readonly unresolvedItems: ReadonlySet<string>;
  }): HarnessRunResult {
    this.#synchronizeDuration(args.usage, args.startedAtMs);
    args.evidenceReads.push(
      normalizeEvidenceInput(args.iteration, args.phase, this.#clock.nowIso(), {
        source: `harness-runtime:${args.phase}`,
        detail: `${args.phase} callback failed`,
        value: {
          code: args.failure.code,
          message: args.failure.message,
        },
      }),
    );
    return this.#finish({
      input: args.input,
      startState: args.startState,
      startedAt: args.startedAt,
      executionId: args.executionId,
      correlationId: args.correlationId,
      usage: args.usage,
      terminalState: "lifecycle_failed",
      finalState: args.finalState,
      failure: args.failure,
      selectedPlans: args.selectedPlans,
      evidenceReads: args.evidenceReads,
      attemptedActions: args.attemptedActions,
      policyDecisions: args.policyDecisions,
      approvalDecisions: args.approvalDecisions,
      evaluations: args.evaluations,
      stateChanges: args.stateChanges,
      unresolvedItems: args.unresolvedItems,
    });
  }

  #assertBudget(budget: ExecutionBudget, usage: ExecutionUsage): void {
    const budgetContext: WorkflowContext = {
      executionId: "harness-runtime",
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

  #synchronizeDuration(usage: ExecutionUsage, startedAtMs: number): void {
    usage.durationMs = Math.max(usage.durationMs, this.#clock.nowMs() - startedAtMs);
  }
}

function createUsage(): ExecutionUsage {
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

function snapshotUsage(usage: ExecutionUsage): ExecutionUsage {
  return Object.freeze({ ...usage }) as ExecutionUsage;
}

function normalizeEvaluation(
  evaluation: HarnessEvaluation,
  recordedAt: string,
  iteration: number,
): HarnessEvaluationRecord {
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(evaluation.metrics)) {
    metrics[normalizeString("evaluation.metricKey", key)] = normalizeNonNegativeNumber(
      `evaluation.metrics.${key}`,
      value,
    );
  }
  return Object.freeze({
    iteration,
    recordedAt,
    score: normalizeNonNegativeNumber("evaluation.score", evaluation.score),
    passed: evaluation.passed,
    reasons: Object.freeze(
      evaluation.reasons.map((reason) => normalizeString("evaluation.reason", reason)),
    ),
    metrics: Object.freeze(metrics),
    ...(evaluation.summary === undefined
      ? {}
      : { summary: normalizeJsonValue("evaluation.summary", evaluation.summary) }),
  });
}

function normalizeNonNegativeNumber(field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite non-negative number`);
  }
  return value;
}

function applyLifecycleUsage(usage: ExecutionUsage, report: HarnessUsageReport): void {
  if (report.inputTokens !== undefined) {
    usage.inputTokens += normalizeNonNegativeNumber("usage.inputTokens", report.inputTokens);
  }
  if (report.outputTokens !== undefined) {
    usage.outputTokens += normalizeNonNegativeNumber("usage.outputTokens", report.outputTokens);
  }
  if (report.costUsd !== undefined) {
    usage.costUsd += normalizeNonNegativeNumber("usage.costUsd", report.costUsd);
  }
}

function normalizeLifecycleFailure(
  phase: "inspect" | "plan" | "observe" | "evaluate" | "refine",
  error: unknown,
): ToolFailure {
  return Object.freeze({
    kind: "deterministic",
    code: `${phase}_failed`,
    message: error instanceof Error ? error.message : String(error),
    details: {
      phase,
      error: describeLifecycleError(error),
    },
  });
}

function describeLifecycleError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

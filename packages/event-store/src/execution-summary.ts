import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import { InvalidEventError } from "./index.js";
import { projectExecutionTopology, type ExecutionTopology } from "./execution-topology.js";

export interface ExecutionBudgetSummary {
  readonly limit: number;
  readonly observed: number;
  readonly remaining: number;
  readonly exceeded: boolean;
}

export interface ExecutionSummary {
  readonly executionId: string;
  readonly eventCount: number;
  readonly startedAt: string;
  readonly lastObservedAt: string;
  readonly elapsedMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly toolCalls: number;
  readonly retries: number;
  readonly iterations: number;
  readonly topology: ExecutionTopology;
  readonly budget: Readonly<{
    toolCalls: ExecutionBudgetSummary;
    retries: ExecutionBudgetSummary;
    iterations: ExecutionBudgetSummary;
    tokens: ExecutionBudgetSummary;
    durationMs: ExecutionBudgetSummary;
    costUsd: ExecutionBudgetSummary;
  }>;
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidEventError(`execution summary requires finite non-negative ${name}.`);
  }
}

function budgetDimension(limit: number, observed: number): ExecutionBudgetSummary {
  return Object.freeze({
    limit,
    observed,
    remaining: Math.max(0, limit - observed),
    exceeded: observed > limit,
  });
}

/**
 * Produces provider-neutral Day-7 execution evidence from canonical restored
 * events plus the governed workflow budget/usage snapshot. Usage is supplied
 * explicitly rather than inferred from arbitrary event payloads.
 */
export function projectExecutionSummary(
  events: readonly ExecutionEvent[],
  budget: ExecutionBudget,
  usage: ExecutionUsage,
): ExecutionSummary {
  const topology = projectExecutionTopology(events);
  const startedAtMs = Date.parse(events[0]!.occurredAt);
  const lastObservedAtMs = Date.parse(events[events.length - 1]!.occurredAt);

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(lastObservedAtMs)) {
    throw new InvalidEventError("execution summary requires valid event timestamps.");
  }
  if (lastObservedAtMs < startedAtMs) {
    throw new InvalidEventError("execution summary timestamps must not move backwards.");
  }

  const values: ReadonlyArray<readonly [string, number]> = [
    ["maxToolCalls", budget.maxToolCalls],
    ["maxRetries", budget.maxRetries],
    ["maxIterations", budget.maxIterations],
    ["maxTokens", budget.maxTokens],
    ["maxDurationMs", budget.maxDurationMs],
    ["maxCostUsd", budget.maxCostUsd],
    ["toolCalls", usage.toolCalls],
    ["retries", usage.retries],
    ["iterations", usage.iterations],
    ["inputTokens", usage.inputTokens],
    ["outputTokens", usage.outputTokens],
    ["durationMs", usage.durationMs],
    ["costUsd", usage.costUsd],
  ];
  for (const [name, value] of values) assertFiniteNonNegative(name, value);

  const totalTokens = usage.inputTokens + usage.outputTokens;
  const elapsedMs = lastObservedAtMs - startedAtMs;

  return Object.freeze({
    executionId: topology.executionId,
    eventCount: events.length,
    startedAt: events[0]!.occurredAt,
    lastObservedAt: events[events.length - 1]!.occurredAt,
    elapsedMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens,
    costUsd: usage.costUsd,
    toolCalls: usage.toolCalls,
    retries: usage.retries,
    iterations: usage.iterations,
    topology,
    budget: Object.freeze({
      toolCalls: budgetDimension(budget.maxToolCalls, usage.toolCalls),
      retries: budgetDimension(budget.maxRetries, usage.retries),
      iterations: budgetDimension(budget.maxIterations, usage.iterations),
      tokens: budgetDimension(budget.maxTokens, totalTokens),
      durationMs: budgetDimension(budget.maxDurationMs, usage.durationMs),
      costUsd: budgetDimension(budget.maxCostUsd, usage.costUsd),
    }),
  });
}

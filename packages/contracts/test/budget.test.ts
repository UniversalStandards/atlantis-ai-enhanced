import { describe, expect, it } from "vitest";
import {
  assertWithinBudget,
  BudgetExceededError,
  InvalidBudgetValueError,
  type WorkflowContext,
} from "../src/index.js";

function context(
  usageOverrides: Partial<WorkflowContext["usage"]> = {},
  budgetOverrides: Partial<WorkflowContext["budget"]> = {},
): WorkflowContext {
  return {
    executionId: "exec-1",
    workflowId: "test-workflow",
    workflowVersion: "1.0.0",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries: 2,
      maxIterations: 5,
      maxTokens: 10_000,
      maxDurationMs: 60_000,
      maxCostUsd: 1,
      ...budgetOverrides,
    },
    usage: {
      toolCalls: 0,
      retries: 0,
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      costUsd: 0,
      ...usageOverrides,
    },
    metadata: {},
  };
}

describe("assertWithinBudget", () => {
  it("accepts usage exactly at every configured limit", () => {
    expect(() =>
      assertWithinBudget(
        context({
          toolCalls: 10,
          retries: 2,
          iterations: 5,
          inputTokens: 5_000,
          outputTokens: 5_000,
          durationMs: 60_000,
          costUsd: 1,
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ["maxToolCalls", { toolCalls: 11 }],
    ["maxRetries", { retries: 3 }],
    ["maxIterations", { iterations: 6 }],
    ["maxTokens", { inputTokens: 5_000, outputTokens: 5_001 }],
    ["maxDurationMs", { durationMs: 60_001 }],
    ["maxCostUsd", { costUsd: 1.01 }],
  ] as const)("fails closed when %s is exceeded", (dimension, usage) => {
    expect(() => assertWithinBudget(context(usage))).toThrow(
      BudgetExceededError,
    );
    expect(() => assertWithinBudget(context(usage))).toThrow(dimension);
  });

  it.each([
    ["toolCalls", { toolCalls: -1 }],
    ["retries", { retries: Number.NaN }],
    ["iterations", { iterations: Number.POSITIVE_INFINITY }],
    ["inputTokens", { inputTokens: Number.NEGATIVE_INFINITY }],
    ["outputTokens", { outputTokens: -1 }],
    ["durationMs", { durationMs: Number.NaN }],
    ["costUsd", { costUsd: Number.POSITIVE_INFINITY }],
  ] as const)("rejects invalid usage field %s", (field, usage) => {
    expect(() => assertWithinBudget(context(usage))).toThrow(
      InvalidBudgetValueError,
    );
    expect(() => assertWithinBudget(context(usage))).toThrow(field);
  });

  it.each([
    ["maxToolCalls", { maxToolCalls: -1 }],
    ["maxRetries", { maxRetries: Number.NaN }],
    ["maxIterations", { maxIterations: Number.POSITIVE_INFINITY }],
    ["maxTokens", { maxTokens: Number.NEGATIVE_INFINITY }],
    ["maxDurationMs", { maxDurationMs: -1 }],
    ["maxCostUsd", { maxCostUsd: Number.NaN }],
  ] as const)("rejects invalid budget field %s", (field, budget) => {
    expect(() => assertWithinBudget(context({}, budget))).toThrow(
      InvalidBudgetValueError,
    );
    expect(() => assertWithinBudget(context({}, budget))).toThrow(field);
  });
});

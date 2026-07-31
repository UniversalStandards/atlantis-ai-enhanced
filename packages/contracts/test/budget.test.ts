import { describe, expect, it } from "vitest";
import {
  assertWithinBudget,
  BudgetExceededError,
  type WorkflowContext,
} from "../src/index.js";

function context(overrides: Partial<WorkflowContext["usage"]> = {}): WorkflowContext {
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
    },
    usage: {
      toolCalls: 0,
      retries: 0,
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      costUsd: 0,
      ...overrides,
    },
    metadata: {},
  };
}

describe("assertWithinBudget", () => {
  it("accepts usage at or below every configured limit", () => {
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

  it("fails closed when a limit is exceeded", () => {
    expect(() => assertWithinBudget(context({ toolCalls: 11 }))).toThrow(
      BudgetExceededError,
    );
  });

  it("combines input and output tokens for token enforcement", () => {
    expect(() =>
      assertWithinBudget(context({ inputTokens: 8_000, outputTokens: 2_001 })),
    ).toThrow(/maxTokens/);
  });
});

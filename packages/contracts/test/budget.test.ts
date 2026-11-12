import { describe, expect, it } from "vitest";
import {
  assertValidBudget,
  assertWithinBudget,
  BudgetExceededError,
  createUsage,
  InvalidBudgetStateError,
  type WorkflowContext,
} from "../src/index.js";

function context(
  overrides: Partial<WorkflowContext["usage"]> = {},
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

  it("reports the dimension, limit, and observed value", () => {
    try {
      assertWithinBudget(context({ costUsd: 1.5 }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      expect(error).toMatchObject({
        dimension: "maxCostUsd",
        limit: 1,
        observed: 1.5,
      });
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "fails closed when a usage counter is %s",
    (value) => {
      expect(() => assertWithinBudget(context({ toolCalls: value }))).toThrow(
        InvalidBudgetStateError,
      );
    },
  );

  it("fails closed when a limit is not a finite number", () => {
    const base = context();
    expect(() =>
      assertWithinBudget({
        ...base,
        budget: { ...base.budget, maxTokens: Number.NaN },
      }),
    ).toThrow(/budget\.maxTokens/);
    expect(() =>
      assertValidBudget({ ...base.budget, maxCostUsd: -0.01 }),
    ).toThrow(InvalidBudgetStateError);
  });
});

describe("createUsage", () => {
  it("returns an independent zeroed record on every call", () => {
    const first = createUsage();
    first.toolCalls = 3;
    expect(createUsage().toolCalls).toBe(0);
    expect(Object.values(createUsage()).every((n) => n === 0)).toBe(true);
  });
});

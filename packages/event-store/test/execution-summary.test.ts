import { describe, expect, it } from "vitest";

import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import { InvalidEventError } from "../src/index.js";
import { projectExecutionSummary } from "../src/execution-summary.js";

const budget: ExecutionBudget = Object.freeze({
  maxToolCalls: 4,
  maxRetries: 2,
  maxIterations: 3,
  maxTokens: 1_000,
  maxDurationMs: 10_000,
  maxCostUsd: 1,
});

const usage: ExecutionUsage = Object.freeze({
  toolCalls: 2,
  retries: 1,
  iterations: 2,
  inputTokens: 300,
  outputTokens: 200,
  durationMs: 4_000,
  costUsd: 0.25,
});

function events(): readonly ExecutionEvent[] {
  return Object.freeze([
    Object.freeze({
      id: "root",
      executionId: "execution-1",
      sequence: 1,
      type: "execution.started" as const,
      occurredAt: "2026-08-21T00:00:00.000Z",
      actor: "runner",
      payload: Object.freeze({}),
    }),
    Object.freeze({
      id: "child",
      executionId: "execution-1",
      sequence: 2,
      type: "execution.completed" as const,
      occurredAt: "2026-08-21T00:00:05.000Z",
      actor: "runner",
      parentEventId: "root",
      payload: Object.freeze({}),
    }),
  ]);
}

describe("projectExecutionSummary", () => {
  it("projects topology, elapsed time, usage totals, and budget headroom", () => {
    const summary = projectExecutionSummary(events(), budget, usage);

    expect(summary.executionId).toBe("execution-1");
    expect(summary.eventCount).toBe(2);
    expect(summary.elapsedMs).toBe(5_000);
    expect(summary.totalTokens).toBe(500);
    expect(summary.costUsd).toBe(0.25);
    expect(summary.topology.edges).toEqual([{ parentEventId: "root", childEventId: "child" }]);
    expect(summary.budget.tokens).toEqual({ limit: 1_000, observed: 500, remaining: 500, exceeded: false });
    expect(summary.budget.durationMs).toEqual({ limit: 10_000, observed: 4_000, remaining: 6_000, exceeded: false });
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.budget)).toBe(true);
  });

  it("reports exceeded dimensions without discarding evidence", () => {
    const summary = projectExecutionSummary(events(), budget, { ...usage, inputTokens: 900, outputTokens: 200 });
    expect(summary.budget.tokens).toEqual({ limit: 1_000, observed: 1_100, remaining: 0, exceeded: true });
  });

  it("fails closed on invalid governed usage", () => {
    expect(() => projectExecutionSummary(events(), budget, { ...usage, costUsd: Number.NaN })).toThrow(InvalidEventError);
  });

  it("fails closed when finite token components overflow their aggregate", () => {
    expect(() => projectExecutionSummary(events(), budget, {
      ...usage,
      inputTokens: Number.MAX_VALUE,
      outputTokens: Number.MAX_VALUE,
    })).toThrow(/finite non-negative totalTokens/);
  });

  it("fails closed when canonical event time moves backwards", () => {
    const reversed = events().map((event, index) => index === 1 ? { ...event, occurredAt: "2026-08-20T23:59:59.000Z" } : event);
    expect(() => projectExecutionSummary(reversed, budget, usage)).toThrow(/must not move backwards/);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import { projectExecutionReleaseEvidence } from "../src/execution-release-evidence.js";
import {
  exportExecutionReleaseTelemetry,
  projectExecutionReleaseTelemetry,
} from "../src/execution-release-telemetry.js";

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

const events: readonly ExecutionEvent[] = Object.freeze([
  Object.freeze({
    id: "root",
    executionId: "execution-telemetry-1",
    sequence: 1,
    type: "execution.started" as const,
    occurredAt: "2026-08-21T00:00:00.000Z",
    actor: "runner",
    payload: Object.freeze({}),
  }),
  Object.freeze({
    id: "child",
    executionId: "execution-telemetry-1",
    sequence: 2,
    type: "execution.completed" as const,
    occurredAt: "2026-08-21T00:00:05.000Z",
    actor: "runner",
    parentEventId: "root",
    payload: Object.freeze({}),
  }),
]);

function evidence() {
  return projectExecutionReleaseEvidence({ events, budget, usage });
}

describe("execution release telemetry", () => {
  it("projects immutable non-authoritative telemetry from governed evidence", () => {
    const record = projectExecutionReleaseTelemetry(evidence());

    expect(record).toEqual({
      executionId: "execution-telemetry-1",
      eventCount: 2,
      elapsedMs: 5_000,
      inputTokens: 300,
      outputTokens: 200,
      totalTokens: 500,
      costUsd: 0.25,
      toolCalls: 2,
      retries: 1,
      iterations: 2,
      replayVerified: false,
      budgetExceeded: false,
    });
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("reports successful exporter settlement without changing evidence", async () => {
    const releaseEvidence = evidence();
    const exportRecord = vi.fn();

    const result = await exportExecutionReleaseTelemetry(releaseEvidence, {
      export: exportRecord,
    });

    expect(result.exported).toBe(true);
    expect(exportRecord).toHaveBeenCalledOnce();
    expect(result.record.executionId).toBe(releaseEvidence.executionId);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("contains exporter failure without making telemetry authoritative", async () => {
    const releaseEvidence = evidence();
    const failure = new Error("collector unavailable");

    const result = await exportExecutionReleaseTelemetry(releaseEvidence, {
      export: () => {
        throw failure;
      },
    });

    expect(result.exported).toBe(false);
    expect(result.error).toBe(failure);
    expect(result.record.executionId).toBe(releaseEvidence.executionId);
    expect(releaseEvidence.summary.totalTokens).toBe(500);
  });

  it("surfaces governed budget exceedance as telemetry rather than recomputing policy", () => {
    const exceededUsage: ExecutionUsage = Object.freeze({ ...usage, costUsd: 2 });
    const releaseEvidence = projectExecutionReleaseEvidence({ events, budget, usage: exceededUsage });

    expect(projectExecutionReleaseTelemetry(releaseEvidence).budgetExceeded).toBe(true);
  });
});

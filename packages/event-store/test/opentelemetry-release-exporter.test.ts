import { describe, expect, it, vi } from "vitest";

import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import { projectExecutionReleaseEvidence } from "../src/execution-release-evidence.js";
import { exportExecutionReleaseTelemetry } from "../src/execution-release-telemetry.js";
import {
  OpenTelemetryExecutionReleaseExporter,
  projectOpenTelemetryReleaseSpan,
} from "../src/opentelemetry-release-exporter.js";

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
    executionId: "execution-otel-1",
    sequence: 1,
    type: "execution.started" as const,
    occurredAt: "2026-08-21T00:00:00.000Z",
    actor: "runner",
    payload: Object.freeze({}),
  }),
  Object.freeze({
    id: "child",
    executionId: "execution-otel-1",
    sequence: 2,
    type: "execution.completed" as const,
    occurredAt: "2026-08-21T00:00:05.000Z",
    actor: "runner",
    parentEventId: "root",
    payload: Object.freeze({}),
  }),
]);

describe("OpenTelemetry release exporter", () => {
  it("projects a stable immutable OpenTelemetry-shaped release span", () => {
    const evidence = projectExecutionReleaseEvidence({ events, budget, usage });
    const record = {
      executionId: evidence.executionId,
      eventCount: evidence.summary.eventCount,
      elapsedMs: evidence.summary.elapsedMs,
      inputTokens: evidence.summary.inputTokens,
      outputTokens: evidence.summary.outputTokens,
      totalTokens: evidence.summary.totalTokens,
      costUsd: evidence.summary.costUsd,
      toolCalls: evidence.summary.toolCalls,
      retries: evidence.summary.retries,
      iterations: evidence.summary.iterations,
      replayVerified: false,
      budgetExceeded: false,
    } as const;

    const span = projectOpenTelemetryReleaseSpan(record);

    expect(span.name).toBe("atlantis.execution.release");
    expect(span.attributes["atlantis.execution.id"]).toBe("execution-otel-1");
    expect(span.attributes["atlantis.execution.total_tokens"]).toBe(500);
    expect(span.attributes["atlantis.execution.cost_usd"]).toBe(0.25);
    expect(Object.isFrozen(span)).toBe(true);
    expect(Object.isFrozen(span.attributes)).toBe(true);
  });

  it("exports governed release telemetry through the adapter", async () => {
    const evidence = projectExecutionReleaseEvidence({ events, budget, usage });
    const emit = vi.fn();
    const exporter = new OpenTelemetryExecutionReleaseExporter({ emit });

    const result = await exportExecutionReleaseTelemetry(evidence, exporter);

    expect(result.exported).toBe(true);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0]?.[0].name).toBe("atlantis.execution.release");
  });

  it("keeps OpenTelemetry sink failure non-authoritative", async () => {
    const evidence = projectExecutionReleaseEvidence({ events, budget, usage });
    const failure = new Error("collector unavailable");
    const exporter = new OpenTelemetryExecutionReleaseExporter({
      emit: () => {
        throw failure;
      },
    });

    const result = await exportExecutionReleaseTelemetry(evidence, exporter);

    expect(result.exported).toBe(false);
    expect(result.error).toBe(failure);
    expect(result.record.executionId).toBe(evidence.executionId);
    expect(evidence.summary.totalTokens).toBe(500);
  });
});

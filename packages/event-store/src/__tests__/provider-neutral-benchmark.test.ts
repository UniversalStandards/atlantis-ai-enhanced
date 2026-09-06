import { describe, expect, it } from "vitest";
import type { EvaluationResult, WorkflowContext } from "@atlantis/contracts";
import {
  compareProviderBenchmarkRecords,
  InvalidBenchmarkEvidenceError,
  runBoundedBenchmark,
  type BenchmarkCase,
  type ProviderBenchmarkRecord,
} from "../provider-neutral-benchmark.js";

function context(maxIterations: number): WorkflowContext {
  return {
    executionId: "exec-benchmark-1",
    workflowId: "benchmark-workflow",
    workflowVersion: "1.0.0",
    userId: "benchmark-user",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries: 2,
      maxIterations,
      maxTokens: 10_000,
      maxDurationMs: 60_000,
      maxCostUsd: 10,
    },
    usage: {
      toolCalls: 0,
      retries: 0,
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      costUsd: 0,
    },
    metadata: {},
  };
}

function evaluation(score: number, passed = true): EvaluationResult {
  return {
    score,
    passed,
    reasons: passed ? [] : ["quality threshold not met"],
    metrics: { quality: score, safety: 1, grounding: 1, toolUse: 1 },
  };
}

describe("provider-neutral benchmark", () => {
  it("scores and refines a coding workflow within the configured iteration bound", async () => {
    const benchmarkCase: BenchmarkCase<string> = {
      id: "coding-fix-v1",
      version: "1",
      workflowKind: "coding",
      input: "repair deterministic parser",
      passThreshold: 0.8,
    };
    const scores = [0.6, 0.9];
    let index = 0;

    const result = await runBoundedBenchmark(
      benchmarkCase,
      context(2),
      { generate: async (input) => `${input}:draft` },
      { evaluate: async () => evaluation(scores[index++] ?? 0) },
      { refine: async (_input, prior) => `${prior}:refined` },
    );

    expect(result.workflowKind).toBe("coding");
    expect(result.passed).toBe(true);
    expect(result.exhausted).toBe(false);
    expect(result.attempts).toHaveLength(2);
    expect(result.final.scorecard.score).toBe(0.9);
  });

  it("produces deterministic scorecards for a conversational workflow", async () => {
    const result = await runBoundedBenchmark(
      {
        id: "conversation-grounded-v1",
        version: "1",
        workflowKind: "conversation",
        input: "summarize supplied evidence",
        passThreshold: 0.85,
      },
      context(1),
      { generate: async () => "grounded response" },
      { evaluate: async () => evaluation(0.91) },
    );

    expect(result.passed).toBe(true);
    expect(result.final.scorecard.metrics).toEqual({
      quality: 0.91,
      safety: 1,
      grounding: 1,
      toolUse: 1,
    });
  });

  it("fails closed when the score remains below threshold and the iteration budget is exhausted", async () => {
    const result = await runBoundedBenchmark(
      {
        id: "coding-exhaustion-v1",
        version: "1",
        workflowKind: "coding",
        input: "fix",
        passThreshold: 0.9,
      },
      context(2),
      { generate: async () => "draft" },
      { evaluate: async () => evaluation(0.5) },
      { refine: async (_input, prior) => `${prior}:retry` },
    );

    expect(result.passed).toBe(false);
    expect(result.exhausted).toBe(true);
    expect(result.attempts).toHaveLength(2);
  });

  it("does not execute generation after the shared iteration budget is already exhausted", async () => {
    const exhaustedContext = context(1);
    exhaustedContext.usage.iterations = 1;
    let generated = false;

    await expect(
      runBoundedBenchmark(
        {
          id: "budget-exhausted-v1",
          version: "1",
          workflowKind: "coding",
          input: "fix",
          passThreshold: 0.8,
        },
        exhaustedContext,
        {
          generate: async () => {
            generated = true;
            return "must-not-run";
          },
        },
        { evaluate: async () => evaluation(1) },
      ),
    ).rejects.toThrow("no benchmark iteration budget remains");

    expect(generated).toBe(false);
  });

  it("does not convert an evaluator failure into a passing threshold result", async () => {
    const result = await runBoundedBenchmark(
      {
        id: "conversation-evaluator-fail-v1",
        version: "1",
        workflowKind: "conversation",
        input: "answer",
        passThreshold: 0.8,
      },
      context(1),
      { generate: async () => "response" },
      { evaluate: async () => evaluation(0.95, false) },
    );

    expect(result.passed).toBe(false);
    expect(result.final.scorecard.passed).toBe(false);
  });

  it("keeps missing real-provider evidence explicitly gated and unable to satisfy acceptance", () => {
    const mock: ProviderBenchmarkRecord = {
      providerId: "deterministic-mock",
      providerKind: "mock",
      evidenceState: "executed",
      caseId: "coding-fix-v1",
      caseVersion: "1",
      workflowKind: "coding",
      scorecard: {
        score: 0.9,
        passed: true,
        threshold: 0.8,
        reasons: [],
        metrics: { quality: 0.9 },
      },
      measurement: { latencyMs: 1, inputTokens: 10, outputTokens: 20, costUsd: 0 },
    };
    const gatedReal: ProviderBenchmarkRecord = {
      providerId: "unselected-real-provider",
      providerKind: "real",
      evidenceState: "gated-not-executed",
      caseId: "coding-fix-v1",
      caseVersion: "1",
      workflowKind: "coding",
      gateReason: "provider/model/credential authority not selected",
    };

    expect(compareProviderBenchmarkRecords(mock, gatedReal)).toMatchObject({
      status: "real-provider-gated",
      acceptanceSatisfied: false,
    });
  });

  it("rejects fabricated measurements on gated real-provider evidence", () => {
    const mock: ProviderBenchmarkRecord = {
      providerId: "deterministic-mock",
      providerKind: "mock",
      evidenceState: "executed",
      caseId: "conversation-v1",
      caseVersion: "1",
      workflowKind: "conversation",
      scorecard: { score: 1, passed: true, threshold: 0.8, reasons: [], metrics: {} },
      measurement: { latencyMs: 1 },
    };
    const invalidReal = {
      providerId: "unselected-real-provider",
      providerKind: "real" as const,
      evidenceState: "gated-not-executed" as const,
      caseId: "conversation-v1",
      caseVersion: "1",
      workflowKind: "conversation" as const,
      gateReason: "not authorized",
      measurement: { latencyMs: 1 },
    };

    expect(() => compareProviderBenchmarkRecords(mock, invalidReal)).toThrow(
      InvalidBenchmarkEvidenceError,
    );
  });
});

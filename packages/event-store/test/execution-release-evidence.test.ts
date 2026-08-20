import { describe, expect, it } from "vitest";

import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import { projectExecutionReleaseEvidence } from "../src/execution-release-evidence.js";

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

function events(executionId: string): readonly ExecutionEvent[] {
  return Object.freeze([
    Object.freeze({
      id: "root",
      executionId,
      sequence: 1,
      type: "execution.started" as const,
      occurredAt: "2026-08-21T00:00:00.000Z",
      actor: "runner",
      payload: Object.freeze({}),
    }),
    Object.freeze({
      id: "child",
      executionId,
      sequence: 2,
      type: "execution.completed" as const,
      occurredAt: "2026-08-21T00:00:05.000Z",
      actor: "runner",
      parentEventId: "root",
      payload: Object.freeze({}),
    }),
  ]);
}

describe("execution release evidence", () => {
  it("composes governed summary and topology without requiring replay", () => {
    const evidence = projectExecutionReleaseEvidence({
      events: events("execution-release-1"),
      budget,
      usage,
    });

    expect(evidence.executionId).toBe("execution-release-1");
    expect(evidence.summary.totalTokens).toBe(500);
    expect(evidence.summary.topology.edges).toEqual([
      { parentEventId: "root", childEventId: "child" },
    ]);
    expect(evidence.replay).toBeUndefined();
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it("composes deterministic replay evidence when a matching fixture is supplied", () => {
    const executionEvents = events("execution-release-2");
    const evidence = projectExecutionReleaseEvidence({
      events: executionEvents,
      budget,
      usage,
      replayFixture: Object.freeze({
        fixtureId: "golden-release-2",
        events: executionEvents,
        budget,
        usage,
      }),
    });

    expect(evidence.replay?.fixtureId).toBe("golden-release-2");
    expect(evidence.replay?.executionId).toBe(evidence.executionId);
  });

  it("fails closed when replay evidence is bound to another execution", () => {
    expect(() => projectExecutionReleaseEvidence({
      events: events("execution-release-3"),
      budget,
      usage,
      replayFixture: Object.freeze({
        fixtureId: "substituted-release",
        events: events("execution-other"),
        budget,
        usage,
      }),
    })).toThrow(/same executionId/);
  });
});

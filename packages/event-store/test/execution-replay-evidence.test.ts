import { describe, expect, it } from "vitest";

import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import { InvalidEventError } from "../src/index.js";
import {
  assertDeterministicExecutionReplay,
  projectExecutionReplayEvidence,
} from "../src/execution-replay-evidence.js";

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
    executionId: "execution-replay-1",
    sequence: 1,
    type: "execution.started" as const,
    occurredAt: "2026-08-21T00:00:00.000Z",
    actor: "runner",
    payload: Object.freeze({}),
  }),
  Object.freeze({
    id: "child",
    executionId: "execution-replay-1",
    sequence: 2,
    type: "execution.completed" as const,
    occurredAt: "2026-08-21T00:00:05.000Z",
    actor: "runner",
    parentEventId: "root",
    payload: Object.freeze({}),
  }),
]);

function fixture(overrides: Partial<{ fixtureId: string; usage: ExecutionUsage }> = {}) {
  return Object.freeze({
    fixtureId: overrides.fixtureId ?? "golden-replay-1",
    events,
    budget,
    usage: overrides.usage ?? usage,
  });
}

describe("execution replay evidence", () => {
  it("produces byte-identical canonical evidence for repeated fixture projection", () => {
    const first = projectExecutionReplayEvidence(fixture());
    const second = projectExecutionReplayEvidence(fixture());

    expect(first.canonicalProjection).toBe(second.canonicalProjection);
    expect(first.summary.totalTokens).toBe(500);
    expect(first.summary.topology.edges).toEqual([{ parentEventId: "root", childEventId: "child" }]);
    expect(Object.isFrozen(first)).toBe(true);
    assertDeterministicExecutionReplay(first, second);
  });

  it("fails closed when governed replay evidence diverges", () => {
    const expected = projectExecutionReplayEvidence(fixture());
    const actual = projectExecutionReplayEvidence(fixture({ usage: { ...usage, costUsd: 0.5 } }));

    expect(() => assertDeterministicExecutionReplay(expected, actual)).toThrow(/projection diverged/);
  });

  it("fails closed when fixture identity changes", () => {
    const expected = projectExecutionReplayEvidence(fixture());
    const actual = projectExecutionReplayEvidence(fixture({ fixtureId: "other-fixture" }));

    expect(() => assertDeterministicExecutionReplay(expected, actual)).toThrow(/same fixtureId/);
  });

  it("reuses fail-closed topology validation for malformed fixture evidence", () => {
    const malformed = Object.freeze({
      fixtureId: "malformed",
      events: Object.freeze([{ ...events[0]!, sequence: 2 }]),
      budget,
      usage,
    });

    expect(() => projectExecutionReplayEvidence(malformed)).toThrow(InvalidEventError);
  });
});

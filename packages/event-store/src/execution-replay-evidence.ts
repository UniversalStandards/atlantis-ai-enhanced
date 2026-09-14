import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import { InvalidEventError } from "./index.js";
import { projectExecutionSummary, type ExecutionSummary } from "./execution-summary.js";

export interface ExecutionReplayFixture {
  readonly fixtureId: string;
  readonly events: readonly ExecutionEvent[];
  readonly budget: ExecutionBudget;
  readonly usage: ExecutionUsage;
}

export interface ExecutionReplayEvidence {
  readonly fixtureId: string;
  readonly executionId: string;
  readonly summary: ExecutionSummary;
  readonly canonicalProjection: string;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new InvalidEventError(`${field} must be non-empty.`);
  }
}

function canonicalProjection(summary: ExecutionSummary): string {
  return JSON.stringify({
    executionId: summary.executionId,
    eventCount: summary.eventCount,
    startedAt: summary.startedAt,
    lastObservedAt: summary.lastObservedAt,
    elapsedMs: summary.elapsedMs,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    totalTokens: summary.totalTokens,
    costUsd: summary.costUsd,
    toolCalls: summary.toolCalls,
    retries: summary.retries,
    iterations: summary.iterations,
    topology: summary.topology,
    budget: summary.budget,
  });
}

/**
 * Replays a deterministic Day-7 fixture through the same fail-closed topology
 * and governed execution-summary projection used for release evidence. The
 * canonical projection is provider-neutral and suitable for exact comparison
 * across repeated fixture runs.
 */
export function projectExecutionReplayEvidence(
  fixture: ExecutionReplayFixture,
): ExecutionReplayEvidence {
  assertNonEmpty(fixture.fixtureId, "fixtureId");
  const summary = projectExecutionSummary(fixture.events, fixture.budget, fixture.usage);

  return Object.freeze({
    fixtureId: fixture.fixtureId,
    executionId: summary.executionId,
    summary,
    canonicalProjection: canonicalProjection(summary),
  });
}

export function assertDeterministicExecutionReplay(
  expected: ExecutionReplayEvidence,
  actual: ExecutionReplayEvidence,
): void {
  if (expected.fixtureId !== actual.fixtureId) {
    throw new InvalidEventError("deterministic replay evidence must use the same fixtureId.");
  }
  if (expected.executionId !== actual.executionId) {
    throw new InvalidEventError("deterministic replay evidence must use the same executionId.");
  }
  if (expected.canonicalProjection !== actual.canonicalProjection) {
    throw new InvalidEventError("deterministic replay projection diverged from the expected evidence.");
  }
}

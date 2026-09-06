import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import {
  assertDeterministicExecutionReplay,
  projectExecutionReplayEvidence,
  type ExecutionReplayEvidence,
  type ExecutionReplayFixture,
} from "./execution-replay-evidence.js";
import { projectExecutionSummary, type ExecutionSummary } from "./execution-summary.js";

export interface ExecutionReleaseEvidenceInput {
  readonly events: readonly ExecutionEvent[];
  readonly budget: ExecutionBudget;
  readonly usage: ExecutionUsage;
  readonly replayFixture?: ExecutionReplayFixture;
}

export interface ExecutionReleaseEvidence {
  readonly executionId: string;
  readonly summary: ExecutionSummary;
  readonly replay?: ExecutionReplayEvidence;
}

/**
 * Composes the Day-7 release evidence through the already-governed summary,
 * topology, and deterministic replay projections. This boundary is deliberately
 * provider-neutral: persistence and telemetry exporters remain outside it.
 */
export function projectExecutionReleaseEvidence(
  input: ExecutionReleaseEvidenceInput,
): ExecutionReleaseEvidence {
  const summary = projectExecutionSummary(input.events, input.budget, input.usage);
  const replay = input.replayFixture === undefined
    ? undefined
    : projectExecutionReplayEvidence(input.replayFixture);

  if (replay !== undefined) {
    const expectedReplay = projectExecutionReplayEvidence(Object.freeze({
      fixtureId: replay.fixtureId,
      events: input.events,
      budget: input.budget,
      usage: input.usage,
    }));
    assertDeterministicExecutionReplay(expectedReplay, replay);
  }

  return Object.freeze({
    executionId: summary.executionId,
    summary,
    ...(replay === undefined ? {} : { replay }),
  });
}

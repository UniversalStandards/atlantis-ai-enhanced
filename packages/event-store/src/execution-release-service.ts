import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import {
  projectExecutionReleaseEvidence,
  type ExecutionReleaseEvidence,
} from "./execution-release-evidence.js";
import { ExecutionReplayFixtureRepository } from "./execution-replay-fixture-store.js";

export interface ExecutionReleaseRequest {
  readonly events: readonly ExecutionEvent[];
  readonly budget: ExecutionBudget;
  readonly usage: ExecutionUsage;
  readonly replayFixtureId?: string;
}

/**
 * Operational Day-7 release boundary. Persisted replay fixtures are loaded
 * through the governed repository and then rebound by projectExecutionReleaseEvidence
 * to the authoritative events/budget/usage supplied for this release projection.
 * Storage and telemetry remain provider-neutral concerns outside this service.
 */
export class ExecutionReleaseEvidenceService {
  public constructor(private readonly replayFixtures: ExecutionReplayFixtureRepository) {}

  public project(input: ExecutionReleaseRequest): ExecutionReleaseEvidence {
    const replayFixture = input.replayFixtureId === undefined
      ? undefined
      : this.replayFixtures.load(input.replayFixtureId);

    return projectExecutionReleaseEvidence({
      events: input.events,
      budget: input.budget,
      usage: input.usage,
      ...(replayFixture === undefined ? {} : { replayFixture }),
    });
  }
}

/**
 * Canonical operational serialization for release artifacts. The evidence
 * projection owns semantic validation; this boundary only emits its governed
 * JSON representation and never treats telemetry/export success as correctness.
 */
export function serializeExecutionReleaseEvidence(evidence: ExecutionReleaseEvidence): string {
  return JSON.stringify(evidence);
}

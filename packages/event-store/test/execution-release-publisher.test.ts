import { describe, expect, it } from "vitest";

import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import {
  ExecutionReleaseArtifactRepository,
  type ExecutionReleaseArtifactStorage,
  InMemoryExecutionReleaseArtifactStorage,
} from "../src/execution-release-artifact-store.js";
import { ExecutionReleasePublisher } from "../src/execution-release-publisher.js";
import { ExecutionReleaseEvidenceService } from "../src/execution-release-service.js";
import {
  ExecutionReplayFixtureRepository,
  InMemoryExecutionReplayFixtureStorage,
} from "../src/execution-replay-fixture-store.js";

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

function evidenceService(): ExecutionReleaseEvidenceService {
  return new ExecutionReleaseEvidenceService(
    new ExecutionReplayFixtureRepository(new InMemoryExecutionReplayFixtureStorage()),
  );
}

describe("execution release publisher", () => {
  it("projects governed evidence and persists the exact operational artifact", () => {
    const storage = new InMemoryExecutionReleaseArtifactStorage();
    const publisher = new ExecutionReleasePublisher(
      evidenceService(),
      new ExecutionReleaseArtifactRepository(storage),
    );

    const publication = publisher.publish("release-1.json", {
      events: events("release-publisher-1"),
      budget,
      usage,
    });

    expect(publication.artifactId).toBe("release-1.json");
    expect(publication.evidence.executionId).toBe("release-publisher-1");
    expect(storage.get("release-1.json")).toBe(publication.serializedEvidence);
    expect(JSON.parse(publication.serializedEvidence)).toEqual(publication.evidence);
    expect(Object.isFrozen(publication)).toBe(true);
  });

  it("fails closed when artifact persistence is not acknowledged", () => {
    const storage: ExecutionReleaseArtifactStorage = {
      put: () => false,
      get: () => null,
    };
    const publisher = new ExecutionReleasePublisher(
      evidenceService(),
      new ExecutionReleaseArtifactRepository(storage),
    );

    expect(() => publisher.publish("release-2.json", {
      events: events("release-publisher-2"),
      budget,
      usage,
    })).toThrow(/did not acknowledge persistence/);
  });

  it("fails closed when acknowledged storage cannot read back the exact governed bytes", () => {
    const storage: ExecutionReleaseArtifactStorage = {
      put: () => true,
      get: () => "{}",
    };
    const publisher = new ExecutionReleasePublisher(
      evidenceService(),
      new ExecutionReleaseArtifactRepository(storage),
    );

    expect(() => publisher.publish("release-3.json", {
      events: events("release-publisher-3"),
      budget,
      usage,
    })).toThrow(/exact governed artifact/);
  });
});

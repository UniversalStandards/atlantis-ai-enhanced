import { describe, expect, it } from "vitest";

import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import {
  ExecutionReleaseEvidenceService,
  serializeExecutionReleaseEvidence,
} from "../src/execution-release-service.js";
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

function fixtureRepository(): ExecutionReplayFixtureRepository {
  return new ExecutionReplayFixtureRepository(new InMemoryExecutionReplayFixtureStorage());
}

describe("execution release evidence service", () => {
  it("projects operational release evidence without a replay fixture", () => {
    const service = new ExecutionReleaseEvidenceService(fixtureRepository());
    const evidence = service.project({ events: events("release-service-1"), budget, usage });

    expect(evidence.executionId).toBe("release-service-1");
    expect(evidence.summary.totalTokens).toBe(500);
    expect(evidence.replay).toBeUndefined();
  });

  it("loads a persisted fixture and binds it to authoritative release inputs", () => {
    const repository = fixtureRepository();
    const executionEvents = events("release-service-2");
    repository.save(Object.freeze({
      fixtureId: "golden-service-2",
      events: executionEvents,
      budget,
      usage,
    }));

    const service = new ExecutionReleaseEvidenceService(repository);
    const evidence = service.project({
      events: executionEvents,
      budget,
      usage,
      replayFixtureId: "golden-service-2",
    });

    expect(evidence.replay?.fixtureId).toBe("golden-service-2");
    expect(evidence.replay?.executionId).toBe("release-service-2");
  });

  it("fails closed when a persisted fixture diverges from authoritative usage", () => {
    const repository = fixtureRepository();
    const executionEvents = events("release-service-3");
    repository.save(Object.freeze({
      fixtureId: "golden-service-3",
      events: executionEvents,
      budget,
      usage: Object.freeze({ ...usage, outputTokens: 201 }),
    }));

    const service = new ExecutionReleaseEvidenceService(repository);
    expect(() => service.project({
      events: executionEvents,
      budget,
      usage,
      replayFixtureId: "golden-service-3",
    })).toThrow(/projection diverged/);
  });

  it("serializes the governed projection without changing its evidence", () => {
    const service = new ExecutionReleaseEvidenceService(fixtureRepository());
    const evidence = service.project({ events: events("release-service-4"), budget, usage });

    expect(JSON.parse(serializeExecutionReleaseEvidence(evidence))).toEqual(evidence);
  });
});

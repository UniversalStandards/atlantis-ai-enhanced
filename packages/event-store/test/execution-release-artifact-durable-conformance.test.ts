import { describe, expect, it } from "vitest";
import {
  ExecutionReleaseArtifactRepository,
  type ExecutionReleaseArtifactStorage,
} from "../src/execution-release-artifact-store.js";
import type { ExecutionReleaseEvidence } from "../src/execution-release-evidence.js";

interface DurableArtifactFixture {
  createStorage(): ExecutionReleaseArtifactStorage;
  restart(): void;
  failNextPutBeforeCommit(): void;
  loseNextPutAcknowledgement(): void;
}

function evidence(executionId: string): ExecutionReleaseEvidence {
  return {
    executionId,
    summary: {
      executionId,
      eventCount: 1,
      startedAtEpochMs: 1,
      completedAtEpochMs: 2,
      elapsedMs: 1,
      usage: {
        toolCalls: 0,
        retries: 0,
        iterations: 1,
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        costUsd: 0,
      },
      totalTokens: 2,
      budget: {
        toolCalls: { limit: 1, observed: 0, remaining: 1, exceeded: false },
        retries: { limit: 1, observed: 0, remaining: 1, exceeded: false },
        iterations: { limit: 1, observed: 1, remaining: 0, exceeded: false },
        inputTokens: { limit: 2, observed: 1, remaining: 1, exceeded: false },
        outputTokens: { limit: 2, observed: 1, remaining: 1, exceeded: false },
        durationMs: { limit: 2, observed: 1, remaining: 1, exceeded: false },
        costUsd: { limit: 1, observed: 0, remaining: 1, exceeded: false },
      },
      topology: {
        executionId,
        roots: ["event-1"],
        nodes: [{ eventId: "event-1", sequence: 1, parentEventId: null, type: "execution.completed", actor: "runner", occurredAtEpochMs: 2 }],
        edges: [],
      },
    },
    replay: null,
  };
}

/**
 * Reusable provider-neutral durability gate for concrete release-artifact adapters.
 * The fixture must model shared durable state across adapter replacement and expose
 * deterministic failure injection around the provider's commit/acknowledgement boundary.
 */
export function registerExecutionReleaseArtifactDurableConformance(
  name: string,
  createFixture: () => DurableArtifactFixture,
): void {
  describe(`${name} durable release artifact conformance`, () => {
    it("survives adapter restart with exact authoritative bytes", () => {
      const fixture = createFixture();
      const artifactId = "release/execution-1";
      const written = new ExecutionReleaseArtifactRepository(fixture.createStorage()).save(artifactId, evidence("execution-1"));
      fixture.restart();
      expect(new ExecutionReleaseArtifactRepository(fixture.createStorage()).load(artifactId)).toBe(written);
    });

    it("does not expose an artifact when the write fails before commit", () => {
      const fixture = createFixture();
      const artifactId = "release/execution-2";
      fixture.failNextPutBeforeCommit();
      expect(() => new ExecutionReleaseArtifactRepository(fixture.createStorage()).save(artifactId, evidence("execution-2"))).toThrow();
      fixture.restart();
      expect(new ExecutionReleaseArtifactRepository(fixture.createStorage()).load(artifactId)).toBeNull();
    });

    it("reconciles acknowledgement loss by authoritative readback without divergent bytes", () => {
      const fixture = createFixture();
      const artifactId = "release/execution-3";
      fixture.loseNextPutAcknowledgement();
      expect(() => new ExecutionReleaseArtifactRepository(fixture.createStorage()).save(artifactId, evidence("execution-3"))).toThrow();
      fixture.restart();
      const persisted = new ExecutionReleaseArtifactRepository(fixture.createStorage()).load(artifactId);
      expect(persisted).not.toBeNull();
      expect(JSON.parse(persisted!)).toMatchObject({ executionId: "execution-3" });
    });
  });
}

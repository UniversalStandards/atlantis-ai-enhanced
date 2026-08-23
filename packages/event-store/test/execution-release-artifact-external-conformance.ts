import { describe, expect, it } from "vitest";
import {
  ExecutionReleaseArtifactRepository,
  type ExecutionReleaseArtifactStorage,
} from "../src/execution-release-artifact-store.js";
import type { ExecutionReleaseEvidence } from "../src/execution-release-evidence.js";

export interface ExternalArtifactFixture {
  createIndependentStorage(): ExecutionReleaseArtifactStorage;
  restart(): void;
  failNextPutBeforeCommit(): void;
  loseNextPutAcknowledgement(): void;
}

function evidence(executionId: string, costUsd = 0): ExecutionReleaseEvidence {
  return {
    executionId,
    summary: {
      executionId,
      eventCount: 1,
      startedAt: "1970-01-01T00:00:00.001Z",
      lastObservedAt: "1970-01-01T00:00:00.002Z",
      elapsedMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      costUsd,
      toolCalls: 0,
      retries: 0,
      iterations: 1,
      topology: {
        executionId,
        roots: ["event-1"],
        nodes: [{
          eventId: "event-1",
          executionId,
          sequence: 1,
          type: "execution.completed",
          occurredAt: "1970-01-01T00:00:00.002Z",
          actor: "runner",
        }],
        edges: [],
      },
      budget: {
        toolCalls: { limit: 1, observed: 0, remaining: 1, exceeded: false },
        retries: { limit: 1, observed: 0, remaining: 1, exceeded: false },
        iterations: { limit: 1, observed: 1, remaining: 0, exceeded: false },
        tokens: { limit: 2, observed: 2, remaining: 0, exceeded: false },
        durationMs: { limit: 2, observed: 1, remaining: 1, exceeded: false },
        costUsd: { limit: 1, observed: costUsd, remaining: 1 - costUsd, exceeded: false },
      },
    },
  };
}

/**
 * Provider-neutral external-adapter gate. Concrete provider tests register here
 * only after they can create genuinely independent clients over shared durable
 * state. The suite intentionally does not choose a provider, credentials, or
 * network topology.
 */
export function registerExecutionReleaseArtifactExternalConformance(
  name: string,
  createFixture: () => ExternalArtifactFixture,
): void {
  describe(`${name} external release artifact conformance`, () => {
    it("exposes exact governed bytes to an independent client", () => {
      const fixture = createFixture();
      const artifactId = "release/external-1";
      const first = new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage());
      const written = first.save(artifactId, evidence("external-1"));
      const second = new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage());
      expect(second.load(artifactId)).toBe(written);
    });

    it("survives restart and preserves exact bytes", () => {
      const fixture = createFixture();
      const artifactId = "release/external-2";
      const written = new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage()).save(
        artifactId,
        evidence("external-2"),
      );
      fixture.restart();
      expect(
        new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage()).load(artifactId),
      ).toBe(written);
    });

    it("keeps authoritative bytes stable across repeated reads, restart, and independent clients", () => {
      const fixture = createFixture();
      const artifactId = "release/external-stable";
      const written = new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage()).save(
        artifactId,
        evidence("external-stable"),
      );

      const beforeRestart = new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage());
      expect(beforeRestart.load(artifactId)).toBe(written);
      expect(beforeRestart.load(artifactId)).toBe(written);

      fixture.restart();

      const afterRestart = new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage());
      expect(afterRestart.load(artifactId)).toBe(written);
      expect(
        new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage()).load(artifactId),
      ).toBe(written);
    });

    it("keeps pre-commit failure invisible across independent clients and restart", () => {
      const fixture = createFixture();
      const artifactId = "release/external-3";
      fixture.failNextPutBeforeCommit();
      expect(() =>
        new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage()).save(
          artifactId,
          evidence("external-3"),
        ),
      ).toThrow();
      fixture.restart();
      expect(
        new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage()).load(artifactId),
      ).toBeNull();
    });

    it("reconciles acknowledgement loss from an independent client without rewrite", () => {
      const fixture = createFixture();
      const artifactId = "release/external-4";
      const expected = evidence("external-4");
      fixture.loseNextPutAcknowledgement();
      expect(() =>
        new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage()).save(
          artifactId,
          expected,
        ),
      ).toThrow();
      fixture.restart();
      const independent = new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage());
      const settled = independent.reconcile(artifactId, expected);
      expect(independent.load(artifactId)).toBe(settled);
    });

    it("rejects divergent same-identity publication and preserves the first exact artifact", () => {
      const fixture = createFixture();
      const artifactId = "release/external-5";
      const firstEvidence = evidence("external-5", 0);
      const divergentEvidence = evidence("external-5", 0.5);
      const first = new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage());
      const authoritative = first.save(artifactId, firstEvidence);
      const competing = new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage());
      expect(() => competing.save(artifactId, divergentEvidence)).toThrow();
      expect(
        new ExecutionReleaseArtifactRepository(fixture.createIndependentStorage()).load(artifactId),
      ).toBe(authoritative);
    });
  });
}

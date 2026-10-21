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
      startedAt: "1970-01-01T00:00:00.001Z",
      lastObservedAt: "1970-01-01T00:00:00.002Z",
      elapsedMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      costUsd: 0,
      toolCalls: 0,
      retries: 0,
      iterations: 1,
      topology: {
        executionId,
        roots: ["event-1"],
        nodes: [
          {
            eventId: "event-1",
            executionId,
            sequence: 1,
            type: "execution.completed",
            occurredAt: "1970-01-01T00:00:00.002Z",
            actor: "runner",
          },
        ],
        edges: [],
      },
      budget: {
        toolCalls: { limit: 1, observed: 0, remaining: 1, exceeded: false },
        retries: { limit: 1, observed: 0, remaining: 1, exceeded: false },
        iterations: { limit: 1, observed: 1, remaining: 0, exceeded: false },
        tokens: { limit: 2, observed: 2, remaining: 0, exceeded: false },
        durationMs: { limit: 2, observed: 1, remaining: 1, exceeded: false },
        costUsd: { limit: 1, observed: 0, remaining: 1, exceeded: false },
      },
    },
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
      const written = new ExecutionReleaseArtifactRepository(fixture.createStorage()).save(
        artifactId,
        evidence("execution-1"),
      );
      fixture.restart();
      expect(new ExecutionReleaseArtifactRepository(fixture.createStorage()).load(artifactId)).toBe(
        written,
      );
    });

    it("does not expose an artifact when the write fails before commit", () => {
      const fixture = createFixture();
      const artifactId = "release/execution-2";
      fixture.failNextPutBeforeCommit();
      expect(() =>
        new ExecutionReleaseArtifactRepository(fixture.createStorage()).save(
          artifactId,
          evidence("execution-2"),
        ),
      ).toThrow();
      fixture.restart();
      expect(new ExecutionReleaseArtifactRepository(fixture.createStorage()).load(artifactId)).toBeNull();
    });

    it("settles acknowledgement loss by exact authoritative readback without rewriting", () => {
      const fixture = createFixture();
      const artifactId = "release/execution-3";
      const expected = evidence("execution-3");
      fixture.loseNextPutAcknowledgement();
      expect(() =>
        new ExecutionReleaseArtifactRepository(fixture.createStorage()).save(artifactId, expected),
      ).toThrow();
      fixture.restart();
      const repository = new ExecutionReleaseArtifactRepository(fixture.createStorage());
      const settled = repository.reconcile(artifactId, expected);
      expect(repository.load(artifactId)).toBe(settled);
      expect(JSON.parse(settled)).toMatchObject({ executionId: "execution-3" });
    });

    it("rejects acknowledgement-loss settlement when authoritative bytes diverge", () => {
      const fixture = createFixture();
      const artifactId = "release/execution-4";
      fixture.loseNextPutAcknowledgement();
      expect(() =>
        new ExecutionReleaseArtifactRepository(fixture.createStorage()).save(
          artifactId,
          evidence("execution-4"),
        ),
      ).toThrow();
      fixture.restart();
      expect(() =>
        new ExecutionReleaseArtifactRepository(fixture.createStorage()).reconcile(
          artifactId,
          evidence("different-execution"),
        ),
      ).toThrow(/divergent authoritative bytes/);
    });
  });
}

class ProcessLocalSharedStateArtifactFixture implements DurableArtifactFixture {
  readonly #artifacts = new Map<string, string>();
  #failBeforeCommit = false;
  #loseAcknowledgement = false;

  public createStorage(): ExecutionReleaseArtifactStorage {
    return {
      put: (artifactId, serializedEvidence) => {
        if (this.#failBeforeCommit) {
          this.#failBeforeCommit = false;
          return false;
        }
        this.#artifacts.set(artifactId, serializedEvidence);
        if (this.#loseAcknowledgement) {
          this.#loseAcknowledgement = false;
          return false;
        }
        return true;
      },
      get: (artifactId) => this.#artifacts.get(artifactId) ?? null,
    };
  }

  public restart(): void {
    // Self-test only: adapter instances are replaced while process-local shared state remains.
  }

  public failNextPutBeforeCommit(): void {
    this.#failBeforeCommit = true;
  }

  public loseNextPutAcknowledgement(): void {
    this.#loseAcknowledgement = true;
  }
}

// Harness self-test only. Passing this process-local fixture is not evidence that a
// concrete external adapter survives process restart or satisfies the durable release gate.
registerExecutionReleaseArtifactDurableConformance(
  "process-local shared-state harness self-test",
  () => new ProcessLocalSharedStateArtifactFixture(),
);

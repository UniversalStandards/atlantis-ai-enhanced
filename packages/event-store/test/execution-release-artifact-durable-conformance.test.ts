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
  return Object.freeze({
    executionId,
    summary: Object.freeze({}),
  }) as unknown as ExecutionReleaseEvidence;
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

class SharedStateDurableArtifactFixture implements DurableArtifactFixture {
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
    // Adapter instances are replaced by createStorage(); shared state is retained.
  }

  public failNextPutBeforeCommit(): void {
    this.#failBeforeCommit = true;
  }

  public loseNextPutAcknowledgement(): void {
    this.#loseAcknowledgement = true;
  }
}

registerExecutionReleaseArtifactDurableConformance(
  "shared-state reference fixture",
  () => new SharedStateDurableArtifactFixture(),
);

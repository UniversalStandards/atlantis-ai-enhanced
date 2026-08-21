import { InvalidEventError } from "./index.js";
import type { ExecutionReleaseEvidence } from "./execution-release-evidence.js";
import { serializeExecutionReleaseEvidence } from "./execution-release-service.js";

export interface ExecutionReleaseArtifactStorage {
  put(artifactId: string, serializedEvidence: string): boolean;
  get(artifactId: string): string | null;
}

function assertArtifactId(artifactId: string): void {
  if (artifactId.trim().length === 0) {
    throw new InvalidEventError("release artifactId must be non-empty.");
  }
}

/**
 * Provider-neutral durable release-artifact boundary. A storage acknowledgement
 * is accepted only when authoritative readback exposes the exact governed bytes
 * written for the artifact identity. Provider selection and durability remain
 * responsibilities of concrete adapters and their acceptance suites.
 */
export class ExecutionReleaseArtifactRepository {
  public constructor(private readonly storage: ExecutionReleaseArtifactStorage) {}

  public save(artifactId: string, evidence: ExecutionReleaseEvidence): string {
    assertArtifactId(artifactId);
    const serializedEvidence = serializeExecutionReleaseEvidence(evidence);
    if (this.storage.put(artifactId, serializedEvidence) !== true) {
      throw new InvalidEventError("release artifact storage did not acknowledge persistence.");
    }
    const acknowledged = this.storage.get(artifactId);
    if (acknowledged !== serializedEvidence) {
      throw new InvalidEventError("release artifact storage acknowledgement did not expose the exact governed artifact.");
    }
    return serializedEvidence;
  }

  /**
   * Explicit settlement path for an uncertain save outcome. This never retries
   * the write: it accepts the artifact only when authoritative readback already
   * contains the exact governed bytes expected for this artifact identity.
   */
  public reconcile(artifactId: string, evidence: ExecutionReleaseEvidence): string {
    assertArtifactId(artifactId);
    const serializedEvidence = serializeExecutionReleaseEvidence(evidence);
    const authoritative = this.storage.get(artifactId);
    if (authoritative === null) {
      throw new InvalidEventError("release artifact reconciliation found no authoritative artifact.");
    }
    if (authoritative !== serializedEvidence) {
      throw new InvalidEventError("release artifact reconciliation found divergent authoritative bytes.");
    }
    return authoritative;
  }

  public load(artifactId: string): string | null {
    assertArtifactId(artifactId);
    return this.storage.get(artifactId);
  }
}

/** Process-local contract fixture only; not evidence of production durability. */
export class InMemoryExecutionReleaseArtifactStorage implements ExecutionReleaseArtifactStorage {
  readonly #artifacts = new Map<string, string>();

  public put(artifactId: string, serializedEvidence: string): boolean {
    this.#artifacts.set(artifactId, serializedEvidence);
    return true;
  }

  public get(artifactId: string): string | null {
    return this.#artifacts.get(artifactId) ?? null;
  }
}

import { InvalidEventError } from "./index.js";
import { createCanonicalJsonCandidate } from "./canonical-json-candidate.js";
import type { ExecutionReleaseArtifactStorage } from "./execution-release-artifact-store.js";
import {
  composeDay7ReleaseReadiness,
  type Day7ReleaseReadinessEvidence,
  type Day7ReleaseReadinessInput,
} from "./day7-release-readiness.js";

function assertArtifactId(artifactId: string): void {
  if (artifactId.trim().length === 0) {
    throw new InvalidEventError("Day-7 readiness artifactId must be non-empty.");
  }
}

function restoreReadinessEvidence(parsed: unknown): Day7ReleaseReadinessEvidence {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidEventError("Day-7 readiness artifact must be an object.");
  }
  const candidate = parsed as Day7ReleaseReadinessEvidence;
  return composeDay7ReleaseReadiness({
    candidateIdentity: candidate.candidateIdentity,
    deployment: candidate.deployment,
    rollback: candidate.rollback,
    burnIn: candidate.burnIn,
    independentGates: candidate.independentGates,
  });
}

export function serializeDay7ReleaseReadinessEvidence(
  evidence: Day7ReleaseReadinessEvidence,
): string {
  return createCanonicalJsonCandidate(evidence, restoreReadinessEvidence).serialized;
}

/**
 * Provider-neutral authoritative handoff for the final candidate-bound Day-7
 * readiness record. This intentionally reuses ExecutionReleaseArtifactStorage:
 * the same exact-byte acknowledgement and authoritative-readback semantics apply
 * without selecting a production storage provider.
 */
export class Day7ReleaseReadinessArtifactRepository {
  public constructor(private readonly storage: ExecutionReleaseArtifactStorage) {}

  public composeAndSave(artifactId: string, input: Day7ReleaseReadinessInput): Day7ReleaseReadinessEvidence {
    const evidence = composeDay7ReleaseReadiness(input);
    this.save(artifactId, evidence);
    return evidence;
  }

  public save(artifactId: string, evidence: Day7ReleaseReadinessEvidence): string {
    assertArtifactId(artifactId);
    const serialized = serializeDay7ReleaseReadinessEvidence(evidence);
    if (this.storage.put(artifactId, serialized) !== true) {
      throw new InvalidEventError("Day-7 readiness artifact storage did not acknowledge persistence.");
    }
    if (this.storage.get(artifactId) !== serialized) {
      throw new InvalidEventError("Day-7 readiness artifact acknowledgement did not expose the exact candidate-bound evidence.");
    }
    return serialized;
  }

  /** Settles acknowledgement uncertainty by authoritative readback only; never rewrites. */
  public reconcile(artifactId: string, evidence: Day7ReleaseReadinessEvidence): string {
    assertArtifactId(artifactId);
    const serialized = serializeDay7ReleaseReadinessEvidence(evidence);
    const authoritative = this.storage.get(artifactId);
    if (authoritative === null) {
      throw new InvalidEventError("Day-7 readiness reconciliation found no authoritative artifact.");
    }
    if (authoritative !== serialized) {
      throw new InvalidEventError("Day-7 readiness reconciliation found divergent authoritative bytes.");
    }
    return authoritative;
  }

  public load(artifactId: string): Day7ReleaseReadinessEvidence | null {
    assertArtifactId(artifactId);
    const serialized = this.storage.get(artifactId);
    if (serialized === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new InvalidEventError("Day-7 readiness artifact must contain valid JSON.");
    }
    const restored = restoreReadinessEvidence(parsed);
    if (serializeDay7ReleaseReadinessEvidence(restored) !== serialized) {
      throw new InvalidEventError("Day-7 readiness artifact is not canonical candidate-bound evidence.");
    }
    return restored;
  }
}

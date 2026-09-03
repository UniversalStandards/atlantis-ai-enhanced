import type { ExecutionReleaseEvidence } from "./execution-release-evidence.js";
import {
  ExecutionReleaseEvidenceService,
  type ExecutionReleaseRequest,
} from "./execution-release-service.js";
import { ExecutionReleaseArtifactRepository } from "./execution-release-artifact-store.js";

export interface ExecutionReleasePublication {
  readonly artifactId: string;
  readonly evidence: ExecutionReleaseEvidence;
  readonly serializedEvidence: string;
}

/**
 * Provider-neutral operational publication boundary for Day-7 release evidence.
 * Evidence is projected through the governed release service before the exact
 * serialized bytes are persisted and authoritatively read back by the artifact
 * repository. Storage/provider selection remains outside this composition.
 */
export class ExecutionReleasePublisher {
  public constructor(
    private readonly evidenceService: ExecutionReleaseEvidenceService,
    private readonly artifacts: ExecutionReleaseArtifactRepository,
  ) {}

  public publish(artifactId: string, request: ExecutionReleaseRequest): ExecutionReleasePublication {
    const evidence = this.evidenceService.project(request);
    const serializedEvidence = this.artifacts.save(artifactId, evidence);
    return Object.freeze({ artifactId, evidence, serializedEvidence });
  }
}

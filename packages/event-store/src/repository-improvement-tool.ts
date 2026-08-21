export interface RepositoryImprovementRequest {
  readonly repository: string;
  readonly branch: string;
  readonly objective: string;
}

export interface RepositoryImprovementEvidence {
  readonly repository: string;
  readonly branch: string;
  readonly testsPassed: boolean;
  readonly independentlyVerified: boolean;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly reportArtifactId: string;
  readonly traceExecutionId: string;
  readonly costUsd: number;
}

/** Provider-neutral capability boundary for the Day-7 repository-improvement tool path. */
export interface RepositoryImprovementTool {
  execute(
    request: Readonly<RepositoryImprovementRequest>,
    executionId: string,
  ): Promise<Readonly<RepositoryImprovementEvidence>>;
}

export class InvalidRepositoryImprovementEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRepositoryImprovementEvidenceError";
  }
}

function requireNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidRepositoryImprovementEvidenceError(`${field} must be non-empty.`);
  }
  return normalized;
}

/**
 * Thin governed-task bridge. It binds tool evidence back to the requested
 * repository/isolated branch and execution identity, and refuses incomplete
 * verification or release evidence before the workflow can complete.
 */
export class RepositoryImprovementTask {
  public constructor(private readonly tool: RepositoryImprovementTool) {}

  public async execute(
    request: Readonly<RepositoryImprovementRequest>,
    executionId: string,
  ): Promise<Readonly<RepositoryImprovementEvidence>> {
    const repository = requireNonBlank(request.repository, "repository");
    const branch = requireNonBlank(request.branch, "branch");
    requireNonBlank(request.objective, "objective");
    const boundExecutionId = requireNonBlank(executionId, "executionId");

    const evidence = await this.tool.execute(
      Object.freeze({ ...request, repository, branch }),
      boundExecutionId,
    );

    if (evidence.repository !== repository) {
      throw new InvalidRepositoryImprovementEvidenceError("tool evidence repository does not match the governed request.");
    }
    if (evidence.branch !== branch) {
      throw new InvalidRepositoryImprovementEvidenceError("tool evidence branch does not match the governed isolated branch.");
    }
    if (evidence.testsPassed !== true) {
      throw new InvalidRepositoryImprovementEvidenceError("repository improvement tests must pass before completion.");
    }
    if (evidence.independentlyVerified !== true) {
      throw new InvalidRepositoryImprovementEvidenceError("repository improvement requires independent verification before completion.");
    }
    if (!Number.isSafeInteger(evidence.pullRequestNumber) || evidence.pullRequestNumber < 1) {
      throw new InvalidRepositoryImprovementEvidenceError("pullRequestNumber must be a positive safe integer.");
    }
    requireNonBlank(evidence.pullRequestUrl, "pullRequestUrl");
    requireNonBlank(evidence.reportArtifactId, "reportArtifactId");
    if (evidence.traceExecutionId !== boundExecutionId) {
      throw new InvalidRepositoryImprovementEvidenceError("tool trace identity does not match the governed execution.");
    }
    if (!Number.isFinite(evidence.costUsd) || evidence.costUsd < 0) {
      throw new InvalidRepositoryImprovementEvidenceError("costUsd must be finite and non-negative.");
    }

    return Object.freeze({ ...evidence });
  }
}

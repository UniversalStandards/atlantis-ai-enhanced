import type {
  RepositoryImprovementEvidence,
  RepositoryImprovementRequest,
  RepositoryImprovementTool,
} from "./repository-improvement-tool.js";

export interface ApprovedRepositoryImprovementRequest extends RepositoryImprovementRequest {
  readonly approvalId: string;
}

export interface GitHubRepositoryImprovementExecution {
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

/**
 * Narrow mutation port for a concrete GitHub implementation. Implementations
 * may create/update an isolated branch and PR only after the adapter has
 * verified an explicit approval receipt for the exact governed request.
 */
export interface GitHubRepositoryImprovementPort {
  executeApproved(
    request: Readonly<ApprovedRepositoryImprovementRequest>,
    executionId: string,
  ): Promise<Readonly<GitHubRepositoryImprovementExecution>>;
}

/** Provider-neutral approval verifier. It must fail closed for absent, stale, or substituted approval. */
export interface RepositoryImprovementApprovalVerifier {
  requireApproved(
    request: Readonly<RepositoryImprovementRequest>,
    executionId: string,
  ): Promise<string>;
}

export class InvalidRepositoryImprovementApprovalError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRepositoryImprovementApprovalError";
  }
}

function requireNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidRepositoryImprovementApprovalError(`${field} must be non-empty.`);
  }
  return normalized;
}

/**
 * Approval-gated GitHub adapter shell for the Day-7 repository-improvement
 * capability. It intentionally contains no SDK, credentials, network setup,
 * or production permission grant. Those remain concrete-port concerns.
 */
export class ApprovalGatedGitHubRepositoryImprovementTool implements RepositoryImprovementTool {
  public constructor(
    private readonly approvals: RepositoryImprovementApprovalVerifier,
    private readonly github: GitHubRepositoryImprovementPort,
  ) {}

  public async execute(
    request: Readonly<RepositoryImprovementRequest>,
    executionId: string,
  ): Promise<Readonly<RepositoryImprovementEvidence>> {
    const repository = requireNonBlank(request.repository, "repository");
    const branch = requireNonBlank(request.branch, "branch");
    const objective = requireNonBlank(request.objective, "objective");
    const boundExecutionId = requireNonBlank(executionId, "executionId");
    const normalizedRequest = Object.freeze({ repository, branch, objective });

    const approvalId = requireNonBlank(
      await this.approvals.requireApproved(normalizedRequest, boundExecutionId),
      "approvalId",
    );

    const evidence = await this.github.executeApproved(
      Object.freeze({ ...normalizedRequest, approvalId }),
      boundExecutionId,
    );

    return Object.freeze({ ...evidence });
  }
}

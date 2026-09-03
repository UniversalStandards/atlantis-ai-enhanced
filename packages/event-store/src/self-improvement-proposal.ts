export interface SelfImprovementProposalInput {
  readonly proposalId: string;
  readonly executionId: string;
  readonly observedProblem: string;
  readonly objective: string;
  readonly isolatedBranch: string;
  readonly evidenceArtifactIds: readonly string[];
  readonly expectedBenefit: string;
  readonly risk: string;
  readonly rollbackPlan: string;
  readonly testsPassed: boolean;
  readonly evaluationPassed: boolean;
  readonly securityReviewPassed: boolean;
}

export interface SelfImprovementProposal extends SelfImprovementProposalInput {
  readonly status: "awaiting-human-review";
}

export class InvalidSelfImprovementProposalError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidSelfImprovementProposalError";
  }
}

function requireNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidSelfImprovementProposalError(`${field} must be non-empty.`);
  }
  return normalized;
}

/**
 * Creates an immutable review artifact for an ATLANTIS-proposed change.
 * This boundary deliberately has no merge, production, policy, credential,
 * infrastructure, or deployment mutation capability. A valid proposal stops
 * at human review after evidence, tests, evaluation, and security review.
 */
export function createSelfImprovementProposal(
  input: Readonly<SelfImprovementProposalInput>,
): Readonly<SelfImprovementProposal> {
  const proposalId = requireNonBlank(input.proposalId, "proposalId");
  const executionId = requireNonBlank(input.executionId, "executionId");
  const observedProblem = requireNonBlank(input.observedProblem, "observedProblem");
  const objective = requireNonBlank(input.objective, "objective");
  const isolatedBranch = requireNonBlank(input.isolatedBranch, "isolatedBranch");
  const expectedBenefit = requireNonBlank(input.expectedBenefit, "expectedBenefit");
  const risk = requireNonBlank(input.risk, "risk");
  const rollbackPlan = requireNonBlank(input.rollbackPlan, "rollbackPlan");

  if (!isolatedBranch.startsWith("sprint/") && !isolatedBranch.startsWith("proposal/")) {
    throw new InvalidSelfImprovementProposalError(
      "isolatedBranch must use an isolated sprint/ or proposal/ branch namespace.",
    );
  }
  if (input.evidenceArtifactIds.length === 0) {
    throw new InvalidSelfImprovementProposalError("at least one evidence artifact is required.");
  }
  const evidenceArtifactIds = input.evidenceArtifactIds.map((artifactId, index) =>
    requireNonBlank(artifactId, `evidenceArtifactIds[${index}]`),
  );
  if (new Set(evidenceArtifactIds).size !== evidenceArtifactIds.length) {
    throw new InvalidSelfImprovementProposalError("evidence artifact identities must be unique.");
  }
  if (input.testsPassed !== true) {
    throw new InvalidSelfImprovementProposalError("tests must pass before human review.");
  }
  if (input.evaluationPassed !== true) {
    throw new InvalidSelfImprovementProposalError("evaluation must pass before human review.");
  }
  if (input.securityReviewPassed !== true) {
    throw new InvalidSelfImprovementProposalError("security review must pass before human review.");
  }

  return Object.freeze({
    proposalId,
    executionId,
    observedProblem,
    objective,
    isolatedBranch,
    evidenceArtifactIds: Object.freeze([...evidenceArtifactIds]),
    expectedBenefit,
    risk,
    rollbackPlan,
    testsPassed: true,
    evaluationPassed: true,
    securityReviewPassed: true,
    status: "awaiting-human-review" as const,
  });
}

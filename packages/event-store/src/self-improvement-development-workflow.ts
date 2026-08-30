import type { EvaluationResult } from "@atlantis/contracts";
import {
  validateSelfImprovementOperationalCandidateAuthorization,
  type SelfImprovementOperationalCandidateAuthorization,
} from "@atlantis/contracts/self-improvement-operational-candidate-authorization";

import {
  createSelfImprovementProposal,
  InvalidSelfImprovementProposalError,
  type SelfImprovementProposal,
} from "./self-improvement-proposal.js";

export interface SelfImprovementPatchRequest {
  readonly executionId: string;
  readonly observedProblem: string;
  readonly objective: string;
  readonly evaluation: Readonly<EvaluationResult>;
}

export interface SelfImprovementPatchEvidence {
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

export interface SelfImprovementPatchGenerator {
  generate(request: Readonly<SelfImprovementPatchRequest>): Promise<Readonly<SelfImprovementPatchEvidence>>;
}

export interface AuthorizedSelfImprovementOperationalAdmission {
  readonly authorization: unknown;
  readonly featureGateEnabled: boolean;
}

export class SelfImprovementEvaluationDidNotFailError extends Error {
  public constructor() {
    super("self-improvement workflow requires a failing evaluation before patch generation.");
    this.name = "SelfImprovementEvaluationDidNotFailError";
  }
}

export class InvalidSelfImprovementPatchEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidSelfImprovementPatchEvidenceError";
  }
}

export class SelfImprovementOperationalFeatureGateDisabledError extends Error {
  public constructor() {
    super("self-improvement operational execution remains disabled until the approved non-production feature gate is explicitly enabled.");
    this.name = "SelfImprovementOperationalFeatureGateDisabledError";
  }
}

function requireBound(actual: string, expected: string, field: string): void {
  if (actual.trim() !== expected.trim()) {
    throw new InvalidSelfImprovementPatchEvidenceError(`${field} must remain bound to the failing evaluation request.`);
  }
}

/**
 * Development-only proposal composition boundary.
 *
 * A failing evaluation is the only trigger accepted here. Patch generation is
 * delegated to an isolated development capability, then rebound to the
 * immutable proposal boundary. This workflow has no merge, deployment,
 * credential, infrastructure, policy, or production mutation capability and
 * always terminates at human review.
 */
export async function proposeSelfImprovementFromFailedEvaluation(
  request: Readonly<SelfImprovementPatchRequest>,
  generator: SelfImprovementPatchGenerator,
): Promise<Readonly<SelfImprovementProposal>> {
  if (request.evaluation.passed !== false) {
    throw new SelfImprovementEvaluationDidNotFailError();
  }

  const generated = await generator.generate(request);
  requireBound(generated.executionId, request.executionId, "executionId");
  requireBound(generated.observedProblem, request.observedProblem, "observedProblem");
  requireBound(generated.objective, request.objective, "objective");

  if (generated.evaluationPassed !== true) {
    throw new InvalidSelfImprovementPatchEvidenceError(
      "generated patch must pass the follow-up evaluation before human review.",
    );
  }

  try {
    return createSelfImprovementProposal(generated);
  } catch (error) {
    if (error instanceof InvalidSelfImprovementProposalError) throw error;
    throw error;
  }
}

/**
 * Provider-neutral operational admission wrapper for Issue #7.
 *
 * This is intentionally disabled-by-default and reuses the canonical candidate
 * authorization validator. Successful admission does not add merge, deployment,
 * credential, infrastructure, policy, protected-branch, or production mutation
 * authority; it only permits the already-bounded development workflow to run.
 */
export async function proposeSelfImprovementFromAuthorizedOperationalCandidate(
  request: Readonly<SelfImprovementPatchRequest>,
  generator: SelfImprovementPatchGenerator,
  admission: Readonly<AuthorizedSelfImprovementOperationalAdmission>,
): Promise<Readonly<SelfImprovementProposal>> {
  if (admission.featureGateEnabled !== true) {
    throw new SelfImprovementOperationalFeatureGateDisabledError();
  }

  const authorization: Readonly<SelfImprovementOperationalCandidateAuthorization> =
    validateSelfImprovementOperationalCandidateAuthorization(admission.authorization);

  if (authorization.executionEnvironment !== "non-production" || authorization.authorityBoundary !== "no-prohibited-authority") {
    throw new InvalidSelfImprovementPatchEvidenceError(
      "operational candidate authorization must remain non-production and contain no prohibited authority.",
    );
  }

  return proposeSelfImprovementFromFailedEvaluation(request, generator);
}

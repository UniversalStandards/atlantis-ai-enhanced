import type { EvaluationResult } from "@atlantis/contracts";

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

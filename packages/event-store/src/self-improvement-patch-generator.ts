import type { EvaluationResult } from "@atlantis/contracts";

import type {
  SelfImprovementPatchEvidence,
  SelfImprovementPatchGenerator,
  SelfImprovementPatchRequest,
} from "./self-improvement-development-workflow.js";

export interface IsolatedSelfImprovementPatchResult {
  readonly proposalId: string;
  readonly executionId: string;
  readonly observedProblem: string;
  readonly objective: string;
  readonly isolatedBranch: string;
  readonly patchArtifactId: string;
  readonly expectedBenefit: string;
  readonly risk: string;
  readonly rollbackPlan: string;
}

export interface IsolatedSelfImprovementPatchWorkspace {
  prepare(request: Readonly<SelfImprovementPatchRequest>): Promise<Readonly<IsolatedSelfImprovementPatchResult>>;
}

export interface SelfImprovementPatchTestResult {
  readonly passed: boolean;
  readonly artifactId: string;
}

export interface SelfImprovementPatchTestRunner {
  run(patch: Readonly<IsolatedSelfImprovementPatchResult>): Promise<Readonly<SelfImprovementPatchTestResult>>;
}

export interface SelfImprovementPatchEvaluator {
  evaluate(
    patch: Readonly<IsolatedSelfImprovementPatchResult>,
    triggeringEvaluation: Readonly<EvaluationResult>,
  ): Promise<Readonly<{ passed: boolean; artifactId: string }>>;
}

export interface SelfImprovementPatchSecurityReviewer {
  review(patch: Readonly<IsolatedSelfImprovementPatchResult>): Promise<Readonly<{ passed: boolean; artifactId: string }>>;
}

export class InvalidConcreteSelfImprovementPatchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidConcreteSelfImprovementPatchError";
  }
}

function requireNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new InvalidConcreteSelfImprovementPatchError(`${field} must be non-empty.`);
  return normalized;
}

function requireBound(actual: string, expected: string, field: string): string {
  const normalized = requireNonBlank(actual, field);
  if (normalized !== expected.trim()) {
    throw new InvalidConcreteSelfImprovementPatchError(`${field} must remain bound to the failing evaluation request.`);
  }
  return normalized;
}

/**
 * Concrete orchestration for the development-only patch-generator boundary.
 *
 * Mutation capability is deliberately confined to the injected isolated
 * workspace. This class has no merge, deployment, credential, policy, or
 * production mutation API. Tests, follow-up evaluation, and security review
 * must all complete before evidence can reach the immutable human-review gate.
 */
export class EvidenceBackedSelfImprovementPatchGenerator implements SelfImprovementPatchGenerator {
  public constructor(
    private readonly workspace: IsolatedSelfImprovementPatchWorkspace,
    private readonly tests: SelfImprovementPatchTestRunner,
    private readonly evaluator: SelfImprovementPatchEvaluator,
    private readonly security: SelfImprovementPatchSecurityReviewer,
  ) {}

  public async generate(
    request: Readonly<SelfImprovementPatchRequest>,
  ): Promise<Readonly<SelfImprovementPatchEvidence>> {
    const executionId = requireNonBlank(request.executionId, "executionId");
    const observedProblem = requireNonBlank(request.observedProblem, "observedProblem");
    const objective = requireNonBlank(request.objective, "objective");

    const patch = await this.workspace.prepare(request);
    requireNonBlank(patch.proposalId, "proposalId");
    requireBound(patch.executionId, executionId, "executionId");
    requireBound(patch.observedProblem, observedProblem, "observedProblem");
    requireBound(patch.objective, objective, "objective");
    const isolatedBranch = requireNonBlank(patch.isolatedBranch, "isolatedBranch");
    if (!isolatedBranch.startsWith("proposal/") && !isolatedBranch.startsWith("sprint/")) {
      throw new InvalidConcreteSelfImprovementPatchError(
        "isolatedBranch must use an isolated sprint/ or proposal/ branch namespace.",
      );
    }
    const patchArtifactId = requireNonBlank(patch.patchArtifactId, "patchArtifactId");

    const testResult = await this.tests.run(patch);
    const testArtifactId = requireNonBlank(testResult.artifactId, "testArtifactId");
    if (testResult.passed !== true) {
      throw new InvalidConcreteSelfImprovementPatchError("generated patch tests must pass before evaluation.");
    }

    const evaluationResult = await this.evaluator.evaluate(patch, request.evaluation);
    const evaluationArtifactId = requireNonBlank(evaluationResult.artifactId, "evaluationArtifactId");
    if (evaluationResult.passed !== true) {
      throw new InvalidConcreteSelfImprovementPatchError("generated patch must pass follow-up evaluation.");
    }

    const securityResult = await this.security.review(patch);
    const securityArtifactId = requireNonBlank(securityResult.artifactId, "securityArtifactId");
    if (securityResult.passed !== true) {
      throw new InvalidConcreteSelfImprovementPatchError("generated patch must pass security review.");
    }

    const evidenceArtifactIds = [patchArtifactId, testArtifactId, evaluationArtifactId, securityArtifactId];
    if (new Set(evidenceArtifactIds).size !== evidenceArtifactIds.length) {
      throw new InvalidConcreteSelfImprovementPatchError("patch evidence artifact identities must be unique.");
    }

    return Object.freeze({
      proposalId: requireNonBlank(patch.proposalId, "proposalId"),
      executionId,
      observedProblem,
      objective,
      isolatedBranch,
      evidenceArtifactIds: Object.freeze(evidenceArtifactIds),
      expectedBenefit: requireNonBlank(patch.expectedBenefit, "expectedBenefit"),
      risk: requireNonBlank(patch.risk, "risk"),
      rollbackPlan: requireNonBlank(patch.rollbackPlan, "rollbackPlan"),
      testsPassed: true,
      evaluationPassed: true,
      securityReviewPassed: true,
    });
  }
}

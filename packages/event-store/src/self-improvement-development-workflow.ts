import type { EvaluationResult } from "@atlantis/contracts";
import {
  authorizeSelfImprovementOperationalCandidateAdmission,
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
  readonly repository?: string;
  readonly baseRevision?: string;
}

export interface SelfImprovementPatchEvidence {
  readonly proposalId: string;
  readonly executionId: string;
  readonly observedProblem: string;
  readonly objective: string;
  readonly repository?: string;
  readonly baseRevision?: string;
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
  readonly expectedAdmission: unknown;
  readonly featureGateEnabled: boolean;
  readonly repository: string;
  readonly baseRevision: string;
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

function requireNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidSelfImprovementPatchEvidenceError(`${field} must be a non-empty string.`);
  }
  return normalized;
}

function requireBound(actual: string, expected: string, field: string): void {
  if (requireNonBlank(actual, field) !== requireNonBlank(expected, field)) {
    throw new InvalidSelfImprovementPatchEvidenceError(`${field} must remain bound to the failing evaluation request.`);
  }
}

function requireOperationalBinding(actual: string, expected: string, field: string): void {
  const normalizedExpected = requireNonBlank(expected, `admission.${field}`);
  const normalizedActual = requireNonBlank(actual, `authorization.${field}`);
  if (normalizedActual !== normalizedExpected) {
    throw new InvalidSelfImprovementPatchEvidenceError(
      `operational candidate ${field} must match the admitted execution context.`,
    );
  }
}

function requireGeneratedOperationalBinding(actual: string | undefined, expected: string, field: string): void {
  const normalizedExpected = requireNonBlank(expected, `admission.${field}`);
  const normalizedActual = requireNonBlank(actual ?? "", `generated.${field}`);
  if (normalizedActual !== normalizedExpected) {
    throw new InvalidSelfImprovementPatchEvidenceError(
      `generated ${field} must match the admitted execution context.`,
    );
  }
}

function requireAuthorizedWorkspaceNamespace(namespace: string): string {
  const normalized = requireNonBlank(namespace, "authorization.isolatedWorkspaceNamespace");
  if (!normalized.endsWith("/")) {
    throw new InvalidSelfImprovementPatchEvidenceError(
      "operational candidate isolatedWorkspaceNamespace must be a non-empty branch namespace ending in '/'.",
    );
  }
  if (!normalized.startsWith("proposal/") && !normalized.startsWith("sprint/")) {
    throw new InvalidSelfImprovementPatchEvidenceError(
      "operational candidate isolatedWorkspaceNamespace must begin with proposal/ or sprint/.",
    );
  }
  if (normalized.includes("//") || normalized.includes(" ") || normalized.startsWith("/")) {
    throw new InvalidSelfImprovementPatchEvidenceError(
      "operational candidate isolatedWorkspaceNamespace must be canonical and must not contain spaces, duplicate separators, or leading '/'.",
    );
  }
  return normalized;
}

function requireBoundFailingEvaluation(evaluation: Readonly<EvaluationResult>): void {
  if (evaluation.passed !== false) {
    throw new SelfImprovementEvaluationDidNotFailError();
  }
  if (!Number.isFinite(evaluation.score)) {
    throw new InvalidSelfImprovementPatchEvidenceError("evaluation.score must be a finite number.");
  }
  const reasons = evaluation.reasons
    .map((reason, index) => requireNonBlank(reason, `evaluation.reasons[${index}]`));
  if (reasons.length === 0) {
    throw new InvalidSelfImprovementPatchEvidenceError("evaluation.reasons must contain at least one non-empty reason.");
  }
  const metricEntries = Object.entries(evaluation.metrics);
  if (metricEntries.length === 0) {
    throw new InvalidSelfImprovementPatchEvidenceError("evaluation.metrics must contain at least one metric.");
  }
  for (const [metric, value] of metricEntries) {
    requireNonBlank(metric, "evaluation.metrics key");
    if (!Number.isFinite(value)) {
      throw new InvalidSelfImprovementPatchEvidenceError(`evaluation.metrics.${metric} must be finite.`);
    }
  }
}

function requireIsolatedBranchWithinNamespace(isolatedBranch: string, namespace: string): void {
  const normalizedBranch = requireNonBlank(isolatedBranch, "generated.isolatedBranch");
  if (!normalizedBranch.startsWith(namespace)) {
    throw new InvalidSelfImprovementPatchEvidenceError(
      "generated isolatedBranch must remain inside the authorized isolated workspace namespace.",
    );
  }
  const suffix = normalizedBranch.slice(namespace.length);
  if (suffix.length === 0 || suffix.includes("/") || suffix.includes(" ")) {
    throw new InvalidSelfImprovementPatchEvidenceError(
      "generated isolatedBranch must identify a single canonical run branch inside the authorized namespace.",
    );
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
  const executionId = requireNonBlank(request.executionId, "request.executionId");
  const observedProblem = requireNonBlank(request.observedProblem, "request.observedProblem");
  const objective = requireNonBlank(request.objective, "request.objective");
  requireBoundFailingEvaluation(request.evaluation);

  const generated = await generator.generate(request);
  requireBound(generated.executionId, executionId, "executionId");
  requireBound(generated.observedProblem, observedProblem, "observedProblem");
  requireBound(generated.objective, objective, "objective");

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
 * authorization validator. The admitted repository and base revision are bound
 * to the approved candidate record, and generated work must stay inside that
 * record's isolated workspace namespace. Successful admission does not add
 * merge, deployment, credential, infrastructure, policy, protected-branch, or
 * production mutation authority; it only permits the already-bounded
 * development workflow to run.
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
    authorizeSelfImprovementOperationalCandidateAdmission(
      admission.authorization,
      admission.expectedAdmission,
    );

  if (authorization.executionEnvironment !== "non-production" || authorization.authorityBoundary !== "no-prohibited-authority") {
    throw new InvalidSelfImprovementPatchEvidenceError(
      "operational candidate authorization must remain non-production and contain no prohibited authority.",
    );
  }

  requireOperationalBinding(authorization.repository, admission.repository, "repository");
  requireOperationalBinding(authorization.baseRevision, admission.baseRevision, "baseRevision");
  const isolatedWorkspaceNamespace = requireAuthorizedWorkspaceNamespace(authorization.isolatedWorkspaceNamespace);

  const scopedGenerator: SelfImprovementPatchGenerator = Object.freeze({
    async generate(scopedRequest: Readonly<SelfImprovementPatchRequest>): Promise<Readonly<SelfImprovementPatchEvidence>> {
      const generated = await generator.generate(
        Object.freeze({
          ...scopedRequest,
          repository: admission.repository,
          baseRevision: admission.baseRevision,
        }),
      );
      requireGeneratedOperationalBinding(generated.repository, admission.repository, "repository");
      requireGeneratedOperationalBinding(generated.baseRevision, admission.baseRevision, "baseRevision");
      requireIsolatedBranchWithinNamespace(generated.isolatedBranch, isolatedWorkspaceNamespace);
      return generated;
    },
  });

  return proposeSelfImprovementFromFailedEvaluation(request, scopedGenerator);
}

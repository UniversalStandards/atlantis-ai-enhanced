import { describe, expect, it, vi } from "vitest";

import {
  InvalidSelfImprovementPatchEvidenceError,
  SelfImprovementEvaluationDidNotFailError,
  SelfImprovementOperationalFeatureGateDisabledError,
  proposeSelfImprovementFromAuthorizedOperationalCandidate,
  proposeSelfImprovementFromFailedEvaluation,
  type AuthorizedSelfImprovementOperationalAdmission,
  type SelfImprovementPatchEvidence,
  type SelfImprovementPatchRequest,
} from "./self-improvement-development-workflow.js";

const failedRequest: SelfImprovementPatchRequest = Object.freeze({
  executionId: "exec-improve-7",
  observedProblem: "evaluation score fell below the release threshold",
  objective: "restore deterministic evaluation quality",
  evaluation: Object.freeze({
    score: 0.62,
    passed: false,
    reasons: Object.freeze(["quality threshold missed"]),
    metrics: Object.freeze({ quality: 0.62 }),
  }),
});

function patchEvidence(overrides: Partial<SelfImprovementPatchEvidence> = {}): SelfImprovementPatchEvidence {
  return {
    proposalId: "proposal-improve-7",
    executionId: failedRequest.executionId,
    observedProblem: failedRequest.observedProblem,
    objective: failedRequest.objective,
    isolatedBranch: "proposal/evaluation-quality-7",
    evidenceArtifactIds: ["artifact-failing-evaluation", "artifact-patch", "artifact-tests"],
    expectedBenefit: "restore evaluation quality above the release threshold",
    risk: "patch may overfit the failing fixture",
    rollbackPlan: "discard the isolated proposal branch before merge",
    testsPassed: true,
    evaluationPassed: true,
    securityReviewPassed: true,
    ...overrides,
  };
}

function operationalAuthorization() {
  return Object.freeze({
    candidateId: "self-improvement-nonprod-candidate-1",
    executionEnvironment: "non-production" as const,
    repository: "UniversalStandards/atlantis-ai-enhanced",
    baseRevision: "test-base-revision",
    isolatedWorkspaceNamespace: "proposal/",
    workspaceMechanism: "isolated development workspace adapter",
    patchGenerationMechanism: "evidence-backed patch generator",
    testExecutionMechanism: "bounded package test runner",
    followUpEvaluationMechanism: "deterministic follow-up evaluator",
    securityReviewMechanism: "bounded security review adapter",
    evidenceStorageMechanism: "immutable proposal evidence artifact set",
    configurationDigest: "sha256:test-configuration-digest",
    credentialClass: "non-production repository development credential",
    networkBoundary: "repository-only non-production development boundary",
    timeoutCancellationMechanism: "bounded timeout with cancellation",
    teardownCleanupMechanism: "discard isolated workspace and branch",
    disableRollbackProcedure: "disable feature gate and discard isolated workspace",
    verificationGates: "tests, follow-up evaluation, security review, human review stop",
    failureInjectionPlan: "adapter timeout, test failure, evaluation failure, security review failure",
    featureGateDefault: "disabled" as const,
    authorityBoundary: "no-prohibited-authority" as const,
    decisionEvidence: "test fixture exercising canonical operational admission contract",
    approvals: Object.freeze([
      Object.freeze({ role: "architecture" as const, approvedBy: "test-architecture", approvedAt: "2026-08-30T00:00:00.000Z" }),
      Object.freeze({ role: "operations" as const, approvedBy: "test-operations", approvedAt: "2026-08-30T00:00:00.000Z" }),
      Object.freeze({ role: "security-network" as const, approvedBy: "test-security-network", approvedAt: "2026-08-30T00:00:00.000Z" }),
    ]),
  });
}

function operationalAdmission(
  overrides: Partial<AuthorizedSelfImprovementOperationalAdmission> = {},
): AuthorizedSelfImprovementOperationalAdmission {
  const authorization = operationalAuthorization();
  return {
    authorization,
    featureGateEnabled: true,
    repository: authorization.repository,
    baseRevision: authorization.baseRevision,
    ...overrides,
  };
}

describe("proposeSelfImprovementFromFailedEvaluation", () => {
  it("detects a failing evaluation, generates isolated patch evidence, and stops at human review", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));

    const proposal = await proposeSelfImprovementFromFailedEvaluation(failedRequest, { generate });

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(failedRequest);
    expect(proposal.status).toBe("awaiting-human-review");
    expect(proposal.isolatedBranch).toBe("proposal/evaluation-quality-7");
    expect(proposal.evidenceArtifactIds).toEqual([
      "artifact-failing-evaluation",
      "artifact-patch",
      "artifact-tests",
    ]);
    expect(Object.isFrozen(proposal)).toBe(true);
  });

  it("does not generate a patch when the triggering evaluation passed", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    const passingRequest = {
      ...failedRequest,
      evaluation: Object.freeze({ ...failedRequest.evaluation, passed: true }),
    };

    await expect(
      proposeSelfImprovementFromFailedEvaluation(passingRequest, { generate }),
    ).rejects.toBeInstanceOf(SelfImprovementEvaluationDidNotFailError);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["executionId", "exec-substituted"],
    ["observedProblem", "different problem"],
    ["objective", "different objective"],
  ] as const)("rejects generated %s substitution", async (field, value) => {
    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ [field]: value })),
      }),
    ).rejects.toBeInstanceOf(InvalidSelfImprovementPatchEvidenceError);
  });

  it("rejects a generated patch that still fails evaluation", async () => {
    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ evaluationPassed: false })),
      }),
    ).rejects.toBeInstanceOf(InvalidSelfImprovementPatchEvidenceError);
  });

  it("reuses the immutable proposal gate for tests, security, isolation, and provenance", async () => {
    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ testsPassed: false })),
      }),
    ).rejects.toThrow("tests must pass before human review");

    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ securityReviewPassed: false })),
      }),
    ).rejects.toThrow("security review must pass before human review");

    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ isolatedBranch: "main" })),
      }),
    ).rejects.toThrow("isolatedBranch must use an isolated sprint/ or proposal/ branch namespace");
  });
});

describe("proposeSelfImprovementFromAuthorizedOperationalCandidate", () => {
  it("reuses canonical operational authorization and still stops at human review", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));

    const proposal = await proposeSelfImprovementFromAuthorizedOperationalCandidate(
      failedRequest,
      { generate },
      operationalAdmission(),
    );

    expect(generate).toHaveBeenCalledOnce();
    expect(proposal.status).toBe("awaiting-human-review");
  });

  it("fails closed while the operational feature gate remains disabled", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission({ featureGateEnabled: false }),
      ),
    ).rejects.toBeInstanceOf(SelfImprovementOperationalFeatureGateDisabledError);
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects malformed authorization before patch generation", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    const malformed = { ...operationalAuthorization(), approvals: [] };

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission({ authorization: malformed }),
      ),
    ).rejects.toThrow("exactly one architecture approval is required");
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["repository", "UniversalStandards/other-repository"],
    ["baseRevision", "other-base-revision"],
  ] as const)("rejects authorization replay against a different %s", async (field, value) => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission({ [field]: value }),
      ),
    ).rejects.toThrow(`operational candidate ${field} must match the admitted execution context`);
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects generated work outside the authorized isolated workspace namespace", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence({ isolatedBranch: "sprint/unapproved-workspace" })));

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission(),
      ),
    ).rejects.toThrow("generated isolatedBranch must remain inside the authorized isolated workspace namespace");
    expect(generate).toHaveBeenCalledOnce();
  });
});

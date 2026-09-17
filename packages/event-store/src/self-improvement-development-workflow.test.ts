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
    repository: "UniversalStandards/atlantis-ai-enhanced",
    baseRevision: "test-base-revision",
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
  const expectedAdmission = Object.freeze({
    candidateId: authorization.candidateId,
    repository: authorization.repository,
    baseRevision: authorization.baseRevision,
    isolatedWorkspaceNamespace: authorization.isolatedWorkspaceNamespace,
    configurationDigest: authorization.configurationDigest,
    credentialClass: authorization.credentialClass,
    networkBoundary: authorization.networkBoundary,
    verificationGates: authorization.verificationGates,
    decisionEvidence: authorization.decisionEvidence,
    approvalIdentities: Object.freeze({
      architecture: "test-architecture",
      operations: "test-operations",
      "security-network": "test-security-network",
    }),
  });
  return {
    authorization,
    expectedAdmission,
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
    ["executionId", "   "],
    ["observedProblem", "\n\t"],
    ["objective", "  "],
  ] as const)("rejects blank request %s before patch generation", async (field, value) => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    await expect(
      proposeSelfImprovementFromFailedEvaluation(
        { ...failedRequest, [field]: value },
        { generate },
      ),
    ).rejects.toThrow(`request.${field} must be a non-empty string`);
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects non-finite score, empty reasons, or empty metrics in the triggering evaluation", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    await expect(
      proposeSelfImprovementFromFailedEvaluation(
        { ...failedRequest, evaluation: Object.freeze({ ...failedRequest.evaluation, score: Number.NaN }) },
        { generate },
      ),
    ).rejects.toThrow("evaluation.score must be a finite number");
    await expect(
      proposeSelfImprovementFromFailedEvaluation(
        { ...failedRequest, evaluation: Object.freeze({ ...failedRequest.evaluation, reasons: Object.freeze([]) }) },
        { generate },
      ),
    ).rejects.toThrow("evaluation.reasons must contain at least one non-empty reason");
    await expect(
      proposeSelfImprovementFromFailedEvaluation(
        { ...failedRequest, evaluation: Object.freeze({ ...failedRequest.evaluation, metrics: Object.freeze({}) }) },
        { generate },
      ),
    ).rejects.toThrow("evaluation.metrics must contain at least one metric");
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
    const admission = operationalAdmission();

    const proposal = await proposeSelfImprovementFromAuthorizedOperationalCandidate(
      failedRequest,
      { generate },
      admission,
    );

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith({
      ...failedRequest,
      repository: admission.repository,
      baseRevision: admission.baseRevision,
    });
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

  it("rejects missing expected admission decisions before patch generation", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    const { networkBoundary: _missing, ...missingExpected } = operationalAdmission().expectedAdmission as Record<string, unknown>;

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission({ expectedAdmission: missingExpected }),
      ),
    ).rejects.toThrow("expectedAdmission.networkBoundary");
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

  it("rejects authorization replay against a different isolated workspace namespace", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    const authorization = { ...operationalAuthorization(), isolatedWorkspaceNamespace: "sprint/" };

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission({ authorization }),
      ),
    ).rejects.toThrow("isolatedWorkspaceNamespace does not match expected admission value");
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

  it.each([
    ["repository", "UniversalStandards/other-repository"],
    ["baseRevision", "other-base-revision"],
  ] as const)("rejects generated %s substitution outside the admitted execution context", async (field, value) => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence({ [field]: value })));

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission(),
      ),
    ).rejects.toThrow(`generated ${field} must match the admitted execution context`);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("rejects non-canonical isolated workspace namespaces in authorization", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    const authorization = { ...operationalAuthorization(), isolatedWorkspaceNamespace: "proposal//" };
    const expectedAdmission = {
      ...(operationalAdmission().expectedAdmission as Record<string, unknown>),
      isolatedWorkspaceNamespace: "proposal//",
    };
    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission({ authorization, expectedAdmission }),
      ),
    ).rejects.toThrow("must be canonical");
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects non-canonical generated branch paths inside the authorized namespace", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence({ isolatedBranch: "proposal/run-1/extra" })));
    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission(),
      ),
    ).rejects.toThrow("must identify a single canonical run branch");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("rejects prohibited authority in the admitted candidate", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    const authorization = { ...operationalAuthorization(), authorityBoundary: "merge-allowed" };

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission({ authorization }),
      ),
    ).rejects.toThrow("authorityBoundary must prove no-prohibited-authority");
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects substituted approval identity in expected admission", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    const admission = operationalAdmission();
    const expectedAdmission = {
      ...(admission.expectedAdmission as Record<string, unknown>),
      approvalIdentities: {
        ...((admission.expectedAdmission as { approvalIdentities: Record<string, string> }).approvalIdentities),
        "security-network": "different-security-network-approver",
      },
    };

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission({ expectedAdmission }),
      ),
    ).rejects.toThrow("security-network approval identity does not match expected admission value");
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["networkBoundary", "expanded-network"],
    ["credentialClass", "expanded-credential-class"],
  ] as const)("rejects unapproved %s expansion before patch generation", async (field, value) => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    const authorization = { ...operationalAuthorization(), [field]: value };

    await expect(
      proposeSelfImprovementFromAuthorizedOperationalCandidate(
        failedRequest,
        { generate },
        operationalAdmission({ authorization }),
      ),
    ).rejects.toThrow(`${field} does not match expected admission value`);
    expect(generate).not.toHaveBeenCalled();
  });
});

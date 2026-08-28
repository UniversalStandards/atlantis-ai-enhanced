import { describe, expect, it } from "vitest";

import {
  InvalidSelfImprovementOperationalCandidateAuthorizationError,
  validateSelfImprovementOperationalCandidateAuthorization,
} from "../src/self-improvement-operational-candidate-authorization.js";

function candidate() {
  return {
    candidateId: "self-improvement-candidate-1",
    executionEnvironment: "non-production",
    repository: "UniversalStandards/atlantis-ai-enhanced",
    baseRevision: "abc123",
    isolatedWorkspaceNamespace: "proposal/",
    workspaceMechanism: "isolated-workspace v1",
    patchGenerationMechanism: "existing-generator v1",
    testExecutionMechanism: "repository-native-tests v1",
    followUpEvaluationMechanism: "existing-evaluator v1",
    securityReviewMechanism: "existing-security-review v1",
    evidenceStorageMechanism: "immutable-evidence v1",
    configurationDigest: "sha256:configuration",
    credentialClass: "non-secret-classification-only",
    networkBoundary: "documented-non-production-boundary",
    timeoutCancellationMechanism: "bounded-cancellation v1",
    teardownCleanupMechanism: "isolated-workspace-cleanup v1",
    disableRollbackProcedure: "disable feature gate and abandon isolated workspace",
    verificationGates: "typecheck; regression; security; follow-up-evaluation; immutable-proposal",
    failureInjectionPlan: "workspace; patch; test; evaluation; security; evidence; timeout; prohibited-authority",
    featureGateDefault: "disabled",
    authorityBoundary: "no-prohibited-authority",
    decisionEvidence: "candidate-record-and-authoritative-references",
    approvals: [
      { role: "architecture", approvedBy: "architecture-owner", approvedAt: "2026-08-28T00:00:00.000Z" },
      { role: "operations", approvedBy: "operations-owner", approvedAt: "2026-08-28T00:00:01.000Z" },
      { role: "security-network", approvedBy: "security-owner", approvedAt: "2026-08-28T00:00:02.000Z" },
    ],
  } as const;
}

describe("self-improvement operational candidate authorization", () => {
  it("admits complete non-production evidence with no prohibited authority", () => {
    const result = validateSelfImprovementOperationalCandidateAuthorization(candidate());
    expect(result.executionEnvironment).toBe("non-production");
    expect(result.featureGateDefault).toBe("disabled");
    expect(result.authorityBoundary).toBe("no-prohibited-authority");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.approvals)).toBe(true);
  });

  it("rejects production or default-enabled candidates", () => {
    expect(() => validateSelfImprovementOperationalCandidateAuthorization({ ...candidate(), executionEnvironment: "production" })).toThrow(InvalidSelfImprovementOperationalCandidateAuthorizationError);
    expect(() => validateSelfImprovementOperationalCandidateAuthorization({ ...candidate(), featureGateDefault: "enabled" })).toThrow(InvalidSelfImprovementOperationalCandidateAuthorizationError);
  });

  it("rejects candidates that do not prove prohibited authority is absent", () => {
    expect(() => validateSelfImprovementOperationalCandidateAuthorization({ ...candidate(), authorityBoundary: "merge-allowed" })).toThrow(/no-prohibited-authority/);
  });

  it("requires exactly one approval for each required role with canonical timestamps", () => {
    expect(() => validateSelfImprovementOperationalCandidateAuthorization({ ...candidate(), approvals: candidate().approvals.slice(0, 2) })).toThrow(/security-network approval/);
    expect(() => validateSelfImprovementOperationalCandidateAuthorization({ ...candidate(), approvals: [candidate().approvals[0], candidate().approvals[0], ...candidate().approvals.slice(1)] })).toThrow(/architecture approval/);
    expect(() => validateSelfImprovementOperationalCandidateAuthorization({ ...candidate(), approvals: candidate().approvals.map((approval, index) => index === 0 ? { ...approval, approvedAt: "2026-08-28" } : approval) })).toThrow(/canonical ISO timestamp/);
  });

  it("rejects unsupported fields so secret-bearing runtime material cannot enter the record", () => {
    expect(() => validateSelfImprovementOperationalCandidateAuthorization({ ...candidate(), token: "must-not-be-recorded" })).toThrow(/unsupported field/);
  });
});

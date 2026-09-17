import { describe, expect, it } from "vitest";
import {
  InvalidExternalReleaseArtifactCandidateAuthorizationError,
  validateExternalReleaseArtifactCandidateAuthorization,
} from "../src/external-release-artifact-candidate-authorization.js";

function validAuthorization() {
  return {
    candidateId: "external-artifact-candidate",
    executionEnvironment: "non-production",
    providerService: "approved provider/service reference",
    serviceTopology: "approved isolated topology",
    driverSdk: "approved driver and exact version",
    storagePrimitive: "approved immutable object primitive",
    namespaceClass: "approved non-secret namespace class",
    artifactIdentityMapping: "artifactId to immutable object identity",
    providerVersionIdentity: "provider object/version diagnostic identity",
    consistencyContract: "authoritative read-after-write evidence reference",
    conditionalCreatePrimitive: "approved conditional-create semantic",
    configurationDigest: "sha256:approved-candidate-configuration",
    testedRepositoryRevision: "approved-repository-revision",
    credentialClass: "approved least-privilege credential class",
    networkBoundary: "approved non-production data-plane boundary",
    featureGate: "external-release-artifact-adapter",
    featureGateDefault: "disabled",
    rollbackDisable: "disable feature gate and preserve canonical evidence",
    teardownProcedure: "approved non-production teardown procedure",
    failureInjectionPlan: "pre-commit and post-commit/pre-ack deterministic plan",
    decisionEvidence: "authoritative documentation and decision references",
    approvals: [
      { role: "architecture", approvedBy: "architecture-approver", approvedAt: "2026-08-28T20:00:00.000Z" },
      { role: "operations", approvedBy: "operations-approver", approvedAt: "2026-08-28T20:01:00.000Z" },
      { role: "security-network", approvedBy: "security-approver", approvedAt: "2026-08-28T20:02:00.000Z" },
    ],
  } as const;
}

describe("external release-artifact candidate authorization", () => {
  it("normalizes a complete non-production disabled-by-default authorization", () => {
    const authorization = validateExternalReleaseArtifactCandidateAuthorization(validAuthorization());
    expect(authorization.candidateId).toBe("external-artifact-candidate");
    expect(authorization.executionEnvironment).toBe("non-production");
    expect(authorization.featureGateDefault).toBe("disabled");
    expect(authorization.approvals).toHaveLength(3);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.approvals)).toBe(true);
  });

  it("fails closed on incomplete decision evidence", () => {
    const { consistencyContract: _omitted, ...candidate } = validAuthorization();
    expect(() => validateExternalReleaseArtifactCandidateAuthorization(candidate)).toThrow(InvalidExternalReleaseArtifactCandidateAuthorizationError);
  });

  it("requires exactly one architecture, operations, and security-network approval", () => {
    const candidate = validAuthorization();
    expect(() => validateExternalReleaseArtifactCandidateAuthorization({ ...candidate, approvals: candidate.approvals.slice(0, 2) })).toThrow(/security-network approval/);
    expect(() => validateExternalReleaseArtifactCandidateAuthorization({ ...candidate, approvals: [...candidate.approvals, candidate.approvals[0]] })).toThrow(/architecture approval/);
  });

  it("rejects production or enabled-by-default admission", () => {
    expect(() => validateExternalReleaseArtifactCandidateAuthorization({ ...validAuthorization(), executionEnvironment: "production" })).toThrow(/non-production/);
    expect(() => validateExternalReleaseArtifactCandidateAuthorization({ ...validAuthorization(), featureGateDefault: "enabled" })).toThrow(/disabled/);
  });

  it("rejects non-canonical approval timestamps and secret-bearing runtime fields", () => {
    const candidate = validAuthorization();
    expect(() => validateExternalReleaseArtifactCandidateAuthorization({ ...candidate, approvals: [{ ...candidate.approvals[0], approvedAt: "2026-08-28" }, ...candidate.approvals.slice(1)] })).toThrow(/canonical ISO timestamp/);
    expect(() => validateExternalReleaseArtifactCandidateAuthorization({ ...candidate, accessToken: "must-not-be-recorded" })).toThrow(/unsupported field/);
  });
});

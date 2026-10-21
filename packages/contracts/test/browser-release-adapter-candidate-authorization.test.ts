import { describe, expect, it } from "vitest";
import {
  InvalidBrowserReleaseAdapterCandidateAuthorizationError,
  validateBrowserReleaseAdapterCandidateAuthorization,
} from "../src/browser-release-adapter-candidate-authorization.js";

function validAuthorization() {
  return {
    candidateId: "browser-candidate",
    executionEnvironment: "non-production",
    adapterImplementation: "approved adapter implementation identity",
    sourceRevision: "immutable-source-revision",
    browserEngine: "approved engine and exact runtime version",
    automationSessionMechanism: "approved automation/session mechanism and version",
    executionTopology: "approved isolated non-production topology",
    navigationNetworkBoundary: "approved destination and egress boundary",
    sessionLifecycle: "approved creation teardown timeout and crash handling",
    representationAcquisition: "text html accessibility-tree mechanisms",
    fixtureIdentities: "immutable hostile-fixture digests",
    releaseCandidate: "exact-day7-release-candidate",
    capabilityRequirements: "approved non-secret capability classes or none",
    featureGate: "browser-release-adapter",
    featureGateDefault: "disabled",
    disableRollback: "disable feature gate and tear down non-production session",
    decisionEvidence: "authoritative candidate and decision references",
    approvals: [
      { role: "architecture", approvedBy: "architecture-approver", approvedAt: "2026-08-28T21:00:00.000Z" },
      { role: "operations", approvedBy: "operations-approver", approvedAt: "2026-08-28T21:01:00.000Z" },
      { role: "security-network", approvedBy: "security-approver", approvedAt: "2026-08-28T21:02:00.000Z" },
    ],
  } as const;
}

describe("browser release-adapter candidate authorization", () => {
  it("normalizes a complete non-production disabled-by-default authorization", () => {
    const authorization = validateBrowserReleaseAdapterCandidateAuthorization(validAuthorization());
    expect(authorization.candidateId).toBe("browser-candidate");
    expect(authorization.executionEnvironment).toBe("non-production");
    expect(authorization.featureGateDefault).toBe("disabled");
    expect(authorization.approvals).toHaveLength(3);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.approvals)).toBe(true);
  });

  it("fails closed on incomplete candidate evidence", () => {
    const { browserEngine: _omitted, ...candidate } = validAuthorization();
    expect(() => validateBrowserReleaseAdapterCandidateAuthorization(candidate)).toThrow(InvalidBrowserReleaseAdapterCandidateAuthorizationError);
  });

  it("requires exactly one architecture, operations, and security-network approval", () => {
    const candidate = validAuthorization();
    expect(() => validateBrowserReleaseAdapterCandidateAuthorization({ ...candidate, approvals: candidate.approvals.slice(0, 2) })).toThrow(/security-network approval/);
    expect(() => validateBrowserReleaseAdapterCandidateAuthorization({ ...candidate, approvals: [...candidate.approvals, candidate.approvals[0]] })).toThrow(/architecture approval/);
  });

  it("rejects production or enabled-by-default admission", () => {
    expect(() => validateBrowserReleaseAdapterCandidateAuthorization({ ...validAuthorization(), executionEnvironment: "production" })).toThrow(/non-production/);
    expect(() => validateBrowserReleaseAdapterCandidateAuthorization({ ...validAuthorization(), featureGateDefault: "enabled" })).toThrow(/disabled/);
  });

  it("rejects non-canonical approval timestamps and secret-bearing runtime fields", () => {
    const candidate = validAuthorization();
    expect(() => validateBrowserReleaseAdapterCandidateAuthorization({ ...candidate, approvals: [{ ...candidate.approvals[0], approvedAt: "2026-08-28" }, ...candidate.approvals.slice(1)] })).toThrow(/canonical ISO timestamp/);
    expect(() => validateBrowserReleaseAdapterCandidateAuthorization({ ...candidate, cookie: "must-not-be-recorded" })).toThrow(/unsupported field/);
  });
});

import { describe, expect, it } from "vitest";
import {
  InvalidTelemetrySdkCollectorCandidateAuthorizationError,
  validateTelemetrySdkCollectorCandidateAuthorization,
} from "../src/telemetry-sdk-collector-candidate-authorization.js";

function validAuthorization() {
  return {
    candidateId: "telemetry-candidate",
    executionEnvironment: "non-production",
    sdkRuntime: "approved SDK/runtime and exact version",
    exporterSpanMechanism: "approved exporter/span mechanism and exact version",
    collectorReceiver: "approved collector/receiver and exact version",
    transport: "approved transport",
    endpointClass: "approved non-secret endpoint class",
    authenticationClass: "approved non-secret authentication class",
    executionTopology: "approved isolated non-production topology",
    networkBoundary: "approved outbound/receiver network boundary",
    adapterSourceRevision: "immutable-source-revision",
    configurationDigest: "immutable-non-secret-configuration-digest",
    releaseCandidate: "exact-day7-release-candidate",
    testEnvironment: "exact-non-production-test-environment",
    teardownDisable: "disable telemetry and tear down receiver path",
    authoritativeReferences: "protocol retry backpressure timeout flush shutdown auth configuration references",
    failureInjectionPlan: "healthy unavailable timeout rejection exception shutdown-race duplicate substitution scenarios",
    featureGateDefault: "disabled",
    decisionEvidence: "authoritative candidate and decision references",
    approvals: [
      { role: "architecture", approvedBy: "architecture-approver", approvedAt: "2026-08-28T22:00:00.000Z" },
      { role: "operations", approvedBy: "operations-approver", approvedAt: "2026-08-28T22:01:00.000Z" },
      { role: "security-network", approvedBy: "security-approver", approvedAt: "2026-08-28T22:02:00.000Z" },
    ],
  } as const;
}

describe("telemetry SDK/collector candidate authorization", () => {
  it("normalizes a complete non-production disabled-by-default authorization", () => {
    const authorization = validateTelemetrySdkCollectorCandidateAuthorization(validAuthorization());
    expect(authorization.candidateId).toBe("telemetry-candidate");
    expect(authorization.executionEnvironment).toBe("non-production");
    expect(authorization.featureGateDefault).toBe("disabled");
    expect(authorization.approvals).toHaveLength(3);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.approvals)).toBe(true);
  });

  it("fails closed on incomplete candidate evidence", () => {
    const { collectorReceiver: _omitted, ...candidate } = validAuthorization();
    expect(() => validateTelemetrySdkCollectorCandidateAuthorization(candidate)).toThrow(InvalidTelemetrySdkCollectorCandidateAuthorizationError);
  });

  it("requires exactly one architecture, operations, and security-network approval", () => {
    const candidate = validAuthorization();
    expect(() => validateTelemetrySdkCollectorCandidateAuthorization({ ...candidate, approvals: candidate.approvals.slice(0, 2) })).toThrow(/security-network approval/);
    expect(() => validateTelemetrySdkCollectorCandidateAuthorization({ ...candidate, approvals: [...candidate.approvals, candidate.approvals[0]] })).toThrow(/architecture approval/);
  });

  it("rejects production or enabled-by-default admission", () => {
    expect(() => validateTelemetrySdkCollectorCandidateAuthorization({ ...validAuthorization(), executionEnvironment: "production" })).toThrow(/non-production/);
    expect(() => validateTelemetrySdkCollectorCandidateAuthorization({ ...validAuthorization(), featureGateDefault: "enabled" })).toThrow(/disabled/);
  });

  it("rejects non-canonical approval timestamps and secret-bearing runtime fields", () => {
    const candidate = validAuthorization();
    expect(() => validateTelemetrySdkCollectorCandidateAuthorization({ ...candidate, approvals: [{ ...candidate.approvals[0], approvedAt: "2026-08-28" }, ...candidate.approvals.slice(1)] })).toThrow(/canonical ISO timestamp/);
    expect(() => validateTelemetrySdkCollectorCandidateAuthorization({ ...candidate, token: "must-not-be-recorded" })).toThrow(/unsupported field/);
  });
});

import { describe, expect, it } from "vitest";

import {
  InvalidDurablePersistenceCandidateAuthorizationError,
  validateDurablePersistenceCandidateAuthorization,
  type DurablePersistenceCandidateAuthorization,
} from "../src/durable-persistence-candidate-authorization.js";

function candidate(): DurablePersistenceCandidateAuthorization {
  return {
    candidateId: "candidate-nonprod-1",
    productSubstrate: "approved substrate",
    versionServiceMode: "approved version/mode",
    driverSdk: "approved frozen dependency",
    authoritativeTopology: "approved non-production topology",
    consistencyMode: "documented consistency semantics",
    transactionPrimitive: "documented conditional/transaction primitive",
    independentClientTopology: "independent clients share authoritative state",
    restartBoundary: "client process recreated",
    credentialClass: "non-secret workload identity class",
    networkBoundary: "approved non-secret network boundary",
    featureGate: "candidate registration control",
    featureGateDefault: "disabled",
    rollbackDisable: "disable adapter registration",
    semanticMappingEvidence: "architecture evidence reference",
    errorMappingEvidence: "provider error mapping reference",
    failureInjectionPlan: "deterministic failure-injection plan reference",
    decisionEvidence: "approved candidate decision record reference",
    approvals: [
      { role: "architecture", approvedBy: "architecture-reviewer", approvedAt: "2026-08-28T15:00:00.000Z" },
      { role: "operations", approvedBy: "operations-reviewer", approvedAt: "2026-08-28T15:01:00.000Z" },
    ],
  };
}

describe("durable persistence candidate authorization", () => {
  it("normalizes and freezes a complete provider-neutral authorization", () => {
    const authorization = validateDurablePersistenceCandidateAuthorization(candidate());
    expect(authorization.candidateId).toBe("candidate-nonprod-1");
    expect(authorization.featureGateDefault).toBe("disabled");
    expect(authorization.approvals.map(({ role }) => role)).toEqual(["architecture", "operations"]);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.approvals)).toBe(true);
  });

  it("fails closed when a required decision field is blank", () => {
    expect(() => validateDurablePersistenceCandidateAuthorization({ ...candidate(), transactionPrimitive: " " }))
      .toThrow(InvalidDurablePersistenceCandidateAuthorizationError);
  });

  it("requires the admitted candidate to remain disabled by default", () => {
    expect(() => validateDurablePersistenceCandidateAuthorization({
      ...candidate(),
      featureGateDefault: "enabled",
    })).toThrow(/featureGateDefault must be disabled/);

    const { featureGateDefault: _omitted, ...withoutDefault } = candidate();
    expect(() => validateDurablePersistenceCandidateAuthorization(withoutDefault))
      .toThrow(/featureGateDefault must be disabled/);
  });

  it("requires exactly one architecture and one operations approval", () => {
    const architectureOnly = candidate().approvals.slice(0, 1);
    expect(() => validateDurablePersistenceCandidateAuthorization({ ...candidate(), approvals: architectureOnly }))
      .toThrow(/exactly one operations approval/);

    const duplicateArchitecture = [...candidate().approvals, candidate().approvals[0]!];
    expect(() => validateDurablePersistenceCandidateAuthorization({ ...candidate(), approvals: duplicateArchitecture }))
      .toThrow(/exactly one architecture approval/);
  });

  it("requires canonical approval timestamps", () => {
    const malformed = [
      { ...candidate().approvals[0]!, approvedAt: "not-a-time" },
      candidate().approvals[1]!,
    ];
    expect(() => validateDurablePersistenceCandidateAuthorization({ ...candidate(), approvals: malformed }))
      .toThrow(/approvedAt must be a canonical ISO timestamp/);

    const dateOnly = [
      { ...candidate().approvals[0]!, approvedAt: "2026-08-28" },
      candidate().approvals[1]!,
    ];
    expect(() => validateDurablePersistenceCandidateAuthorization({ ...candidate(), approvals: dateOnly }))
      .toThrow(/approvedAt must be a canonical ISO timestamp/);

    const offsetEquivalent = [
      { ...candidate().approvals[0]!, approvedAt: "2026-08-28T08:00:00-07:00" },
      candidate().approvals[1]!,
    ];
    expect(() => validateDurablePersistenceCandidateAuthorization({ ...candidate(), approvals: offsetEquivalent }))
      .toThrow(/approvedAt must be a canonical ISO timestamp/);
  });

  it("rejects unsupported top-level fields instead of preserving secret-bearing input", () => {
    const authorization = { ...candidate(), connectionString: "must-not-survive-validation" };
    expect(() => validateDurablePersistenceCandidateAuthorization(authorization))
      .toThrow(/authorization contains unsupported field\(s\): connectionString/);
  });

  it("rejects malformed or extended approval records at the runtime boundary", () => {
    expect(() => validateDurablePersistenceCandidateAuthorization({ ...candidate(), approvals: [null, candidate().approvals[1]] }))
      .toThrow(/approval must be an object/);

    const approvals = [
      { ...candidate().approvals[0]!, token: "must-not-survive-validation" },
      candidate().approvals[1]!,
    ];
    expect(() => validateDurablePersistenceCandidateAuthorization({ ...candidate(), approvals }))
      .toThrow(/approval contains unsupported field\(s\): token/);
  });
});

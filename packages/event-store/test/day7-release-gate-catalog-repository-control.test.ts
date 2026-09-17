import { describe, expect, it } from "vitest";
import { DAY7_REQUIRED_RELEASE_GATE_IDS, requireCompleteDay7ReleaseGateCatalog } from "../src/day7-release-gate-catalog.js";
import type { Day7ReleaseGateEvidence } from "../src/day7-release-readiness.js";
import type { Day7CandidateIdentity } from "../src/day7-operational-evidence.js";

const candidateIdentity: Day7CandidateIdentity = {
  candidateHeadSha: "candidate-head",
  candidateMergeSha: "candidate-merge",
  workflowRunId: "run-1",
  verificationMatrixRevision: "matrix-1",
  operatorRunbookRevision: "runbook-1",
  dependencyLockDigest: "lock-1",
  configurationSchemaVersion: "config-1",
  deploymentIdentity: "deployment-1",
  recordedAtEpochMs: 1,
};

const completeCatalog = (): Day7ReleaseGateEvidence[] => DAY7_REQUIRED_RELEASE_GATE_IDS.map((gateId) => ({
  gateId,
  candidateIdentity,
  disposition: "PASS",
  evidenceIds: [`${gateId}-evidence`],
  blockerReason: null,
}));

describe("Day-7 repository release-control gate", () => {
  it("is part of the canonical release gate catalog and fails closed when omitted", () => {
    expect(DAY7_REQUIRED_RELEASE_GATE_IDS).toContain("repository-release-control");

    const withoutRepositoryControl = completeCatalog().filter(
      (gate) => gate.gateId !== "repository-release-control",
    );

    expect(() => requireCompleteDay7ReleaseGateCatalog(withoutRepositoryControl)).toThrow(
      "missing required Day-7 release gates: repository-release-control",
    );
  });
});

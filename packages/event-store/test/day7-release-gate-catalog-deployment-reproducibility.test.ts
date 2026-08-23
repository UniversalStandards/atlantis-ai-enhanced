import { describe, expect, it } from "vitest";
import {
  DAY7_REQUIRED_RELEASE_GATE_IDS,
  requireCompleteDay7ReleaseGateCatalog,
} from "../src/day7-release-gate-catalog.js";
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

function completeGates(): Day7ReleaseGateEvidence[] {
  return DAY7_REQUIRED_RELEASE_GATE_IDS.map((gateId) => ({
    gateId,
    candidateIdentity,
    disposition: "PASS",
    evidenceIds: [`${gateId}-evidence-1`],
    blockerReason: null,
  }));
}

describe("Day-7 deployment reproducibility release gate", () => {
  it("fails closed when deployment-reproducibility evidence is omitted", () => {
    const incomplete = completeGates().filter(
      (gate) => gate.gateId !== "deployment-reproducibility",
    );

    expect(() => requireCompleteDay7ReleaseGateCatalog(incomplete)).toThrow(
      "missing required Day-7 release gates: deployment-reproducibility",
    );
  });
});

import { describe, expect, it } from "vitest";
import { validateBurnInEvidence, type BurnInEvidence } from "../src/day7-operational-evidence.js";

const candidate = {
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

function completeBurnIn(): BurnInEvidence {
  return {
    burnInId: "burn-complete",
    candidateIdentity: candidate,
    plannedDurationMs: 100,
    startedAtEpochMs: 10,
    endedAtEpochMs: 110,
    executionCounts: { attempted: 1, completed: 1, failed: 0, waitingApproval: 0 },
    approvalOutcomes: ["approval-1"],
    injectedFailures: ["failure-1"],
    ownershipEvents: ["ownership-1"],
    persistenceUncertaintyEvents: ["uncertainty-1"],
    telemetryFailures: [],
    securityFindings: [],
    regressionEvidence: ["regression-1"],
    traceCompletenessEvidence: ["trace-1"],
    incidents: [],
    finalDisposition: "PASS",
  };
}

describe("Day-7 burn-in release evidence", () => {
  it("rejects a vacuous PASS with no attempted executions", () => {
    const evidence: BurnInEvidence = {
      ...completeBurnIn(),
      burnInId: "burn-empty",
      executionCounts: { attempted: 0, completed: 0, failed: 0, waitingApproval: 0 },
    };

    expect(() => validateBurnInEvidence(evidence)).toThrow(
      "burn-in PASS requires at least one attempted execution",
    );
  });

  it("rejects one evidence identity reused across distinct burn-in roles", () => {
    const evidence: BurnInEvidence = {
      ...completeBurnIn(),
      injectedFailures: ["shared-evidence"],
      ownershipEvents: ["shared-evidence"],
    };

    expect(() => validateBurnInEvidence(evidence)).toThrow(
      "burn-in evidence identities must be unique across evidence roles",
    );
  });

  it("preserves incident evidence on PASS when all terminal release conditions are satisfied", () => {
    const evidence: BurnInEvidence = {
      ...completeBurnIn(),
      incidents: ["incident-resolved-1"],
    };

    expect(validateBurnInEvidence(evidence).incidents).toEqual(["incident-resolved-1"]);
  });
});

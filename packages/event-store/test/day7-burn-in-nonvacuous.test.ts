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

describe("Day-7 burn-in release evidence", () => {
  it("rejects a vacuous PASS with no attempted executions", () => {
    const evidence: BurnInEvidence = {
      burnInId: "burn-empty",
      candidateIdentity: candidate,
      plannedDurationMs: 100,
      startedAtEpochMs: 10,
      endedAtEpochMs: 110,
      executionCounts: { attempted: 0, completed: 0, failed: 0, waitingApproval: 0 },
      approvalOutcomes: [],
      injectedFailures: [],
      ownershipEvents: [],
      persistenceUncertaintyEvents: [],
      telemetryFailures: [],
      securityFindings: [],
      regressionEvidence: ["regression-1"],
      traceCompletenessEvidence: ["trace-1"],
      incidents: [],
      finalDisposition: "PASS",
    };

    expect(() => validateBurnInEvidence(evidence)).toThrow(
      "burn-in PASS requires at least one attempted execution",
    );
  });
});

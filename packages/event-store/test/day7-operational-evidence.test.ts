import { describe, expect, it } from "vitest";
import {
  validateBurnInEvidence,
  validateDeploymentRehearsalEvidence,
  validateRollbackRehearsalEvidence,
  type Day7CandidateIdentity,
} from "../src/day7-operational-evidence.js";

const candidate: Day7CandidateIdentity = {
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

const step = {
  stepId: "step-1",
  startedAtEpochMs: 1,
  completedAtEpochMs: 2,
  result: "PASS" as const,
  evidenceId: "step-evidence-1",
};

const check = {
  checkId: "check-1",
  expectedCondition: "healthy",
  observedCondition: "healthy",
  result: "PASS" as const,
  evidenceId: "check-evidence-1",
};

describe("Day-7 operational evidence runtime dispositions", () => {
  it("rejects an unknown deployment disposition supplied at runtime", () => {
    expect(() => validateDeploymentRehearsalEvidence({
      deploymentRehearsalId: "deploy-1",
      candidateIdentity: candidate,
      immutableArtifactIdentities: ["artifact-1"],
      environmentClass: "release-candidate",
      configurationDigest: "config-digest",
      migrationPrerequisiteEvidence: [],
      startedAtEpochMs: 1,
      completedAtEpochMs: 2,
      steps: [step],
      postDeployChecks: [check],
      releaseEvidenceArtifactId: "release-1",
      result: "UNKNOWN",
      failureReason: "not a canonical disposition",
    } as never)).toThrow("deployment rehearsal result must be PASS, FAIL, or BLOCKED");
  });

  it("rejects unknown nested step and check dispositions", () => {
    const base = {
      deploymentRehearsalId: "deploy-1",
      candidateIdentity: candidate,
      immutableArtifactIdentities: ["artifact-1"],
      environmentClass: "release-candidate",
      configurationDigest: "config-digest",
      migrationPrerequisiteEvidence: [],
      startedAtEpochMs: 1,
      completedAtEpochMs: 2,
      releaseEvidenceArtifactId: null,
      result: "FAIL" as const,
      failureReason: "expected test failure",
    };

    expect(() => validateDeploymentRehearsalEvidence({
      ...base,
      steps: [{ ...step, result: "UNKNOWN" }],
      postDeployChecks: [check],
    } as never)).toThrow("steps[0].result must be PASS, FAIL, or BLOCKED");

    expect(() => validateDeploymentRehearsalEvidence({
      ...base,
      steps: [step],
      postDeployChecks: [{ ...check, result: "UNKNOWN" }],
    } as never)).toThrow("postDeployChecks[0].result must be PASS, FAIL, or BLOCKED");
  });

  it("rejects an unknown uncertain-operation reconciliation disposition", () => {
    expect(() => validateRollbackRehearsalEvidence({
      rollbackRehearsalId: "rollback-1",
      candidateIdentity: candidate,
      fromDeploymentIdentity: "deployment-1",
      targetKnownGoodIdentity: "deployment-0",
      compatibilityEvidence: ["compat-1"],
      preservedAuthorityEvidence: ["authority-1"],
      startedAtEpochMs: 1,
      completedAtEpochMs: 2,
      steps: [step],
      postRollbackChecks: [check],
      uncertainOperations: [{
        operationId: "operation-1",
        uncertaintySource: "acknowledgement-loss",
        authoritativeReadbackId: "readback-1",
        reconciliationDisposition: "UNKNOWN",
        evidenceId: "operation-evidence-1",
      }],
      result: "FAIL",
      failureReason: "expected test failure",
    } as never)).toThrow("reconciliationDisposition must be PASS, FAIL, or BLOCKED");
  });

  it("rejects an unknown burn-in final disposition", () => {
    expect(() => validateBurnInEvidence({
      burnInId: "burn-1",
      candidateIdentity: candidate,
      plannedDurationMs: 100,
      startedAtEpochMs: 1,
      endedAtEpochMs: 101,
      executionCounts: { attempted: 1, completed: 1, failed: 0, waitingApproval: 0 },
      approvalOutcomes: [],
      injectedFailures: [],
      ownershipEvents: [],
      persistenceUncertaintyEvents: [],
      telemetryFailures: [],
      securityFindings: [],
      regressionEvidence: ["regression-1"],
      traceCompletenessEvidence: ["trace-1"],
      incidents: [],
      finalDisposition: "UNKNOWN",
    } as never)).toThrow("finalDisposition must be PASS, FAIL, or BLOCKED");
  });
});

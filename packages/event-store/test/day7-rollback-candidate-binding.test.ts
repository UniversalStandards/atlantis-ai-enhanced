import { describe, expect, it } from "vitest";
import {
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

const rollback = () => ({
  rollbackRehearsalId: "rollback-1",
  candidateIdentity: candidate,
  fromDeploymentIdentity: candidate.deploymentIdentity,
  targetKnownGoodIdentity: "deployment-0",
  compatibilityEvidence: ["compat-1"],
  preservedAuthorityEvidence: ["authority-1"],
  startedAtEpochMs: 3,
  completedAtEpochMs: 4,
  steps: [{
    stepId: "step-1",
    startedAtEpochMs: 3,
    completedAtEpochMs: 4,
    result: "PASS" as const,
    evidenceId: "step-evidence-1",
  }],
  postRollbackChecks: [{
    checkId: "check-1",
    expectedCondition: "known-good identity active",
    observedCondition: "known-good identity active",
    result: "PASS" as const,
    evidenceId: "check-evidence-1",
  }],
  uncertainOperations: [{
    operationId: "operation-1",
    uncertaintySource: "acknowledgement-loss",
    authoritativeReadbackId: "readback-1",
    reconciliationDisposition: "PASS" as const,
    evidenceId: "operation-evidence-1",
  }],
  result: "PASS" as const,
  failureReason: null,
});

describe("Day-7 rollback candidate binding", () => {
  it("accepts rollback evidence bound to the candidate deployment identity", () => {
    expect(validateRollbackRehearsalEvidence(rollback()).fromDeploymentIdentity).toBe(candidate.deploymentIdentity);
  });

  it("rejects rollback evidence whose source deployment substitutes another candidate", () => {
    expect(() => validateRollbackRehearsalEvidence({
      ...rollback(),
      fromDeploymentIdentity: "different-deployment",
    })).toThrow("rollback source deployment identity must match candidate deployment identity");
  });
});

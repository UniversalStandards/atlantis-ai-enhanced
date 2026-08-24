import { describe, expect, it } from "vitest";
import {
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

const step = (stepId: string, evidenceId: string) => ({
  stepId,
  startedAtEpochMs: 1,
  completedAtEpochMs: 2,
  result: "PASS" as const,
  evidenceId,
});

const check = (checkId: string, evidenceId: string) => ({
  checkId,
  expectedCondition: "healthy",
  observedCondition: "healthy",
  result: "PASS" as const,
  evidenceId,
});

describe("Day-7 operational evidence identity uniqueness", () => {
  it("rejects one evidence identity being reused for distinct steps, checks, or uncertain operations", () => {
    const deployment = {
      deploymentRehearsalId: "deploy-1",
      candidateIdentity: candidate,
      immutableArtifactIdentities: ["artifact-1"],
      environmentClass: "release-candidate",
      configurationDigest: "config-digest",
      migrationPrerequisiteEvidence: [],
      startedAtEpochMs: 1,
      completedAtEpochMs: 2,
      steps: [step("step-1", "step-evidence"), step("step-2", "step-evidence")],
      postDeployChecks: [check("check-1", "check-evidence")],
      releaseEvidenceArtifactId: "release-1",
      result: "PASS" as const,
      failureReason: null,
    };

    expect(() => validateDeploymentRehearsalEvidence(deployment)).toThrow("steps evidence identities must be unique");
    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment,
      steps: [step("step-1", "step-evidence-1")],
      postDeployChecks: [check("check-1", "check-evidence"), check("check-2", "check-evidence")],
    })).toThrow("postDeployChecks evidence identities must be unique");

    expect(() => validateRollbackRehearsalEvidence({
      rollbackRehearsalId: "rollback-1",
      candidateIdentity: candidate,
      fromDeploymentIdentity: "deployment-1",
      targetKnownGoodIdentity: "deployment-0",
      compatibilityEvidence: ["compat-1"],
      preservedAuthorityEvidence: ["authority-1"],
      startedAtEpochMs: 3,
      completedAtEpochMs: 4,
      steps: [step("rollback-step", "rollback-step-evidence")],
      postRollbackChecks: [check("rollback-check", "rollback-check-evidence")],
      uncertainOperations: [
        { operationId: "op-1", uncertaintySource: "ack-loss-1", authoritativeReadbackId: "readback-1", reconciliationDisposition: "PASS" as const, evidenceId: "uncertain-evidence" },
        { operationId: "op-2", uncertaintySource: "ack-loss-2", authoritativeReadbackId: "readback-2", reconciliationDisposition: "PASS" as const, evidenceId: "uncertain-evidence" },
      ],
      result: "PASS" as const,
      failureReason: null,
    })).toThrow("uncertain operation evidence identities must be unique");
  });

  it("rejects one evidence identity being reused across distinct operational roles", () => {
    expect(() => validateDeploymentRehearsalEvidence({
      deploymentRehearsalId: "deploy-1",
      candidateIdentity: candidate,
      immutableArtifactIdentities: ["artifact-1"],
      environmentClass: "release-candidate",
      configurationDigest: "config-digest",
      migrationPrerequisiteEvidence: [],
      startedAtEpochMs: 1,
      completedAtEpochMs: 2,
      steps: [step("step-1", "shared-evidence")],
      postDeployChecks: [check("check-1", "shared-evidence")],
      releaseEvidenceArtifactId: "release-1",
      result: "PASS" as const,
      failureReason: null,
    })).toThrow("deployment rehearsal evidence identities must be unique across operational roles");

    expect(() => validateRollbackRehearsalEvidence({
      rollbackRehearsalId: "rollback-1",
      candidateIdentity: candidate,
      fromDeploymentIdentity: "deployment-1",
      targetKnownGoodIdentity: "deployment-0",
      compatibilityEvidence: ["compat-1"],
      preservedAuthorityEvidence: ["authority-1"],
      startedAtEpochMs: 3,
      completedAtEpochMs: 4,
      steps: [step("rollback-step", "shared-evidence")],
      postRollbackChecks: [check("rollback-check", "rollback-check-evidence")],
      uncertainOperations: [
        { operationId: "op-1", uncertaintySource: "ack-loss-1", authoritativeReadbackId: "readback-1", reconciliationDisposition: "PASS" as const, evidenceId: "shared-evidence" },
      ],
      result: "PASS" as const,
      failureReason: null,
    })).toThrow("rollback rehearsal evidence identities must be unique across operational roles");
  });
});

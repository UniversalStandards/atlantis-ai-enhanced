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

const deployment = () => ({
  deploymentRehearsalId: "deploy-1",
  candidateIdentity: candidate,
  immutableArtifactIdentities: ["artifact-1"],
  environmentClass: "release-candidate",
  configurationDigest: "config-digest",
  migrationPrerequisiteEvidence: ["migration-1"],
  startedAtEpochMs: 1,
  completedAtEpochMs: 2,
  steps: [step("step-1", "step-evidence-1")],
  postDeployChecks: [check("check-1", "check-evidence-1")],
  releaseEvidenceArtifactId: "release-1",
  result: "PASS" as const,
  failureReason: null,
});

const rollback = () => ({
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
    { operationId: "op-1", uncertaintySource: "ack-loss-1", authoritativeReadbackId: "readback-1", reconciliationDisposition: "PASS" as const, evidenceId: "uncertain-evidence-1" },
  ],
  result: "PASS" as const,
  failureReason: null,
});

describe("Day-7 operational evidence identity uniqueness", () => {
  it("rejects one evidence identity being reused for distinct steps, checks, or uncertain operations", () => {
    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment(),
      steps: [step("step-1", "step-evidence"), step("step-2", "step-evidence")],
    })).toThrow("steps evidence identities must be unique");

    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment(),
      postDeployChecks: [check("check-1", "check-evidence"), check("check-2", "check-evidence")],
    })).toThrow("postDeployChecks evidence identities must be unique");

    expect(() => validateRollbackRehearsalEvidence({
      ...rollback(),
      uncertainOperations: [
        { operationId: "op-1", uncertaintySource: "ack-loss-1", authoritativeReadbackId: "readback-1", reconciliationDisposition: "PASS" as const, evidenceId: "uncertain-evidence" },
        { operationId: "op-2", uncertaintySource: "ack-loss-2", authoritativeReadbackId: "readback-2", reconciliationDisposition: "PASS" as const, evidenceId: "uncertain-evidence" },
      ],
    })).toThrow("uncertain operation evidence identities must be unique");
  });

  it("rejects evidence reuse across every deployment evidence role", () => {
    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment(),
      immutableArtifactIdentities: ["shared-evidence"],
      steps: [step("step-1", "shared-evidence")],
    })).toThrow("deployment rehearsal evidence identities must be unique across evidence roles");

    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment(),
      migrationPrerequisiteEvidence: ["shared-evidence"],
      postDeployChecks: [check("check-1", "shared-evidence")],
    })).toThrow("deployment rehearsal evidence identities must be unique across evidence roles");

    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment(),
      releaseEvidenceArtifactId: "shared-evidence",
      immutableArtifactIdentities: ["shared-evidence"],
    })).toThrow("deployment rehearsal evidence identities must be unique across evidence roles");
  });

  it("rejects evidence reuse across every rollback evidence role, including readback aliases", () => {
    expect(() => validateRollbackRehearsalEvidence({
      ...rollback(),
      compatibilityEvidence: ["shared-evidence"],
      steps: [step("rollback-step", "shared-evidence")],
    })).toThrow("rollback rehearsal evidence identities must be unique across evidence roles");

    expect(() => validateRollbackRehearsalEvidence({
      ...rollback(),
      preservedAuthorityEvidence: ["shared-evidence"],
      postRollbackChecks: [check("rollback-check", "shared-evidence")],
    })).toThrow("rollback rehearsal evidence identities must be unique across evidence roles");

    expect(() => validateRollbackRehearsalEvidence({
      ...rollback(),
      uncertainOperations: [
        { operationId: "op-1", uncertaintySource: "ack-loss-1", authoritativeReadbackId: "shared-evidence", reconciliationDisposition: "PASS" as const, evidenceId: "shared-evidence" },
      ],
    })).toThrow("rollback rehearsal evidence identities must be unique across evidence roles");
  });
});

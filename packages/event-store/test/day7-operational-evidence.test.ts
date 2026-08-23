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

const deployment = () => ({
  deploymentRehearsalId: "deploy-1",
  candidateIdentity: candidate,
  immutableArtifactIdentities: ["artifact-1"],
  environmentClass: "release-candidate",
  configurationDigest: "config-digest",
  migrationPrerequisiteEvidence: ["migration-1"],
  startedAtEpochMs: 1,
  completedAtEpochMs: 2,
  steps: [step],
  postDeployChecks: [check],
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
  steps: [step],
  postRollbackChecks: [check],
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

const burnIn = () => ({
  burnInId: "burn-1",
  candidateIdentity: candidate,
  plannedDurationMs: 100,
  startedAtEpochMs: 10,
  endedAtEpochMs: 110,
  executionCounts: { attempted: 2, completed: 2, failed: 0, waitingApproval: 0 },
  approvalOutcomes: ["approval-1"],
  injectedFailures: ["failure-injection-1"],
  ownershipEvents: ["ownership-1"],
  persistenceUncertaintyEvents: ["persistence-1"],
  telemetryFailures: [],
  securityFindings: [],
  regressionEvidence: ["regression-1"],
  traceCompletenessEvidence: ["trace-1"],
  incidents: [],
  finalDisposition: "PASS" as const,
});

describe("Day-7 operational evidence conformance", () => {
  it("accepts complete deployment, rollback, and burn-in PASS evidence as immutable snapshots", () => {
    const validatedDeployment = validateDeploymentRehearsalEvidence(deployment());
    const validatedRollback = validateRollbackRehearsalEvidence(rollback());
    const validatedBurnIn = validateBurnInEvidence(burnIn());

    expect(validatedDeployment.result).toBe("PASS");
    expect(validatedRollback.result).toBe("PASS");
    expect(validatedBurnIn.finalDisposition).toBe("PASS");
    expect(Object.isFrozen(validatedDeployment)).toBe(true);
    expect(Object.isFrozen(validatedRollback)).toBe(true);
    expect(Object.isFrozen(validatedBurnIn)).toBe(true);
  });

  it("rejects deployment PASS when any required step or post-deploy check is not PASS", () => {
    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment(),
      steps: [{ ...step, result: "BLOCKED" as const }],
    })).toThrow("deployment rehearsal PASS requires every step and check to pass");

    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment(),
      postDeployChecks: [{ ...check, result: "FAIL" as const }],
    })).toThrow("deployment rehearsal PASS requires every step and check to pass");
  });

  it("rejects rollback PASS when uncertain outcomes are not authoritatively reconciled", () => {
    expect(() => validateRollbackRehearsalEvidence({
      ...rollback(),
      uncertainOperations: [{
        ...rollback().uncertainOperations[0]!,
        reconciliationDisposition: "BLOCKED" as const,
      }],
    })).toThrow("rollback rehearsal PASS requires every uncertain operation to reconcile successfully");
  });

  it("rejects rollback evidence that targets the deployment being rolled back", () => {
    expect(() => validateRollbackRehearsalEvidence({
      ...rollback(),
      targetKnownGoodIdentity: rollback().fromDeploymentIdentity,
    })).toThrow("rollback target must differ from the deployment being rolled back");
  });

  it("rejects burn-in PASS before planned duration completes or with unresolved security/incidents", () => {
    expect(() => validateBurnInEvidence({ ...burnIn(), endedAtEpochMs: 109 })).toThrow(
      "burn-in PASS requires the planned duration to complete",
    );
    expect(() => validateBurnInEvidence({ ...burnIn(), securityFindings: ["security-1"] })).toThrow(
      "burn-in PASS requires zero unresolved security findings and incidents",
    );
    expect(() => validateBurnInEvidence({ ...burnIn(), incidents: ["incident-1"] })).toThrow(
      "burn-in PASS requires zero unresolved security findings and incidents",
    );
  });

  it("rejects burn-in PASS with failed, pending, or otherwise unsettled executions", () => {
    const message = "burn-in PASS requires every attempted execution to complete successfully with no failures or pending approvals";
    expect(() => validateBurnInEvidence({
      ...burnIn(),
      executionCounts: { attempted: 2, completed: 1, failed: 1, waitingApproval: 0 },
    })).toThrow(message);
    expect(() => validateBurnInEvidence({
      ...burnIn(),
      executionCounts: { attempted: 2, completed: 1, failed: 0, waitingApproval: 1 },
    })).toThrow(message);
    expect(() => validateBurnInEvidence({
      ...burnIn(),
      executionCounts: { attempted: 2, completed: 1, failed: 0, waitingApproval: 0 },
    })).toThrow(message);
  });

  it("preserves an in-progress burn-in only while it has no terminal timestamp", () => {
    const inProgress = validateBurnInEvidence({
      ...burnIn(),
      endedAtEpochMs: null,
      finalDisposition: "IN_PROGRESS" as const,
    });
    expect(inProgress.finalDisposition).toBe("IN_PROGRESS");

    expect(() => validateBurnInEvidence({
      ...burnIn(),
      finalDisposition: "IN_PROGRESS" as const,
    })).toThrow("IN_PROGRESS burn-in must not have endedAtEpochMs");
  });

  it("rejects impossible execution accounting and duplicate evidence identities", () => {
    expect(() => validateBurnInEvidence({
      ...burnIn(),
      executionCounts: { attempted: 1, completed: 1, failed: 1, waitingApproval: 0 },
    })).toThrow("burn-in execution outcomes cannot exceed attempted executions");

    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment(),
      immutableArtifactIdentities: ["artifact-1", "artifact-1"],
    })).toThrow("immutableArtifactIdentities must not contain duplicate evidence identities");
  });

  it("rejects an unknown deployment disposition supplied at runtime", () => {
    expect(() => validateDeploymentRehearsalEvidence({
      ...deployment(),
      result: "UNKNOWN",
      failureReason: "not a canonical disposition",
    } as never)).toThrow("deployment rehearsal result must be PASS, FAIL, or BLOCKED");
  });

  it("rejects unknown nested step and check dispositions", () => {
    const base = {
      ...deployment(),
      result: "FAIL" as const,
      failureReason: "expected test failure",
    };

    expect(() => validateDeploymentRehearsalEvidence({
      ...base,
      steps: [{ ...step, result: "UNKNOWN" }],
    } as never)).toThrow("steps[0].result must be PASS, FAIL, or BLOCKED");

    expect(() => validateDeploymentRehearsalEvidence({
      ...base,
      postDeployChecks: [{ ...check, result: "UNKNOWN" }],
    } as never)).toThrow("postDeployChecks[0].result must be PASS, FAIL, or BLOCKED");
  });

  it("rejects an unknown uncertain-operation reconciliation disposition", () => {
    expect(() => validateRollbackRehearsalEvidence({
      ...rollback(),
      uncertainOperations: [{
        ...rollback().uncertainOperations[0],
        reconciliationDisposition: "UNKNOWN",
      }],
      result: "FAIL",
      failureReason: "expected test failure",
    } as never)).toThrow("reconciliationDisposition must be PASS, FAIL, or BLOCKED");
  });

  it("rejects an unknown burn-in final disposition", () => {
    expect(() => validateBurnInEvidence({
      ...burnIn(),
      finalDisposition: "UNKNOWN",
    } as never)).toThrow("finalDisposition must be PASS, FAIL, or BLOCKED");
  });
});
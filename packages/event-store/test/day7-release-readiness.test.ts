import { describe, expect, it } from "vitest";
import {
  composeDay7ReleaseReadiness,
  type Day7ReleaseGateEvidence,
} from "../src/day7-release-readiness.js";
import type { Day7CandidateIdentity } from "../src/day7-operational-evidence.js";

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

const reorderedCandidate = (): Day7CandidateIdentity => ({
  deploymentIdentity: "deployment-1",
  configurationSchemaVersion: "config-1",
  dependencyLockDigest: "lock-1",
  operatorRunbookRevision: "runbook-1",
  verificationMatrixRevision: "matrix-1",
  workflowRunId: "run-1",
  candidateMergeSha: "candidate-merge",
  candidateHeadSha: "candidate-head",
  recordedAtEpochMs: 1,
});

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

const deployment = (candidateIdentity: Day7CandidateIdentity = candidate) => ({
  deploymentRehearsalId: "deploy-1",
  candidateIdentity,
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

const rollback = (candidateIdentity: Day7CandidateIdentity = candidate) => ({
  rollbackRehearsalId: "rollback-1",
  candidateIdentity,
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

const burnIn = (candidateIdentity: Day7CandidateIdentity = candidate) => ({
  burnInId: "burn-1",
  candidateIdentity,
  plannedDurationMs: 100,
  startedAtEpochMs: 10,
  endedAtEpochMs: 110,
  executionCounts: { attempted: 1, completed: 1, failed: 0, waitingApproval: 0 },
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

const passGate: Day7ReleaseGateEvidence = {
  gateId: "security",
  disposition: "PASS",
  evidenceIds: ["security-evidence-1"],
  blockerReason: null,
};

describe("Day-7 release readiness composition", () => {
  it("accepts semantically identical candidate identities regardless of property insertion order", () => {
    const result = composeDay7ReleaseReadiness({
      candidateIdentity: candidate,
      deployment: deployment(reorderedCandidate()),
      rollback: rollback(reorderedCandidate()),
      burnIn: burnIn(reorderedCandidate()),
      independentGates: [passGate],
    });

    expect(result.disposition).toBe("PASS");
    expect(result.blockingGateIds).toEqual([]);
  });

  it("rejects a genuinely substituted candidate identity", () => {
    expect(() => composeDay7ReleaseReadiness({
      candidateIdentity: candidate,
      deployment: deployment({ ...candidate, candidateHeadSha: "other-head" }),
      rollback: rollback(),
      burnIn: burnIn(),
      independentGates: [passGate],
    })).toThrow("deployment must be bound to the exact release candidate identity");
  });

  it("aggregates operational and independent blockers without converting them to PASS", () => {
    const result = composeDay7ReleaseReadiness({
      candidateIdentity: candidate,
      deployment: {
        ...deployment(),
        result: "BLOCKED" as const,
        failureReason: "deployment approval pending",
      },
      rollback: rollback(),
      burnIn: {
        ...burnIn(),
        endedAtEpochMs: null,
        finalDisposition: "IN_PROGRESS" as const,
      },
      independentGates: [
        passGate,
        {
          gateId: "durable-artifact-storage",
          disposition: "BLOCKED",
          evidenceIds: ["artifact-gate-evidence-1"],
          blockerReason: "external durability not proven",
        },
      ],
    });

    expect(result.disposition).toBe("BLOCKED");
    expect(result.blockingGateIds).toEqual([
      "deployment",
      "burn-in",
      "durable-artifact-storage",
    ]);
  });

  it("fails closed on duplicate gate identities and invalid runtime dispositions", () => {
    expect(() => composeDay7ReleaseReadiness({
      candidateIdentity: candidate,
      deployment: deployment(),
      rollback: rollback(),
      burnIn: burnIn(),
      independentGates: [passGate, { ...passGate, evidenceIds: ["security-evidence-2"] }],
    })).toThrow("independent gate identifiers must be unique");

    expect(() => composeDay7ReleaseReadiness({
      candidateIdentity: candidate,
      deployment: deployment(),
      rollback: rollback(),
      burnIn: burnIn(),
      independentGates: [{
        ...passGate,
        disposition: "UNKNOWN",
      } as never],
    })).toThrow("disposition must be PASS or BLOCKED");
  });
});

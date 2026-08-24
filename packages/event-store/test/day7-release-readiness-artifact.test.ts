import { describe, expect, it } from "vitest";
import { DAY7_REQUIRED_RELEASE_GATE_IDS } from "../src/day7-release-gate-catalog.js";
import { Day7ReleaseReadinessArtifactRepository } from "../src/day7-release-readiness-artifact.js";
import { InMemoryExecutionReleaseArtifactStorage, type ExecutionReleaseArtifactStorage } from "../src/execution-release-artifact-store.js";
import type { Day7ReleaseReadinessInput } from "../src/day7-release-readiness.js";
import type { Day7CandidateIdentity } from "../src/day7-operational-evidence.js";

const candidate: Day7CandidateIdentity = { candidateHeadSha: "candidate-head", candidateMergeSha: "candidate-merge", workflowRunId: "run-1", verificationMatrixRevision: "matrix-1", operatorRunbookRevision: "runbook-1", dependencyLockDigest: "lock-1", configurationSchemaVersion: "config-1", deploymentIdentity: "deployment-1", recordedAtEpochMs: 1 };
const step = { stepId: "step-1", startedAtEpochMs: 1, completedAtEpochMs: 2, result: "PASS" as const, evidenceId: "step-evidence-1" };
const rollbackStep = { ...step, stepId: "rollback-step-1", startedAtEpochMs: 3, completedAtEpochMs: 4, evidenceId: "rollback-step-evidence-1" };
const check = { checkId: "check-1", expectedCondition: "healthy", observedCondition: "healthy", result: "PASS" as const, evidenceId: "check-evidence-1" };
const rollbackCheck = { ...check, checkId: "rollback-check-1", evidenceId: "rollback-check-evidence-1" };
const input = (): Day7ReleaseReadinessInput => ({
  candidateIdentity: candidate,
  deployment: { deploymentRehearsalId: "deploy-1", candidateIdentity: candidate, immutableArtifactIdentities: ["artifact-1"], environmentClass: "release-candidate", configurationDigest: "config-digest", migrationPrerequisiteEvidence: ["migration-1"], startedAtEpochMs: 1, completedAtEpochMs: 2, steps: [step], postDeployChecks: [check], releaseEvidenceArtifactId: "release-1", result: "PASS", failureReason: null },
  rollback: { rollbackRehearsalId: "rollback-1", candidateIdentity: candidate, fromDeploymentIdentity: "deployment-1", targetKnownGoodIdentity: "deployment-0", compatibilityEvidence: ["compat-1"], preservedAuthorityEvidence: ["authority-1"], startedAtEpochMs: 3, completedAtEpochMs: 4, steps: [rollbackStep], postRollbackChecks: [rollbackCheck], uncertainOperations: [{ operationId: "operation-1", uncertaintySource: "ack-loss", authoritativeReadbackId: "readback-1", reconciliationDisposition: "PASS", evidenceId: "operation-evidence-1" }], result: "PASS", failureReason: null },
  burnIn: { burnInId: "burn-1", candidateIdentity: candidate, plannedDurationMs: 100, startedAtEpochMs: 10, endedAtEpochMs: 110, executionCounts: { attempted: 1, completed: 1, failed: 0, waitingApproval: 0 }, approvalOutcomes: ["approval-1"], injectedFailures: ["failure-1"], ownershipEvents: ["ownership-1"], persistenceUncertaintyEvents: ["persistence-1"], telemetryFailures: [], securityFindings: [], regressionEvidence: ["regression-1"], traceCompletenessEvidence: ["trace-1"], incidents: [], finalDisposition: "PASS" },
  independentGates: DAY7_REQUIRED_RELEASE_GATE_IDS.map((gateId) => ({ gateId, candidateIdentity: candidate, disposition: "PASS", evidenceIds: [`${gateId}-evidence`], blockerReason: null })),
});

describe("Day-7 release readiness artifact repository", () => {
  it("composes, persists, and restores exact candidate-bound readiness evidence", () => {
    const repository = new Day7ReleaseReadinessArtifactRepository(new InMemoryExecutionReleaseArtifactStorage());
    const evidence = repository.composeAndSave("readiness-1", input());
    expect(evidence.disposition).toBe("PASS");
    expect(repository.load("readiness-1")).toEqual(evidence);
  });

  it("fails closed when acknowledgement does not expose exact bytes", () => {
    const storage: ExecutionReleaseArtifactStorage = { put: () => true, get: () => "{}" };
    const repository = new Day7ReleaseReadinessArtifactRepository(storage);
    expect(() => repository.composeAndSave("readiness-1", input())).toThrow("did not expose the exact candidate-bound evidence");
  });

  it("reconciles acknowledgement uncertainty by readback without rewriting", () => {
    const backing = new InMemoryExecutionReleaseArtifactStorage();
    const repository = new Day7ReleaseReadinessArtifactRepository(backing);
    const evidence = repository.composeAndSave("readiness-1", input());
    let writes = 0;
    const uncertainStorage: ExecutionReleaseArtifactStorage = { put: () => { writes += 1; return false; }, get: (artifactId) => backing.get(artifactId) };
    const uncertainRepository = new Day7ReleaseReadinessArtifactRepository(uncertainStorage);
    expect(uncertainRepository.reconcile("readiness-1", evidence)).toBe(backing.get("readiness-1"));
    expect(writes).toBe(0);
  });

  it("rejects substituted or noncanonical authoritative readiness bytes", () => {
    const backing = new InMemoryExecutionReleaseArtifactStorage();
    const repository = new Day7ReleaseReadinessArtifactRepository(backing);
    repository.composeAndSave("readiness-1", input());
    const original = backing.get("readiness-1")!;
    const parsed = JSON.parse(original) as Record<string, unknown>;
    const candidateIdentity = parsed.candidateIdentity as Record<string, unknown>;
    backing.put("readiness-1", JSON.stringify({ ...parsed, candidateIdentity: { ...candidateIdentity, candidateHeadSha: "stale-head" } }));
    expect(() => repository.load("readiness-1")).toThrow();
  });
});

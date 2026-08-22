import { describe, expect, it } from "vitest";
import { DAY7_REQUIRED_RELEASE_GATE_IDS } from "../src/day7-release-gate-catalog.js";
import { composeDay7ReleaseReadiness, type Day7ReleaseGateEvidence } from "../src/day7-release-readiness.js";
import type { Day7CandidateIdentity } from "../src/day7-operational-evidence.js";

const candidate: Day7CandidateIdentity = { candidateHeadSha: "candidate-head", candidateMergeSha: "candidate-merge", workflowRunId: "run-1", verificationMatrixRevision: "matrix-1", operatorRunbookRevision: "runbook-1", dependencyLockDigest: "lock-1", configurationSchemaVersion: "config-1", deploymentIdentity: "deployment-1", recordedAtEpochMs: 1 };
const reorderedCandidate = (): Day7CandidateIdentity => ({ deploymentIdentity: "deployment-1", configurationSchemaVersion: "config-1", dependencyLockDigest: "lock-1", operatorRunbookRevision: "runbook-1", verificationMatrixRevision: "matrix-1", workflowRunId: "run-1", candidateMergeSha: "candidate-merge", candidateHeadSha: "candidate-head", recordedAtEpochMs: 1 });
const step = { stepId: "step-1", startedAtEpochMs: 1, completedAtEpochMs: 2, result: "PASS" as const, evidenceId: "step-evidence-1" };
const check = { checkId: "check-1", expectedCondition: "healthy", observedCondition: "healthy", result: "PASS" as const, evidenceId: "check-evidence-1" };
const deployment = (candidateIdentity: Day7CandidateIdentity = candidate) => ({ deploymentRehearsalId: "deploy-1", candidateIdentity, immutableArtifactIdentities: ["artifact-1"], environmentClass: "release-candidate", configurationDigest: "config-digest", migrationPrerequisiteEvidence: ["migration-1"], startedAtEpochMs: 1, completedAtEpochMs: 2, steps: [step], postDeployChecks: [check], releaseEvidenceArtifactId: "release-1", result: "PASS" as const, failureReason: null });
const rollback = (candidateIdentity: Day7CandidateIdentity = candidate) => ({ rollbackRehearsalId: "rollback-1", candidateIdentity, fromDeploymentIdentity: "deployment-1", targetKnownGoodIdentity: "deployment-0", compatibilityEvidence: ["compat-1"], preservedAuthorityEvidence: ["authority-1"], startedAtEpochMs: 3, completedAtEpochMs: 4, steps: [step], postRollbackChecks: [check], uncertainOperations: [{ operationId: "operation-1", uncertaintySource: "acknowledgement-loss", authoritativeReadbackId: "readback-1", reconciliationDisposition: "PASS" as const, evidenceId: "operation-evidence-1" }], result: "PASS" as const, failureReason: null });
const burnIn = (candidateIdentity: Day7CandidateIdentity = candidate) => ({ burnInId: "burn-1", candidateIdentity, plannedDurationMs: 100, startedAtEpochMs: 10, endedAtEpochMs: 110, executionCounts: { attempted: 1, completed: 1, failed: 0, waitingApproval: 0 }, approvalOutcomes: ["approval-1"], injectedFailures: ["failure-injection-1"], ownershipEvents: ["ownership-1"], persistenceUncertaintyEvents: ["persistence-1"], telemetryFailures: [], securityFindings: [], regressionEvidence: ["regression-1"], traceCompletenessEvidence: ["trace-1"], incidents: [], finalDisposition: "PASS" as const });
const gates = (): Day7ReleaseGateEvidence[] => DAY7_REQUIRED_RELEASE_GATE_IDS.map((gateId) => ({ gateId, disposition: "PASS", evidenceIds: [`${gateId}-evidence-1`], blockerReason: null }));

describe("Day-7 release readiness composition", () => {
  it("accepts a complete PASS catalog and property-order-independent candidate identity", () => {
    const result = composeDay7ReleaseReadiness({ candidateIdentity: candidate, deployment: deployment(reorderedCandidate()), rollback: rollback(reorderedCandidate()), burnIn: burnIn(reorderedCandidate()), independentGates: gates() });
    expect(result.disposition).toBe("PASS");
    expect(result.blockingGateIds).toEqual([]);
    expect(result.independentGates.map((gate) => gate.gateId)).toEqual(DAY7_REQUIRED_RELEASE_GATE_IDS);
  });

  it("rejects a genuinely substituted candidate identity", () => {
    expect(() => composeDay7ReleaseReadiness({ candidateIdentity: candidate, deployment: deployment({ ...candidate, candidateHeadSha: "other-head" }), rollback: rollback(), burnIn: burnIn(), independentGates: gates() })).toThrow("deployment must be bound to the exact release candidate identity");
  });

  it("aggregates operational and required independent blockers without converting them to PASS", () => {
    const independentGates = gates().map((gate) => gate.gateId === "external-artifact-durability" ? { ...gate, disposition: "BLOCKED" as const, blockerReason: "external durability not proven" } : gate);
    const result = composeDay7ReleaseReadiness({ candidateIdentity: candidate, deployment: { ...deployment(), result: "BLOCKED" as const, failureReason: "deployment approval pending" }, rollback: rollback(), burnIn: { ...burnIn(), endedAtEpochMs: null, finalDisposition: "IN_PROGRESS" as const }, independentGates });
    expect(result.disposition).toBe("BLOCKED");
    expect(result.blockingGateIds).toEqual(["deployment", "burn-in", "external-artifact-durability"]);
  });

  it("fails closed when a required release gate is omitted", () => {
    const incomplete = gates().filter((gate) => gate.gateId !== "browser-runtime");
    expect(() => composeDay7ReleaseReadiness({ candidateIdentity: candidate, deployment: deployment(), rollback: rollback(), burnIn: burnIn(), independentGates: incomplete })).toThrow("missing required Day-7 release gates: browser-runtime");
  });

  it("fails closed when operator-runbook evidence is omitted", () => {
    const incomplete = gates().filter((gate) => gate.gateId !== "operator-runbook");
    expect(() => composeDay7ReleaseReadiness({ candidateIdentity: candidate, deployment: deployment(), rollback: rollback(), burnIn: burnIn(), independentGates: incomplete })).toThrow("missing required Day-7 release gates: operator-runbook");
  });

  it("fails closed on unknown or duplicate release gate identities", () => {
    expect(() => composeDay7ReleaseReadiness({ candidateIdentity: candidate, deployment: deployment(), rollback: rollback(), burnIn: burnIn(), independentGates: [...gates(), { gateId: "unknown-gate", disposition: "PASS", evidenceIds: ["unknown-1"], blockerReason: null }] })).toThrow("unknown Day-7 release gates: unknown-gate");
    expect(() => composeDay7ReleaseReadiness({ candidateIdentity: candidate, deployment: deployment(), rollback: rollback(), burnIn: burnIn(), independentGates: [...gates(), gates()[0]!] })).toThrow("Day-7 release gate identifiers must be unique");
  });

  it("fails closed on invalid runtime dispositions", () => {
    const invalidGates = gates();
    invalidGates[0] = { ...invalidGates[0]!, disposition: "UNKNOWN" } as never;
    expect(() => composeDay7ReleaseReadiness({ candidateIdentity: candidate, deployment: deployment(), rollback: rollback(), burnIn: burnIn(), independentGates: invalidGates })).toThrow("disposition must be PASS or BLOCKED");
  });
});

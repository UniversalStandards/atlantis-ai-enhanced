import { describe, expect, it } from "vitest";
import {
  InvalidDay7RehearsalEvidenceError,
  validateDay7BurnInEvidence,
  validateDay7RehearsalEvidence,
} from "../src/day7-rehearsal-evidence.js";

const identity = {
  candidateHeadSha: "a".repeat(40), candidateMergeSha: null, workflowRunId: "33229182285",
  verificationMatrixRevision: "matrix-rev-1", operatorRunbookRevision: "runbook-rev-1",
  dependencyLockDigest: "b".repeat(64), configurationSchemaVersion: "1",
  deploymentIdentity: "non-production-rehearsal-1", recordedAtEpochMs: 1_800_000_000_000,
};

const evidence = {
  rehearsalId: "deploy-rehearsal-1", kind: "deployment" as const, candidateIdentity: identity,
  startedAtEpochMs: 1_800_000_000_100, completedAtEpochMs: 1_800_000_000_200,
  evidenceIdentities: ["artifact:release-1", "check:health-1"], result: "PASS" as const, failureReason: null,
};

const burnIn = {
  burnInId: "burnin-1", candidateIdentity: identity, plannedDurationMs: 60_000,
  startedAtEpochMs: 1_800_000_100_000, endedAtEpochMs: 1_800_000_160_000,
  executionCounts: { attempted: 4, completed: 4, failed: 0, waitingApproval: 0 },
  approvalOutcomes: ["approval:1"], injectedFailures: ["failure:restart:1"], ownershipEvents: ["ownership:1"],
  persistenceUncertaintyEvents: ["uncertainty:1"], telemetryFailures: [], securityFindings: [],
  regressionEvidence: ["regression:1"], traceCompletenessEvidence: ["trace:1"], incidents: [],
  finalDisposition: "PASS" as const,
};

describe("Day-7 rehearsal evidence", () => {
  it("accepts exact candidate-bound PASS evidence", () => {
    expect(validateDay7RehearsalEvidence(evidence)).toMatchObject({ rehearsalId: "deploy-rehearsal-1", result: "PASS", candidateIdentity: { candidateHeadSha: "a".repeat(40) } });
  });
  it.each([
    ["unknown authority-bearing fields", { ...evidence, credential: "secret" }],
    ["noncanonical candidate SHA", { ...evidence, candidateIdentity: { ...identity, candidateHeadSha: "HEAD" } }],
    ["noncanonical lock digest", { ...evidence, candidateIdentity: { ...identity, dependencyLockDigest: "sha256:abc" } }],
    ["time reversal", { ...evidence, completedAtEpochMs: evidence.startedAtEpochMs - 1 }],
    ["PASS with failure reason", { ...evidence, failureReason: "ignored failure" }],
    ["BLOCKED without reason", { ...evidence, result: "BLOCKED", failureReason: null }],
    ["missing evidence identities", { ...evidence, evidenceIdentities: [] }],
  ])("fails closed for %s", (_name, candidate) => expect(() => validateDay7RehearsalEvidence(candidate)).toThrow(InvalidDay7RehearsalEvidenceError));

  it("accepts candidate-bound burn-in evidence after the planned duration", () => {
    expect(validateDay7BurnInEvidence(burnIn)).toMatchObject({ burnInId: "burnin-1", finalDisposition: "PASS", executionCounts: { attempted: 4, completed: 4 } });
  });

  it.each([
    ["unknown fields", { ...burnIn, token: "secret" }],
    ["zero planned duration", { ...burnIn, plannedDurationMs: 0 }],
    ["shortened PASS duration", { ...burnIn, endedAtEpochMs: burnIn.startedAtEpochMs + 59_999 }],
    ["terminal record without end", { ...burnIn, endedAtEpochMs: null }],
    ["in-progress record with end", { ...burnIn, finalDisposition: "IN_PROGRESS" }],
    ["impossible execution counts", { ...burnIn, executionCounts: { attempted: 1, completed: 1, failed: 1, waitingApproval: 0 } }],
    ["unknown count field", { ...burnIn, executionCounts: { ...burnIn.executionCounts, skipped: 1 } }],
    ["non-evidence array value", { ...burnIn, incidents: [null] }],
    ["vacuous PASS", { ...burnIn, executionCounts: { attempted: 0, completed: 0, failed: 0, waitingApproval: 0 } }],
    ["PASS with failed execution", { ...burnIn, executionCounts: { attempted: 4, completed: 3, failed: 1, waitingApproval: 0 } }],
    ["PASS with pending approval", { ...burnIn, executionCounts: { attempted: 4, completed: 3, failed: 0, waitingApproval: 1 } }],
    ["PASS without approval evidence", { ...burnIn, approvalOutcomes: [] }],
    ["PASS without injected failure evidence", { ...burnIn, injectedFailures: [] }],
    ["PASS without ownership evidence", { ...burnIn, ownershipEvents: [] }],
    ["PASS without persistence reconciliation evidence", { ...burnIn, persistenceUncertaintyEvents: [] }],
    ["PASS with unresolved security finding", { ...burnIn, securityFindings: ["security:critical:1"] }],
    ["PASS with unresolved incident", { ...burnIn, incidents: ["incident:1"] }],
    ["missing regression evidence", { ...burnIn, regressionEvidence: [] }],
    ["missing trace completeness evidence", { ...burnIn, traceCompletenessEvidence: [] }],
  ])("fails closed for burn-in %s", (_name, candidate) => expect(() => validateDay7BurnInEvidence(candidate)).toThrow(InvalidDay7RehearsalEvidenceError));
});

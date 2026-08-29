import { describe, expect, it } from "vitest";
import {
  InvalidDay7RehearsalEvidenceError,
  validateDay7RehearsalEvidence,
} from "../src/day7-rehearsal-evidence.js";

const identity = {
  candidateHeadSha: "a".repeat(40),
  candidateMergeSha: null,
  workflowRunId: "33229182285",
  verificationMatrixRevision: "matrix-rev-1",
  operatorRunbookRevision: "runbook-rev-1",
  dependencyLockDigest: "b".repeat(64),
  configurationSchemaVersion: "1",
  deploymentIdentity: "non-production-rehearsal-1",
  recordedAtEpochMs: 1_800_000_000_000,
};

const evidence = {
  rehearsalId: "deploy-rehearsal-1",
  kind: "deployment" as const,
  candidateIdentity: identity,
  startedAtEpochMs: 1_800_000_000_100,
  completedAtEpochMs: 1_800_000_000_200,
  evidenceIdentities: ["artifact:release-1", "check:health-1"],
  result: "PASS" as const,
  failureReason: null,
};

describe("Day-7 rehearsal evidence", () => {
  it("accepts exact candidate-bound PASS evidence", () => {
    expect(validateDay7RehearsalEvidence(evidence)).toMatchObject({
      rehearsalId: "deploy-rehearsal-1",
      result: "PASS",
      candidateIdentity: { candidateHeadSha: "a".repeat(40) },
    });
  });

  it.each([
    ["unknown authority-bearing fields", { ...evidence, credential: "secret" }],
    ["noncanonical candidate SHA", { ...evidence, candidateIdentity: { ...identity, candidateHeadSha: "HEAD" } }],
    ["noncanonical lock digest", { ...evidence, candidateIdentity: { ...identity, dependencyLockDigest: "sha256:abc" } }],
    ["time reversal", { ...evidence, completedAtEpochMs: evidence.startedAtEpochMs - 1 }],
    ["PASS with failure reason", { ...evidence, failureReason: "ignored failure" }],
    ["BLOCKED without reason", { ...evidence, result: "BLOCKED", failureReason: null }],
    ["missing evidence identities", { ...evidence, evidenceIdentities: [] }],
  ])("fails closed for %s", (_name, candidate) => {
    expect(() => validateDay7RehearsalEvidence(candidate)).toThrow(InvalidDay7RehearsalEvidenceError);
  });
});

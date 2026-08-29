import {
  InvalidExactDataRecordError,
  normalizeExactDataRecord,
  requireExactDataFields,
} from "./exact-data-record.js";

export type Day7RehearsalResult = "PASS" | "FAIL" | "BLOCKED";

export interface Day7CandidateIdentity {
  readonly candidateHeadSha: string;
  readonly candidateMergeSha: string | null;
  readonly workflowRunId: string;
  readonly verificationMatrixRevision: string;
  readonly operatorRunbookRevision: string;
  readonly dependencyLockDigest: string;
  readonly configurationSchemaVersion: string;
  readonly deploymentIdentity: string;
  readonly recordedAtEpochMs: number;
}

export interface Day7RehearsalEvidence {
  readonly rehearsalId: string;
  readonly kind: "deployment" | "rollback";
  readonly candidateIdentity: Day7CandidateIdentity;
  readonly startedAtEpochMs: number;
  readonly completedAtEpochMs: number;
  readonly evidenceIdentities: readonly string[];
  readonly result: Day7RehearsalResult;
  readonly failureReason: string | null;
}

export class InvalidDay7RehearsalEvidenceError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidDay7RehearsalEvidenceError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40,64}$/;

function requireString(subject: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidDay7RehearsalEvidenceError(`${subject} must be a non-empty string`);
  }
  return value;
}

function requireEpoch(subject: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InvalidDay7RehearsalEvidenceError(`${subject} must be a non-negative safe integer`);
  }
  return value as number;
}

export function validateDay7CandidateIdentity(value: unknown): Day7CandidateIdentity {
  let record;
  try {
    record = normalizeExactDataRecord("candidateIdentity", value, [
      "candidateHeadSha", "candidateMergeSha", "workflowRunId",
      "verificationMatrixRevision", "operatorRunbookRevision", "dependencyLockDigest",
      "configurationSchemaVersion", "deploymentIdentity", "recordedAtEpochMs",
    ]);
    requireExactDataFields("candidateIdentity", record, [
      "candidateHeadSha", "candidateMergeSha", "workflowRunId",
      "verificationMatrixRevision", "operatorRunbookRevision", "dependencyLockDigest",
      "configurationSchemaVersion", "deploymentIdentity", "recordedAtEpochMs",
    ]);
  } catch (error) {
    if (error instanceof InvalidExactDataRecordError) {
      throw new InvalidDay7RehearsalEvidenceError(error.message);
    }
    throw error;
  }

  const candidateHeadSha = requireString("candidateIdentity.candidateHeadSha", record.candidateHeadSha);
  if (!GIT_SHA.test(candidateHeadSha)) throw new InvalidDay7RehearsalEvidenceError("candidateIdentity.candidateHeadSha must be a canonical lowercase Git SHA");
  const candidateMergeSha = record.candidateMergeSha;
  if (candidateMergeSha !== null && (typeof candidateMergeSha !== "string" || !GIT_SHA.test(candidateMergeSha))) {
    throw new InvalidDay7RehearsalEvidenceError("candidateIdentity.candidateMergeSha must be null or a canonical lowercase Git SHA");
  }
  const dependencyLockDigest = requireString("candidateIdentity.dependencyLockDigest", record.dependencyLockDigest);
  if (!SHA256.test(dependencyLockDigest)) throw new InvalidDay7RehearsalEvidenceError("candidateIdentity.dependencyLockDigest must be a lowercase SHA-256 digest");

  return Object.freeze({
    candidateHeadSha,
    candidateMergeSha,
    workflowRunId: requireString("candidateIdentity.workflowRunId", record.workflowRunId),
    verificationMatrixRevision: requireString("candidateIdentity.verificationMatrixRevision", record.verificationMatrixRevision),
    operatorRunbookRevision: requireString("candidateIdentity.operatorRunbookRevision", record.operatorRunbookRevision),
    dependencyLockDigest,
    configurationSchemaVersion: requireString("candidateIdentity.configurationSchemaVersion", record.configurationSchemaVersion),
    deploymentIdentity: requireString("candidateIdentity.deploymentIdentity", record.deploymentIdentity),
    recordedAtEpochMs: requireEpoch("candidateIdentity.recordedAtEpochMs", record.recordedAtEpochMs),
  });
}

export function validateDay7RehearsalEvidence(value: unknown): Day7RehearsalEvidence {
  let record;
  try {
    record = normalizeExactDataRecord("rehearsalEvidence", value, [
      "rehearsalId", "kind", "candidateIdentity", "startedAtEpochMs", "completedAtEpochMs",
      "evidenceIdentities", "result", "failureReason",
    ]);
    requireExactDataFields("rehearsalEvidence", record, [
      "rehearsalId", "kind", "candidateIdentity", "startedAtEpochMs", "completedAtEpochMs",
      "evidenceIdentities", "result", "failureReason",
    ]);
  } catch (error) {
    if (error instanceof InvalidExactDataRecordError) throw new InvalidDay7RehearsalEvidenceError(error.message);
    throw error;
  }

  if (record.kind !== "deployment" && record.kind !== "rollback") throw new InvalidDay7RehearsalEvidenceError("rehearsalEvidence.kind is invalid");
  if (record.result !== "PASS" && record.result !== "FAIL" && record.result !== "BLOCKED") throw new InvalidDay7RehearsalEvidenceError("rehearsalEvidence.result is invalid");
  const startedAtEpochMs = requireEpoch("rehearsalEvidence.startedAtEpochMs", record.startedAtEpochMs);
  const completedAtEpochMs = requireEpoch("rehearsalEvidence.completedAtEpochMs", record.completedAtEpochMs);
  if (completedAtEpochMs < startedAtEpochMs) throw new InvalidDay7RehearsalEvidenceError("rehearsalEvidence completion precedes start");
  if (!Array.isArray(record.evidenceIdentities) || record.evidenceIdentities.length === 0 || record.evidenceIdentities.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new InvalidDay7RehearsalEvidenceError("rehearsalEvidence.evidenceIdentities must contain non-empty evidence identities");
  }
  let failureReason: string | null;
  if (record.result === "PASS") {
    if (record.failureReason !== null) throw new InvalidDay7RehearsalEvidenceError("PASS rehearsal evidence must not contain failureReason");
    failureReason = null;
  } else {
    failureReason = requireString("rehearsalEvidence.failureReason", record.failureReason);
  }

  return Object.freeze({
    rehearsalId: requireString("rehearsalEvidence.rehearsalId", record.rehearsalId),
    kind: record.kind,
    candidateIdentity: validateDay7CandidateIdentity(record.candidateIdentity),
    startedAtEpochMs,
    completedAtEpochMs,
    evidenceIdentities: Object.freeze([...record.evidenceIdentities]) as readonly string[],
    result: record.result,
    failureReason,
  });
}

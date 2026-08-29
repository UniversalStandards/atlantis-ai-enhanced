import {
  InvalidExactDataRecordError,
  normalizeExactDataRecord,
  requireExactDataFields,
} from "./exact-data-record.js";

export type Day7RehearsalResult = "PASS" | "FAIL" | "BLOCKED";
export type Day7BurnInDisposition = Day7RehearsalResult | "IN_PROGRESS";

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

export interface Day7BurnInEvidence {
  readonly burnInId: string;
  readonly candidateIdentity: Day7CandidateIdentity;
  readonly plannedDurationMs: number;
  readonly startedAtEpochMs: number;
  readonly endedAtEpochMs: number | null;
  readonly executionCounts: Readonly<{ attempted: number; completed: number; failed: number; waitingApproval: number }>;
  readonly approvalOutcomes: readonly string[];
  readonly injectedFailures: readonly string[];
  readonly ownershipEvents: readonly string[];
  readonly persistenceUncertaintyEvents: readonly string[];
  readonly telemetryFailures: readonly string[];
  readonly securityFindings: readonly string[];
  readonly regressionEvidence: readonly string[];
  readonly traceCompletenessEvidence: readonly string[];
  readonly incidents: readonly string[];
  readonly finalDisposition: Day7BurnInDisposition;
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
  if (typeof value !== "string" || value.trim() === "") throw new InvalidDay7RehearsalEvidenceError(`${subject} must be a non-empty string`);
  return value;
}

function requireEpoch(subject: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new InvalidDay7RehearsalEvidenceError(`${subject} must be a non-negative safe integer`);
  return value as number;
}

function requireStringArray(subject: string, value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new InvalidDay7RehearsalEvidenceError(`${subject} must contain only non-empty evidence identities`);
  }
  if (new Set(value).size !== value.length) {
    throw new InvalidDay7RehearsalEvidenceError(`${subject} must not contain duplicate evidence identities`);
  }
  return Object.freeze([...value]) as readonly string[];
}

export function validateDay7CandidateIdentity(value: unknown): Day7CandidateIdentity {
  let record;
  try {
    record = normalizeExactDataRecord("candidateIdentity", value, ["candidateHeadSha", "candidateMergeSha", "workflowRunId", "verificationMatrixRevision", "operatorRunbookRevision", "dependencyLockDigest", "configurationSchemaVersion", "deploymentIdentity", "recordedAtEpochMs"]);
    requireExactDataFields("candidateIdentity", record, ["candidateHeadSha", "candidateMergeSha", "workflowRunId", "verificationMatrixRevision", "operatorRunbookRevision", "dependencyLockDigest", "configurationSchemaVersion", "deploymentIdentity", "recordedAtEpochMs"]);
  } catch (error) {
    if (error instanceof InvalidExactDataRecordError) throw new InvalidDay7RehearsalEvidenceError(error.message);
    throw error;
  }
  const candidateHeadSha = requireString("candidateIdentity.candidateHeadSha", record.candidateHeadSha);
  if (!GIT_SHA.test(candidateHeadSha)) throw new InvalidDay7RehearsalEvidenceError("candidateIdentity.candidateHeadSha must be a canonical lowercase Git SHA");
  const candidateMergeSha = record.candidateMergeSha;
  if (candidateMergeSha !== null && (typeof candidateMergeSha !== "string" || !GIT_SHA.test(candidateMergeSha))) throw new InvalidDay7RehearsalEvidenceError("candidateIdentity.candidateMergeSha must be null or a canonical lowercase Git SHA");
  const dependencyLockDigest = requireString("candidateIdentity.dependencyLockDigest", record.dependencyLockDigest);
  if (!SHA256.test(dependencyLockDigest)) throw new InvalidDay7RehearsalEvidenceError("candidateIdentity.dependencyLockDigest must be a lowercase SHA-256 digest");
  return Object.freeze({ candidateHeadSha, candidateMergeSha, workflowRunId: requireString("candidateIdentity.workflowRunId", record.workflowRunId), verificationMatrixRevision: requireString("candidateIdentity.verificationMatrixRevision", record.verificationMatrixRevision), operatorRunbookRevision: requireString("candidateIdentity.operatorRunbookRevision", record.operatorRunbookRevision), dependencyLockDigest, configurationSchemaVersion: requireString("candidateIdentity.configurationSchemaVersion", record.configurationSchemaVersion), deploymentIdentity: requireString("candidateIdentity.deploymentIdentity", record.deploymentIdentity), recordedAtEpochMs: requireEpoch("candidateIdentity.recordedAtEpochMs", record.recordedAtEpochMs) });
}

export function validateDay7RehearsalEvidence(value: unknown): Day7RehearsalEvidence {
  let record;
  try {
    record = normalizeExactDataRecord("rehearsalEvidence", value, ["rehearsalId", "kind", "candidateIdentity", "startedAtEpochMs", "completedAtEpochMs", "evidenceIdentities", "result", "failureReason"]);
    requireExactDataFields("rehearsalEvidence", record, ["rehearsalId", "kind", "candidateIdentity", "startedAtEpochMs", "completedAtEpochMs", "evidenceIdentities", "result", "failureReason"]);
  } catch (error) {
    if (error instanceof InvalidExactDataRecordError) throw new InvalidDay7RehearsalEvidenceError(error.message);
    throw error;
  }
  if (record.kind !== "deployment" && record.kind !== "rollback") throw new InvalidDay7RehearsalEvidenceError("rehearsalEvidence.kind is invalid");
  if (record.result !== "PASS" && record.result !== "FAIL" && record.result !== "BLOCKED") throw new InvalidDay7RehearsalEvidenceError("rehearsalEvidence.result is invalid");
  const candidateIdentity = validateDay7CandidateIdentity(record.candidateIdentity);
  const startedAtEpochMs = requireEpoch("rehearsalEvidence.startedAtEpochMs", record.startedAtEpochMs);
  const completedAtEpochMs = requireEpoch("rehearsalEvidence.completedAtEpochMs", record.completedAtEpochMs);
  if (candidateIdentity.recordedAtEpochMs > startedAtEpochMs) throw new InvalidDay7RehearsalEvidenceError("rehearsalEvidence candidate identity must be recorded before execution starts");
  if (completedAtEpochMs < startedAtEpochMs) throw new InvalidDay7RehearsalEvidenceError("rehearsalEvidence completion precedes start");
  const evidenceIdentities = requireStringArray("rehearsalEvidence.evidenceIdentities", record.evidenceIdentities);
  if (evidenceIdentities.length === 0) throw new InvalidDay7RehearsalEvidenceError("rehearsalEvidence.evidenceIdentities must contain non-empty evidence identities");
  let failureReason: string | null;
  if (record.result === "PASS") {
    if (record.failureReason !== null) throw new InvalidDay7RehearsalEvidenceError("PASS rehearsal evidence must not contain failureReason");
    failureReason = null;
  } else failureReason = requireString("rehearsalEvidence.failureReason", record.failureReason);
  return Object.freeze({ rehearsalId: requireString("rehearsalEvidence.rehearsalId", record.rehearsalId), kind: record.kind, candidateIdentity, startedAtEpochMs, completedAtEpochMs, evidenceIdentities, result: record.result, failureReason });
}

export function validateDay7BurnInEvidence(value: unknown): Day7BurnInEvidence {
  const fields = ["burnInId", "candidateIdentity", "plannedDurationMs", "startedAtEpochMs", "endedAtEpochMs", "executionCounts", "approvalOutcomes", "injectedFailures", "ownershipEvents", "persistenceUncertaintyEvents", "telemetryFailures", "securityFindings", "regressionEvidence", "traceCompletenessEvidence", "incidents", "finalDisposition"];
  let record;
  try {
    record = normalizeExactDataRecord("burnInEvidence", value, fields);
    requireExactDataFields("burnInEvidence", record, fields);
  } catch (error) {
    if (error instanceof InvalidExactDataRecordError) throw new InvalidDay7RehearsalEvidenceError(error.message);
    throw error;
  }
  const candidateIdentity = validateDay7CandidateIdentity(record.candidateIdentity);
  const plannedDurationMs = requireEpoch("burnInEvidence.plannedDurationMs", record.plannedDurationMs);
  if (plannedDurationMs === 0) throw new InvalidDay7RehearsalEvidenceError("burnInEvidence.plannedDurationMs must be greater than zero");
  const startedAtEpochMs = requireEpoch("burnInEvidence.startedAtEpochMs", record.startedAtEpochMs);
  if (candidateIdentity.recordedAtEpochMs > startedAtEpochMs) throw new InvalidDay7RehearsalEvidenceError("burnInEvidence candidate identity must be recorded before execution starts");
  const endedAtEpochMs = record.endedAtEpochMs === null ? null : requireEpoch("burnInEvidence.endedAtEpochMs", record.endedAtEpochMs);
  if (endedAtEpochMs !== null && endedAtEpochMs < startedAtEpochMs) throw new InvalidDay7RehearsalEvidenceError("burnInEvidence end precedes start");
  if (record.finalDisposition !== "PASS" && record.finalDisposition !== "FAIL" && record.finalDisposition !== "BLOCKED" && record.finalDisposition !== "IN_PROGRESS") throw new InvalidDay7RehearsalEvidenceError("burnInEvidence.finalDisposition is invalid");
  if (record.finalDisposition === "IN_PROGRESS" && endedAtEpochMs !== null) throw new InvalidDay7RehearsalEvidenceError("IN_PROGRESS burn-in evidence must not have endedAtEpochMs");
  if (record.finalDisposition !== "IN_PROGRESS" && endedAtEpochMs === null) throw new InvalidDay7RehearsalEvidenceError("terminal burn-in evidence requires endedAtEpochMs");
  if (record.finalDisposition === "PASS" && endedAtEpochMs! - startedAtEpochMs < plannedDurationMs) throw new InvalidDay7RehearsalEvidenceError("PASS burn-in evidence must complete the planned duration");

  let counts;
  try {
    counts = normalizeExactDataRecord("burnInEvidence.executionCounts", record.executionCounts, ["attempted", "completed", "failed", "waitingApproval"]);
    requireExactDataFields("burnInEvidence.executionCounts", counts, ["attempted", "completed", "failed", "waitingApproval"]);
  } catch (error) {
    if (error instanceof InvalidExactDataRecordError) throw new InvalidDay7RehearsalEvidenceError(error.message);
    throw error;
  }
  const executionCounts = Object.freeze({ attempted: requireEpoch("executionCounts.attempted", counts.attempted), completed: requireEpoch("executionCounts.completed", counts.completed), failed: requireEpoch("executionCounts.failed", counts.failed), waitingApproval: requireEpoch("executionCounts.waitingApproval", counts.waitingApproval) });
  if (executionCounts.completed + executionCounts.failed + executionCounts.waitingApproval > executionCounts.attempted) throw new InvalidDay7RehearsalEvidenceError("burnInEvidence.executionCounts outcomes exceed attempted executions");

  const approvalOutcomes = requireStringArray("burnInEvidence.approvalOutcomes", record.approvalOutcomes);
  const injectedFailures = requireStringArray("burnInEvidence.injectedFailures", record.injectedFailures);
  const ownershipEvents = requireStringArray("burnInEvidence.ownershipEvents", record.ownershipEvents);
  const persistenceUncertaintyEvents = requireStringArray("burnInEvidence.persistenceUncertaintyEvents", record.persistenceUncertaintyEvents);
  const telemetryFailures = requireStringArray("burnInEvidence.telemetryFailures", record.telemetryFailures);
  const securityFindings = requireStringArray("burnInEvidence.securityFindings", record.securityFindings);
  const regressionEvidence = requireStringArray("burnInEvidence.regressionEvidence", record.regressionEvidence);
  const traceCompletenessEvidence = requireStringArray("burnInEvidence.traceCompletenessEvidence", record.traceCompletenessEvidence);
  const incidents = requireStringArray("burnInEvidence.incidents", record.incidents);

  if (regressionEvidence.length === 0) throw new InvalidDay7RehearsalEvidenceError("burnInEvidence.regressionEvidence must contain evidence");
  if (traceCompletenessEvidence.length === 0) throw new InvalidDay7RehearsalEvidenceError("burnInEvidence.traceCompletenessEvidence must contain evidence");

  if (record.finalDisposition === "PASS") {
    if (executionCounts.attempted === 0) throw new InvalidDay7RehearsalEvidenceError("PASS burn-in evidence requires at least one attempted execution");
    if (executionCounts.failed !== 0 || executionCounts.waitingApproval !== 0 || executionCounts.completed !== executionCounts.attempted) throw new InvalidDay7RehearsalEvidenceError("PASS burn-in evidence requires every attempted execution to complete successfully with no failures or pending approvals");
    if (approvalOutcomes.length === 0) throw new InvalidDay7RehearsalEvidenceError("PASS burn-in evidence requires governed approval evidence");
    if (injectedFailures.length === 0) throw new InvalidDay7RehearsalEvidenceError("PASS burn-in evidence requires approved reversible failure-injection evidence");
    if (ownershipEvents.length === 0) throw new InvalidDay7RehearsalEvidenceError("PASS burn-in evidence requires ownership evidence");
    if (persistenceUncertaintyEvents.length === 0) throw new InvalidDay7RehearsalEvidenceError("PASS burn-in evidence requires persistence uncertainty/reconciliation evidence");
    if (telemetryFailures.length > 0) throw new InvalidDay7RehearsalEvidenceError("PASS burn-in evidence requires zero unresolved telemetry failures");
    if (securityFindings.length > 0 || incidents.length > 0) throw new InvalidDay7RehearsalEvidenceError("PASS burn-in evidence requires zero unresolved security findings and incidents");
  }

  return Object.freeze({ burnInId: requireString("burnInEvidence.burnInId", record.burnInId), candidateIdentity, plannedDurationMs, startedAtEpochMs, endedAtEpochMs, executionCounts, approvalOutcomes, injectedFailures, ownershipEvents, persistenceUncertaintyEvents, telemetryFailures, securityFindings, regressionEvidence, traceCompletenessEvidence, incidents, finalDisposition: record.finalDisposition });
}

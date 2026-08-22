import { InvalidEventError } from "./index.js";

export type OperationalEvidenceDisposition = "PASS" | "FAIL" | "BLOCKED";
export type BurnInDisposition = OperationalEvidenceDisposition | "IN_PROGRESS";

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

export interface OperationalCheckEvidence {
  readonly checkId: string;
  readonly expectedCondition: string;
  readonly observedCondition: string;
  readonly result: OperationalEvidenceDisposition;
  readonly evidenceId: string;
}

export interface OperationalStepEvidence {
  readonly stepId: string;
  readonly startedAtEpochMs: number;
  readonly completedAtEpochMs: number;
  readonly result: OperationalEvidenceDisposition;
  readonly evidenceId: string;
}

export interface DeploymentRehearsalEvidence {
  readonly deploymentRehearsalId: string;
  readonly candidateIdentity: Day7CandidateIdentity;
  readonly immutableArtifactIdentities: readonly string[];
  readonly environmentClass: string;
  readonly configurationDigest: string;
  readonly migrationPrerequisiteEvidence: readonly string[];
  readonly startedAtEpochMs: number;
  readonly completedAtEpochMs: number;
  readonly steps: readonly OperationalStepEvidence[];
  readonly postDeployChecks: readonly OperationalCheckEvidence[];
  readonly releaseEvidenceArtifactId: string | null;
  readonly result: OperationalEvidenceDisposition;
  readonly failureReason: string | null;
}

export interface RollbackUncertainOperationEvidence {
  readonly operationId: string;
  readonly uncertaintySource: string;
  readonly authoritativeReadbackId: string;
  readonly reconciliationDisposition: OperationalEvidenceDisposition;
  readonly evidenceId: string;
}

export interface RollbackRehearsalEvidence {
  readonly rollbackRehearsalId: string;
  readonly candidateIdentity: Day7CandidateIdentity;
  readonly fromDeploymentIdentity: string;
  readonly targetKnownGoodIdentity: string;
  readonly compatibilityEvidence: readonly string[];
  readonly preservedAuthorityEvidence: readonly string[];
  readonly startedAtEpochMs: number;
  readonly completedAtEpochMs: number;
  readonly steps: readonly OperationalStepEvidence[];
  readonly postRollbackChecks: readonly OperationalCheckEvidence[];
  readonly uncertainOperations: readonly RollbackUncertainOperationEvidence[];
  readonly result: OperationalEvidenceDisposition;
  readonly failureReason: string | null;
}

export interface BurnInExecutionCounts {
  readonly attempted: number;
  readonly completed: number;
  readonly failed: number;
  readonly waitingApproval: number;
}

export interface BurnInEvidence {
  readonly burnInId: string;
  readonly candidateIdentity: Day7CandidateIdentity;
  readonly plannedDurationMs: number;
  readonly startedAtEpochMs: number;
  readonly endedAtEpochMs: number | null;
  readonly executionCounts: BurnInExecutionCounts;
  readonly approvalOutcomes: readonly string[];
  readonly injectedFailures: readonly string[];
  readonly ownershipEvents: readonly string[];
  readonly persistenceUncertaintyEvents: readonly string[];
  readonly telemetryFailures: readonly string[];
  readonly securityFindings: readonly string[];
  readonly regressionEvidence: readonly string[];
  readonly traceCompletenessEvidence: readonly string[];
  readonly incidents: readonly string[];
  readonly finalDisposition: BurnInDisposition;
}

function invalid(message: string): never {
  throw new InvalidEventError(message);
}

function nonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) invalid(`${field} must be non-empty.`);
  return value;
}

function epoch(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${field} must be a non-negative safe integer.`);
  return value;
}

function count(value: number, field: string): number {
  return epoch(value, field);
}

function uniqueNonEmpty(values: readonly string[], field: string, allowEmpty = false): readonly string[] {
  if (!allowEmpty && values.length === 0) invalid(`${field} must contain evidence.`);
  const normalized = values.map((value, index) => nonEmpty(value, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) invalid(`${field} must not contain duplicate evidence identities.`);
  return Object.freeze([...normalized]);
}

function cloneFreeze<T>(value: T): T {
  try {
    return Object.freeze(structuredClone(value));
  } catch {
    return invalid("operational evidence must be structured-cloneable.");
  }
}

function candidate(value: Day7CandidateIdentity): Day7CandidateIdentity {
  nonEmpty(value.candidateHeadSha, "candidateHeadSha");
  if (value.candidateMergeSha !== null) nonEmpty(value.candidateMergeSha, "candidateMergeSha");
  nonEmpty(value.workflowRunId, "workflowRunId");
  nonEmpty(value.verificationMatrixRevision, "verificationMatrixRevision");
  nonEmpty(value.operatorRunbookRevision, "operatorRunbookRevision");
  nonEmpty(value.dependencyLockDigest, "dependencyLockDigest");
  nonEmpty(value.configurationSchemaVersion, "configurationSchemaVersion");
  nonEmpty(value.deploymentIdentity, "deploymentIdentity");
  epoch(value.recordedAtEpochMs, "recordedAtEpochMs");
  return cloneFreeze(value);
}

function validateSteps(values: readonly OperationalStepEvidence[], field: string): void {
  if (values.length === 0) invalid(`${field} must contain evidence.`);
  const ids = new Set<string>();
  for (const [index, step] of values.entries()) {
    nonEmpty(step.stepId, `${field}[${index}].stepId`);
    nonEmpty(step.evidenceId, `${field}[${index}].evidenceId`);
    epoch(step.startedAtEpochMs, `${field}[${index}].startedAtEpochMs`);
    epoch(step.completedAtEpochMs, `${field}[${index}].completedAtEpochMs`);
    if (step.completedAtEpochMs < step.startedAtEpochMs) invalid(`${field}[${index}] completes before it starts.`);
    if (ids.has(step.stepId)) invalid(`${field} step identifiers must be unique.`);
    ids.add(step.stepId);
  }
}

function validateChecks(values: readonly OperationalCheckEvidence[], field: string): void {
  if (values.length === 0) invalid(`${field} must contain evidence.`);
  const ids = new Set<string>();
  for (const [index, check] of values.entries()) {
    nonEmpty(check.checkId, `${field}[${index}].checkId`);
    nonEmpty(check.expectedCondition, `${field}[${index}].expectedCondition`);
    nonEmpty(check.observedCondition, `${field}[${index}].observedCondition`);
    nonEmpty(check.evidenceId, `${field}[${index}].evidenceId`);
    if (ids.has(check.checkId)) invalid(`${field} check identifiers must be unique.`);
    ids.add(check.checkId);
  }
}

function validateTerminalDisposition(result: OperationalEvidenceDisposition, failureReason: string | null, field: string): void {
  if (result === "PASS") {
    if (failureReason !== null) invalid(`${field} PASS must not carry a failure reason.`);
  } else {
    if (failureReason === null || failureReason.trim().length === 0) invalid(`${field} ${result} must carry a failure reason.`);
  }
}

export function validateDeploymentRehearsalEvidence(input: DeploymentRehearsalEvidence): DeploymentRehearsalEvidence {
  nonEmpty(input.deploymentRehearsalId, "deploymentRehearsalId");
  candidate(input.candidateIdentity);
  uniqueNonEmpty(input.immutableArtifactIdentities, "immutableArtifactIdentities");
  nonEmpty(input.environmentClass, "environmentClass");
  nonEmpty(input.configurationDigest, "configurationDigest");
  uniqueNonEmpty(input.migrationPrerequisiteEvidence, "migrationPrerequisiteEvidence", true);
  epoch(input.startedAtEpochMs, "startedAtEpochMs");
  epoch(input.completedAtEpochMs, "completedAtEpochMs");
  if (input.completedAtEpochMs < input.startedAtEpochMs) invalid("deployment rehearsal completes before it starts.");
  validateSteps(input.steps, "steps");
  validateChecks(input.postDeployChecks, "postDeployChecks");
  if (input.releaseEvidenceArtifactId !== null) nonEmpty(input.releaseEvidenceArtifactId, "releaseEvidenceArtifactId");
  validateTerminalDisposition(input.result, input.failureReason, "deployment rehearsal");
  if (input.result === "PASS" && [...input.steps, ...input.postDeployChecks].some((entry) => entry.result !== "PASS")) invalid("deployment rehearsal PASS requires every step and check to pass.");
  return cloneFreeze(input);
}

export function validateRollbackRehearsalEvidence(input: RollbackRehearsalEvidence): RollbackRehearsalEvidence {
  nonEmpty(input.rollbackRehearsalId, "rollbackRehearsalId");
  candidate(input.candidateIdentity);
  nonEmpty(input.fromDeploymentIdentity, "fromDeploymentIdentity");
  nonEmpty(input.targetKnownGoodIdentity, "targetKnownGoodIdentity");
  uniqueNonEmpty(input.compatibilityEvidence, "compatibilityEvidence");
  uniqueNonEmpty(input.preservedAuthorityEvidence, "preservedAuthorityEvidence");
  epoch(input.startedAtEpochMs, "startedAtEpochMs");
  epoch(input.completedAtEpochMs, "completedAtEpochMs");
  if (input.completedAtEpochMs < input.startedAtEpochMs) invalid("rollback rehearsal completes before it starts.");
  validateSteps(input.steps, "steps");
  validateChecks(input.postRollbackChecks, "postRollbackChecks");
  const operationIds = new Set<string>();
  for (const [index, operation] of input.uncertainOperations.entries()) {
    nonEmpty(operation.operationId, `uncertainOperations[${index}].operationId`);
    nonEmpty(operation.uncertaintySource, `uncertainOperations[${index}].uncertaintySource`);
    nonEmpty(operation.authoritativeReadbackId, `uncertainOperations[${index}].authoritativeReadbackId`);
    nonEmpty(operation.evidenceId, `uncertainOperations[${index}].evidenceId`);
    if (operationIds.has(operation.operationId)) invalid("uncertain operation identifiers must be unique.");
    operationIds.add(operation.operationId);
  }
  validateTerminalDisposition(input.result, input.failureReason, "rollback rehearsal");
  if (input.result === "PASS" && [...input.steps, ...input.postRollbackChecks].some((entry) => entry.result !== "PASS")) invalid("rollback rehearsal PASS requires every step and check to pass.");
  if (input.result === "PASS" && input.uncertainOperations.some((operation) => operation.reconciliationDisposition !== "PASS")) invalid("rollback rehearsal PASS requires every uncertain operation to reconcile successfully.");
  return cloneFreeze(input);
}

export function validateBurnInEvidence(input: BurnInEvidence): BurnInEvidence {
  nonEmpty(input.burnInId, "burnInId");
  candidate(input.candidateIdentity);
  if (!Number.isSafeInteger(input.plannedDurationMs) || input.plannedDurationMs <= 0) invalid("plannedDurationMs must be a positive safe integer.");
  epoch(input.startedAtEpochMs, "startedAtEpochMs");
  if (input.endedAtEpochMs !== null) {
    epoch(input.endedAtEpochMs, "endedAtEpochMs");
    if (input.endedAtEpochMs < input.startedAtEpochMs) invalid("burn-in ends before it starts.");
  }
  count(input.executionCounts.attempted, "executionCounts.attempted");
  count(input.executionCounts.completed, "executionCounts.completed");
  count(input.executionCounts.failed, "executionCounts.failed");
  count(input.executionCounts.waitingApproval, "executionCounts.waitingApproval");
  if (input.executionCounts.completed + input.executionCounts.failed + input.executionCounts.waitingApproval > input.executionCounts.attempted) invalid("burn-in execution outcomes cannot exceed attempted executions.");
  uniqueNonEmpty(input.regressionEvidence, "regressionEvidence");
  uniqueNonEmpty(input.traceCompletenessEvidence, "traceCompletenessEvidence");
  for (const [field, values] of Object.entries({
    approvalOutcomes: input.approvalOutcomes,
    injectedFailures: input.injectedFailures,
    ownershipEvents: input.ownershipEvents,
    persistenceUncertaintyEvents: input.persistenceUncertaintyEvents,
    telemetryFailures: input.telemetryFailures,
    securityFindings: input.securityFindings,
    incidents: input.incidents,
  })) uniqueNonEmpty(values, field, true);
  if (input.finalDisposition === "IN_PROGRESS") {
    if (input.endedAtEpochMs !== null) invalid("IN_PROGRESS burn-in must not have endedAtEpochMs.");
  } else if (input.endedAtEpochMs === null) invalid("terminal burn-in disposition requires endedAtEpochMs.");
  if (input.finalDisposition === "PASS") {
    if (input.endedAtEpochMs === null || input.endedAtEpochMs - input.startedAtEpochMs < input.plannedDurationMs) invalid("burn-in PASS requires the planned duration to complete.");
    if (input.securityFindings.length > 0 || input.incidents.length > 0) invalid("burn-in PASS requires zero unresolved security findings and incidents.");
  }
  return cloneFreeze(input);
}

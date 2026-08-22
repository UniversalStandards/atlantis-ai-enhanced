import { InvalidEventError } from "./index.js";
import {
  validateBurnInEvidence,
  validateDeploymentRehearsalEvidence,
  validateRollbackRehearsalEvidence,
  type BurnInEvidence,
  type Day7CandidateIdentity,
  type DeploymentRehearsalEvidence,
  type RollbackRehearsalEvidence,
} from "./day7-operational-evidence.js";

export type Day7ReleaseGateDisposition = "PASS" | "BLOCKED";

export interface Day7ReleaseGateEvidence {
  readonly gateId: string;
  readonly disposition: Day7ReleaseGateDisposition;
  readonly evidenceIds: readonly string[];
  readonly blockerReason: string | null;
}

export interface Day7ReleaseReadinessInput {
  readonly candidateIdentity: Day7CandidateIdentity;
  readonly deployment: DeploymentRehearsalEvidence;
  readonly rollback: RollbackRehearsalEvidence;
  readonly burnIn: BurnInEvidence;
  readonly independentGates: readonly Day7ReleaseGateEvidence[];
}

export interface Day7ReleaseReadinessEvidence {
  readonly candidateIdentity: Day7CandidateIdentity;
  readonly deployment: DeploymentRehearsalEvidence;
  readonly rollback: RollbackRehearsalEvidence;
  readonly burnIn: BurnInEvidence;
  readonly independentGates: readonly Day7ReleaseGateEvidence[];
  readonly disposition: Day7ReleaseGateDisposition;
  readonly blockingGateIds: readonly string[];
}

function invalid(message: string): never {
  throw new InvalidEventError(message);
}

function nonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) invalid(`${field} must be non-empty.`);
  return value;
}

function assertSameCandidate(expected: Day7CandidateIdentity, actual: Day7CandidateIdentity, field: string): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    invalid(`${field} must be bound to the exact release candidate identity.`);
  }
}

function validateGate(gate: Day7ReleaseGateEvidence, index: number): Day7ReleaseGateEvidence {
  nonEmpty(gate.gateId, `independentGates[${index}].gateId`);
  if (gate.disposition !== "PASS" && gate.disposition !== "BLOCKED") {
    invalid(`independentGates[${index}].disposition must be PASS or BLOCKED.`);
  }
  if (gate.evidenceIds.length === 0) invalid(`independentGates[${index}].evidenceIds must contain evidence.`);
  const evidenceIds = gate.evidenceIds.map((id, evidenceIndex) => nonEmpty(id, `independentGates[${index}].evidenceIds[${evidenceIndex}]`));
  if (new Set(evidenceIds).size !== evidenceIds.length) invalid(`independentGates[${index}].evidenceIds must be unique.`);
  if (gate.disposition === "PASS" && gate.blockerReason !== null) invalid(`independentGates[${index}] PASS must not carry a blocker reason.`);
  if (gate.disposition === "BLOCKED" && (gate.blockerReason === null || gate.blockerReason.trim().length === 0)) invalid(`independentGates[${index}] BLOCKED must carry a blocker reason.`);
  return Object.freeze(structuredClone(gate));
}

export function composeDay7ReleaseReadiness(input: Day7ReleaseReadinessInput): Day7ReleaseReadinessEvidence {
  const deployment = validateDeploymentRehearsalEvidence(input.deployment);
  const rollback = validateRollbackRehearsalEvidence(input.rollback);
  const burnIn = validateBurnInEvidence(input.burnIn);

  assertSameCandidate(input.candidateIdentity, deployment.candidateIdentity, "deployment");
  assertSameCandidate(input.candidateIdentity, rollback.candidateIdentity, "rollback");
  assertSameCandidate(input.candidateIdentity, burnIn.candidateIdentity, "burnIn");

  if (input.independentGates.length === 0) invalid("independentGates must contain release-gate evidence.");
  const independentGates = input.independentGates.map(validateGate);
  const gateIds = independentGates.map((gate) => gate.gateId);
  if (new Set(gateIds).size !== gateIds.length) invalid("independent gate identifiers must be unique.");

  const blockingGateIds: string[] = [];
  if (deployment.result !== "PASS") blockingGateIds.push("deployment");
  if (rollback.result !== "PASS") blockingGateIds.push("rollback");
  if (burnIn.finalDisposition !== "PASS") blockingGateIds.push("burn-in");
  for (const gate of independentGates) if (gate.disposition === "BLOCKED") blockingGateIds.push(gate.gateId);

  return Object.freeze({
    candidateIdentity: Object.freeze(structuredClone(input.candidateIdentity)),
    deployment,
    rollback,
    burnIn,
    independentGates: Object.freeze(independentGates),
    disposition: blockingGateIds.length === 0 ? "PASS" : "BLOCKED",
    blockingGateIds: Object.freeze(blockingGateIds),
  });
}

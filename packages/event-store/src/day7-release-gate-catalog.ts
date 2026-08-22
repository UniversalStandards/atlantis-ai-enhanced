import { InvalidEventError } from "./index.js";
import type { Day7ReleaseGateEvidence } from "./day7-release-readiness.js";

export const DAY7_REQUIRED_RELEASE_GATE_IDS = Object.freeze([
  "regression-ci",
  "unauthorized-protected-actions",
  "governed-repository-improvement",
  "self-improvement-human-review",
  "external-artifact-durability",
  "recovery-ownership-durability",
  "ownership-writer-atomicity",
  "trace-completeness",
  "telemetry-binding",
  "adversarial-security",
  "browser-runtime",
  "operator-runbook",
] as const);

export type Day7RequiredReleaseGateId = typeof DAY7_REQUIRED_RELEASE_GATE_IDS[number];

function invalid(message: string): never {
  throw new InvalidEventError(message);
}

export function requireCompleteDay7ReleaseGateCatalog(
  gates: readonly Day7ReleaseGateEvidence[],
): readonly Day7ReleaseGateEvidence[] {
  const byId = new Map(gates.map((gate) => [gate.gateId, gate]));
  const required = new Set<string>(DAY7_REQUIRED_RELEASE_GATE_IDS);
  const missing = DAY7_REQUIRED_RELEASE_GATE_IDS.filter((gateId) => !byId.has(gateId));
  if (missing.length > 0) invalid(`missing required Day-7 release gates: ${missing.join(", ")}.`);
  const unknown = gates.map((gate) => gate.gateId).filter((gateId) => !required.has(gateId));
  if (unknown.length > 0) invalid(`unknown Day-7 release gates: ${unknown.join(", ")}.`);
  if (byId.size !== gates.length) invalid("Day-7 release gate identifiers must be unique.");
  return Object.freeze(DAY7_REQUIRED_RELEASE_GATE_IDS.map((gateId) => byId.get(gateId)!));
}

import {
  normalizeAuthorityDescriptor,
  type ControlPlaneAuthorityDescriptor,
} from "./authority.js";
import {
  requireEnumValue,
  requirePolicyVersion,
  requireStringArray,
  trackerControlPlanePolicyVersion,
  type TrackerControlPlanePolicyVersion,
} from "./shared.js";

export const projectionClassifications = Object.freeze([
  "program-work",
  "release-control",
  "automation-control",
  "security-incident",
  "excluded",
] as const);

export type ProjectionClassification = typeof projectionClassifications[number];

export const systemControlLabels = Object.freeze([
  "tracker-drift",
  "automation-health",
  "sync-internal",
  "sync-dlq",
] as const);

export type SystemControlLabel = typeof systemControlLabels[number];

export interface ProjectionClassificationRequest {
  readonly policyVersion: TrackerControlPlanePolicyVersion;
  readonly requestedClassification: ProjectionClassification;
  readonly labels: readonly string[];
  readonly sourceIdentity: ControlPlaneAuthorityDescriptor;
}

export interface ProjectionClassificationDecision {
  readonly policyVersion: TrackerControlPlanePolicyVersion;
  readonly sourceIdentity: ControlPlaneAuthorityDescriptor;
  readonly requestedClassification: ProjectionClassification;
  readonly classification: ProjectionClassification;
  readonly projectedAsProgramWork: boolean;
  readonly controlPlaneOnly: boolean;
  readonly matchedSystemControlLabels: readonly SystemControlLabel[];
  readonly reason: "requested-classification" | "system-control-label";
}

export function normalizeSystemControlLabels(labels: readonly string[]): readonly SystemControlLabel[] {
  const normalized = requireStringArray("labels", labels, { allowEmpty: true });
  return Object.freeze(
    normalized.map((label) =>
      requireEnumValue("label", label, systemControlLabels)
    ),
  );
}

export function classifyProjectionCandidate(
  request: ProjectionClassificationRequest,
): Readonly<ProjectionClassificationDecision> {
  const policyVersion = requirePolicyVersion(request.policyVersion);
  const requestedClassification = requireEnumValue(
    "requestedClassification",
    request.requestedClassification,
    projectionClassifications,
  );
  const matchedSystemControlLabels = normalizeSystemControlLabels(request.labels);
  const sourceIdentity = normalizeAuthorityDescriptor(request.sourceIdentity);
  const shouldExcludeProgramWork = requestedClassification === "program-work"
    && matchedSystemControlLabels.length > 0;
  const classification = shouldExcludeProgramWork
    ? "excluded"
    : requestedClassification;

  return Object.freeze({
    policyVersion,
    sourceIdentity,
    requestedClassification,
    classification,
    projectedAsProgramWork: classification === "program-work",
    controlPlaneOnly: classification !== "program-work",
    matchedSystemControlLabels,
    reason: shouldExcludeProgramWork
      ? "system-control-label"
      : "requested-classification",
  });
}

export function createProjectionClassificationRequest(
  input: Omit<ProjectionClassificationRequest, "policyVersion">,
): ProjectionClassificationRequest {
  return Object.freeze({
    policyVersion: trackerControlPlanePolicyVersion,
    ...input,
  });
}

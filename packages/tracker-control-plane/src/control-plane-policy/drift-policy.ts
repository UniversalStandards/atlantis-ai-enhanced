import type { ControlPlaneAuthorityDescriptor } from "./authority.js";
import type { ProjectionClassification } from "./projection-policy.js";
import {
  validateControlPlaneIncident,
  type ControlPlaneIncident,
} from "./incident-policy.js";
import {
  InvalidTrackerControlPlanePolicyError,
  requireEnumValue,
  requirePolicyVersion,
  trackerControlPlanePolicyVersion,
  type TrackerControlPlanePolicyVersion,
} from "./shared.js";

export const driftClassifications = Object.freeze([
  "safe-stale-mirror",
  "missing-unambiguous-row",
  "duplicate-rows",
  "conflicting-authoritative-state",
  "ambiguous-mapping",
  "schema-incompatibility",
  "unverifiable-write",
] as const);

export type DriftClassification = typeof driftClassifications[number];

export interface DriftEvaluationRequest {
  readonly policyVersion: TrackerControlPlanePolicyVersion;
  readonly driftClassification: DriftClassification;
  readonly projectionClassification: ProjectionClassification;
  readonly sourceIdentity: ControlPlaneAuthorityDescriptor;
  readonly targetIdentity: ControlPlaneAuthorityDescriptor;
  readonly incident?: ControlPlaneIncident;
}

export interface AutomaticRemediationDriftDecision {
  readonly policyVersion: TrackerControlPlanePolicyVersion;
  readonly outcome: "automatic-remediation";
  readonly driftClassification: "safe-stale-mirror" | "missing-unambiguous-row";
  readonly projectionClassification: ProjectionClassification;
  readonly sourceIdentity: ControlPlaneAuthorityDescriptor;
  readonly targetIdentity: ControlPlaneAuthorityDescriptor;
  readonly remediation:
    | "reconcile-stale-mirror"
    | "create-unambiguous-row";
}

export interface HumanReviewDriftDecision {
  readonly policyVersion: TrackerControlPlanePolicyVersion;
  readonly outcome: "human-review";
  readonly driftClassification:
    | "duplicate-rows"
    | "conflicting-authoritative-state";
  readonly projectionClassification: ProjectionClassification;
  readonly sourceIdentity: ControlPlaneAuthorityDescriptor;
  readonly targetIdentity: ControlPlaneAuthorityDescriptor;
  readonly incident: Readonly<ControlPlaneIncident>;
  readonly automaticDeletionPermitted: false;
}

export interface BlockedDriftDecision {
  readonly policyVersion: TrackerControlPlanePolicyVersion;
  readonly outcome: "blocked";
  readonly driftClassification:
    | "ambiguous-mapping"
    | "schema-incompatibility"
    | "unverifiable-write";
  readonly projectionClassification: ProjectionClassification;
  readonly sourceIdentity: ControlPlaneAuthorityDescriptor;
  readonly targetIdentity: ControlPlaneAuthorityDescriptor;
  readonly incident: Readonly<ControlPlaneIncident>;
  readonly failClosed: true;
}

export type DriftDecision =
  | AutomaticRemediationDriftDecision
  | HumanReviewDriftDecision
  | BlockedDriftDecision;

export interface ControlPlaneReviewPort {
  requestReview(decision: HumanReviewDriftDecision | BlockedDriftDecision): Promise<void>;
}

export interface ControlPlaneRemediationPort {
  remediate(decision: AutomaticRemediationDriftDecision): Promise<void>;
}

function requireIncident(
  incident: ControlPlaneIncident | undefined,
  request: DriftEvaluationRequest,
): Readonly<ControlPlaneIncident> {
  if (incident === undefined) {
    throw new InvalidTrackerControlPlanePolicyError(
      `incident is required for ${request.driftClassification}`,
    );
  }
  const validated = validateControlPlaneIncident(incident);
  if (validated.sourceIdentity.authorityId !== request.sourceIdentity.authorityId) {
    throw new InvalidTrackerControlPlanePolicyError(
      "incident.sourceIdentity must match drift sourceIdentity",
    );
  }
  if (validated.targetIdentity.authorityId !== request.targetIdentity.authorityId) {
    throw new InvalidTrackerControlPlanePolicyError(
      "incident.targetIdentity must match drift targetIdentity",
    );
  }
  return validated;
}

export function evaluateDrift(
  request: DriftEvaluationRequest,
): Readonly<DriftDecision> {
  const policyVersion = requirePolicyVersion(request.policyVersion);
  const driftClassification = requireEnumValue(
    "driftClassification",
    request.driftClassification,
    driftClassifications,
  );

  switch (driftClassification) {
    case "safe-stale-mirror":
      return Object.freeze({
        policyVersion,
        outcome: "automatic-remediation",
        driftClassification,
        projectionClassification: request.projectionClassification,
        sourceIdentity: request.sourceIdentity,
        targetIdentity: request.targetIdentity,
        remediation: "reconcile-stale-mirror",
      });
    case "missing-unambiguous-row":
      return Object.freeze({
        policyVersion,
        outcome: "automatic-remediation",
        driftClassification,
        projectionClassification: request.projectionClassification,
        sourceIdentity: request.sourceIdentity,
        targetIdentity: request.targetIdentity,
        remediation: "create-unambiguous-row",
      });
    case "duplicate-rows":
    case "conflicting-authoritative-state":
      return Object.freeze({
        policyVersion,
        outcome: "human-review",
        driftClassification,
        projectionClassification: request.projectionClassification,
        sourceIdentity: request.sourceIdentity,
        targetIdentity: request.targetIdentity,
        incident: requireIncident(request.incident, request),
        automaticDeletionPermitted: false,
      });
    case "ambiguous-mapping":
    case "schema-incompatibility":
    case "unverifiable-write":
      return Object.freeze({
        policyVersion,
        outcome: "blocked",
        driftClassification,
        projectionClassification: request.projectionClassification,
        sourceIdentity: request.sourceIdentity,
        targetIdentity: request.targetIdentity,
        incident: requireIncident(request.incident, request),
        failClosed: true,
      });
  }
}

export function createDriftEvaluationRequest(
  input: Omit<DriftEvaluationRequest, "policyVersion">,
): DriftEvaluationRequest {
  return Object.freeze({
    policyVersion: trackerControlPlanePolicyVersion,
    ...input,
  });
}

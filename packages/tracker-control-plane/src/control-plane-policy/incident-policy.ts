import {
  normalizeAuthorityDescriptor,
  type ControlPlaneAuthorityDescriptor,
} from "./authority.js";
import type { ProjectionClassification } from "./projection-policy.js";
import {
  InvalidTrackerControlPlanePolicyError,
  requireCanonicalTimestamp,
  requireEnumValue,
  requireNonBlank,
  requireObject,
  requirePolicyVersion,
  requireStringArray,
  trackerControlPlanePolicyVersion,
  type TrackerControlPlanePolicyVersion,
} from "./shared.js";

export const controlPlaneIncidentSeverities = Object.freeze([
  "critical",
  "high",
  "medium",
  "low",
] as const);

export type ControlPlaneIncidentSeverity =
  typeof controlPlaneIncidentSeverities[number];

export const controlPlaneIncidentSlaClasses = Object.freeze([
  "P0",
  "P1",
  "P2",
  "P3",
] as const);

export type ControlPlaneIncidentSlaClass =
  typeof controlPlaneIncidentSlaClasses[number];

export const controlPlaneIncidentEscalationStates = Object.freeze([
  "pending-triage",
  "acknowledged",
  "escalated",
  "contained",
  "resolved",
] as const);

export type ControlPlaneIncidentEscalationState =
  typeof controlPlaneIncidentEscalationStates[number];

export const controlPlaneIncidentClassifications = Object.freeze([
  "release-control",
  "automation-control",
  "security-incident",
  "excluded",
] as const satisfies readonly ProjectionClassification[]);

export type ControlPlaneIncidentClassification =
  typeof controlPlaneIncidentClassifications[number];

const controlPlaneIncidentSlaTargets = Object.freeze({
  P0: "immediate",
  P1: "within 4 hours",
  P2: "within 1 business day",
  P3: "next maintenance cycle",
} as const satisfies Record<ControlPlaneIncidentSlaClass, string>);

export interface ControlPlaneIncidentSla {
  readonly class: ControlPlaneIncidentSlaClass;
  readonly responseTarget: string;
}

export interface ControlPlaneIncidentProvenance {
  readonly detectedAt: string;
  readonly detectedBy: string;
  readonly authoritativeRecordLocator: string;
  readonly evidence: readonly string[];
}

export interface ControlPlaneIncident {
  readonly policyVersion: TrackerControlPlanePolicyVersion;
  readonly incidentId: string;
  readonly summary: string;
  readonly severity: ControlPlaneIncidentSeverity;
  readonly owner: string;
  readonly sla: Readonly<ControlPlaneIncidentSla>;
  readonly escalationState: ControlPlaneIncidentEscalationState;
  readonly sourceIdentity: ControlPlaneAuthorityDescriptor;
  readonly targetIdentity: ControlPlaneAuthorityDescriptor;
  readonly classification: ControlPlaneIncidentClassification;
  readonly provenance: Readonly<ControlPlaneIncidentProvenance>;
}

export interface ControlPlaneIncidentPort {
  recordIncident(incident: Readonly<ControlPlaneIncident>): Promise<void>;
}

export interface ControlPlaneNotificationPort {
  notifyIncident(incident: Readonly<ControlPlaneIncident>): Promise<void>;
}

function validateIncidentSla(value: unknown): Readonly<ControlPlaneIncidentSla> {
  const sla = requireObject("sla", value);
  const incidentClass = requireEnumValue(
    "sla.class",
    sla.class,
    controlPlaneIncidentSlaClasses,
  );
  const responseTarget = requireNonBlank("sla.responseTarget", sla.responseTarget);
  if (controlPlaneIncidentSlaTargets[incidentClass] !== responseTarget) {
    throw new InvalidTrackerControlPlanePolicyError(
      `sla.responseTarget must match approved policy for ${incidentClass}`,
    );
  }
  return Object.freeze({
    class: incidentClass,
    responseTarget,
  });
}

function validateIncidentProvenance(
  value: unknown,
): Readonly<ControlPlaneIncidentProvenance> {
  const provenance = requireObject("provenance", value);
  return Object.freeze({
    detectedAt: requireCanonicalTimestamp(
      "provenance.detectedAt",
      provenance.detectedAt,
    ),
    detectedBy: requireNonBlank("provenance.detectedBy", provenance.detectedBy),
    authoritativeRecordLocator: requireNonBlank(
      "provenance.authoritativeRecordLocator",
      provenance.authoritativeRecordLocator,
    ),
    evidence: requireStringArray("provenance.evidence", provenance.evidence),
  });
}

export function validateControlPlaneIncident(
  incident: ControlPlaneIncident,
): Readonly<ControlPlaneIncident> {
  const sourceIdentity = normalizeAuthorityDescriptor(incident.sourceIdentity);
  const targetIdentity = normalizeAuthorityDescriptor(incident.targetIdentity);
  return Object.freeze({
    policyVersion: requirePolicyVersion(incident.policyVersion),
    incidentId: requireNonBlank("incidentId", incident.incidentId),
    summary: requireNonBlank("summary", incident.summary),
    severity: requireEnumValue(
      "severity",
      incident.severity,
      controlPlaneIncidentSeverities,
    ),
    owner: requireNonBlank("owner", incident.owner),
    sla: validateIncidentSla(incident.sla),
    escalationState: requireEnumValue(
      "escalationState",
      incident.escalationState,
      controlPlaneIncidentEscalationStates,
    ),
    sourceIdentity,
    targetIdentity,
    classification: requireEnumValue(
      "classification",
      incident.classification,
      controlPlaneIncidentClassifications,
    ),
    provenance: validateIncidentProvenance(incident.provenance),
  });
}

export function createControlPlaneIncident(
  input: Omit<ControlPlaneIncident, "policyVersion" | "sla"> & {
    readonly slaClass: ControlPlaneIncidentSlaClass;
  },
): Readonly<ControlPlaneIncident> {
  return validateControlPlaneIncident({
    policyVersion: trackerControlPlanePolicyVersion,
    incidentId: input.incidentId,
    summary: input.summary,
    severity: input.severity,
    owner: input.owner,
    sla: {
      class: input.slaClass,
      responseTarget: controlPlaneIncidentSlaTargets[input.slaClass],
    },
    escalationState: input.escalationState,
    sourceIdentity: input.sourceIdentity,
    targetIdentity: input.targetIdentity,
    classification: input.classification,
    provenance: input.provenance,
  });
}

export function incidentSlaPolicy(): Readonly<
  Record<ControlPlaneIncidentSlaClass, Readonly<ControlPlaneIncidentSla>>
> {
  return Object.freeze({
    P0: Object.freeze({ class: "P0", responseTarget: controlPlaneIncidentSlaTargets.P0 }),
    P1: Object.freeze({ class: "P1", responseTarget: controlPlaneIncidentSlaTargets.P1 }),
    P2: Object.freeze({ class: "P2", responseTarget: controlPlaneIncidentSlaTargets.P2 }),
    P3: Object.freeze({ class: "P3", responseTarget: controlPlaneIncidentSlaTargets.P3 }),
  });
}

export type TelemetrySdkCollectorCandidateApprovalRole = "architecture" | "operations" | "security-network";

export interface TelemetrySdkCollectorCandidateApproval {
  readonly role: TelemetrySdkCollectorCandidateApprovalRole;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface TelemetrySdkCollectorCandidateAuthorization {
  readonly candidateId: string;
  readonly executionEnvironment: "non-production";
  readonly sdkRuntime: string;
  readonly exporterSpanMechanism: string;
  readonly collectorReceiver: string;
  readonly transport: string;
  readonly endpointClass: string;
  readonly authenticationClass: string;
  readonly executionTopology: string;
  readonly networkBoundary: string;
  readonly adapterSourceRevision: string;
  readonly configurationDigest: string;
  readonly releaseCandidate: string;
  readonly testEnvironment: string;
  readonly teardownDisable: string;
  readonly authoritativeReferences: string;
  readonly failureInjectionPlan: string;
  readonly featureGateDefault: "disabled";
  readonly decisionEvidence: string;
  readonly approvals: readonly TelemetrySdkCollectorCandidateApproval[];
}

export class InvalidTelemetrySdkCollectorCandidateAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTelemetrySdkCollectorCandidateAuthorizationError";
  }
}

const requiredFields = [
  "candidateId", "sdkRuntime", "exporterSpanMechanism", "collectorReceiver", "transport",
  "endpointClass", "authenticationClass", "executionTopology", "networkBoundary",
  "adapterSourceRevision", "configurationDigest", "releaseCandidate", "testEnvironment",
  "teardownDisable", "authoritativeReferences", "failureInjectionPlan", "decisionEvidence",
] as const satisfies readonly (keyof TelemetrySdkCollectorCandidateAuthorization)[];
const approvalFields = ["role", "approvedBy", "approvedAt"] as const;
const authorizationFields = [...requiredFields, "executionEnvironment", "featureGateDefault", "approvals"] as const;

function record(field: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidTelemetrySdkCollectorCandidateAuthorizationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(field: string, value: Readonly<Record<string, unknown>>, allowedFields: readonly string[]): void {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new InvalidTelemetrySdkCollectorCandidateAuthorizationError(`${field} contains unsupported field(s): ${unknown.sort().join(", ")}`);
  }
}

function nonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidTelemetrySdkCollectorCandidateAuthorizationError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function canonicalTimestamp(field: string, value: unknown): string {
  const timestamp = nonBlank(field, value);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new InvalidTelemetrySdkCollectorCandidateAuthorizationError(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function approval(value: unknown): Readonly<TelemetrySdkCollectorCandidateApproval> {
  const candidate = record("approval", value);
  rejectUnknown("approval", candidate, approvalFields);
  if (candidate.role !== "architecture" && candidate.role !== "operations" && candidate.role !== "security-network") {
    throw new InvalidTelemetrySdkCollectorCandidateAuthorizationError("approval role must be architecture, operations, or security-network");
  }
  return Object.freeze({
    role: candidate.role,
    approvedBy: nonBlank(`${candidate.role}.approvedBy`, candidate.approvedBy),
    approvedAt: canonicalTimestamp(`${candidate.role}.approvedAt`, candidate.approvedAt),
  });
}

/** Provider-neutral admission boundary only. It does not select telemetry dependencies, authorize credentials/networking/production, or prove receiver behavior. */
export function validateTelemetrySdkCollectorCandidateAuthorization(
  authorization: unknown,
): Readonly<TelemetrySdkCollectorCandidateAuthorization> {
  const candidate = record("authorization", authorization);
  rejectUnknown("authorization", candidate, authorizationFields);
  const normalized: Record<string, string> = {};
  for (const field of requiredFields) normalized[field] = nonBlank(field, candidate[field]);

  if (candidate.executionEnvironment !== "non-production") {
    throw new InvalidTelemetrySdkCollectorCandidateAuthorizationError("executionEnvironment must be non-production; production authorization is a separate gate");
  }
  if (candidate.featureGateDefault !== "disabled") {
    throw new InvalidTelemetrySdkCollectorCandidateAuthorizationError("featureGateDefault must be disabled for non-production candidate authorization");
  }
  if (!Array.isArray(candidate.approvals)) {
    throw new InvalidTelemetrySdkCollectorCandidateAuthorizationError("approvals must be an array");
  }
  const approvals = candidate.approvals.map(approval);
  for (const role of ["architecture", "operations", "security-network"] as const) {
    if (approvals.filter((item) => item.role === role).length !== 1) {
      throw new InvalidTelemetrySdkCollectorCandidateAuthorizationError(`exactly one ${role} approval is required`);
    }
  }

  return Object.freeze({
    ...(normalized as unknown as Omit<TelemetrySdkCollectorCandidateAuthorization, "executionEnvironment" | "featureGateDefault" | "approvals">),
    executionEnvironment: "non-production",
    featureGateDefault: "disabled",
    approvals: Object.freeze(approvals),
  });
}

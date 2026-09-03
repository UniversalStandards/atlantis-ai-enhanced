export type ExternalReleaseArtifactCandidateApprovalRole = "architecture" | "operations" | "security-network";

export interface ExternalReleaseArtifactCandidateApproval {
  readonly role: ExternalReleaseArtifactCandidateApprovalRole;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface ExternalReleaseArtifactCandidateAuthorization {
  readonly candidateId: string;
  readonly executionEnvironment: "non-production";
  readonly providerService: string;
  readonly serviceTopology: string;
  readonly driverSdk: string;
  readonly storagePrimitive: string;
  readonly namespaceClass: string;
  readonly artifactIdentityMapping: string;
  readonly providerVersionIdentity: string;
  readonly consistencyContract: string;
  readonly conditionalCreatePrimitive: string;
  readonly configurationDigest: string;
  readonly testedRepositoryRevision: string;
  readonly credentialClass: string;
  readonly networkBoundary: string;
  readonly featureGate: string;
  readonly featureGateDefault: "disabled";
  readonly rollbackDisable: string;
  readonly teardownProcedure: string;
  readonly failureInjectionPlan: string;
  readonly decisionEvidence: string;
  readonly approvals: readonly ExternalReleaseArtifactCandidateApproval[];
}

export class InvalidExternalReleaseArtifactCandidateAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExternalReleaseArtifactCandidateAuthorizationError";
  }
}

const requiredFields = [
  "candidateId", "providerService", "serviceTopology", "driverSdk", "storagePrimitive",
  "namespaceClass", "artifactIdentityMapping", "providerVersionIdentity", "consistencyContract",
  "conditionalCreatePrimitive", "configurationDigest", "testedRepositoryRevision", "credentialClass",
  "networkBoundary", "featureGate", "rollbackDisable", "teardownProcedure", "failureInjectionPlan",
  "decisionEvidence",
] as const satisfies readonly (keyof ExternalReleaseArtifactCandidateAuthorization)[];
const approvalFields = ["role", "approvedBy", "approvedAt"] as const;
const authorizationFields = [...requiredFields, "executionEnvironment", "featureGateDefault", "approvals"] as const;

function record(field: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidExternalReleaseArtifactCandidateAuthorizationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(field: string, value: Readonly<Record<string, unknown>>, allowedFields: readonly string[]): void {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new InvalidExternalReleaseArtifactCandidateAuthorizationError(`${field} contains unsupported field(s): ${unknown.sort().join(", ")}`);
  }
}

function nonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidExternalReleaseArtifactCandidateAuthorizationError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function canonicalTimestamp(field: string, value: unknown): string {
  const timestamp = nonBlank(field, value);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new InvalidExternalReleaseArtifactCandidateAuthorizationError(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function approval(value: unknown): Readonly<ExternalReleaseArtifactCandidateApproval> {
  const candidate = record("approval", value);
  rejectUnknown("approval", candidate, approvalFields);
  if (candidate.role !== "architecture" && candidate.role !== "operations" && candidate.role !== "security-network") {
    throw new InvalidExternalReleaseArtifactCandidateAuthorizationError("approval role must be architecture, operations, or security-network");
  }
  return Object.freeze({
    role: candidate.role,
    approvedBy: nonBlank(`${candidate.role}.approvedBy`, candidate.approvedBy),
    approvedAt: canonicalTimestamp(`${candidate.role}.approvedAt`, candidate.approvedAt),
  });
}

/** Provider-neutral completeness boundary only. It does not select a provider, authorize credentials/networking/production, or prove external durability. */
export function validateExternalReleaseArtifactCandidateAuthorization(
  authorization: unknown,
): Readonly<ExternalReleaseArtifactCandidateAuthorization> {
  const candidate = record("authorization", authorization);
  rejectUnknown("authorization", candidate, authorizationFields);
  const normalized: Record<string, string> = {};
  for (const field of requiredFields) normalized[field] = nonBlank(field, candidate[field]);

  if (candidate.executionEnvironment !== "non-production") {
    throw new InvalidExternalReleaseArtifactCandidateAuthorizationError("executionEnvironment must be non-production; production authorization is a separate gate");
  }
  if (candidate.featureGateDefault !== "disabled") {
    throw new InvalidExternalReleaseArtifactCandidateAuthorizationError("featureGateDefault must be disabled for non-production candidate authorization");
  }
  if (!Array.isArray(candidate.approvals)) {
    throw new InvalidExternalReleaseArtifactCandidateAuthorizationError("approvals must be an array");
  }
  const approvals = candidate.approvals.map(approval);
  for (const role of ["architecture", "operations", "security-network"] as const) {
    if (approvals.filter((item) => item.role === role).length !== 1) {
      throw new InvalidExternalReleaseArtifactCandidateAuthorizationError(`exactly one ${role} approval is required`);
    }
  }

  return Object.freeze({
    ...(normalized as unknown as Omit<ExternalReleaseArtifactCandidateAuthorization, "executionEnvironment" | "featureGateDefault" | "approvals">),
    executionEnvironment: "non-production",
    featureGateDefault: "disabled",
    approvals: Object.freeze(approvals),
  });
}

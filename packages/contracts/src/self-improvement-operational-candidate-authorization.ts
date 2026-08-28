export type SelfImprovementOperationalCandidateApprovalRole = "architecture" | "operations" | "security-network";

export interface SelfImprovementOperationalCandidateApproval {
  readonly role: SelfImprovementOperationalCandidateApprovalRole;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface SelfImprovementOperationalCandidateAuthorization {
  readonly candidateId: string;
  readonly executionEnvironment: "non-production";
  readonly repository: string;
  readonly baseRevision: string;
  readonly isolatedWorkspaceNamespace: string;
  readonly workspaceMechanism: string;
  readonly patchGenerationMechanism: string;
  readonly testExecutionMechanism: string;
  readonly followUpEvaluationMechanism: string;
  readonly securityReviewMechanism: string;
  readonly evidenceStorageMechanism: string;
  readonly configurationDigest: string;
  readonly credentialClass: string;
  readonly networkBoundary: string;
  readonly timeoutCancellationMechanism: string;
  readonly teardownCleanupMechanism: string;
  readonly disableRollbackProcedure: string;
  readonly verificationGates: string;
  readonly failureInjectionPlan: string;
  readonly featureGateDefault: "disabled";
  readonly authorityBoundary: "no-prohibited-authority";
  readonly decisionEvidence: string;
  readonly approvals: readonly SelfImprovementOperationalCandidateApproval[];
}

export class InvalidSelfImprovementOperationalCandidateAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSelfImprovementOperationalCandidateAuthorizationError";
  }
}

const requiredFields = [
  "candidateId", "repository", "baseRevision", "isolatedWorkspaceNamespace", "workspaceMechanism",
  "patchGenerationMechanism", "testExecutionMechanism", "followUpEvaluationMechanism",
  "securityReviewMechanism", "evidenceStorageMechanism", "configurationDigest", "credentialClass",
  "networkBoundary", "timeoutCancellationMechanism", "teardownCleanupMechanism", "disableRollbackProcedure",
  "verificationGates", "failureInjectionPlan", "decisionEvidence",
] as const satisfies readonly (keyof SelfImprovementOperationalCandidateAuthorization)[];
const approvalFields = ["role", "approvedBy", "approvedAt"] as const;
const authorizationFields = [
  ...requiredFields, "executionEnvironment", "featureGateDefault", "authorityBoundary", "approvals",
] as const;

function record(field: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidSelfImprovementOperationalCandidateAuthorizationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(field: string, value: Readonly<Record<string, unknown>>, allowedFields: readonly string[]): void {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new InvalidSelfImprovementOperationalCandidateAuthorizationError(`${field} contains unsupported field(s): ${unknown.sort().join(", ")}`);
  }
}

function nonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidSelfImprovementOperationalCandidateAuthorizationError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function canonicalTimestamp(field: string, value: unknown): string {
  const timestamp = nonBlank(field, value);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new InvalidSelfImprovementOperationalCandidateAuthorizationError(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function approval(value: unknown): Readonly<SelfImprovementOperationalCandidateApproval> {
  const candidate = record("approval", value);
  rejectUnknown("approval", candidate, approvalFields);
  if (candidate.role !== "architecture" && candidate.role !== "operations" && candidate.role !== "security-network") {
    throw new InvalidSelfImprovementOperationalCandidateAuthorizationError("approval role must be architecture, operations, or security-network");
  }
  return Object.freeze({
    role: candidate.role,
    approvedBy: nonBlank(`${candidate.role}.approvedBy`, candidate.approvedBy),
    approvedAt: canonicalTimestamp(`${candidate.role}.approvedAt`, candidate.approvedAt),
  });
}

/** Admission evidence only. It never grants merge, protected-branch, deployment, credential, infrastructure, policy, or production mutation authority. */
export function validateSelfImprovementOperationalCandidateAuthorization(
  authorization: unknown,
): Readonly<SelfImprovementOperationalCandidateAuthorization> {
  const candidate = record("authorization", authorization);
  rejectUnknown("authorization", candidate, authorizationFields);
  const normalized: Record<string, string> = {};
  for (const field of requiredFields) normalized[field] = nonBlank(field, candidate[field]);

  if (candidate.executionEnvironment !== "non-production") {
    throw new InvalidSelfImprovementOperationalCandidateAuthorizationError("executionEnvironment must be non-production");
  }
  if (candidate.featureGateDefault !== "disabled") {
    throw new InvalidSelfImprovementOperationalCandidateAuthorizationError("featureGateDefault must be disabled");
  }
  if (candidate.authorityBoundary !== "no-prohibited-authority") {
    throw new InvalidSelfImprovementOperationalCandidateAuthorizationError("authorityBoundary must prove no-prohibited-authority");
  }
  if (!Array.isArray(candidate.approvals)) {
    throw new InvalidSelfImprovementOperationalCandidateAuthorizationError("approvals must be an array");
  }
  const approvals = candidate.approvals.map(approval);
  for (const role of ["architecture", "operations", "security-network"] as const) {
    if (approvals.filter((item) => item.role === role).length !== 1) {
      throw new InvalidSelfImprovementOperationalCandidateAuthorizationError(`exactly one ${role} approval is required`);
    }
  }

  return Object.freeze({
    ...(normalized as unknown as Omit<SelfImprovementOperationalCandidateAuthorization, "executionEnvironment" | "featureGateDefault" | "authorityBoundary" | "approvals">),
    executionEnvironment: "non-production",
    featureGateDefault: "disabled",
    authorityBoundary: "no-prohibited-authority",
    approvals: Object.freeze(approvals),
  });
}

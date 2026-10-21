export type BrowserReleaseAdapterCandidateApprovalRole = "architecture" | "operations" | "security-network";

export interface BrowserReleaseAdapterCandidateApproval {
  readonly role: BrowserReleaseAdapterCandidateApprovalRole;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface BrowserReleaseAdapterCandidateAuthorization {
  readonly candidateId: string;
  readonly executionEnvironment: "non-production";
  readonly adapterImplementation: string;
  readonly sourceRevision: string;
  readonly browserEngine: string;
  readonly automationSessionMechanism: string;
  readonly executionTopology: string;
  readonly navigationNetworkBoundary: string;
  readonly sessionLifecycle: string;
  readonly representationAcquisition: string;
  readonly fixtureIdentities: string;
  readonly releaseCandidate: string;
  readonly capabilityRequirements: string;
  readonly featureGate: string;
  readonly featureGateDefault: "disabled";
  readonly disableRollback: string;
  readonly decisionEvidence: string;
  readonly approvals: readonly BrowserReleaseAdapterCandidateApproval[];
}

export class InvalidBrowserReleaseAdapterCandidateAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBrowserReleaseAdapterCandidateAuthorizationError";
  }
}

const requiredFields = [
  "candidateId", "adapterImplementation", "sourceRevision", "browserEngine",
  "automationSessionMechanism", "executionTopology", "navigationNetworkBoundary",
  "sessionLifecycle", "representationAcquisition", "fixtureIdentities", "releaseCandidate",
  "capabilityRequirements", "featureGate", "disableRollback", "decisionEvidence",
] as const satisfies readonly (keyof BrowserReleaseAdapterCandidateAuthorization)[];
const approvalFields = ["role", "approvedBy", "approvedAt"] as const;
const authorizationFields = [...requiredFields, "executionEnvironment", "featureGateDefault", "approvals"] as const;

function record(field: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidBrowserReleaseAdapterCandidateAuthorizationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(field: string, value: Readonly<Record<string, unknown>>, allowedFields: readonly string[]): void {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new InvalidBrowserReleaseAdapterCandidateAuthorizationError(`${field} contains unsupported field(s): ${unknown.sort().join(", ")}`);
  }
}

function nonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidBrowserReleaseAdapterCandidateAuthorizationError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function canonicalTimestamp(field: string, value: unknown): string {
  const timestamp = nonBlank(field, value);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new InvalidBrowserReleaseAdapterCandidateAuthorizationError(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function approval(value: unknown): Readonly<BrowserReleaseAdapterCandidateApproval> {
  const candidate = record("approval", value);
  rejectUnknown("approval", candidate, approvalFields);
  if (candidate.role !== "architecture" && candidate.role !== "operations" && candidate.role !== "security-network") {
    throw new InvalidBrowserReleaseAdapterCandidateAuthorizationError("approval role must be architecture, operations, or security-network");
  }
  return Object.freeze({
    role: candidate.role,
    approvedBy: nonBlank(`${candidate.role}.approvedBy`, candidate.approvedBy),
    approvedAt: canonicalTimestamp(`${candidate.role}.approvedAt`, candidate.approvedAt),
  });
}

/** Provider-neutral admission boundary only. It does not select a browser/runtime, authorize credentials/networking/production, or prove live-browser conformance. */
export function validateBrowserReleaseAdapterCandidateAuthorization(
  authorization: unknown,
): Readonly<BrowserReleaseAdapterCandidateAuthorization> {
  const candidate = record("authorization", authorization);
  rejectUnknown("authorization", candidate, authorizationFields);
  const normalized: Record<string, string> = {};
  for (const field of requiredFields) normalized[field] = nonBlank(field, candidate[field]);

  if (candidate.executionEnvironment !== "non-production") {
    throw new InvalidBrowserReleaseAdapterCandidateAuthorizationError("executionEnvironment must be non-production; production authorization is a separate gate");
  }
  if (candidate.featureGateDefault !== "disabled") {
    throw new InvalidBrowserReleaseAdapterCandidateAuthorizationError("featureGateDefault must be disabled for non-production candidate authorization");
  }
  if (!Array.isArray(candidate.approvals)) {
    throw new InvalidBrowserReleaseAdapterCandidateAuthorizationError("approvals must be an array");
  }
  const approvals = candidate.approvals.map(approval);
  for (const role of ["architecture", "operations", "security-network"] as const) {
    if (approvals.filter((item) => item.role === role).length !== 1) {
      throw new InvalidBrowserReleaseAdapterCandidateAuthorizationError(`exactly one ${role} approval is required`);
    }
  }

  return Object.freeze({
    ...(normalized as unknown as Omit<BrowserReleaseAdapterCandidateAuthorization, "executionEnvironment" | "featureGateDefault" | "approvals">),
    executionEnvironment: "non-production",
    featureGateDefault: "disabled",
    approvals: Object.freeze(approvals),
  });
}

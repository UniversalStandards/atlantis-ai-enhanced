export type DurablePersistenceCandidateApprovalRole = "architecture" | "operations";

export interface DurablePersistenceCandidateApproval {
  readonly role: DurablePersistenceCandidateApprovalRole;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface DurablePersistenceCandidateAuthorization {
  readonly candidateId: string;
  readonly executionEnvironment: "non-production";
  readonly productSubstrate: string;
  readonly versionServiceMode: string;
  readonly driverSdk: string;
  readonly authoritativeTopology: string;
  readonly consistencyMode: string;
  readonly transactionPrimitive: string;
  readonly independentClientTopology: string;
  readonly restartBoundary: string;
  readonly credentialClass: string;
  readonly networkBoundary: string;
  readonly featureGate: string;
  readonly featureGateDefault: "disabled";
  readonly rollbackDisable: string;
  readonly semanticMappingEvidence: string;
  readonly errorMappingEvidence: string;
  readonly failureInjectionPlan: string;
  readonly decisionEvidence: string;
  readonly approvals: readonly DurablePersistenceCandidateApproval[];
}

export class InvalidDurablePersistenceCandidateAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDurablePersistenceCandidateAuthorizationError";
  }
}

const requiredFields = [
  "candidateId",
  "productSubstrate",
  "versionServiceMode",
  "driverSdk",
  "authoritativeTopology",
  "consistencyMode",
  "transactionPrimitive",
  "independentClientTopology",
  "restartBoundary",
  "credentialClass",
  "networkBoundary",
  "featureGate",
  "rollbackDisable",
  "semanticMappingEvidence",
  "errorMappingEvidence",
  "failureInjectionPlan",
  "decisionEvidence",
] as const satisfies readonly (keyof DurablePersistenceCandidateAuthorization)[];

const approvalFields = ["role", "approvedBy", "approvedAt"] as const;
const authorizationFields = [...requiredFields, "executionEnvironment", "featureGateDefault", "approvals"] as const;

function requireRecord(field: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidDurablePersistenceCandidateAuthorizationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(
  field: string,
  value: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
): void {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new InvalidDurablePersistenceCandidateAuthorizationError(
      `${field} contains unsupported field(s): ${unknown.sort().join(", ")}`,
    );
  }
}

function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidDurablePersistenceCandidateAuthorizationError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function requireCanonicalTimestamp(field: string, value: unknown): string {
  const timestamp = requireNonBlank(field, value);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    throw new InvalidDurablePersistenceCandidateAuthorizationError(`${field} must be a canonical ISO timestamp`);
  }
  const canonical = new Date(parsed).toISOString();
  if (timestamp !== canonical) {
    throw new InvalidDurablePersistenceCandidateAuthorizationError(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function validateApproval(approval: unknown): Readonly<DurablePersistenceCandidateApproval> {
  const record = requireRecord("approval", approval);
  rejectUnknownFields("approval", record, approvalFields);

  if (record.role !== "architecture" && record.role !== "operations") {
    throw new InvalidDurablePersistenceCandidateAuthorizationError("approval role must be architecture or operations");
  }
  const approvedBy = requireNonBlank(`${record.role}.approvedBy`, record.approvedBy);
  const approvedAt = requireCanonicalTimestamp(`${record.role}.approvedAt`, record.approvedAt);
  return Object.freeze({ role: record.role, approvedBy, approvedAt });
}

/**
 * Provider-neutral admission boundary for the architecture/operations record.
 * This validates decision completeness only; it does not authorize production,
 * prove provider semantics, or substitute for executable conformance evidence.
 */
export function validateDurablePersistenceCandidateAuthorization(
  authorization: unknown,
): Readonly<DurablePersistenceCandidateAuthorization> {
  const record = requireRecord("authorization", authorization);
  rejectUnknownFields("authorization", record, authorizationFields);

  const normalized: Record<string, string> = {};
  for (const field of requiredFields) normalized[field] = requireNonBlank(field, record[field]);

  if (record.executionEnvironment !== "non-production") {
    throw new InvalidDurablePersistenceCandidateAuthorizationError(
      "executionEnvironment must be non-production; production authorization is a separate gate",
    );
  }

  if (record.featureGateDefault !== "disabled") {
    throw new InvalidDurablePersistenceCandidateAuthorizationError(
      "featureGateDefault must be disabled for non-production candidate authorization",
    );
  }

  if (!Array.isArray(record.approvals)) {
    throw new InvalidDurablePersistenceCandidateAuthorizationError("approvals must be an array");
  }
  const approvals = record.approvals.map(validateApproval);
  for (const role of ["architecture", "operations"] as const) {
    if (approvals.filter((approval) => approval.role === role).length !== 1) {
      throw new InvalidDurablePersistenceCandidateAuthorizationError(`exactly one ${role} approval is required`);
    }
  }

  return Object.freeze({
    ...(normalized as unknown as Omit<DurablePersistenceCandidateAuthorization, "executionEnvironment" | "featureGateDefault" | "approvals">),
    executionEnvironment: "non-production",
    featureGateDefault: "disabled",
    approvals: Object.freeze(approvals),
  });
}

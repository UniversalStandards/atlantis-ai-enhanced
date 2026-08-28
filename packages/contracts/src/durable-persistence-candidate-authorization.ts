export type DurablePersistenceCandidateApprovalRole = "architecture" | "operations";

export interface DurablePersistenceCandidateApproval {
  readonly role: DurablePersistenceCandidateApprovalRole;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface DurablePersistenceCandidateAuthorization {
  readonly candidateId: string;
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

function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidDurablePersistenceCandidateAuthorizationError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function validateApproval(approval: DurablePersistenceCandidateApproval): Readonly<DurablePersistenceCandidateApproval> {
  if (approval.role !== "architecture" && approval.role !== "operations") {
    throw new InvalidDurablePersistenceCandidateAuthorizationError("approval role must be architecture or operations");
  }
  const approvedBy = requireNonBlank(`${approval.role}.approvedBy`, approval.approvedBy);
  const approvedAt = requireNonBlank(`${approval.role}.approvedAt`, approval.approvedAt);
  if (!Number.isFinite(Date.parse(approvedAt))) {
    throw new InvalidDurablePersistenceCandidateAuthorizationError(`${approval.role}.approvedAt must be an ISO-compatible timestamp`);
  }
  return Object.freeze({ role: approval.role, approvedBy, approvedAt });
}

/**
 * Provider-neutral admission boundary for the architecture/operations record.
 * This validates decision completeness only; it does not authorize production,
 * prove provider semantics, or substitute for executable conformance evidence.
 */
export function validateDurablePersistenceCandidateAuthorization(
  authorization: DurablePersistenceCandidateAuthorization,
): Readonly<DurablePersistenceCandidateAuthorization> {
  const normalized = { ...authorization } as Record<string, unknown>;
  for (const field of requiredFields) normalized[field] = requireNonBlank(field, authorization[field]);

  if (!Array.isArray(authorization.approvals)) {
    throw new InvalidDurablePersistenceCandidateAuthorizationError("approvals must be an array");
  }
  const approvals = authorization.approvals.map(validateApproval);
  for (const role of ["architecture", "operations"] as const) {
    if (approvals.filter((approval) => approval.role === role).length !== 1) {
      throw new InvalidDurablePersistenceCandidateAuthorizationError(`exactly one ${role} approval is required`);
    }
  }

  return Object.freeze({
    ...(normalized as unknown as DurablePersistenceCandidateAuthorization),
    approvals: Object.freeze(approvals),
  });
}

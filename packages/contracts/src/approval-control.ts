export type ApprovalDecision = "approved" | "rejected";

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly executionId: string;
  readonly requestVersion: number;
  readonly stepId: string;
  readonly action: string;
  readonly reason: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ApprovalResolution {
  readonly approvalId: string;
  readonly executionId: string;
  readonly requestVersion: number;
  readonly decision: ApprovalDecision;
  readonly resolvedBy: string;
  readonly resolvedAt: string;
  readonly comment?: string;
}

export interface ResolvedApproval {
  readonly request: ApprovalRequest;
  readonly resolution: ApprovalResolution;
}

export class InvalidApprovalError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidApprovalError";
  }
}

export class ApprovalRequiredError extends Error {
  public constructor(public readonly request: ApprovalRequest) {
    super(`Approval ${request.approvalId} is required for ${request.action}`);
    this.name = "ApprovalRequiredError";
  }
}

export class ApprovalRejectedError extends Error {
  public constructor(public readonly approval: ResolvedApproval) {
    super(`Approval ${approval.request.approvalId} was rejected`);
    this.name = "ApprovalRejectedError";
  }
}

function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidApprovalError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function requirePositiveSafeInteger(field: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new InvalidApprovalError(`${field} must be a positive safe integer`);
  }
  return value as number;
}

function requireCanonicalTimestamp(field: string, value: unknown): string {
  const timestamp = requireNonBlank(field, value);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new InvalidApprovalError(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function normalizeMetadata(
  metadata: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new InvalidApprovalError("metadata must be a string record");
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = requireNonBlank("metadata key", key);
    normalized[normalizedKey] = requireNonBlank(`metadata.${normalizedKey}`, value);
  }
  return Object.freeze(normalized);
}

export function normalizeApprovalRequest(request: ApprovalRequest): ApprovalRequest {
  return Object.freeze({
    approvalId: requireNonBlank("approvalId", request.approvalId),
    executionId: requireNonBlank("executionId", request.executionId),
    requestVersion: requirePositiveSafeInteger("requestVersion", request.requestVersion),
    stepId: requireNonBlank("stepId", request.stepId),
    action: requireNonBlank("action", request.action),
    reason: requireNonBlank("reason", request.reason),
    requestedBy: requireNonBlank("requestedBy", request.requestedBy),
    requestedAt: requireCanonicalTimestamp("requestedAt", request.requestedAt),
    metadata: normalizeMetadata(request.metadata),
  });
}

export function resolveApproval(
  rawRequest: ApprovalRequest,
  rawResolution: ApprovalResolution,
): ResolvedApproval {
  const request = normalizeApprovalRequest(rawRequest);
  const decision = rawResolution.decision;
  if (decision !== "approved" && decision !== "rejected") {
    throw new InvalidApprovalError("decision must be approved or rejected");
  }

  const resolution: ApprovalResolution = Object.freeze({
    approvalId: requireNonBlank("approvalId", rawResolution.approvalId),
    executionId: requireNonBlank("executionId", rawResolution.executionId),
    requestVersion: requirePositiveSafeInteger(
      "requestVersion",
      rawResolution.requestVersion,
    ),
    decision,
    resolvedBy: requireNonBlank("resolvedBy", rawResolution.resolvedBy),
    resolvedAt: requireCanonicalTimestamp("resolvedAt", rawResolution.resolvedAt),
    ...(rawResolution.comment === undefined
      ? {}
      : { comment: requireNonBlank("comment", rawResolution.comment) }),
  });

  if (resolution.approvalId !== request.approvalId) {
    throw new InvalidApprovalError("resolution approvalId does not match request");
  }
  if (resolution.executionId !== request.executionId) {
    throw new InvalidApprovalError("resolution executionId does not match request");
  }
  if (resolution.requestVersion !== request.requestVersion) {
    throw new InvalidApprovalError("resolution requestVersion does not match request");
  }
  if (resolution.resolvedAt < request.requestedAt) {
    throw new InvalidApprovalError("resolution cannot predate the approval request");
  }

  return Object.freeze({ request, resolution });
}

export function requireApproved(
  request: ApprovalRequest,
  resolution?: ApprovalResolution,
): ResolvedApproval {
  const normalizedRequest = normalizeApprovalRequest(request);
  if (resolution === undefined) {
    throw new ApprovalRequiredError(normalizedRequest);
  }

  const approval = resolveApproval(normalizedRequest, resolution);
  if (approval.resolution.decision === "rejected") {
    throw new ApprovalRejectedError(approval);
  }
  return approval;
}

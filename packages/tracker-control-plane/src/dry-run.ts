import {
  assessTrackerProjectionCompatibility,
  canonicalizeTrackerProjectionValue,
  type TrackerProjectionCompatibility,
  type TrackerProjectionEntityType,
  type TrackerProjectionVersion,
} from "@atlantis/contracts/tracker-projection";

import {
  createTrackerSynchronizationIdentity,
  type IdempotencyOutcome,
  type IdempotencyPort,
  type IdempotencyRecordResult,
  type TrackerSynchronizationIdentity,
} from "./idempotency.js";

export interface TrackerSourceIdentity {
  readonly system: string;
  readonly repository: string;
  readonly entityType: TrackerProjectionEntityType;
  readonly entityId: number;
  readonly sourceRevision: string;
}

export interface TrackerTargetIdentity {
  readonly system: string;
  readonly entityType: TrackerProjectionEntityType;
  readonly entityId: string | number;
}

export interface TrackerMutationProposal {
  readonly source: TrackerSourceIdentity;
  readonly target: TrackerTargetIdentity;
  readonly priorProjection: unknown | null;
  readonly proposedProjection: unknown;
  readonly changedFields: readonly string[];
  readonly reason: string;
  readonly authority: AuthorityClassification;
  readonly projectionVersion: TrackerProjectionVersion;
  readonly idempotencyKey: string;
}

export type AuthorityClassification = "authorized" | "denied" | "ambiguous";

export type AuthorityDecision =
  | Readonly<{ classification: "authorized" }>
  | Readonly<{ classification: "denied"; code: string }>
  | Readonly<{ classification: "ambiguous"; code: string }>;

export interface TrackerAuthorityPort {
  decide(proposal: TrackerMutationProposal): Promise<AuthorityDecision> | AuthorityDecision;
}

const admissionToken: unique symbol = Symbol("admitted-tracker-mutation");

export interface AdmittedTrackerMutation {
  readonly proposal: TrackerMutationProposal;
  readonly [admissionToken]: true;
}

export interface TrackerMutationPort {
  admit(mutation: AdmittedTrackerMutation): Promise<unknown> | unknown;
}

export interface TrackerSynchronizationRequest {
  readonly sourceSystem: string;
  readonly sourceProjection: unknown;
  readonly target: TrackerTargetIdentity;
  readonly priorProjection: unknown | null;
  readonly proposedProjection: unknown;
  readonly reason: string;
  readonly dryRun: boolean;
}

export interface TrackerSynchronizationPorts {
  readonly authority: TrackerAuthorityPort;
  readonly idempotency: IdempotencyPort;
  readonly mutation: TrackerMutationPort;
}

export type TrackerSynchronizationResult =
  | Readonly<{ status: "dry-run"; proposal: TrackerMutationProposal }>
  | Readonly<{ status: "applied"; proposal: TrackerMutationProposal; result: unknown }>
  | Readonly<{ status: "replayed"; proposal: TrackerMutationProposal; outcome: IdempotencyOutcome }>
  | Readonly<{ status: "claim-conflict"; code: "IDEMPOTENCY_CLAIM_CONFLICT"; key: string }>
  | Readonly<{ status: "authority-denied"; code: string; proposal: TrackerMutationProposal }>
  | Readonly<{ status: "authority-ambiguous"; code: string; proposal: TrackerMutationProposal }>
  | Readonly<{ status: "unsupported-version"; compatibility: TrackerProjectionCompatibility }>
  | Readonly<{ status: "invalid-projection"; code: "MALFORMED_PROJECTION"; reason: string }>
  | Readonly<{ status: "invalid-identity"; code: "MALFORMED_IDENTITY"; reason: string }>
  | Readonly<{ status: "invalid-request"; code: "MALFORMED_REQUEST"; reason: string }>
  | Readonly<{ status: "authority-error"; code: "AUTHORITY_EVALUATION_FAILED"; proposal: TrackerMutationProposal }>
  | Readonly<{ status: "idempotency-error"; code: "IDEMPOTENCY_PORT_FAILED"; key: string }>
  | Readonly<{ status: "replay-missing"; code: "IDEMPOTENCY_REPLAY_MISSING"; key: string }>
  | Readonly<{ status: "mutation-failed"; code: "TARGET_MUTATION_FAILED"; recorded: boolean; key: string }>
  | Readonly<{ status: "record-failed"; record: IdempotencyRecordResult; key: string }>;

export async function synchronizeTrackerMutation(
  request: TrackerSynchronizationRequest,
  ports: TrackerSynchronizationPorts,
): Promise<TrackerSynchronizationResult> {
  const proposalResult = createProposal(request);
  if (proposalResult.status !== "valid") {
    return proposalResult;
  }
  const proposal = proposalResult.proposal;
  const compatibility = assessTrackerProjectionCompatibility(proposalResult.sourceProjection);
  if (compatibility.status !== "supported") {
    return compatibility.status === "unsupported-major"
      ? Object.freeze({ status: "unsupported-version", compatibility })
      : Object.freeze({
          status: "invalid-projection",
          code: "MALFORMED_PROJECTION",
          reason: compatibility.reason,
        });
  }

  let authority: AuthorityDecision;
  try {
    authority = await ports.authority.decide(proposal);
  } catch {
    return Object.freeze({
      status: "authority-error",
      code: "AUTHORITY_EVALUATION_FAILED",
      proposal,
    });
  }
  if (
    !authority ||
    (authority.classification !== "authorized" &&
      authority.classification !== "denied" &&
      authority.classification !== "ambiguous") ||
    (authority.classification !== "authorized" &&
      (typeof authority.code !== "string" || authority.code.trim().length === 0))
  ) {
    return Object.freeze({
      status: "authority-ambiguous",
      code: "MALFORMED_AUTHORITY_DECISION",
      proposal,
    });
  }
  const authorizedProposal = Object.freeze({
    ...proposal,
    authority: authority.classification,
  });
  if (proposalResult.dryRun) {
    return Object.freeze({ status: "dry-run", proposal: authorizedProposal });
  }
  if (authority.classification === "denied") {
    return Object.freeze({
      status: "authority-denied",
      code: authority.code,
      proposal: authorizedProposal,
    });
  }
  if (authority.classification !== "authorized") {
    return Object.freeze({
      status: "authority-ambiguous",
      code: authority.classification === "ambiguous" ? authority.code : "UNKNOWN_AUTHORITY",
      proposal: authorizedProposal,
    });
  }

  let claim;
  try {
    claim = await ports.idempotency.claim(proposal.idempotencyKey);
  } catch {
    return Object.freeze({
      status: "idempotency-error",
      code: "IDEMPOTENCY_PORT_FAILED",
      key: proposal.idempotencyKey,
    });
  }
  if (claim.status === "conflict") {
    return Object.freeze({
      status: "claim-conflict",
      code: "IDEMPOTENCY_CLAIM_CONFLICT",
      key: proposal.idempotencyKey,
    });
  }
  if (claim.status === "invalid-key") {
    return Object.freeze({
      status: "idempotency-error",
      code: "IDEMPOTENCY_PORT_FAILED",
      key: proposal.idempotencyKey,
    });
  }
  if (claim.status === "replay") {
    try {
      const outcome = await ports.idempotency.replay(proposal.idempotencyKey);
      return outcome
        ? Object.freeze({ status: "replayed", proposal: authorizedProposal, outcome })
        : Object.freeze({
            status: "replay-missing",
            code: "IDEMPOTENCY_REPLAY_MISSING",
            key: proposal.idempotencyKey,
          });
    } catch {
      return Object.freeze({
        status: "idempotency-error",
        code: "IDEMPOTENCY_PORT_FAILED",
        key: proposal.idempotencyKey,
      });
    }
  }

  let result: unknown;
  try {
    result = await ports.mutation.admit(
      Object.freeze({ proposal: authorizedProposal, [admissionToken]: true as const }),
    );
  } catch {
    const recordResult = await recordOutcome(ports.idempotency, proposal.idempotencyKey, {
      status: "failed",
      code: "TARGET_MUTATION_FAILED",
    });
    return recordResult.status === "recorded"
      ? Object.freeze({
          status: "mutation-failed",
          code: "TARGET_MUTATION_FAILED",
          recorded: true,
          key: proposal.idempotencyKey,
        })
      : Object.freeze({
          status: "record-failed",
          record: recordResult,
          key: proposal.idempotencyKey,
        });
  }
  const recordResult = await recordOutcome(ports.idempotency, proposal.idempotencyKey, {
    status: "applied",
    result,
  });
  return recordResult.status === "recorded"
    ? Object.freeze({ status: "applied", proposal: authorizedProposal, result })
    : Object.freeze({
        status: "record-failed",
        record: recordResult,
        key: proposal.idempotencyKey,
      });
}

function createProposal(
  request: TrackerSynchronizationRequest,
):
  | Readonly<{
      status: "valid";
      proposal: TrackerMutationProposal;
      sourceProjection: unknown;
      dryRun: boolean;
    }>
  | Extract<TrackerSynchronizationResult, { status: "invalid-identity" | "invalid-request" }> {
  try {
    const requestRecord = ownRecord(request, "request");
    const sourceProjection = requestRecord.sourceProjection;
    const projection = ownRecord(sourceProjection, "sourceProjection");
    const version = ownRecord(projection.projectionVersion, "projectionVersion");
    const targetInput = ownRecord(requestRecord.target, "target");
    const identityResult = createTrackerSynchronizationIdentity({
      sourceSystem: requestRecord.sourceSystem,
      repository: projection.repository,
      entityType: projection.entityType,
      entityId: projection.entityId,
      sourceRevision: projection.sourceRevision,
      targetSystem: targetInput.system,
      projectionVersion: version,
    });
    if (identityResult.status !== "valid") {
      return Object.freeze({
        status: "invalid-identity",
        code: "MALFORMED_IDENTITY",
        reason: identityResult.reason,
      });
    }
    const source: TrackerSourceIdentity = Object.freeze({
      system: identityResult.identity.sourceSystem,
      repository: identityResult.identity.repository,
      entityType: identityResult.identity.entityType,
      entityId: identityResult.identity.entityId,
      sourceRevision: identityResult.identity.sourceRevision,
    });
    const target: TrackerTargetIdentity = Object.freeze({
      system: identityResult.identity.targetSystem,
      entityType: requireEntityType(targetInput.entityType),
      entityId: requireTargetId(targetInput.entityId),
    });
    const reason = requireText(requestRecord.reason, "reason");
    const dryRun = requestRecord.dryRun;
    if (typeof dryRun !== "boolean") {
      throw new TypeError("dryRun must be a boolean");
    }
    const proposedProjection = snapshotProjection(requestRecord.proposedProjection);
    const priorProjection =
      requestRecord.priorProjection === null
        ? null
        : snapshotProjection(requestRecord.priorProjection);
    const changedFields = diffSemanticFields(priorProjection, proposedProjection);
    return Object.freeze({
      status: "valid",
      sourceProjection,
      dryRun,
      proposal: Object.freeze({
        source,
        target,
        priorProjection,
        proposedProjection,
        changedFields,
        reason,
        authority: "ambiguous" as const,
        projectionVersion: identityResult.identity.projectionVersion,
        idempotencyKey: identityResult.key,
      }),
    });
  } catch (error) {
    return Object.freeze({
      status: "invalid-request",
      code: "MALFORMED_REQUEST",
      reason: error instanceof Error ? error.message : "request is malformed",
    });
  }
}

function diffSemanticFields(prior: unknown | null, proposed: unknown): readonly string[] {
  const priorFields = semanticFields(prior);
  const proposedFields = semanticFields(proposed);
  const names = new Set([...Object.keys(priorFields), ...Object.keys(proposedFields)]);
  return Object.freeze(
    [...names]
      .filter(
        (name) =>
          !Object.hasOwn(priorFields, name) ||
          !Object.hasOwn(proposedFields, name) ||
          canonicalizeTrackerProjectionValue(priorFields[name]) !==
            canonicalizeTrackerProjectionValue(proposedFields[name]),
      )
      .sort(),
  );
}

function semanticFields(value: unknown | null): Record<string, unknown> {
  if (value === null) {
    return {};
  }
  const record = ownRecord(value, "projection");
  const fields = Object.hasOwn(record, "semanticFields")
    ? ownRecord(record.semanticFields, "semanticFields")
    : record;
  return fields;
}

function ownRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError(`${field} must not contain symbol properties`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${field}.${key} must be a data property`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function requireEntityType(value: unknown): TrackerProjectionEntityType {
  if (value !== "issue" && value !== "pull_request") {
    throw new TypeError("target.entityType must be issue or pull_request");
  }
  return value;
}

function requireTargetId(value: unknown): string | number {
  if (
    (typeof value !== "string" || value.trim().length === 0) &&
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new TypeError("target.entityId must be non-blank text or a positive safe integer");
  }
  return typeof value === "string" ? value.trim() : value;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be non-blank text`);
  }
  return value.trim();
}

async function recordOutcome(
  port: IdempotencyPort,
  key: string,
  outcome: IdempotencyOutcome,
): Promise<IdempotencyRecordResult> {
  try {
    return await port.record(key, outcome);
  } catch {
    return Object.freeze({ status: "port-failed" });
  }
}

function snapshotProjection(value: unknown): unknown {
  return deepFreeze(JSON.parse(canonicalizeTrackerProjectionValue(value)) as unknown);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

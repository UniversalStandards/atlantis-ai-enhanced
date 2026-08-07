import {
  normalizeExactDataRecord,
  requireExactDataFields,
  type ExactDataRecord,
} from "./exact-data-record.js";

export type ProductionAppendOutcome =
  | ProductionAppendCommitted
  | ProductionAppendConflict
  | ProductionAppendKnownFailure
  | ProductionAppendUncertain;

export interface ProductionAppendCommitted {
  readonly kind: "committed";
  readonly eventId: string;
  readonly executionId: string;
  readonly streamVersion: number;
  readonly globalSequence?: number;
  readonly contentDigest: string;
}

export interface ProductionAppendConflict {
  readonly kind: "conflict";
  readonly reason: "stream_version" | "duplicate_event_id";
  readonly executionId: string;
  readonly eventId: string;
  readonly expectedStreamVersion: number;
  readonly observedStreamVersion?: number;
}

export interface ProductionAppendKnownFailure {
  readonly kind: "known_failure";
  readonly operationId: string;
  readonly executionId: string;
  readonly eventId: string;
  readonly retryable: boolean;
  readonly failureCode: string;
}

export interface ProductionAppendUncertain {
  readonly kind: "uncertain";
  readonly operationId: string;
  readonly executionId: string;
  readonly eventId: string;
  readonly expectedStreamVersion: number;
  readonly contentDigest: string;
  readonly providerOperationId?: string;
  readonly observedAt: string;
}

export interface ExpectedPersistenceEvent {
  readonly operationId: string;
  readonly eventId: string;
  readonly executionId: string;
  readonly streamVersion: number;
  readonly contentDigest: string;
}

export interface ObservedPersistenceEvent {
  readonly eventId: string;
  readonly executionId: string;
  readonly streamVersion: number;
  readonly contentDigest: string;
}

export type NonCommitProofProvenance =
  | "provider_transaction_status"
  | "provider_idempotency_lookup"
  | "authoritative_post_write_read";

export type NonCommitProofVerificationMethod =
  | "provider_signed_response"
  | "authenticated_provider_api"
  | "transactionally_consistent_read";

/**
 * Provider-neutral proof that one exact append operation did not commit.
 * Every attempted-append identity field is repeated so reconciliation can
 * reject stale, cross-execution, cross-event, or replayed proof before retry.
 */
export interface PersistenceNonCommitProof {
  readonly proofId: string;
  readonly uncertaintyRecordId: string;
  readonly operationId: string;
  readonly providerOperationId: string;
  readonly executionId: string;
  readonly eventId: string;
  readonly expectedStreamVersion: number;
  readonly contentDigest: string;
  readonly providerObservationId: string;
  readonly proofIssuer: string;
  readonly verificationMethod: NonCommitProofVerificationMethod;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly provenance: NonCommitProofProvenance;
}

export interface PersistenceReconciliationEvidence {
  readonly expected: ExpectedPersistenceEvent;
  /** Authoritative durable event observed at the expected stream position. */
  readonly observedAtExpectedPosition?: ObservedPersistenceEvent;
  /** Authoritative, identity-bound provider proof that the append did not commit. */
  readonly nonCommitProof?: PersistenceNonCommitProof;
}

/**
 * Trusted deterministic time context for an authorization-bearing
 * reconciliation decision. The composition root must supply this value from a
 * trusted clock boundary rather than ambient wall-clock reads inside the
 * classifier.
 */
export interface PersistenceReconciliationDecisionContext {
  readonly decisionAt: string;
}

export type PersistenceReconciliationDecision =
  | { readonly kind: "committed" }
  | { readonly kind: "conflict"; readonly quarantine: true }
  | { readonly kind: "retry_permitted" }
  | { readonly kind: "uncertain"; readonly blockFurtherMutation: true };

export class InvalidPersistenceReconciliationEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistenceReconciliationEvidenceError";
  }
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      `${field} must be a non-empty string`,
    );
  }
}

function requireStreamVersion(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      `${field} must be a positive safe integer`,
    );
  }
}

function requireCanonicalTimestamp(value: unknown, field: string): asserts value is string {
  requireNonEmpty(value, field);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      `${field} must be a canonical ISO-8601 UTC timestamp`,
    );
  }
}

function normalizeRecord(
  subject: string,
  value: unknown,
  allowedFields: readonly string[],
  requiredFields: readonly string[],
): ExactDataRecord {
  try {
    const record = normalizeExactDataRecord(subject, value, allowedFields);
    requireExactDataFields(subject, record, requiredFields);
    return record;
  } catch (error) {
    if (error instanceof InvalidPersistenceReconciliationEvidenceError) {
      throw error;
    }
    throw new InvalidPersistenceReconciliationEvidenceError(
      error instanceof Error ? error.message : `${subject} is invalid`,
    );
  }
}

function normalizeExpectedEvent(value: unknown): ExpectedPersistenceEvent {
  const event = normalizeRecord(
    "expected",
    value,
    ["operationId", "eventId", "executionId", "streamVersion", "contentDigest"],
    ["operationId", "eventId", "executionId", "streamVersion", "contentDigest"],
  );

  requireNonEmpty(event.operationId, "expected.operationId");
  requireNonEmpty(event.eventId, "expected.eventId");
  requireNonEmpty(event.executionId, "expected.executionId");
  requireStreamVersion(event.streamVersion, "expected.streamVersion");
  requireNonEmpty(event.contentDigest, "expected.contentDigest");

  return Object.freeze({
    operationId: event.operationId,
    eventId: event.eventId,
    executionId: event.executionId,
    streamVersion: event.streamVersion,
    contentDigest: event.contentDigest,
  });
}

function normalizeObservedEvent(value: unknown): ObservedPersistenceEvent {
  const event = normalizeRecord(
    "observedAtExpectedPosition",
    value,
    ["eventId", "executionId", "streamVersion", "contentDigest"],
    ["eventId", "executionId", "streamVersion", "contentDigest"],
  );

  requireNonEmpty(event.eventId, "observedAtExpectedPosition.eventId");
  requireNonEmpty(event.executionId, "observedAtExpectedPosition.executionId");
  requireStreamVersion(
    event.streamVersion,
    "observedAtExpectedPosition.streamVersion",
  );
  requireNonEmpty(
    event.contentDigest,
    "observedAtExpectedPosition.contentDigest",
  );

  return Object.freeze({
    eventId: event.eventId,
    executionId: event.executionId,
    streamVersion: event.streamVersion,
    contentDigest: event.contentDigest,
  });
}

function normalizeNonCommitProof(
  value: unknown,
  expected: ExpectedPersistenceEvent,
): PersistenceNonCommitProof {
  const proof = normalizeRecord(
    "nonCommitProof",
    value,
    [
      "proofId",
      "uncertaintyRecordId",
      "operationId",
      "providerOperationId",
      "executionId",
      "eventId",
      "expectedStreamVersion",
      "contentDigest",
      "providerObservationId",
      "proofIssuer",
      "verificationMethod",
      "observedAt",
      "validUntil",
      "provenance",
    ],
    [
      "proofId",
      "uncertaintyRecordId",
      "operationId",
      "providerOperationId",
      "executionId",
      "eventId",
      "expectedStreamVersion",
      "contentDigest",
      "providerObservationId",
      "proofIssuer",
      "verificationMethod",
      "observedAt",
      "validUntil",
      "provenance",
    ],
  );

  requireNonEmpty(proof.proofId, "nonCommitProof.proofId");
  requireNonEmpty(proof.uncertaintyRecordId, "nonCommitProof.uncertaintyRecordId");
  requireNonEmpty(proof.operationId, "nonCommitProof.operationId");
  requireNonEmpty(proof.providerOperationId, "nonCommitProof.providerOperationId");
  requireNonEmpty(proof.executionId, "nonCommitProof.executionId");
  requireNonEmpty(proof.eventId, "nonCommitProof.eventId");
  requireStreamVersion(
    proof.expectedStreamVersion,
    "nonCommitProof.expectedStreamVersion",
  );
  requireNonEmpty(proof.contentDigest, "nonCommitProof.contentDigest");
  requireNonEmpty(
    proof.providerObservationId,
    "nonCommitProof.providerObservationId",
  );
  requireNonEmpty(proof.proofIssuer, "nonCommitProof.proofIssuer");
  requireCanonicalTimestamp(proof.observedAt, "nonCommitProof.observedAt");
  requireCanonicalTimestamp(proof.validUntil, "nonCommitProof.validUntil");
  requireNonEmpty(proof.verificationMethod, "nonCommitProof.verificationMethod");
  requireNonEmpty(proof.provenance, "nonCommitProof.provenance");

  if (proof.validUntil < proof.observedAt) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      "nonCommitProof.validUntil cannot precede nonCommitProof.observedAt",
    );
  }

  if (![
    "provider_signed_response",
    "authenticated_provider_api",
    "transactionally_consistent_read",
  ].includes(proof.verificationMethod)) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      "nonCommitProof.verificationMethod is not supported",
    );
  }

  if (![
    "provider_transaction_status",
    "provider_idempotency_lookup",
    "authoritative_post_write_read",
  ].includes(proof.provenance)) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      "nonCommitProof.provenance is not supported",
    );
  }

  const exactBinding =
    proof.operationId === expected.operationId &&
    proof.executionId === expected.executionId &&
    proof.eventId === expected.eventId &&
    proof.expectedStreamVersion === expected.streamVersion &&
    proof.contentDigest === expected.contentDigest;

  if (!exactBinding) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      "nonCommitProof must be bound to the exact expected append identity",
    );
  }

  return Object.freeze({
    proofId: proof.proofId,
    uncertaintyRecordId: proof.uncertaintyRecordId,
    operationId: proof.operationId,
    providerOperationId: proof.providerOperationId,
    executionId: proof.executionId,
    eventId: proof.eventId,
    expectedStreamVersion: proof.expectedStreamVersion,
    contentDigest: proof.contentDigest,
    providerObservationId: proof.providerObservationId,
    proofIssuer: proof.proofIssuer,
    verificationMethod: proof.verificationMethod as NonCommitProofVerificationMethod,
    observedAt: proof.observedAt,
    validUntil: proof.validUntil,
    provenance: proof.provenance as NonCommitProofProvenance,
  });
}

function normalizeDecisionContext(
  value: unknown,
): PersistenceReconciliationDecisionContext {
  const context = normalizeRecord(
    "decisionContext",
    value,
    ["decisionAt"],
    ["decisionAt"],
  );
  requireCanonicalTimestamp(context.decisionAt, "decisionContext.decisionAt");
  return Object.freeze({ decisionAt: context.decisionAt });
}

/**
 * Classifies authoritative reconciliation evidence without provider-specific
 * assumptions. A committed decision is derived only from an exact immutable
 * identity, stream-position, and content-digest match. Retry is authorized
 * only by a validated proof envelope bound to the exact append operation and
 * a trusted deterministic decision time within that proof's validity window.
 * Missing decision-time context fails closed to uncertainty; a trusted clock
 * that precedes the proof observation is rejected as invalid reconciliation
 * context. Runtime evidence and decision context are normalized as exact data
 * records before nested fields are read.
 */
export function classifyPersistenceReconciliation(
  evidence: PersistenceReconciliationEvidence,
  decisionContext?: PersistenceReconciliationDecisionContext,
): PersistenceReconciliationDecision {
  const root = normalizeRecord(
    "evidence",
    evidence,
    ["expected", "observedAtExpectedPosition", "nonCommitProof"],
    ["expected"],
  );
  const expected = normalizeExpectedEvent(root.expected);

  const proof = Object.prototype.hasOwnProperty.call(root, "nonCommitProof")
    ? normalizeNonCommitProof(root.nonCommitProof, expected)
    : undefined;

  const observed = Object.prototype.hasOwnProperty.call(
    root,
    "observedAtExpectedPosition",
  )
    ? normalizeObservedEvent(root.observedAtExpectedPosition)
    : undefined;

  if (observed !== undefined) {
    if (observed.streamVersion !== expected.streamVersion) {
      throw new InvalidPersistenceReconciliationEvidenceError(
        "observedAtExpectedPosition.streamVersion must equal expected.streamVersion",
      );
    }

    if (proof !== undefined) {
      throw new InvalidPersistenceReconciliationEvidenceError(
        "a durable event at the expected position cannot coexist with proof of non-commit",
      );
    }

    const exactMatch =
      observed.eventId === expected.eventId &&
      observed.executionId === expected.executionId &&
      observed.contentDigest === expected.contentDigest;

    return exactMatch
      ? Object.freeze({ kind: "committed" })
      : Object.freeze({ kind: "conflict", quarantine: true });
  }

  if (proof !== undefined) {
    if (decisionContext === undefined) {
      return Object.freeze({ kind: "uncertain", blockFurtherMutation: true });
    }

    const context = normalizeDecisionContext(decisionContext);
    if (context.decisionAt < proof.observedAt) {
      throw new InvalidPersistenceReconciliationEvidenceError(
        "decisionContext.decisionAt cannot precede nonCommitProof.observedAt",
      );
    }

    if (context.decisionAt > proof.validUntil) {
      return Object.freeze({ kind: "uncertain", blockFurtherMutation: true });
    }

    return Object.freeze({ kind: "retry_permitted" });
  }

  return Object.freeze({ kind: "uncertain", blockFurtherMutation: true });
}

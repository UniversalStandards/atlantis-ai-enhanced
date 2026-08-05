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

export interface PersistenceReconciliationEvidence {
  readonly expected: ExpectedPersistenceEvent;
  /** Authoritative durable event observed at the expected stream position. */
  readonly observedAtExpectedPosition?: ObservedPersistenceEvent;
  /** Authoritative provider proof that the attempted transition did not commit. */
  readonly providerProvesNotCommitted: boolean;
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

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      `${field} must be a non-empty string`,
    );
  }
}

function requireStreamVersion(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      `${field} must be a positive safe integer`,
    );
  }
}

function validateEventIdentity(
  event: ExpectedPersistenceEvent | ObservedPersistenceEvent,
  field: "expected" | "observedAtExpectedPosition",
): void {
  requireNonEmpty(event.eventId, `${field}.eventId`);
  requireNonEmpty(event.executionId, `${field}.executionId`);
  requireStreamVersion(event.streamVersion, `${field}.streamVersion`);
  requireNonEmpty(event.contentDigest, `${field}.contentDigest`);
}

/**
 * Classifies authoritative reconciliation evidence without provider-specific
 * assumptions. A committed decision is derived only from an exact immutable
 * identity, stream-position, and content-digest match. Ambiguity remains
 * blocked; this function never trusts a caller-supplied match assertion.
 */
export function classifyPersistenceReconciliation(
  evidence: PersistenceReconciliationEvidence,
): PersistenceReconciliationDecision {
  validateEventIdentity(evidence.expected, "expected");

  const observed = evidence.observedAtExpectedPosition;
  if (observed !== undefined) {
    validateEventIdentity(observed, "observedAtExpectedPosition");

    if (observed.streamVersion !== evidence.expected.streamVersion) {
      throw new InvalidPersistenceReconciliationEvidenceError(
        "observedAtExpectedPosition.streamVersion must equal expected.streamVersion",
      );
    }

    if (evidence.providerProvesNotCommitted) {
      throw new InvalidPersistenceReconciliationEvidenceError(
        "a durable event at the expected position cannot coexist with proof of non-commit",
      );
    }

    const exactMatch =
      observed.eventId === evidence.expected.eventId &&
      observed.executionId === evidence.expected.executionId &&
      observed.contentDigest === evidence.expected.contentDigest;

    return exactMatch
      ? Object.freeze({ kind: "committed" })
      : Object.freeze({ kind: "conflict", quarantine: true });
  }

  if (evidence.providerProvesNotCommitted) {
    return Object.freeze({ kind: "retry_permitted" });
  }

  return Object.freeze({ kind: "uncertain", blockFurtherMutation: true });
}

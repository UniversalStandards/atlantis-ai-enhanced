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

export interface PersistenceReconciliationEvidence {
  readonly exactEventMatch: boolean;
  readonly conflictingEventAtExpectedPosition: boolean;
  readonly providerProvesNotCommitted: boolean;
  readonly observedContentDigest?: string;
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

/**
 * Classifies authoritative reconciliation evidence without provider-specific
 * assumptions. Ambiguity always remains blocked; this function never guesses.
 */
export function classifyPersistenceReconciliation(
  evidence: PersistenceReconciliationEvidence,
): PersistenceReconciliationDecision {
  if (evidence.exactEventMatch && evidence.conflictingEventAtExpectedPosition) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      "an exact event match cannot coexist with a conflicting event at the expected position",
    );
  }

  if (evidence.exactEventMatch && evidence.providerProvesNotCommitted) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      "an exact durable event match cannot coexist with proof of non-commit",
    );
  }

  if (
    evidence.conflictingEventAtExpectedPosition &&
    evidence.providerProvesNotCommitted
  ) {
    throw new InvalidPersistenceReconciliationEvidenceError(
      "a conflicting durable event cannot coexist with proof that no relevant transition committed",
    );
  }

  if (evidence.exactEventMatch) {
    return Object.freeze({ kind: "committed" });
  }

  if (evidence.conflictingEventAtExpectedPosition) {
    return Object.freeze({ kind: "conflict", quarantine: true });
  }

  if (evidence.providerProvesNotCommitted) {
    return Object.freeze({ kind: "retry_permitted" });
  }

  return Object.freeze({ kind: "uncertain", blockFurtherMutation: true });
}

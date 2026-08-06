export interface PersistenceProofConsumption {
  readonly proofId: string;
  readonly uncertaintyRecordId: string;
  readonly providerOperationId: string;
  readonly consumedByAttemptId: string;
  readonly consumedAt: string;
}

export interface PersistenceProofConsumptionIndex {
  readonly entries: readonly PersistenceProofConsumption[];
}

export class InvalidPersistenceProofConsumptionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistenceProofConsumptionError";
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidPersistenceProofConsumptionError(
      `${field} must be a non-empty string`,
    );
  }
}

function requireCanonicalTimestamp(value: string, field: string): void {
  requireNonEmpty(value, field);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new InvalidPersistenceProofConsumptionError(
      `${field} must be a canonical ISO-8601 UTC timestamp`,
    );
  }
}

export function createPersistenceProofConsumptionIndex(): PersistenceProofConsumptionIndex {
  return Object.freeze({ entries: Object.freeze([]) });
}

/**
 * Returns a new immutable index containing one globally unique proof
 * consumption. A production uncertainty store must persist this entry
 * atomically with the state transition authorized by the proof.
 */
export function consumePersistenceProof(
  index: PersistenceProofConsumptionIndex,
  consumption: PersistenceProofConsumption,
): PersistenceProofConsumptionIndex {
  requireNonEmpty(consumption.proofId, "proofId");
  requireNonEmpty(consumption.uncertaintyRecordId, "uncertaintyRecordId");
  requireNonEmpty(consumption.providerOperationId, "providerOperationId");
  requireNonEmpty(consumption.consumedByAttemptId, "consumedByAttemptId");
  requireCanonicalTimestamp(consumption.consumedAt, "consumedAt");

  if (index.entries.some((entry) => entry.proofId === consumption.proofId)) {
    throw new InvalidPersistenceProofConsumptionError(
      "proofId has already been consumed",
    );
  }

  const frozenConsumption = Object.freeze({ ...consumption });
  return Object.freeze({
    entries: Object.freeze([...index.entries, frozenConsumption]),
  });
}

export function hasConsumedPersistenceProof(
  index: PersistenceProofConsumptionIndex,
  proofId: string,
): boolean {
  requireNonEmpty(proofId, "proofId");
  return index.entries.some((entry) => entry.proofId === proofId);
}

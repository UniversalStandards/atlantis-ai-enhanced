import {
  InvalidExactDataRecordError,
  normalizeExactDataRecord,
  requireExactDataFields,
  type ExactDataRecord,
} from "./exact-data-record.js";

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

const CONSUMPTION_FIELDS = Object.freeze([
  "proofId",
  "uncertaintyRecordId",
  "providerOperationId",
  "consumedByAttemptId",
  "consumedAt",
] as const);

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidPersistenceProofConsumptionError(
      `${field} must be a non-empty string`,
    );
  }
}

function requireCanonicalTimestamp(
  value: unknown,
  field: string,
): asserts value is string {
  requireNonEmpty(value, field);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new InvalidPersistenceProofConsumptionError(
      `${field} must be a canonical ISO-8601 UTC timestamp`,
    );
  }
}

function normalizeRecord(
  subject: string,
  value: unknown,
  fields: readonly string[],
  requiredFields: readonly string[],
): ExactDataRecord {
  try {
    const record = normalizeExactDataRecord(subject, value, fields);
    requireExactDataFields(subject, record, requiredFields);
    return record;
  } catch (error) {
    if (error instanceof InvalidExactDataRecordError) {
      throw new InvalidPersistenceProofConsumptionError(error.message);
    }
    throw error;
  }
}

function normalizeConsumption(
  value: unknown,
  subject = "proof consumption",
): PersistenceProofConsumption {
  const record = normalizeRecord(
    subject,
    value,
    CONSUMPTION_FIELDS,
    CONSUMPTION_FIELDS,
  );

  requireNonEmpty(record.proofId, `${subject}.proofId`);
  requireNonEmpty(
    record.uncertaintyRecordId,
    `${subject}.uncertaintyRecordId`,
  );
  requireNonEmpty(
    record.providerOperationId,
    `${subject}.providerOperationId`,
  );
  requireNonEmpty(
    record.consumedByAttemptId,
    `${subject}.consumedByAttemptId`,
  );
  requireCanonicalTimestamp(record.consumedAt, `${subject}.consumedAt`);

  return Object.freeze({
    proofId: record.proofId,
    uncertaintyRecordId: record.uncertaintyRecordId,
    providerOperationId: record.providerOperationId,
    consumedByAttemptId: record.consumedByAttemptId,
    consumedAt: record.consumedAt,
  });
}

function normalizeEntries(value: unknown): readonly PersistenceProofConsumption[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new InvalidPersistenceProofConsumptionError(
      "proof consumption index.entries must be a standard array",
    );
  }

  const length = value.length;
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (key === "length") {
      continue;
    }
    if (
      typeof key !== "string"
      || !/^(0|[1-9]\d*)$/.test(key)
      || Number(key) >= length
      || String(Number(key)) !== key
    ) {
      throw new InvalidPersistenceProofConsumptionError(
        "proof consumption index.entries must not contain non-index fields",
      );
    }
  }

  if (keys.length !== length + 1) {
    throw new InvalidPersistenceProofConsumptionError(
      "proof consumption index.entries must not contain sparse elements",
    );
  }

  const proofIds = new Set<string>();
  const entries: PersistenceProofConsumption[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined
      || descriptor.enumerable !== true
      || !("value" in descriptor)
    ) {
      throw new InvalidPersistenceProofConsumptionError(
        `proof consumption index.entries[${index}] must be an enumerable data property`,
      );
    }

    const consumption = normalizeConsumption(
      descriptor.value,
      `proof consumption index.entries[${index}]`,
    );
    if (proofIds.has(consumption.proofId)) {
      throw new InvalidPersistenceProofConsumptionError(
        "proof consumption index contains a duplicate proofId",
      );
    }
    proofIds.add(consumption.proofId);
    entries.push(consumption);
  }

  return Object.freeze(entries);
}

/**
 * Validates and freezes an untrusted or restored proof-consumption index.
 * Malformed, ambiguous, accessor-backed, sparse, or duplicate durable state
 * fails closed before replay decisions are made.
 */
export function restorePersistenceProofConsumptionIndex(
  value: unknown,
): PersistenceProofConsumptionIndex {
  const record = normalizeRecord(
    "proof consumption index",
    value,
    ["entries"],
    ["entries"],
  );
  return Object.freeze({ entries: normalizeEntries(record.entries) });
}

export function createPersistenceProofConsumptionIndex(): PersistenceProofConsumptionIndex {
  return restorePersistenceProofConsumptionIndex({ entries: [] });
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
  const validatedIndex = restorePersistenceProofConsumptionIndex(index);
  const validatedConsumption = normalizeConsumption(consumption);

  if (
    validatedIndex.entries.some(
      (entry) => entry.proofId === validatedConsumption.proofId,
    )
  ) {
    throw new InvalidPersistenceProofConsumptionError(
      "proofId has already been consumed",
    );
  }

  return Object.freeze({
    entries: Object.freeze([
      ...validatedIndex.entries,
      validatedConsumption,
    ]),
  });
}

export function hasConsumedPersistenceProof(
  index: PersistenceProofConsumptionIndex,
  proofId: string,
): boolean {
  const validatedIndex = restorePersistenceProofConsumptionIndex(index);
  requireNonEmpty(proofId, "proofId");
  return validatedIndex.entries.some((entry) => entry.proofId === proofId);
}

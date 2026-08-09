import {
  normalizeExactDataRecord,
  requireExactDataFields,
  type ExactDataRecord,
} from "./exact-data-record.js";

export type ImmutableWriterCommitEvidenceMechanism =
  | "transaction_bound_receipt"
  | "operation_bound_historical_record"
  | "provider_operation_with_historical_record";

export interface ExpectedWriterAppendIdentity {
  readonly operationId: string;
  readonly executionId: string;
  readonly eventId: string;
  readonly streamVersion: number;
  readonly contentDigest: string;
}

/**
 * Provider-neutral immutable evidence that one exact admitted append operation
 * committed one exact event transition. Provider-specific verification remains
 * behind the persistence-adapter boundary; this contract validates only the
 * minimum identity binding and mechanism-specific evidence shape that may be
 * admitted into ATLANTIS reconciliation.
 */
export interface ImmutableWriterCommitEvidence {
  readonly evidenceId: string;
  readonly mechanism: ImmutableWriterCommitEvidenceMechanism;
  readonly operationId: string;
  readonly executionId: string;
  readonly eventId: string;
  readonly streamVersion: number;
  readonly contentDigest: string;
  readonly transactionReceiptId?: string;
  readonly historicalRecordId?: string;
  readonly providerOperationId?: string;
}

export class InvalidImmutableWriterCommitEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidImmutableWriterCommitEvidenceError";
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
    if (error instanceof InvalidImmutableWriterCommitEvidenceError) {
      throw error;
    }
    throw new InvalidImmutableWriterCommitEvidenceError(
      error instanceof Error ? error.message : `${subject} is invalid`,
    );
  }
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidImmutableWriterCommitEvidenceError(
      `${field} must be a non-empty string`,
    );
  }
}

function requireStreamVersion(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new InvalidImmutableWriterCommitEvidenceError(
      `${field} must be a positive safe integer`,
    );
  }
}

function normalizeExpectedWriterAppendIdentity(
  value: unknown,
): ExpectedWriterAppendIdentity {
  const expected = normalizeRecord(
    "expected",
    value,
    ["operationId", "executionId", "eventId", "streamVersion", "contentDigest"],
    ["operationId", "executionId", "eventId", "streamVersion", "contentDigest"],
  );

  requireNonEmpty(expected.operationId, "expected.operationId");
  requireNonEmpty(expected.executionId, "expected.executionId");
  requireNonEmpty(expected.eventId, "expected.eventId");
  requireStreamVersion(expected.streamVersion, "expected.streamVersion");
  requireNonEmpty(expected.contentDigest, "expected.contentDigest");

  return Object.freeze({
    operationId: expected.operationId,
    executionId: expected.executionId,
    eventId: expected.eventId,
    streamVersion: expected.streamVersion,
    contentDigest: expected.contentDigest,
  });
}

function hasOwn(record: ExactDataRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

/**
 * Validates the provider-neutral acceptance boundary for immutable writer
 * commit evidence. This function deliberately does not validate a provider's
 * cryptography, transaction semantics, retention guarantees, or historical
 * read implementation; those obligations belong to the real-adapter
 * acceptance harness. It does ensure that evidence cannot be admitted unless
 * it is bound to the exact append operation and contains the minimum
 * mechanism-specific durable identifier required by the architecture gate.
 */
export function verifyImmutableWriterCommitEvidence(
  expectedValue: ExpectedWriterAppendIdentity,
  evidenceValue: ImmutableWriterCommitEvidence,
): Readonly<ImmutableWriterCommitEvidence> {
  const expected = normalizeExpectedWriterAppendIdentity(expectedValue);
  const evidence = normalizeRecord(
    "evidence",
    evidenceValue,
    [
      "evidenceId",
      "mechanism",
      "operationId",
      "executionId",
      "eventId",
      "streamVersion",
      "contentDigest",
      "transactionReceiptId",
      "historicalRecordId",
      "providerOperationId",
    ],
    [
      "evidenceId",
      "mechanism",
      "operationId",
      "executionId",
      "eventId",
      "streamVersion",
      "contentDigest",
    ],
  );

  requireNonEmpty(evidence.evidenceId, "evidence.evidenceId");
  requireNonEmpty(evidence.mechanism, "evidence.mechanism");
  requireNonEmpty(evidence.operationId, "evidence.operationId");
  requireNonEmpty(evidence.executionId, "evidence.executionId");
  requireNonEmpty(evidence.eventId, "evidence.eventId");
  requireStreamVersion(evidence.streamVersion, "evidence.streamVersion");
  requireNonEmpty(evidence.contentDigest, "evidence.contentDigest");

  const exactBinding =
    evidence.operationId === expected.operationId &&
    evidence.executionId === expected.executionId &&
    evidence.eventId === expected.eventId &&
    evidence.streamVersion === expected.streamVersion &&
    evidence.contentDigest === expected.contentDigest;

  if (!exactBinding) {
    throw new InvalidImmutableWriterCommitEvidenceError(
      "evidence must be bound to the exact admitted append identity",
    );
  }

  const mechanism = evidence.mechanism as ImmutableWriterCommitEvidenceMechanism;
  if (![
    "transaction_bound_receipt",
    "operation_bound_historical_record",
    "provider_operation_with_historical_record",
  ].includes(mechanism)) {
    throw new InvalidImmutableWriterCommitEvidenceError(
      "evidence.mechanism is not supported",
    );
  }

  if (hasOwn(evidence, "transactionReceiptId")) {
    requireNonEmpty(evidence.transactionReceiptId, "evidence.transactionReceiptId");
  }
  if (hasOwn(evidence, "historicalRecordId")) {
    requireNonEmpty(evidence.historicalRecordId, "evidence.historicalRecordId");
  }
  if (hasOwn(evidence, "providerOperationId")) {
    requireNonEmpty(evidence.providerOperationId, "evidence.providerOperationId");
  }

  if (
    mechanism === "transaction_bound_receipt" &&
    !hasOwn(evidence, "transactionReceiptId")
  ) {
    throw new InvalidImmutableWriterCommitEvidenceError(
      "transaction-bound receipt evidence requires evidence.transactionReceiptId",
    );
  }

  if (
    mechanism === "operation_bound_historical_record" &&
    !hasOwn(evidence, "historicalRecordId")
  ) {
    throw new InvalidImmutableWriterCommitEvidenceError(
      "operation-bound historical evidence requires evidence.historicalRecordId",
    );
  }

  if (mechanism === "provider_operation_with_historical_record") {
    if (!hasOwn(evidence, "providerOperationId")) {
      throw new InvalidImmutableWriterCommitEvidenceError(
        "combined provider-operation evidence requires evidence.providerOperationId",
      );
    }
    if (!hasOwn(evidence, "historicalRecordId")) {
      throw new InvalidImmutableWriterCommitEvidenceError(
        "combined provider-operation evidence requires evidence.historicalRecordId",
      );
    }
  }

  return Object.freeze({
    evidenceId: evidence.evidenceId,
    mechanism,
    operationId: evidence.operationId,
    executionId: evidence.executionId,
    eventId: evidence.eventId,
    streamVersion: evidence.streamVersion,
    contentDigest: evidence.contentDigest,
    ...(hasOwn(evidence, "transactionReceiptId")
      ? { transactionReceiptId: evidence.transactionReceiptId as string }
      : {}),
    ...(hasOwn(evidence, "historicalRecordId")
      ? { historicalRecordId: evidence.historicalRecordId as string }
      : {}),
    ...(hasOwn(evidence, "providerOperationId")
      ? { providerOperationId: evidence.providerOperationId as string }
      : {}),
  });
}

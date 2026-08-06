import type {
  PersistenceReconciliationAttempt,
  PersistenceUncertaintyRecord,
  PersistenceUncertaintyStatus,
} from "@atlantis/contracts/persistence-uncertainty";
import type {
  ExpectedPersistenceEvent,
  PersistenceReconciliationDecision,
} from "@atlantis/contracts/production-persistence";

export class InvalidPersistedUncertaintyRecordError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistedUncertaintyRecordError";
  }
}

function requirePlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidPersistedUncertaintyRecordError(`${field} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidPersistedUncertaintyRecordError(`${field} must have a standard or null prototype.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  field: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new InvalidPersistedUncertaintyRecordError(`${field}.${key} is required.`);
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new InvalidPersistedUncertaintyRecordError(`${field} contains an unexpected property.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new InvalidPersistedUncertaintyRecordError(`${field}.${key} must be an enumerable data property.`);
    }
  }
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidPersistedUncertaintyRecordError(`${field} must be a non-empty string.`);
  }
}

function requireCanonicalTimestamp(value: unknown, field: string): asserts value is string {
  requireNonEmpty(value, field);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new InvalidPersistedUncertaintyRecordError(`${field} must be canonical UTC.`);
  }
}

function requirePositiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new InvalidPersistedUncertaintyRecordError(`${field} must be a positive safe integer.`);
  }
}

function restoreExpected(value: unknown): ExpectedPersistenceEvent {
  const record = requirePlainRecord(value, "record.expected");
  requireExactKeys(
    record,
    ["operationId", "eventId", "executionId", "streamVersion", "contentDigest"],
    [],
    "record.expected",
  );
  requireNonEmpty(record.operationId, "record.expected.operationId");
  requireNonEmpty(record.eventId, "record.expected.eventId");
  requireNonEmpty(record.executionId, "record.expected.executionId");
  requirePositiveInteger(record.streamVersion, "record.expected.streamVersion");
  requireNonEmpty(record.contentDigest, "record.expected.contentDigest");
  return Object.freeze({
    operationId: record.operationId,
    eventId: record.eventId,
    executionId: record.executionId,
    streamVersion: record.streamVersion,
    contentDigest: record.contentDigest,
  });
}

function restoreDecision(value: unknown, field: string): PersistenceReconciliationDecision {
  const record = requirePlainRecord(value, field);
  requireNonEmpty(record.kind, `${field}.kind`);
  switch (record.kind) {
    case "committed":
      requireExactKeys(record, ["kind"], [], field);
      return Object.freeze({ kind: "committed" });
    case "retry_permitted":
      requireExactKeys(record, ["kind"], [], field);
      return Object.freeze({ kind: "retry_permitted" });
    case "conflict":
      requireExactKeys(record, ["kind", "quarantine"], [], field);
      if (record.quarantine !== true) {
        throw new InvalidPersistedUncertaintyRecordError(`${field}.quarantine must be true.`);
      }
      return Object.freeze({ kind: "conflict", quarantine: true });
    case "uncertain":
      requireExactKeys(record, ["kind", "blockFurtherMutation"], [], field);
      if (record.blockFurtherMutation !== true) {
        throw new InvalidPersistedUncertaintyRecordError(`${field}.blockFurtherMutation must be true.`);
      }
      return Object.freeze({ kind: "uncertain", blockFurtherMutation: true });
    default:
      throw new InvalidPersistedUncertaintyRecordError(`${field}.kind is invalid.`);
  }
}

function restoreAttempt(
  value: unknown,
  index: number,
  firstObservedAt: string,
): PersistenceReconciliationAttempt {
  const field = `record.attempts[${index}]`;
  const record = requirePlainRecord(value, field);
  requireExactKeys(
    record,
    ["attemptNumber", "attemptId", "observedAt", "reconciledAt", "decision"],
    ["providerObservationId", "proofId"],
    field,
  );
  requirePositiveInteger(record.attemptNumber, `${field}.attemptNumber`);
  if (record.attemptNumber !== index + 1) {
    throw new InvalidPersistedUncertaintyRecordError("record attempt numbers must be contiguous.");
  }
  requireNonEmpty(record.attemptId, `${field}.attemptId`);
  requireCanonicalTimestamp(record.observedAt, `${field}.observedAt`);
  requireCanonicalTimestamp(record.reconciledAt, `${field}.reconciledAt`);
  if (record.observedAt < firstObservedAt || record.reconciledAt < record.observedAt) {
    throw new InvalidPersistedUncertaintyRecordError(`${field} timestamps are not monotonic.`);
  }
  if (record.providerObservationId !== undefined) {
    requireNonEmpty(record.providerObservationId, `${field}.providerObservationId`);
  }
  if (record.proofId !== undefined) {
    requireNonEmpty(record.proofId, `${field}.proofId`);
  }
  const decision = restoreDecision(record.decision, `${field}.decision`);
  return Object.freeze({
    attemptNumber: record.attemptNumber,
    attemptId: record.attemptId,
    observedAt: record.observedAt,
    reconciledAt: record.reconciledAt,
    decision,
    ...(record.providerObservationId === undefined
      ? {}
      : { providerObservationId: record.providerObservationId }),
    ...(record.proofId === undefined ? {} : { proofId: record.proofId }),
  });
}

function statusForDecision(decision: PersistenceReconciliationDecision): PersistenceUncertaintyStatus {
  switch (decision.kind) {
    case "committed": return "resolved_committed";
    case "retry_permitted": return "resolved_not_committed";
    case "conflict": return "quarantined";
    case "uncertain": return "pending";
  }
}

/**
 * Restores one persisted uncertainty record through an exact-record boundary.
 * Accessors, symbols, extra properties, malformed decisions, duplicate evidence,
 * and status/decision contradictions fail before the record can be reconciled.
 */
export function restoreExactPersistenceUncertaintyRecord(
  value: unknown,
): PersistenceUncertaintyRecord {
  const record = requirePlainRecord(value, "record");
  requireExactKeys(
    record,
    ["recordId", "expected", "firstObservedAt", "status", "attempts"],
    ["providerOperationId"],
    "record",
  );
  requireNonEmpty(record.recordId, "record.recordId");
  requireCanonicalTimestamp(record.firstObservedAt, "record.firstObservedAt");
  if (record.providerOperationId !== undefined) {
    requireNonEmpty(record.providerOperationId, "record.providerOperationId");
  }
  if (!Array.isArray(record.attempts) || Object.getPrototypeOf(record.attempts) !== Array.prototype) {
    throw new InvalidPersistedUncertaintyRecordError("record.attempts must be a standard array.");
  }
  if (!["pending", "quarantined", "resolved_committed", "resolved_not_committed"].includes(String(record.status))) {
    throw new InvalidPersistedUncertaintyRecordError("record.status is invalid.");
  }

  const attempts = record.attempts.map((attempt, index) =>
    restoreAttempt(attempt, index, record.firstObservedAt),
  );
  const attemptIds = new Set<string>();
  const proofIds = new Set<string>();
  for (const attempt of attempts) {
    if (attemptIds.has(attempt.attemptId)) {
      throw new InvalidPersistedUncertaintyRecordError("record attemptId values must be unique.");
    }
    attemptIds.add(attempt.attemptId);
    if (attempt.proofId !== undefined) {
      if (proofIds.has(attempt.proofId)) {
        throw new InvalidPersistedUncertaintyRecordError("record proofId values must be unique.");
      }
      proofIds.add(attempt.proofId);
    }
  }

  const status = record.status as PersistenceUncertaintyStatus;
  if (attempts.length === 0) {
    if (status !== "pending") {
      throw new InvalidPersistedUncertaintyRecordError("a record without attempts must remain pending.");
    }
  } else {
    for (const attempt of attempts.slice(0, -1)) {
      if (attempt.decision.kind !== "uncertain") {
        throw new InvalidPersistedUncertaintyRecordError("only the final attempt may be terminal.");
      }
    }
    const finalAttempt = attempts[attempts.length - 1];
    if (finalAttempt === undefined || statusForDecision(finalAttempt.decision) !== status) {
      throw new InvalidPersistedUncertaintyRecordError("record.status must match the final decision.");
    }
    if (finalAttempt.decision.kind === "retry_permitted" && finalAttempt.proofId === undefined) {
      throw new InvalidPersistedUncertaintyRecordError("retry_permitted requires a persisted proofId.");
    }
    if (finalAttempt.decision.kind !== "retry_permitted" && finalAttempt.proofId !== undefined) {
      throw new InvalidPersistedUncertaintyRecordError("proofId is only legal for retry_permitted.");
    }
  }

  return Object.freeze({
    recordId: record.recordId,
    expected: restoreExpected(record.expected),
    ...(record.providerOperationId === undefined
      ? {}
      : { providerOperationId: record.providerOperationId }),
    firstObservedAt: record.firstObservedAt,
    status,
    attempts: Object.freeze(attempts),
  });
}

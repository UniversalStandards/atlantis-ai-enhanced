import {
  InvalidPersistenceReconciliationEvidenceError,
  classifyPersistenceReconciliation,
  type ExpectedPersistenceEvent,
  type PersistenceReconciliationDecision,
  type PersistenceReconciliationEvidence,
} from "./production-persistence.js";

export type PersistenceUncertaintyStatus =
  | "pending"
  | "quarantined"
  | "resolved_committed"
  | "resolved_not_committed";

export interface PersistenceReconciliationAttempt {
  readonly attemptNumber: number;
  readonly attemptId: string;
  readonly observedAt: string;
  readonly decision: PersistenceReconciliationDecision;
  readonly providerObservationId?: string;
}

export interface PersistenceUncertaintyRecord {
  readonly recordId: string;
  readonly expected: ExpectedPersistenceEvent;
  readonly providerOperationId?: string;
  readonly firstObservedAt: string;
  readonly status: PersistenceUncertaintyStatus;
  readonly attempts: readonly PersistenceReconciliationAttempt[];
}

export interface CreatePersistenceUncertaintyRecordInput {
  readonly recordId: string;
  readonly expected: ExpectedPersistenceEvent;
  readonly providerOperationId?: string;
  readonly firstObservedAt: string;
}

export interface ReconcilePersistenceUncertaintyInput {
  readonly attemptId: string;
  readonly observedAt: string;
  readonly providerObservationId?: string;
  readonly evidence: PersistenceReconciliationEvidence;
}

export class InvalidPersistenceUncertaintyTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistenceUncertaintyTransitionError";
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      `${field} must be a non-empty string`,
    );
  }
}

function requireCanonicalTimestamp(value: string, field: string): void {
  requireNonEmpty(value, field);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      `${field} must be a canonical ISO-8601 UTC timestamp`,
    );
  }
}

function requireExpectedIdentity(event: ExpectedPersistenceEvent): void {
  requireNonEmpty(event.operationId, "expected.operationId");
  requireNonEmpty(event.executionId, "expected.executionId");
  requireNonEmpty(event.eventId, "expected.eventId");
  requireNonEmpty(event.contentDigest, "expected.contentDigest");
  if (!Number.isSafeInteger(event.streamVersion) || event.streamVersion < 1) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "expected.streamVersion must be a positive safe integer",
    );
  }
}

function sameExpectedIdentity(
  left: ExpectedPersistenceEvent,
  right: ExpectedPersistenceEvent,
): boolean {
  return left.operationId === right.operationId
    && left.executionId === right.executionId
    && left.eventId === right.eventId
    && left.streamVersion === right.streamVersion
    && left.contentDigest === right.contentDigest;
}

function freezeExpected(
  expected: ExpectedPersistenceEvent,
): ExpectedPersistenceEvent {
  return Object.freeze({ ...expected });
}

function nextStatus(
  decision: PersistenceReconciliationDecision,
): PersistenceUncertaintyStatus {
  switch (decision.kind) {
    case "committed":
      return "resolved_committed";
    case "retry_permitted":
      return "resolved_not_committed";
    case "conflict":
      return "quarantined";
    case "uncertain":
      return "pending";
  }
}

/** Creates an immutable provider-neutral uncertainty record for one exact append. */
export function createPersistenceUncertaintyRecord(
  input: CreatePersistenceUncertaintyRecordInput,
): PersistenceUncertaintyRecord {
  requireNonEmpty(input.recordId, "recordId");
  requireExpectedIdentity(input.expected);
  requireCanonicalTimestamp(input.firstObservedAt, "firstObservedAt");
  if (input.providerOperationId !== undefined) {
    requireNonEmpty(input.providerOperationId, "providerOperationId");
  }

  return Object.freeze({
    recordId: input.recordId,
    expected: freezeExpected(input.expected),
    ...(input.providerOperationId === undefined
      ? {}
      : { providerOperationId: input.providerOperationId }),
    firstObservedAt: input.firstObservedAt,
    status: "pending" as const,
    attempts: Object.freeze([]),
  });
}

/**
 * Applies one authoritative reconciliation attempt. Terminal and quarantined
 * records are closed to further mutation; unresolved evidence remains pending.
 */
export function reconcilePersistenceUncertainty(
  record: PersistenceUncertaintyRecord,
  input: ReconcilePersistenceUncertaintyInput,
): PersistenceUncertaintyRecord {
  if (record.status !== "pending") {
    throw new InvalidPersistenceUncertaintyTransitionError(
      `cannot reconcile a ${record.status} uncertainty record`,
    );
  }

  requireNonEmpty(input.attemptId, "attemptId");
  requireCanonicalTimestamp(input.observedAt, "observedAt");
  if (input.providerObservationId !== undefined) {
    requireNonEmpty(input.providerObservationId, "providerObservationId");
  }
  if (input.observedAt < record.firstObservedAt) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "observedAt cannot precede firstObservedAt",
    );
  }
  if (record.attempts.some((attempt) => attempt.attemptId === input.attemptId)) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "attemptId must be unique within the uncertainty record",
    );
  }
  if (!sameExpectedIdentity(record.expected, input.evidence.expected)) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      "reconciliation evidence must match the uncertainty record append identity",
    );
  }

  let decision: PersistenceReconciliationDecision;
  try {
    decision = classifyPersistenceReconciliation(input.evidence);
  } catch (error) {
    if (error instanceof InvalidPersistenceReconciliationEvidenceError) {
      throw new InvalidPersistenceUncertaintyTransitionError(error.message);
    }
    throw error;
  }

  const attempt = Object.freeze({
    attemptNumber: record.attempts.length + 1,
    attemptId: input.attemptId,
    observedAt: input.observedAt,
    decision,
    ...(input.providerObservationId === undefined
      ? {}
      : { providerObservationId: input.providerObservationId }),
  });

  return Object.freeze({
    ...record,
    status: nextStatus(decision),
    attempts: Object.freeze([...record.attempts, attempt]),
  });
}

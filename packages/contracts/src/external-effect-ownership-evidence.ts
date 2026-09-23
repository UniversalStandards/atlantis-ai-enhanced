import type {
  ExternalEffectOwnershipLifecycleEvent,
  ExternalEffectOwnershipLifecycleObserver,
} from "./observable-external-effect-ownership-store.js";

export type ExternalEffectOwnershipExecutionEventType =
  | "external.effect.ownership.acquired"
  | "external.effect.ownership.contended"
  | "external.effect.ownership.committed_observed"
  | "external.effect.ownership.rejected"
  | "external.effect.ownership.renewed"
  | "external.effect.ownership.receipt_committed"
  | "external.effect.ownership.released"
  | "external.effect.ownership.observed";

export interface ExternalEffectOwnershipEvidencePayload {
  readonly lifecycle: ExternalEffectOwnershipLifecycleEvent;
}

export interface ExternalEffectOwnershipExecutionEvent {
  readonly id: string;
  readonly executionId: string;
  readonly sequence: number;
  readonly type: ExternalEffectOwnershipExecutionEventType;
  readonly occurredAt: string;
  readonly actor: string;
  readonly parentEventId?: string;
  readonly payload: ExternalEffectOwnershipEvidencePayload;
}

export interface ExternalEffectOwnershipEvidenceSink {
  append(event: ExternalEffectOwnershipExecutionEvent): Promise<void>;
}

export interface ExternalEffectOwnershipEvidenceContext {
  readonly eventSink: ExternalEffectOwnershipEvidenceSink;
  readonly executionId: string;
  readonly actor: string;
  readonly initialSequence: number;
  readonly createEventId: () => string;
  readonly now: () => string;
  readonly parentEventId?: string;
}

const REDACTED_CLAIM_TOKEN = "[REDACTED]";

function requireNonBlank(field: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${field} must be a non-blank string`);
  }
  return normalized;
}

function requireCanonicalTimestamp(field: string, value: string): string {
  const timestamp = requireNonBlank(field, value);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function validateContext(context: ExternalEffectOwnershipEvidenceContext): void {
  requireNonBlank("executionId", context.executionId);
  requireNonBlank("actor", context.actor);
  if (!Number.isSafeInteger(context.initialSequence) || context.initialSequence < 0) {
    throw new Error("initialSequence must be a non-negative safe integer");
  }
  if (context.parentEventId !== undefined) {
    requireNonBlank("parentEventId", context.parentEventId);
  }
  if (context.initialSequence === 0 && context.parentEventId !== undefined) {
    throw new Error("An empty evidence stream cannot have a parent event");
  }
  if (context.initialSequence > 0 && context.parentEventId === undefined) {
    throw new Error("A non-empty evidence stream must identify its tail event");
  }
}

function executionIdForLifecycleEvent(
  event: ExternalEffectOwnershipLifecycleEvent,
): string {
  switch (event.type) {
    case "ownership.acquired":
    case "ownership.contended":
    case "ownership.committed_observed":
    case "ownership.rejected":
      return event.result.identity.executionId;
    case "ownership.renewed":
    case "ownership.receipt_committed":
    case "ownership.released":
      return event.claim.executionId;
    case "ownership.observed":
      return event.observation.identity.executionId;
  }
}

function executionEventTypeForLifecycleEvent(
  event: ExternalEffectOwnershipLifecycleEvent,
): ExternalEffectOwnershipExecutionEventType {
  switch (event.type) {
    case "ownership.acquired":
      return "external.effect.ownership.acquired";
    case "ownership.contended":
      return "external.effect.ownership.contended";
    case "ownership.committed_observed":
      return "external.effect.ownership.committed_observed";
    case "ownership.rejected":
      return "external.effect.ownership.rejected";
    case "ownership.renewed":
      return "external.effect.ownership.renewed";
    case "ownership.receipt_committed":
      return "external.effect.ownership.receipt_committed";
    case "ownership.released":
      return "external.effect.ownership.released";
    case "ownership.observed":
      return "external.effect.ownership.observed";
  }
}

function snapshotEvidenceValue(
  value: unknown,
  path = "lifecycle",
  ancestors = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must contain only finite JSON numbers`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} must contain only JSON-native values`);
  }
  if (ancestors.has(value)) {
    throw new Error(`${path} must not contain circular references`);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(`${path} must contain only standard arrays`);
      }

      const descriptors = Object.getOwnPropertyDescriptors(value);
      const ownKeys = Reflect.ownKeys(descriptors);
      const allowedKeys = new Set<PropertyKey>([
        "length",
        ...Array.from({ length: value.length }, (_item, index) => String(index)),
      ]);
      if (ownKeys.some((key) => !allowedKeys.has(key))) {
        throw new Error(`${path} arrays must not contain non-index properties`);
      }

      const snapshot: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined) {
          throw new Error(`${path} must not contain sparse array holes`);
        }
        if (!descriptor.enumerable || !("value" in descriptor)) {
          throw new Error(`${path}[${index}] must be an enumerable data property`);
        }
        snapshot.push(
          snapshotEvidenceValue(descriptor.value, `${path}[${index}]`, ancestors),
        );
      }
      return Object.freeze(snapshot);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain records and arrays`);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key === "symbol") {
        throw new Error(`${path} must not contain symbol-keyed properties`);
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error(`${path}.${key} must be an enumerable data property`);
      }
      Object.defineProperty(snapshot, key, {
        value:
          key === "claimToken"
            ? REDACTED_CLAIM_TOKEN
            : snapshotEvidenceValue(descriptor.value, `${path}.${key}`, ancestors),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(value);
  }
}

function evidenceLifecycleSnapshot(
  lifecycle: ExternalEffectOwnershipLifecycleEvent,
): ExternalEffectOwnershipLifecycleEvent {
  return snapshotEvidenceValue(lifecycle) as ExternalEffectOwnershipLifecycleEvent;
}

/**
 * Converts non-authoritative ownership lifecycle observations into ordered
 * execution evidence. Lifecycle callbacks are serialized so concurrent store
 * operations cannot allocate the same sequence or parent. Cursor state advances
 * only after the sink accepts an event, so a failed append never creates a
 * false in-memory stream tail and does not block later evidence attempts.
 */
export function createExternalEffectOwnershipEvidenceObserver(
  context: ExternalEffectOwnershipEvidenceContext,
): ExternalEffectOwnershipLifecycleObserver {
  validateContext(context);
  let sequence = context.initialSequence;
  let parentEventId = context.parentEventId;
  let appendTail: Promise<void> = Promise.resolve();

  const appendLifecycleEvent = async (
    lifecycle: ExternalEffectOwnershipLifecycleEvent,
  ): Promise<void> => {
    const lifecycleExecutionId = executionIdForLifecycleEvent(lifecycle);
    if (lifecycleExecutionId !== context.executionId) {
      throw new Error(
        "Ownership lifecycle executionId does not match evidence context",
      );
    }
    if (sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Ownership evidence sequence is exhausted");
    }

    const event: ExternalEffectOwnershipExecutionEvent = Object.freeze({
      id: requireNonBlank("event id", context.createEventId()),
      executionId: context.executionId,
      sequence: sequence + 1,
      type: executionEventTypeForLifecycleEvent(lifecycle),
      occurredAt: requireCanonicalTimestamp("occurredAt", context.now()),
      actor: requireNonBlank("actor", context.actor),
      ...(parentEventId === undefined ? {} : { parentEventId }),
      payload: Object.freeze({ lifecycle: evidenceLifecycleSnapshot(lifecycle) }),
    });

    await context.eventSink.append(event);
    sequence = event.sequence;
    parentEventId = event.id;
  };

  return Object.freeze({
    onLifecycleEvent(lifecycle: ExternalEffectOwnershipLifecycleEvent) {
      const operation = appendTail.then(() => appendLifecycleEvent(lifecycle));
      appendTail = operation.catch(() => undefined);
      return operation;
    },
  });
}

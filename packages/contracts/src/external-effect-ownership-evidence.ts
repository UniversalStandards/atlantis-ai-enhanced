import type { EventSink, ExecutionEvent, ExecutionEventType } from "./index.js";
import type {
  ExternalEffectOwnershipLifecycleEvent,
  ExternalEffectOwnershipLifecycleObserver,
} from "./observable-external-effect-ownership-store.js";

export interface ExternalEffectOwnershipEvidenceContext {
  readonly eventSink: EventSink;
  readonly executionId: string;
  readonly actor: string;
  readonly initialSequence: number;
  readonly createEventId: () => string;
  readonly now: () => string;
  readonly parentEventId?: string;
}

export interface ExternalEffectOwnershipEvidencePayload {
  readonly lifecycle: ExternalEffectOwnershipLifecycleEvent;
}

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
): ExecutionEventType {
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

/**
 * Converts non-authoritative ownership lifecycle observations into canonical
 * execution events. Sequence state advances only after the durable sink accepts
 * an event, so failed appends never create a false in-memory tail.
 */
export function createExternalEffectOwnershipEvidenceObserver(
  context: ExternalEffectOwnershipEvidenceContext,
): ExternalEffectOwnershipLifecycleObserver {
  validateContext(context);
  let sequence = context.initialSequence;
  let parentEventId = context.parentEventId;

  return Object.freeze({
    async onLifecycleEvent(lifecycle: ExternalEffectOwnershipLifecycleEvent) {
      const lifecycleExecutionId = executionIdForLifecycleEvent(lifecycle);
      if (lifecycleExecutionId !== context.executionId) {
        throw new Error(
          "Ownership lifecycle executionId does not match evidence context",
        );
      }
      if (sequence >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Ownership evidence sequence is exhausted");
      }

      const event: ExecutionEvent<ExternalEffectOwnershipEvidencePayload> =
        Object.freeze({
          id: requireNonBlank("event id", context.createEventId()),
          executionId: context.executionId,
          sequence: sequence + 1,
          type: executionEventTypeForLifecycleEvent(lifecycle),
          occurredAt: requireCanonicalTimestamp("occurredAt", context.now()),
          actor: requireNonBlank("actor", context.actor),
          ...(parentEventId === undefined ? {} : { parentEventId }),
          payload: Object.freeze({ lifecycle }),
        });

      await context.eventSink.append(event);
      sequence = event.sequence;
      parentEventId = event.id;
    },
  });
}

import {
  ExternalEffectOwnershipLostError,
  type ExternalEffectLeaseStage,
} from "./external-effect-execution.js";
import type { ExternalEffectIdentity } from "./external-effect.js";

export interface ExternalEffectOwnershipLossEvidencePayload {
  readonly stage: ExternalEffectLeaseStage;
  readonly identity: ExternalEffectIdentity;
  readonly ownerId: string;
  readonly generation: number;
  readonly expiresAt: string;
}

export interface ExternalEffectOwnershipLossExecutionEvent {
  readonly id: string;
  readonly executionId: string;
  readonly sequence: number;
  readonly type: "external.effect.ownership.lost";
  readonly occurredAt: string;
  readonly actor: string;
  readonly parentEventId?: string;
  readonly payload: ExternalEffectOwnershipLossEvidencePayload;
}

export interface ExternalEffectOwnershipLossEvidenceSink {
  append(event: ExternalEffectOwnershipLossExecutionEvent): void | Promise<void>;
}

export interface ExternalEffectOwnershipLossEvidenceContext {
  readonly eventSink: ExternalEffectOwnershipLossEvidenceSink;
  readonly executionId: string;
  readonly actor: string;
  readonly sequence: number;
  readonly createEventId: () => string;
  readonly now: () => string;
  readonly parentEventId?: string;
  readonly onEvidenceError?: (error: unknown) => void | Promise<void>;
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

function validateContext(context: ExternalEffectOwnershipLossEvidenceContext): void {
  requireNonBlank("executionId", context.executionId);
  requireNonBlank("actor", context.actor);
  if (!Number.isSafeInteger(context.sequence) || context.sequence <= 0) {
    throw new Error("sequence must be a positive safe integer");
  }
  if (context.parentEventId !== undefined) {
    requireNonBlank("parentEventId", context.parentEventId);
  }
  if (context.sequence > 1 && context.parentEventId === undefined) {
    throw new Error("A non-initial evidence event must identify its parent");
  }
}

function createOwnershipLossEvent(
  context: ExternalEffectOwnershipLossEvidenceContext,
  error: ExternalEffectOwnershipLostError,
): ExternalEffectOwnershipLossExecutionEvent {
  if (error.identity.executionId !== context.executionId) {
    throw new Error("Ownership-loss executionId does not match evidence context");
  }

  return Object.freeze({
    id: requireNonBlank("event id", context.createEventId()),
    executionId: context.executionId,
    sequence: context.sequence,
    type: "external.effect.ownership.lost",
    occurredAt: requireCanonicalTimestamp("occurredAt", context.now()),
    actor: requireNonBlank("actor", context.actor),
    ...(context.parentEventId === undefined
      ? {}
      : { parentEventId: context.parentEventId }),
    payload: Object.freeze({
      stage: error.stage,
      identity: error.identity,
      ownerId: error.ownerId,
      generation: error.generation,
      expiresAt: error.expiresAt,
    }),
  });
}

/**
 * Records a non-authoritative ownership-loss event and then rethrows the exact
 * authoritative error. Evidence failure cannot replace, weaken, or hide the
 * ownership-loss result, and the opaque claim token is never included.
 */
export async function withExternalEffectOwnershipLossEvidence<T>(
  context: ExternalEffectOwnershipLossEvidenceContext,
  operation: () => T | Promise<T>,
): Promise<T> {
  validateContext(context);

  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ExternalEffectOwnershipLostError)) {
      throw error;
    }

    try {
      await context.eventSink.append(createOwnershipLossEvent(context, error));
    } catch (evidenceError) {
      try {
        await context.onEvidenceError?.(evidenceError);
      } catch {
        // Evidence reporting remains non-authoritative.
      }
    }

    throw error;
  }
}

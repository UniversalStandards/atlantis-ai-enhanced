import type {
  ExternalEffectOwnershipLossEvidenceContext,
} from "@atlantis/contracts/external-effect-ownership-loss-evidence";

import { DurableExecutionEventSink } from "./execution-event-sink.js";

export interface DurableOwnershipLossEvidenceContextOptions {
  readonly eventSink: DurableExecutionEventSink;
  readonly executionId: string;
  readonly actor: string;
  readonly createEventId: () => string;
  readonly now: () => string;
  readonly onEvidenceError?: (error: unknown) => void | Promise<void>;
}

/**
 * Binds ownership-loss evidence to the current durable execution-stream tail.
 *
 * The returned sequence and parent are derived from the authoritative stream,
 * rather than supplied by a caller. A concurrent append after this read remains
 * fail-closed through DurableExecutionEventSink optimistic sequence validation.
 */
export function createDurableOwnershipLossEvidenceContext(
  options: DurableOwnershipLossEvidenceContextOptions,
): ExternalEffectOwnershipLossEvidenceContext {
  const events = options.eventSink.readExecution(options.executionId);
  const tail = events.at(-1);

  return Object.freeze({
    eventSink: options.eventSink,
    executionId: options.executionId,
    actor: options.actor,
    sequence: events.length + 1,
    createEventId: options.createEventId,
    now: options.now,
    ...(tail === undefined ? {} : { parentEventId: tail.id }),
    ...(options.onEvidenceError === undefined
      ? {}
      : { onEvidenceError: options.onEvidenceError }),
  });
}

import {
  createExternalEffectOwnershipEvidenceObserver,
  type ExternalEffectOwnershipExecutionEvent,
} from "@atlantis/contracts/external-effect-ownership-evidence";
import type {
  ExternalEffectOwnershipLifecycleEvent,
  ExternalEffectOwnershipLifecycleObserver,
} from "@atlantis/contracts/observable-external-effect-ownership-store";

import { DurableExecutionEventSink } from "./execution-event-sink.js";

export interface DurableOwnershipEvidenceObserverOptions {
  readonly eventSink: DurableExecutionEventSink;
  readonly executionId: string;
  readonly actor: string;
  readonly createEventId: () => string;
  readonly now: () => string;
}

/**
 * Creates ownership lifecycle evidence from the authoritative durable stream
 * tail while holding the sink-owned, governed per-execution append slot.
 *
 * Each callback allocates sequence and parent linkage at append time. The
 * lifecycle event is persisted only through the queue item's identity-bound,
 * revocable append capability, so abandoned work cannot mutate the stream later.
 */
export function createDurableOwnershipEvidenceObserver(
  options: DurableOwnershipEvidenceObserverOptions,
): ExternalEffectOwnershipLifecycleObserver {
  return Object.freeze({
    onLifecycleEvent(
      lifecycle: ExternalEffectOwnershipLifecycleEvent,
    ): Promise<void> {
      return options.eventSink.enqueueExecutionAppend(
        options.executionId,
        async ({ append }) => {
          const events = options.eventSink.readExecution(options.executionId);
          const tail = events.at(-1);
          const observer = createExternalEffectOwnershipEvidenceObserver({
            eventSink: Object.freeze({
              append: (event: ExternalEffectOwnershipExecutionEvent) =>
                append(event),
            }),
            executionId: options.executionId,
            actor: options.actor,
            initialSequence: events.length,
            createEventId: options.createEventId,
            now: options.now,
            ...(tail === undefined ? {} : { parentEventId: tail.id }),
          });

          await observer.onLifecycleEvent(lifecycle);
        },
      ).result;
    },
  });
}

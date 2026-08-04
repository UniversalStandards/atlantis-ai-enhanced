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
 * tail while holding the sink-owned, execution-wide append lock.
 *
 * Each callback allocates sequence and parent linkage at append time. The lock
 * is shared with ownership-loss evidence, so independent evidence adapters
 * cannot race each other against the same execution stream.
 */
export function createDurableOwnershipEvidenceObserver(
  options: DurableOwnershipEvidenceObserverOptions,
): ExternalEffectOwnershipLifecycleObserver {
  return Object.freeze({
    onLifecycleEvent(
      lifecycle: ExternalEffectOwnershipLifecycleEvent,
    ): Promise<void> {
      return options.eventSink.withExecutionAppendLock(
        options.executionId,
        async () => {
          const events = options.eventSink.readExecution(options.executionId);
          const tail = events.at(-1);
          const observer = createExternalEffectOwnershipEvidenceObserver({
            eventSink: Object.freeze({
              append: (event: ExternalEffectOwnershipExecutionEvent) =>
                options.eventSink.append(event),
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
      );
    },
  });
}

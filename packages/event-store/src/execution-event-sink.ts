import type { EventSink, ExecutionEvent } from "@atlantis/contracts";

import {
  InvalidEventError,
  type EventStore,
  type StoredEvent,
} from "./index.js";

interface PersistedExecutionEventPayload<T = unknown> {
  readonly sequence: number;
  readonly actor: string;
  readonly parentEventId?: string;
  readonly payload: T;
}

function assertExecutionSequence(event: ExecutionEvent, expectedVersion: number): void {
  const expectedSequence = expectedVersion + 1;
  if (event.sequence !== expectedSequence) {
    throw new InvalidEventError(
      `execution event sequence ${event.sequence} does not match expected stream sequence ${expectedSequence}.`,
    );
  }
}

function restoreExecutionEvent(stored: StoredEvent): ExecutionEvent {
  const persisted = stored.payload as PersistedExecutionEventPayload;
  if (
    persisted === null ||
    typeof persisted !== "object" ||
    !Number.isSafeInteger(persisted.sequence) ||
    persisted.sequence < 1 ||
    typeof persisted.actor !== "string" ||
    persisted.actor.trim().length === 0
  ) {
    throw new InvalidEventError("persisted execution event payload is invalid.");
  }

  if (persisted.sequence !== stored.streamVersion) {
    throw new InvalidEventError(
      "persisted execution event sequence must match its stream version.",
    );
  }

  return Object.freeze({
    id: stored.eventId,
    executionId: stored.streamId,
    sequence: persisted.sequence,
    type: stored.eventType as ExecutionEvent["type"],
    occurredAt: stored.occurredAt,
    actor: persisted.actor,
    ...(persisted.parentEventId === undefined
      ? {}
      : { parentEventId: persisted.parentEventId }),
    payload: persisted.payload,
  });
}

/**
 * Bridges provider-neutral execution events into the canonical durable event
 * store without leaking persistence details into the workflow runner.
 *
 * The execution-wide lock is owned by this durable sink so independent evidence
 * adapters can share one ordering boundary. Failed operations release the lock
 * and cannot poison later append attempts.
 */
export class DurableExecutionEventSink implements EventSink {
  private readonly executionQueues = new Map<string, Promise<void>>();

  public constructor(private readonly store: EventStore) {}

  public async withExecutionAppendLock<T>(
    executionId: string,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const canonicalExecutionId = executionId.trim();
    if (canonicalExecutionId.length === 0) {
      throw new InvalidEventError("executionId must be non-empty.");
    }
    if (canonicalExecutionId !== executionId) {
      throw new InvalidEventError(
        "executionId must not contain leading or trailing whitespace.",
      );
    }

    const predecessor =
      this.executionQueues.get(canonicalExecutionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.catch(() => undefined).then(() => gate);
    this.executionQueues.set(canonicalExecutionId, tail);

    await predecessor.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.executionQueues.get(canonicalExecutionId) === tail) {
        this.executionQueues.delete(canonicalExecutionId);
      }
    }
  }

  public async append<T>(event: ExecutionEvent<T>): Promise<void> {
    const expectedVersion = this.store.getStreamVersion(event.executionId);
    assertExecutionSequence(event, expectedVersion);

    this.store.append(
      {
        streamId: event.executionId,
        eventId: event.id,
        eventType: event.type,
        occurredAt: event.occurredAt,
        traceId: event.executionId,
        correlationId: event.executionId,
        ...(event.parentEventId === undefined
          ? {}
          : { causationId: event.parentEventId }),
        payload: {
          sequence: event.sequence,
          actor: event.actor,
          ...(event.parentEventId === undefined
            ? {}
            : { parentEventId: event.parentEventId }),
          payload: event.payload,
        },
      },
      expectedVersion,
    );
  }

  public readExecution(executionId: string): readonly ExecutionEvent[] {
    return Object.freeze(
      this.store.readStream(executionId).map(restoreExecutionEvent),
    );
  }
}

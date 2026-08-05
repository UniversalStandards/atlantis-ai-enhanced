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

function assertCanonicalExecutionId(executionId: unknown): string {
  if (typeof executionId !== "string") {
    throw new InvalidEventError("executionId must be a string.");
  }

  const canonicalExecutionId = executionId.trim();
  if (canonicalExecutionId.length === 0) {
    throw new InvalidEventError("executionId must be non-empty.");
  }
  if (canonicalExecutionId !== executionId) {
    throw new InvalidEventError(
      "executionId must not contain leading or trailing whitespace.",
    );
  }
  return canonicalExecutionId;
}

function assertExecutionEvent(event: unknown): ExecutionEvent {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new InvalidEventError("execution event must be an object.");
  }
  return event as ExecutionEvent;
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
    const canonicalExecutionId = assertCanonicalExecutionId(executionId);

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
    const validatedEvent = assertExecutionEvent(event) as ExecutionEvent<T>;
    const executionId = assertCanonicalExecutionId(validatedEvent.executionId);
    const expectedVersion = this.store.getStreamVersion(executionId);
    assertExecutionSequence(validatedEvent, expectedVersion);

    this.store.append(
      {
        streamId: executionId,
        eventId: validatedEvent.id,
        eventType: validatedEvent.type,
        occurredAt: validatedEvent.occurredAt,
        traceId: executionId,
        correlationId: executionId,
        ...(validatedEvent.parentEventId === undefined
          ? {}
          : { causationId: validatedEvent.parentEventId }),
        payload: {
          sequence: validatedEvent.sequence,
          actor: validatedEvent.actor,
          ...(validatedEvent.parentEventId === undefined
            ? {}
            : { parentEventId: validatedEvent.parentEventId }),
          payload: validatedEvent.payload,
        },
      },
      expectedVersion,
    );
  }

  public readExecution(executionId: string): readonly ExecutionEvent[] {
    const canonicalExecutionId = assertCanonicalExecutionId(executionId);
    return Object.freeze(
      this.store.readStream(canonicalExecutionId).map(restoreExecutionEvent),
    );
  }
}

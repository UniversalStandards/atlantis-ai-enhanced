import {
  executionEventTypes,
  type EventSink,
  type ExecutionEvent,
  type ExecutionEventType,
} from "@atlantis/contracts";

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

const executionEventFields = new Set([
  "id",
  "executionId",
  "sequence",
  "type",
  "occurredAt",
  "actor",
  "parentEventId",
  "payload",
]);

const requiredExecutionEventFields = [
  "id",
  "executionId",
  "sequence",
  "type",
  "occurredAt",
  "actor",
  "payload",
] as const;

const recognizedExecutionEventTypes = new Set<ExecutionEventType>(
  executionEventTypes,
);

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

function assertCanonicalEventId(value: unknown, field: "id" | "parentEventId"): string {
  if (typeof value !== "string") {
    throw new InvalidEventError(`execution event ${field} must be a string.`);
  }

  const canonicalValue = value.trim();
  if (canonicalValue.length === 0) {
    throw new InvalidEventError(`execution event ${field} must be non-empty.`);
  }
  if (canonicalValue !== value) {
    throw new InvalidEventError(
      `execution event ${field} must not contain leading or trailing whitespace.`,
    );
  }
  return canonicalValue;
}

function assertExecutionActor(actor: unknown): string {
  if (typeof actor !== "string") {
    throw new InvalidEventError("execution event actor must be a non-empty string.");
  }
  const canonicalActor = actor.trim();
  if (canonicalActor.length === 0) {
    throw new InvalidEventError("execution event actor must be a non-empty string.");
  }
  if (canonicalActor !== actor) {
    throw new InvalidEventError(
      "execution event actor must not contain leading or trailing whitespace.",
    );
  }
  return canonicalActor;
}

function assertExecutionEventType(type: unknown): ExecutionEventType {
  if (
    typeof type !== "string" ||
    !recognizedExecutionEventTypes.has(type as ExecutionEventType)
  ) {
    throw new InvalidEventError("execution event type is not recognized.");
  }
  return type as ExecutionEventType;
}

function assertAppendOperation<T>(operation: unknown): () => T | Promise<T> {
  if (typeof operation !== "function") {
    throw new InvalidEventError("execution append operation must be a function.");
  }
  return operation as () => T | Promise<T>;
}

function normalizeExecutionEvent<T>(event: unknown): ExecutionEvent<T> {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new InvalidEventError("execution event must be an object.");
  }

  const prototype = Object.getPrototypeOf(event);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidEventError("execution event must be a plain data record.");
  }

  const normalized: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;

  for (const key of Reflect.ownKeys(event)) {
    if (typeof key !== "string") {
      throw new InvalidEventError("execution event must not contain symbol fields.");
    }
    if (!executionEventFields.has(key)) {
      throw new InvalidEventError(`execution event contains unexpected field ${key}.`);
    }

    const descriptor = Object.getOwnPropertyDescriptor(event, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new InvalidEventError(
        `execution event.${key} must be an enumerable data property.`,
      );
    }
    normalized[key] = descriptor.value;
  }

  for (const field of requiredExecutionEventFields) {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) {
      throw new InvalidEventError(`execution event is missing required field ${field}.`);
    }
  }

  return Object.freeze(normalized) as unknown as ExecutionEvent<T>;
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
    persisted.sequence < 1
  ) {
    throw new InvalidEventError("persisted execution event payload is invalid.");
  }

  if (persisted.sequence !== stored.streamVersion) {
    throw new InvalidEventError(
      "persisted execution event sequence must match its stream version.",
    );
  }

  const executionId = assertCanonicalExecutionId(stored.streamId);
  const eventId = assertCanonicalEventId(stored.eventId, "id");
  const actor = assertExecutionActor(persisted.actor);
  const type = assertExecutionEventType(stored.eventType);
  const parentEventId =
    persisted.parentEventId === undefined
      ? undefined
      : assertCanonicalEventId(persisted.parentEventId, "parentEventId");

  if (stored.traceId !== executionId || stored.correlationId !== executionId) {
    throw new InvalidEventError(
      "persisted execution event trace and correlation identities must match its stream identity.",
    );
  }

  if (stored.causationId !== parentEventId) {
    throw new InvalidEventError(
      "persisted execution event parentEventId must match its causationId.",
    );
  }

  return Object.freeze({
    id: eventId,
    executionId,
    sequence: persisted.sequence,
    type,
    occurredAt: stored.occurredAt,
    actor,
    ...(parentEventId === undefined ? {} : { parentEventId }),
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
    const validatedOperation = assertAppendOperation<T>(operation);

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
      return await validatedOperation();
    } finally {
      release();
      if (this.executionQueues.get(canonicalExecutionId) === tail) {
        this.executionQueues.delete(canonicalExecutionId);
      }
    }
  }

  public async append<T>(event: ExecutionEvent<T>): Promise<void> {
    const validatedEvent = normalizeExecutionEvent<T>(event);
    const executionId = assertCanonicalExecutionId(validatedEvent.executionId);
    const eventId = assertCanonicalEventId(validatedEvent.id, "id");
    const parentEventId =
      validatedEvent.parentEventId === undefined
        ? undefined
        : assertCanonicalEventId(validatedEvent.parentEventId, "parentEventId");
    const actor = assertExecutionActor(validatedEvent.actor);
    const type = assertExecutionEventType(validatedEvent.type);
    const expectedVersion = this.store.getStreamVersion(executionId);
    assertExecutionSequence(validatedEvent, expectedVersion);

    this.store.append(
      {
        streamId: executionId,
        eventId,
        eventType: type,
        occurredAt: validatedEvent.occurredAt,
        traceId: executionId,
        correlationId: executionId,
        ...(parentEventId === undefined ? {} : { causationId: parentEventId }),
        payload: {
          sequence: validatedEvent.sequence,
          actor,
          ...(parentEventId === undefined ? {} : { parentEventId }),
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

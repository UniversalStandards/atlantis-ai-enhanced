export interface AppendEventInput<TPayload = unknown> {
  readonly streamId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: TPayload;
  readonly occurredAt: string;
  readonly traceId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface StoredEvent<TPayload = unknown> extends AppendEventInput<TPayload> {
  readonly sequence: number;
  readonly streamVersion: number;
}

export class ConcurrencyConflictError extends Error {
  public constructor(
    public readonly streamId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Stream ${streamId} expected version ${expectedVersion}, but is at version ${actualVersion}.`,
    );
    this.name = "ConcurrencyConflictError";
  }
}

export class DuplicateEventError extends Error {
  public constructor(public readonly eventId: string) {
    super(`Event ${eventId} already exists.`);
    this.name = "DuplicateEventError";
  }
}

export class InvalidEventError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidEventError";
  }
}

export interface EventStore {
  append<TPayload>(
    event: AppendEventInput<TPayload>,
    expectedVersion: number,
  ): StoredEvent<TPayload>;
  readStream(streamId: string, afterVersion?: number): readonly StoredEvent[];
  readAll(afterSequence?: number): readonly StoredEvent[];
  getStreamVersion(streamId: string): number;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new InvalidEventError(`${field} must be non-empty.`);
  }
}

function validateEvent(event: AppendEventInput): void {
  assertNonEmpty(event.streamId, "streamId");
  assertNonEmpty(event.eventId, "eventId");
  assertNonEmpty(event.eventType, "eventType");
  assertNonEmpty(event.traceId, "traceId");

  if (!Number.isFinite(Date.parse(event.occurredAt))) {
    throw new InvalidEventError("occurredAt must be a valid ISO-8601 timestamp.");
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return value;
  }
  seen.add(objectValue);

  for (const key of Reflect.ownKeys(objectValue)) {
    deepFreeze(Reflect.get(objectValue, key), seen);
  }

  return Object.freeze(value);
}

function immutableCopy<TPayload>(event: StoredEvent<TPayload>): StoredEvent<TPayload> {
  try {
    return deepFreeze(structuredClone(event));
  } catch {
    throw new InvalidEventError("event must be structured-cloneable.");
  }
}

/**
 * Deterministic append-only event store suitable for tests and the first
 * executable workflow skeleton. Persistence adapters can implement EventStore
 * without changing callers.
 */
export class InMemoryEventStore implements EventStore {
  readonly #events: StoredEvent[] = [];
  readonly #eventIds = new Set<string>();
  readonly #streamVersions = new Map<string, number>();

  public append<TPayload>(
    event: AppendEventInput<TPayload>,
    expectedVersion: number,
  ): StoredEvent<TPayload> {
    validateEvent(event);

    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new InvalidEventError("expectedVersion must be a non-negative safe integer.");
    }

    if (this.#eventIds.has(event.eventId)) {
      throw new DuplicateEventError(event.eventId);
    }

    const actualVersion = this.getStreamVersion(event.streamId);
    if (actualVersion !== expectedVersion) {
      throw new ConcurrencyConflictError(event.streamId, expectedVersion, actualVersion);
    }

    const stored = immutableCopy({
      ...event,
      sequence: this.#events.length + 1,
      streamVersion: actualVersion + 1,
    });

    this.#events.push(stored);
    this.#eventIds.add(stored.eventId);
    this.#streamVersions.set(stored.streamId, stored.streamVersion);
    return stored;
  }

  public readStream(streamId: string, afterVersion = 0): readonly StoredEvent[] {
    assertNonEmpty(streamId, "streamId");
    if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) {
      throw new InvalidEventError("afterVersion must be a non-negative safe integer.");
    }

    return Object.freeze(
      this.#events.filter(
        (event) => event.streamId === streamId && event.streamVersion > afterVersion,
      ),
    );
  }

  public readAll(afterSequence = 0): readonly StoredEvent[] {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new InvalidEventError("afterSequence must be a non-negative safe integer.");
    }
    return Object.freeze(this.#events.filter((event) => event.sequence > afterSequence));
  }

  public getStreamVersion(streamId: string): number {
    assertNonEmpty(streamId, "streamId");
    return this.#streamVersions.get(streamId) ?? 0;
  }
}

export function replay<TState>(
  initialState: TState,
  events: readonly StoredEvent[],
  reducer: (state: TState, event: StoredEvent) => TState,
): TState {
  return events.reduce(reducer, initialState);
}

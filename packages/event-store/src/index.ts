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

export class PersistenceConflictError extends Error {
  public constructor(public readonly attempts: number) {
    super(`Could not persist event store state after ${attempts} atomic attempts.`);
    this.name = "PersistenceConflictError";
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

export interface AtomicSnapshot {
  readonly revision: number;
  readonly value: string | null;
}

/**
 * Provider-neutral atomic persistence boundary. Implementations may use a file,
 * database row, object store, or another durable medium, provided compareAndSwap
 * is atomic for a single snapshot key.
 */
export interface AtomicSnapshotStorage {
  load(): AtomicSnapshot;
  compareAndSwap(expectedRevision: number, nextValue: string): boolean;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new InvalidEventError(`${field} must be non-empty.`);
  }
}

function assertCursor(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidEventError(`${field} must be a non-negative safe integer.`);
  }
}

function validateEvent(event: AppendEventInput): void {
  assertNonEmpty(event.streamId, "streamId");
  assertNonEmpty(event.eventId, "eventId");
  assertNonEmpty(event.eventType, "eventType");
  assertNonEmpty(event.traceId, "traceId");

  if (event.correlationId !== undefined) {
    assertNonEmpty(event.correlationId, "correlationId");
  }
  if (event.causationId !== undefined) {
    assertNonEmpty(event.causationId, "causationId");
  }

  const parsedTimestamp = Date.parse(event.occurredAt);
  if (!Number.isFinite(parsedTimestamp) || new Date(parsedTimestamp).toISOString() !== event.occurredAt) {
    throw new InvalidEventError("occurredAt must be a canonical ISO-8601 UTC timestamp.");
  }
}

function assertJsonValue(
  value: unknown,
  path = "payload",
  ancestors = new WeakSet<object>(),
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InvalidEventError(`${path} must contain only finite JSON numbers.`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new InvalidEventError(`${path} must contain only JSON-native values.`);
  }

  if (ancestors.has(value)) {
    throw new InvalidEventError(`${path} must not contain circular references.`);
  }
  ancestors.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, ancestors));
    ancestors.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidEventError(`${path} must contain only JSON objects and arrays.`);
  }

  for (const [key, item] of Object.entries(value)) {
    assertJsonValue(item, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
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

function detachedCopy<T>(value: T, errorMessage: string): T {
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    throw new InvalidEventError(errorMessage);
  }
}

function immutableCopy<TPayload>(event: StoredEvent<TPayload>): StoredEvent<TPayload> {
  return detachedCopy(event, "event must be structured-cloneable.");
}

function buildIndexes(events: readonly StoredEvent[]): {
  readonly eventIds: Set<string>;
  readonly streamVersions: Map<string, number>;
} {
  const eventIds = new Set<string>();
  const streamVersions = new Map<string, number>();

  events.forEach((event, index) => {
    validateEvent(event);
    assertJsonValue(event.payload);
    assertCursor(event.sequence, "sequence");
    assertCursor(event.streamVersion, "streamVersion");

    if (event.sequence !== index + 1) {
      throw new InvalidEventError("persisted event sequences must be contiguous and ordered.");
    }
    if (eventIds.has(event.eventId)) {
      throw new InvalidEventError(`persisted eventId ${event.eventId} is duplicated.`);
    }

    const expectedStreamVersion = (streamVersions.get(event.streamId) ?? 0) + 1;
    if (event.streamVersion !== expectedStreamVersion) {
      throw new InvalidEventError(
        `persisted stream ${event.streamId} has a non-contiguous version.`,
      );
    }

    eventIds.add(event.eventId);
    streamVersions.set(event.streamId, event.streamVersion);
  });

  return { eventIds, streamVersions };
}

function parsePersistedEvents(value: string | null): readonly StoredEvent[] {
  if (value === null) {
    return Object.freeze([]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidEventError("persisted event store state must be valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new InvalidEventError("persisted event store state must be an event array.");
  }

  const events = detachedCopy(parsed, "persisted events must be structured-cloneable.") as readonly StoredEvent[];
  buildIndexes(events);
  return Object.freeze(events);
}

abstract class IndexedEventStore implements EventStore {
  protected events: readonly StoredEvent[] = Object.freeze([]);
  protected eventIds = new Set<string>();
  protected streamVersions = new Map<string, number>();

  protected replaceEvents(events: readonly StoredEvent[]): void {
    const indexes = buildIndexes(events);
    this.events = Object.freeze([...events]);
    this.eventIds = indexes.eventIds;
    this.streamVersions = indexes.streamVersions;
  }

  protected createStoredEvent<TPayload>(
    event: AppendEventInput<TPayload>,
    expectedVersion: number,
  ): StoredEvent<TPayload> {
    validateEvent(event);
    assertCursor(expectedVersion, "expectedVersion");

    if (this.eventIds.has(event.eventId)) {
      throw new DuplicateEventError(event.eventId);
    }

    const actualVersion = this.getStreamVersion(event.streamId);
    if (actualVersion !== expectedVersion) {
      throw new ConcurrencyConflictError(event.streamId, expectedVersion, actualVersion);
    }

    return immutableCopy({
      ...event,
      sequence: this.events.length + 1,
      streamVersion: actualVersion + 1,
    });
  }

  public abstract append<TPayload>(
    event: AppendEventInput<TPayload>,
    expectedVersion: number,
  ): StoredEvent<TPayload>;

  public readStream(streamId: string, afterVersion = 0): readonly StoredEvent[] {
    assertNonEmpty(streamId, "streamId");
    assertCursor(afterVersion, "afterVersion");

    return Object.freeze(
      this.events.filter(
        (event) => event.streamId === streamId && event.streamVersion > afterVersion,
      ),
    );
  }

  public readAll(afterSequence = 0): readonly StoredEvent[] {
    assertCursor(afterSequence, "afterSequence");
    return Object.freeze(this.events.filter((event) => event.sequence > afterSequence));
  }

  public getStreamVersion(streamId: string): number {
    assertNonEmpty(streamId, "streamId");
    return this.streamVersions.get(streamId) ?? 0;
  }
}

/** Deterministic append-only adapter for tests and the executable skeleton. */
export class InMemoryEventStore extends IndexedEventStore {
  public append<TPayload>(
    event: AppendEventInput<TPayload>,
    expectedVersion: number,
  ): StoredEvent<TPayload> {
    const stored = this.createStoredEvent(event, expectedVersion);
    this.replaceEvents([...this.events, stored]);
    return stored;
  }
}

/**
 * Durable adapter backed by an atomic snapshot primitive. Payloads are limited
 * to JSON-native values so snapshot persistence and restart recovery preserve
 * exact meaning across providers.
 */
export class DurableSnapshotEventStore extends IndexedEventStore {
  public constructor(
    private readonly storage: AtomicSnapshotStorage,
    private readonly maxPersistenceAttempts = 3,
  ) {
    super();
    if (!Number.isSafeInteger(maxPersistenceAttempts) || maxPersistenceAttempts < 1) {
      throw new InvalidEventError("maxPersistenceAttempts must be a positive safe integer.");
    }
    this.reload();
  }

  private reload(): AtomicSnapshot {
    const snapshot = this.storage.load();
    assertCursor(snapshot.revision, "storage revision");
    this.replaceEvents(parsePersistedEvents(snapshot.value));
    return snapshot;
  }

  public append<TPayload>(
    event: AppendEventInput<TPayload>,
    expectedVersion: number,
  ): StoredEvent<TPayload> {
    assertJsonValue(event.payload);

    for (let attempt = 1; attempt <= this.maxPersistenceAttempts; attempt += 1) {
      const snapshot = this.reload();
      const stored = this.createStoredEvent(event, expectedVersion);
      const nextEvents = [...this.events, stored];

      if (this.storage.compareAndSwap(snapshot.revision, JSON.stringify(nextEvents))) {
        this.replaceEvents(nextEvents);
        return stored;
      }
    }

    throw new PersistenceConflictError(this.maxPersistenceAttempts);
  }

  public override readStream(
    streamId: string,
    afterVersion = 0,
  ): readonly StoredEvent[] {
    this.reload();
    return super.readStream(streamId, afterVersion);
  }

  public override readAll(afterSequence = 0): readonly StoredEvent[] {
    this.reload();
    return super.readAll(afterSequence);
  }

  public override getStreamVersion(streamId: string): number {
    this.reload();
    return super.getStreamVersion(streamId);
  }
}

/** In-memory atomic storage used for deterministic adapter and recovery tests. */
export class InMemoryAtomicSnapshotStorage implements AtomicSnapshotStorage {
  #revision = 0;
  #value: string | null = null;

  public load(): AtomicSnapshot {
    return Object.freeze({ revision: this.#revision, value: this.#value });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    assertCursor(expectedRevision, "expectedRevision");
    if (this.#revision !== expectedRevision) {
      return false;
    }
    this.#value = nextValue;
    this.#revision += 1;
    return true;
  }
}

export function replay<TState>(
  initialState: TState,
  events: readonly StoredEvent[],
  reducer: (state: TState, event: StoredEvent) => TState,
): TState {
  return events.reduce(reducer, initialState);
}

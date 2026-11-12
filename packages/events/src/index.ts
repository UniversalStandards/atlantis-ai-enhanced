import { createHash, randomUUID } from "node:crypto";
import type {
  EventStore,
  ExecutionEvent,
  ExecutionEventType,
} from "@atlantis/contracts";

/** Hash of the (empty) history that precedes the first event of an execution. */
export const GENESIS_HASH = "0".repeat(64);

/** A stored event plus the hash that chains it to its predecessor. */
export interface ChainedEvent {
  readonly event: ExecutionEvent;
  readonly previousHash: string;
  readonly hash: string;
}

export type IntegrityResult =
  | { readonly valid: true; readonly length: number; readonly headHash: string }
  | { readonly valid: false; readonly brokenAtSequence: number };

/** Raised when an append would break ordering, uniqueness, or serializability. */
export class EventOrderingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventOrderingError";
  }
}

/**
 * Deterministic JSON: object keys sorted, no whitespace. Rejects values JSON
 * cannot represent faithfully, so an event that cannot be replayed exactly is
 * never accepted into the history.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, "$", new Set());
}

function serialize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new EventOrderingError(`Non-finite number at ${path}`);
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new EventOrderingError(
        `Unserializable ${typeof value} value at ${path}`,
      );
  }

  if (seen.has(value)) {
    throw new EventOrderingError(`Circular reference at ${path}`);
  }
  seen.add(value);
  let out: string;
  if (Array.isArray(value)) {
    out = `[${value.map((v, i) => serialize(v, `${path}[${i}]`, seen)).join(",")}]`;
  } else {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new EventOrderingError(`Non-plain object at ${path}`);
    }
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) continue;
      parts.push(
        `${JSON.stringify(key)}:${serialize(entry, `${path}.${key}`, seen)}`,
      );
    }
    out = `{${parts.join(",")}}`;
  }
  seen.delete(value);
  return out;
}

/** SHA-256 of a UTF-8 string, as lowercase hex. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Hash that links one canonical event to the hash of its predecessor. */
export function chainHash(
  previousHash: string,
  canonicalEvent: string,
): string {
  return createHash("sha256")
    .update(previousHash)
    .update("\n")
    .update(canonicalEvent)
    .digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Append-only, in-process event store with a SHA-256 hash chain per execution.
 *
 * Guarantees:
 * - sequences are contiguous from 0 per execution; gaps and replays are rejected;
 * - event ids are unique across the store;
 * - stored events are deep-frozen copies, so callers cannot rewrite history;
 * - {@link verify} detects any change to a stored event.
 *
 * State lives in memory and is lost when the process exits. It is the reference
 * implementation of the {@link EventStore} contract and the store used in
 * tests and replay fixtures; a durable deployment needs a PostgreSQL-backed
 * implementation of the same contract (ADR 0001 §4).
 */
export class InMemoryEventStore implements EventStore {
  readonly #chains = new Map<string, ChainedEvent[]>();
  readonly #ids = new Set<string>();

  // Async so that validation failures surface as rejections, per the contract.
  // eslint-disable-next-line @typescript-eslint/require-await
  async append<T>(event: ExecutionEvent<T>): Promise<void> {
    this.#append(event);
  }

  #append(event: ExecutionEvent): void {
    if (event.executionId.length === 0 || event.id.length === 0) {
      throw new EventOrderingError("Event id and executionId are required");
    }
    if (Number.isNaN(Date.parse(event.occurredAt))) {
      throw new EventOrderingError(
        `Event ${event.id} has an invalid occurredAt timestamp`,
      );
    }
    if (this.#ids.has(event.id)) {
      throw new EventOrderingError(`Duplicate event id ${event.id}`);
    }
    const chain = this.#chains.get(event.executionId) ?? [];
    if (event.sequence !== chain.length) {
      throw new EventOrderingError(
        `Execution ${event.executionId} expected sequence ${chain.length}, received ${event.sequence}`,
      );
    }

    const canonical = canonicalJson(event);
    const previousHash = chain.at(-1)?.hash ?? GENESIS_HASH;
    const stored = deepFreeze(JSON.parse(canonical) as ExecutionEvent);
    chain.push(
      Object.freeze({
        event: stored,
        previousHash,
        hash: chainHash(previousHash, canonical),
      }),
    );
    this.#chains.set(event.executionId, chain);
    this.#ids.add(event.id);
  }

  read(executionId: string): Promise<readonly ExecutionEvent[]> {
    return Promise.resolve(
      (this.#chains.get(executionId) ?? []).map((entry) => entry.event),
    );
  }

  /** Events with their chain hashes, for export or external anchoring. */
  readChain(executionId: string): readonly ChainedEvent[] {
    return [...(this.#chains.get(executionId) ?? [])];
  }

  /** Recomputes the hash chain for one execution. */
  verify(executionId: string): IntegrityResult {
    return verifyChain(this.readChain(executionId));
  }
}

/** Recomputes a hash chain from its events; usable on exported histories. */
export function verifyChain(chain: readonly ChainedEvent[]): IntegrityResult {
  let previousHash = GENESIS_HASH;
  for (const [index, entry] of chain.entries()) {
    let expected: string;
    try {
      expected = chainHash(previousHash, canonicalJson(entry.event));
    } catch {
      return { valid: false, brokenAtSequence: index };
    }
    if (
      entry.event.sequence !== index ||
      entry.previousHash !== previousHash ||
      entry.hash !== expected
    ) {
      return { valid: false, brokenAtSequence: index };
    }
    previousHash = entry.hash;
  }
  return { valid: true, length: chain.length, headHash: previousHash };
}

export interface EventRecorderOptions {
  /** Identity recorded as the actor on every event. */
  readonly actor: string;
  /** Injectable for deterministic replay fixtures. Defaults to wall-clock time. */
  readonly now?: () => Date;
  /** Injectable for deterministic replay fixtures. Defaults to random UUIDs. */
  readonly generateId?: () => string;
}

/**
 * Assigns ids, sequences, and timestamps for one execution and appends to a
 * store. One recorder owns one execution's sequence; do not share an execution
 * between recorders.
 *
 * Payloads are written verbatim. Callers must not put secrets, prompts
 * containing secrets, or raw tool output in a payload (AGENTS.md rule 6).
 */
export class EventRecorder {
  readonly #store: EventStore;
  readonly #executionId: string;
  readonly #actor: string;
  readonly #now: () => Date;
  readonly #generateId: () => string;
  #sequence = 0;
  #pending: Promise<unknown> = Promise.resolve();

  constructor(
    store: EventStore,
    executionId: string,
    options: EventRecorderOptions,
  ) {
    this.#store = store;
    this.#executionId = executionId;
    this.#actor = options.actor;
    this.#now = options.now ?? (() => new Date());
    this.#generateId = options.generateId ?? randomUUID;
  }

  /**
   * Appends one event. Calls are serialized, so concurrent callers still
   * produce a contiguous sequence. A failed append does not consume a sequence.
   */
  record<T>(
    type: ExecutionEventType,
    payload: T,
    parentEventId?: string,
  ): Promise<ExecutionEvent<T>> {
    const next = this.#pending.then(async () => {
      const event: ExecutionEvent<T> = {
        id: this.#generateId(),
        executionId: this.#executionId,
        sequence: this.#sequence,
        type,
        occurredAt: this.#now().toISOString(),
        actor: this.#actor,
        ...(parentEventId === undefined ? {} : { parentEventId }),
        payload,
      };
      await this.#store.append(event);
      this.#sequence += 1;
      return event;
    });
    this.#pending = next.catch(() => undefined);
    return next;
  }
}

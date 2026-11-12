import { createHash, randomUUID } from "node:crypto";
/** Hash of the (empty) history that precedes the first event of an execution. */
export const GENESIS_HASH = "0".repeat(64);
/** Raised when an append would break ordering, uniqueness, or serializability. */
export class EventOrderingError extends Error {
    constructor(message) {
        super(message);
        this.name = "EventOrderingError";
    }
}
/**
 * Deterministic JSON: object keys sorted, no whitespace. Rejects values JSON
 * cannot represent faithfully, so an event that cannot be replayed exactly is
 * never accepted into the history.
 */
export function canonicalJson(value) {
    return serialize(value, "$", new Set());
}
function serialize(value, path, seen) {
    if (value === null)
        return "null";
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
            throw new EventOrderingError(`Unserializable ${typeof value} value at ${path}`);
    }
    if (seen.has(value)) {
        throw new EventOrderingError(`Circular reference at ${path}`);
    }
    seen.add(value);
    let out;
    if (Array.isArray(value)) {
        out = `[${value.map((v, i) => serialize(v, `${path}[${i}]`, seen)).join(",")}]`;
    }
    else {
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
            throw new EventOrderingError(`Non-plain object at ${path}`);
        }
        const record = value;
        const parts = [];
        for (const key of Object.keys(record).sort()) {
            const entry = record[key];
            if (entry === undefined)
                continue;
            parts.push(`${JSON.stringify(key)}:${serialize(entry, `${path}.${key}`, seen)}`);
        }
        out = `{${parts.join(",")}}`;
    }
    seen.delete(value);
    return out;
}
/** SHA-256 of a UTF-8 string, as lowercase hex. */
export function sha256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
}
/** Hash that links one canonical event to the hash of its predecessor. */
export function chainHash(previousHash, canonicalEvent) {
    return createHash("sha256")
        .update(previousHash)
        .update("\n")
        .update(canonicalEvent)
        .digest("hex");
}
function deepFreeze(value) {
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value))
            deepFreeze(child);
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
export class InMemoryEventStore {
    #chains = new Map();
    #ids = new Set();
    // Async so that validation failures surface as rejections, per the contract.
    // eslint-disable-next-line @typescript-eslint/require-await
    async append(event) {
        this.#append(event);
    }
    #append(event) {
        if (event.executionId.length === 0 || event.id.length === 0) {
            throw new EventOrderingError("Event id and executionId are required");
        }
        if (Number.isNaN(Date.parse(event.occurredAt))) {
            throw new EventOrderingError(`Event ${event.id} has an invalid occurredAt timestamp`);
        }
        if (this.#ids.has(event.id)) {
            throw new EventOrderingError(`Duplicate event id ${event.id}`);
        }
        const chain = this.#chains.get(event.executionId) ?? [];
        if (event.sequence !== chain.length) {
            throw new EventOrderingError(`Execution ${event.executionId} expected sequence ${chain.length}, received ${event.sequence}`);
        }
        const canonical = canonicalJson(event);
        const previousHash = chain.at(-1)?.hash ?? GENESIS_HASH;
        const stored = deepFreeze(JSON.parse(canonical));
        chain.push(Object.freeze({
            event: stored,
            previousHash,
            hash: chainHash(previousHash, canonical),
        }));
        this.#chains.set(event.executionId, chain);
        this.#ids.add(event.id);
    }
    read(executionId) {
        return Promise.resolve((this.#chains.get(executionId) ?? []).map((entry) => entry.event));
    }
    /** Events with their chain hashes, for export or external anchoring. */
    readChain(executionId) {
        return [...(this.#chains.get(executionId) ?? [])];
    }
    /** Recomputes the hash chain for one execution. */
    verify(executionId) {
        return verifyChain(this.readChain(executionId));
    }
}
/** Recomputes a hash chain from its events; usable on exported histories. */
export function verifyChain(chain) {
    let previousHash = GENESIS_HASH;
    for (const [index, entry] of chain.entries()) {
        let expected;
        try {
            expected = chainHash(previousHash, canonicalJson(entry.event));
        }
        catch {
            return { valid: false, brokenAtSequence: index };
        }
        if (entry.event.sequence !== index ||
            entry.previousHash !== previousHash ||
            entry.hash !== expected) {
            return { valid: false, brokenAtSequence: index };
        }
        previousHash = entry.hash;
    }
    return { valid: true, length: chain.length, headHash: previousHash };
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
    #store;
    #executionId;
    #actor;
    #now;
    #generateId;
    #sequence = 0;
    #pending = Promise.resolve();
    constructor(store, executionId, options) {
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
    record(type, payload, parentEventId) {
        const next = this.#pending.then(async () => {
            const event = {
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
//# sourceMappingURL=index.js.map
import type { EventStore, ExecutionEvent, ExecutionEventType } from "@atlantis/contracts";
/** Hash of the (empty) history that precedes the first event of an execution. */
export declare const GENESIS_HASH: string;
/** A stored event plus the hash that chains it to its predecessor. */
export interface ChainedEvent {
    readonly event: ExecutionEvent;
    readonly previousHash: string;
    readonly hash: string;
}
export type IntegrityResult = {
    readonly valid: true;
    readonly length: number;
    readonly headHash: string;
} | {
    readonly valid: false;
    readonly brokenAtSequence: number;
};
/** Raised when an append would break ordering, uniqueness, or serializability. */
export declare class EventOrderingError extends Error {
    constructor(message: string);
}
/**
 * Deterministic JSON: object keys sorted, no whitespace. Rejects values JSON
 * cannot represent faithfully, so an event that cannot be replayed exactly is
 * never accepted into the history.
 */
export declare function canonicalJson(value: unknown): string;
/** SHA-256 of a UTF-8 string, as lowercase hex. */
export declare function sha256Hex(value: string): string;
/** Hash that links one canonical event to the hash of its predecessor. */
export declare function chainHash(previousHash: string, canonicalEvent: string): string;
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
export declare class InMemoryEventStore implements EventStore {
    #private;
    append<T>(event: ExecutionEvent<T>): Promise<void>;
    read(executionId: string): Promise<readonly ExecutionEvent[]>;
    /** Events with their chain hashes, for export or external anchoring. */
    readChain(executionId: string): readonly ChainedEvent[];
    /** Recomputes the hash chain for one execution. */
    verify(executionId: string): IntegrityResult;
}
/** Recomputes a hash chain from its events; usable on exported histories. */
export declare function verifyChain(chain: readonly ChainedEvent[]): IntegrityResult;
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
export declare class EventRecorder {
    #private;
    constructor(store: EventStore, executionId: string, options: EventRecorderOptions);
    /**
     * Appends one event. Calls are serialized, so concurrent callers still
     * produce a contiguous sequence. A failed append does not consume a sequence.
     */
    record<T>(type: ExecutionEventType, payload: T, parentEventId?: string): Promise<ExecutionEvent<T>>;
}
//# sourceMappingURL=index.d.ts.map
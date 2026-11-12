import type { EventStore, ExecutionEvent } from "@atlantis/contracts";
import { type ChainedEvent, type IntegrityResult } from "@atlantis/events";
/**
 * The one method this store needs from a database driver. Satisfied by
 * `pg.Pool`, `pg.Client`, and PGlite without an adapter.
 */
export interface SqlClient {
    query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{
        rows: R[];
    }>;
}
export interface PostgresEventStoreOptions {
    /** Schema that holds the events table. Defaults to `"public"`. */
    readonly schema?: string;
}
/**
 * PostgreSQL implementation of the {@link EventStore} contract, with the same
 * guarantees as the in-memory store, made durable:
 *
 * - sequences are contiguous from 0 per execution, enforced in the INSERT
 *   itself and by the primary key, so concurrent writers cannot both win;
 * - event ids are unique across the table;
 * - rows cannot be updated, deleted, or truncated (triggers reject all three);
 * - every row stores the SHA-256 that chains it to its predecessor, computed
 *   over the exact canonical text that is stored.
 *
 * Call {@link migrate} once at deployment. The triggers stop an application
 * role from rewriting history; a database owner can still disable them, so
 * anchor the head hash externally where that threat matters.
 */
export declare class PostgresEventStore implements EventStore {
    #private;
    constructor(client: SqlClient, options?: PostgresEventStoreOptions);
    /** Creates the table and immutability triggers. Safe to run repeatedly. */
    migrate(): Promise<void>;
    append<T>(event: ExecutionEvent<T>): Promise<void>;
    read(executionId: string): Promise<readonly ExecutionEvent[]>;
    /** Events with their chain hashes, for export or external anchoring. */
    readChain(executionId: string): Promise<readonly ChainedEvent[]>;
    /** Recomputes the stored hash chain for one execution. */
    verify(executionId: string): Promise<IntegrityResult>;
}
//# sourceMappingURL=index.d.ts.map
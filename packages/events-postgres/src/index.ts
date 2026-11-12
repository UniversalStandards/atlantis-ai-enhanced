import type { EventStore, ExecutionEvent } from "@atlantis/contracts";
import {
  canonicalJson,
  chainHash,
  EventOrderingError,
  GENESIS_HASH,
  verifyChain,
  type ChainedEvent,
  type IntegrityResult,
} from "@atlantis/events";

/**
 * The one method this store needs from a database driver. Satisfied by
 * `pg.Pool`, `pg.Client`, and PGlite without an adapter.
 */
export interface SqlClient {
  // The row type is caller-asserted, as in `pg` and PGlite.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  query<R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

export interface PostgresEventStoreOptions {
  /** Schema that holds the events table. Defaults to `"public"`. */
  readonly schema?: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const UNIQUE_VIOLATION = "23505";

interface Row {
  canonical: string;
  previous_hash: string;
  hash: string;
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
export class PostgresEventStore implements EventStore {
  readonly #client: SqlClient;
  readonly #table: string;
  readonly #schema: string;

  constructor(client: SqlClient, options: PostgresEventStoreOptions = {}) {
    const schema = options.schema ?? "public";
    if (!IDENTIFIER.test(schema)) {
      throw new TypeError(
        `Invalid schema name: must match ${IDENTIFIER.source}`,
      );
    }
    this.#client = client;
    this.#schema = schema;
    this.#table = `"${schema}"."atlantis_events"`;
  }

  /** Creates the table and immutability triggers. Safe to run repeatedly. */
  async migrate(): Promise<void> {
    const fn = `"${this.#schema}"."atlantis_events_reject_mutation"`;
    const statements = [
      `CREATE TABLE IF NOT EXISTS ${this.#table} (
         execution_id  text        NOT NULL,
         sequence      integer     NOT NULL CHECK (sequence >= 0),
         event_id      text        NOT NULL UNIQUE,
         event_type    text        NOT NULL,
         occurred_at   timestamptz NOT NULL,
         canonical     text        NOT NULL,
         previous_hash char(64)    NOT NULL,
         hash          char(64)    NOT NULL,
         recorded_at   timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (execution_id, sequence)
       )`,
      `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'atlantis_events is append-only' USING ERRCODE = 'integrity_constraint_violation';
       END $$`,
      `DROP TRIGGER IF EXISTS atlantis_events_no_rewrite ON ${this.#table}`,
      `CREATE TRIGGER atlantis_events_no_rewrite BEFORE UPDATE OR DELETE ON ${this.#table}
       FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      `DROP TRIGGER IF EXISTS atlantis_events_no_truncate ON ${this.#table}`,
      `CREATE TRIGGER atlantis_events_no_truncate BEFORE TRUNCATE ON ${this.#table}
       FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`,
    ];
    for (const statement of statements) await this.#client.query(statement);
  }

  async append<T>(event: ExecutionEvent<T>): Promise<void> {
    if (event.executionId.length === 0 || event.id.length === 0) {
      throw new EventOrderingError("Event id and executionId are required");
    }
    if (!Number.isInteger(event.sequence) || event.sequence < 0) {
      throw new EventOrderingError(`Event ${event.id} has an invalid sequence`);
    }
    if (Number.isNaN(Date.parse(event.occurredAt))) {
      throw new EventOrderingError(
        `Event ${event.id} has an invalid occurredAt timestamp`,
      );
    }
    const canonical = canonicalJson(event);

    const head = await this.#client.query<{ hash: string }>(
      `SELECT hash::text AS hash FROM ${this.#table} WHERE execution_id = $1 AND sequence = $2`,
      [event.executionId, event.sequence - 1],
    );
    const previousHash =
      event.sequence === 0 ? GENESIS_HASH : head.rows[0]?.hash;
    if (previousHash === undefined) {
      throw await this.#orderingError(event);
    }

    // The WHERE clause re-checks, inside the INSERT, that this is the next
    // sequence and that the predecessor still has the hash we chained to.
    let inserted: { rows: unknown[] };
    try {
      inserted = await this.#client.query(
        `INSERT INTO ${this.#table}
           (execution_id, sequence, event_id, event_type, occurred_at, canonical, previous_hash, hash)
         SELECT $1::text, $2::integer, $3::text, $4::text, $5::timestamptz, $6::text, $7::text, $8::text
         WHERE (SELECT count(*) FROM ${this.#table} WHERE execution_id = $1::text) = $2::integer
           AND coalesce(
                 (SELECT hash::text FROM ${this.#table}
                   WHERE execution_id = $1::text AND sequence = $2::integer - 1),
                 $9::text
               ) = $7::text
         RETURNING sequence`,
        [
          event.executionId,
          event.sequence,
          event.id,
          event.type,
          event.occurredAt,
          canonical,
          previousHash,
          chainHash(previousHash, canonical),
          GENESIS_HASH,
        ],
      );
    } catch (error) {
      if ((error as { code?: unknown }).code !== UNIQUE_VIOLATION) throw error;
      const duplicate = await this.#client.query(
        `SELECT 1 FROM ${this.#table} WHERE event_id = $1`,
        [event.id],
      );
      if (duplicate.rows.length > 0) {
        throw new EventOrderingError(`Duplicate event id ${event.id}`);
      }
      throw await this.#orderingError(event);
    }
    if (inserted.rows.length === 0) throw await this.#orderingError(event);
  }

  async #orderingError(event: ExecutionEvent): Promise<EventOrderingError> {
    const count = await this.#client.query<{ n: number | string }>(
      `SELECT count(*) AS n FROM ${this.#table} WHERE execution_id = $1`,
      [event.executionId],
    );
    return new EventOrderingError(
      `Execution ${event.executionId} expected sequence ${Number(count.rows[0]?.n ?? 0)}, received ${event.sequence}`,
    );
  }

  async read(executionId: string): Promise<readonly ExecutionEvent[]> {
    return (await this.readChain(executionId)).map((entry) => entry.event);
  }

  /** Events with their chain hashes, for export or external anchoring. */
  async readChain(executionId: string): Promise<readonly ChainedEvent[]> {
    const result = await this.#client.query<Row>(
      `SELECT canonical, previous_hash::text AS previous_hash, hash::text AS hash FROM ${this.#table}
       WHERE execution_id = $1 ORDER BY sequence`,
      [executionId],
    );
    return result.rows.map((row) => ({
      event: JSON.parse(row.canonical) as ExecutionEvent,
      previousHash: row.previous_hash,
      hash: row.hash,
    }));
  }

  /** Recomputes the stored hash chain for one execution. */
  async verify(executionId: string): Promise<IntegrityResult> {
    return verifyChain(await this.readChain(executionId));
  }
}

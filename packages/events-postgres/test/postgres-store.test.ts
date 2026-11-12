import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@atlantis/contracts";
import {
  EventOrderingError,
  EventRecorder,
  GENESIS_HASH,
  InMemoryEventStore,
} from "@atlantis/events";
import { PostgresEventStore, type SqlClient } from "../src/index.js";

function event(
  sequence: number,
  overrides: Partial<ExecutionEvent> = {},
): ExecutionEvent {
  return {
    id: `evt-${sequence}`,
    executionId: "exec-1",
    sequence,
    type: "execution.started",
    occurredAt: "2026-01-01T00:00:00.000Z",
    actor: "test",
    payload: { n: sequence, nested: { ratio: 1.5, big: 1e21, text: "é\n" } },
    ...overrides,
  };
}

let db: PGlite;
let store: PostgresEventStore;

beforeEach(async () => {
  db = new PGlite();
  store = new PostgresEventStore(db);
  await store.migrate();
});

describe("PostgresEventStore", () => {
  it("migrates idempotently", async () => {
    await store.append(event(0));
    await store.migrate();
    expect(await store.read("exec-1")).toHaveLength(1);
  });

  it("round-trips events exactly and isolates executions", async () => {
    await store.append(event(0));
    await store.append(event(0, { id: "other", executionId: "exec-2" }));
    await store.append(event(1, { parentEventId: "evt-0" }));

    expect(await store.read("exec-1")).toEqual([
      event(0),
      event(1, { parentEventId: "evt-0" }),
    ]);
    expect(await store.read("exec-2")).toHaveLength(1);
    expect(await store.read("missing")).toEqual([]);
  });

  it("produces the same hash chain as the in-memory store", async () => {
    const memory = new InMemoryEventStore();
    for (const e of [event(0), event(1), event(2)]) {
      await store.append(e);
      await memory.append(e);
    }
    expect(await store.verify("exec-1")).toEqual(memory.verify("exec-1"));
    expect(await store.verify("none")).toEqual({
      valid: true,
      length: 0,
      headHash: GENESIS_HASH,
    });
  });

  it("rejects gaps, replays, duplicate ids, and malformed events", async () => {
    await store.append(event(0));

    await expect(store.append(event(2))).rejects.toThrow(
      /expected sequence 1, received 2/,
    );
    await expect(store.append(event(0, { id: "again" }))).rejects.toThrow(
      /expected sequence 1, received 0/,
    );
    await expect(store.append(event(1, { id: "evt-0" }))).rejects.toThrow(
      /Duplicate event id/,
    );
    await expect(
      store.append(event(0, { id: "evt-0", executionId: "exec-9" })),
    ).rejects.toThrow(/Duplicate event id/);
    await expect(store.append(event(1, { id: "" }))).rejects.toThrow(
      /required/,
    );
    await expect(store.append(event(1.5))).rejects.toThrow(/invalid sequence/);
    await expect(store.append(event(-1))).rejects.toThrow(/invalid sequence/);
    await expect(
      store.append(event(1, { occurredAt: "not a date" })),
    ).rejects.toThrow(/occurredAt/);
    await expect(
      store.append(event(1, { payload: { bad: Number.NaN } })),
    ).rejects.toThrow(EventOrderingError);

    expect(await store.read("exec-1")).toHaveLength(1);
  });

  it("lets exactly one of several concurrent writers claim a sequence", async () => {
    await store.append(event(0));
    const outcomes = await Promise.allSettled(
      ["a", "b", "c", "d"].map((id) => store.append(event(1, { id }))),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(EventOrderingError);
      }
    }
    expect(await store.read("exec-1")).toHaveLength(2);
    expect((await store.verify("exec-1")).valid).toBe(true);
  });

  it("refuses an insert whose predecessor changed after it was read", async () => {
    await store.append(event(0));
    const racing: SqlClient = {
      query: async (text, params) => {
        const result = await db.query(text, params);
        if (text.startsWith("SELECT hash")) {
          // Simulate a stale read: hand back a hash that is no longer the head.
          return { rows: [{ hash: "f".repeat(64) }] } as never;
        }
        return result as never;
      },
    };
    await expect(
      new PostgresEventStore(racing).append(event(1)),
    ).rejects.toThrow(/expected sequence 1, received 1/);
  });

  it("passes through database errors that are not ordering conflicts", async () => {
    const failing: SqlClient = {
      query: async (text, params) => {
        if (text.trimStart().startsWith("INSERT"))
          throw new Error("connection lost");
        return (await db.query(text, params)) as never;
      },
    };
    await expect(
      new PostgresEventStore(failing).append(event(0)),
    ).rejects.toThrow("connection lost");
  });

  it("blocks UPDATE, DELETE, and TRUNCATE at the database", async () => {
    await store.append(event(0));
    await expect(
      db.query(`UPDATE atlantis_events SET canonical = '{}'`),
    ).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM atlantis_events`)).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query(`TRUNCATE atlantis_events`)).rejects.toThrow(
      /append-only/,
    );
    expect(await store.read("exec-1")).toHaveLength(1);
  });

  it("detects tampering by a role that bypassed the triggers", async () => {
    await store.append(event(0));
    await store.append(event(1));
    await db.query(`ALTER TABLE atlantis_events DISABLE TRIGGER USER`);
    await db.query(
      `UPDATE atlantis_events SET canonical = replace(canonical, '"actor":"test"', '"actor":"attacker"') WHERE sequence = 1`,
    );
    expect(await store.verify("exec-1")).toEqual({
      valid: false,
      brokenAtSequence: 1,
    });
  });

  it("supports a named schema and rejects unsafe schema names", async () => {
    await db.query(`CREATE SCHEMA audit`);
    const scoped = new PostgresEventStore(db, { schema: "audit" });
    await scoped.migrate();
    await scoped.append(event(0));
    expect(await scoped.read("exec-1")).toHaveLength(1);
    expect(await store.read("exec-1")).toEqual([]);
    expect(
      () => new PostgresEventStore(db, { schema: 'x"; DROP TABLE y; --' }),
    ).toThrow(TypeError);
  });

  it("works as the store behind an EventRecorder", async () => {
    const recorder = new EventRecorder(store, "exec-r", { actor: "runner" });
    await Promise.all([
      recorder.record("execution.started", { a: 1 }),
      recorder.record("execution.completed", {}),
    ]);
    expect((await store.read("exec-r")).map((e) => e.sequence)).toEqual([0, 1]);
    expect(await store.verify("exec-r")).toMatchObject({
      valid: true,
      length: 2,
    });
  });
});

import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@atlantis/contracts";
import {
  canonicalJson,
  EventOrderingError,
  EventRecorder,
  GENESIS_HASH,
  InMemoryEventStore,
  verifyChain,
} from "../src/index.js";

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
    payload: { n: sequence },
    ...overrides,
  };
}

describe("canonicalJson", () => {
  it("is independent of key order and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], c: undefined })).toBe(
      canonicalJson({ a: [true, null, "x"], b: 1 }),
    );
  });

  it.each([
    ["non-finite numbers", { n: Number.NaN }],
    ["functions", { f: () => 1 }],
    ["class instances", { d: new Date(0) }],
    ["bigints", { b: 1n }],
  ])("rejects %s", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(EventOrderingError);
  });

  it("rejects circular references but allows repeated siblings", () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe(
      '{"a":{"x":1},"b":{"x":1}}',
    );
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalJson(loop)).toThrow(/Circular/);
  });
});

describe("InMemoryEventStore", () => {
  it("returns events in sequence order and isolates executions", async () => {
    const store = new InMemoryEventStore();
    await store.append(event(0));
    await store.append(event(0, { id: "other-0", executionId: "exec-2" }));
    await store.append(event(1));

    expect((await store.read("exec-1")).map((e) => e.sequence)).toEqual([0, 1]);
    expect(await store.read("exec-2")).toHaveLength(1);
    expect(await store.read("missing")).toEqual([]);
  });

  it("rejects gaps, replays, duplicate ids, and malformed events", async () => {
    const store = new InMemoryEventStore();
    await store.append(event(0));

    await expect(store.append(event(2))).rejects.toThrow(/expected sequence 1/);
    await expect(store.append(event(0, { id: "again" }))).rejects.toThrow(
      EventOrderingError,
    );
    await expect(store.append(event(1, { id: "evt-0" }))).rejects.toThrow(
      /Duplicate event id/,
    );
    await expect(
      store.append(event(1, { occurredAt: "not a date" })),
    ).rejects.toThrow(/occurredAt/);
    await expect(store.append(event(1, { id: "" }))).rejects.toThrow(
      /required/,
    );
    await expect(
      store.append(event(1, { payload: { bad: Number.POSITIVE_INFINITY } })),
    ).rejects.toThrow(/Non-finite/);

    expect(await store.read("exec-1")).toHaveLength(1);
  });

  it("stores an immutable copy, isolated from the caller's object", async () => {
    const store = new InMemoryEventStore();
    const payload = { nested: { value: 1 } };
    await store.append(event(0, { payload }));
    payload.nested.value = 99;

    const [stored] = await store.read("exec-1");
    expect(stored?.payload).toEqual({ nested: { value: 1 } });
    expect(() => {
      (stored as { actor: string }).actor = "attacker";
    }).toThrow(TypeError);
    expect(() => {
      (stored?.payload as { nested: { value: number } }).nested.value = 2;
    }).toThrow(TypeError);
  });

  it("chains hashes from genesis and verifies an intact history", async () => {
    const store = new InMemoryEventStore();
    expect(store.verify("exec-1")).toEqual({
      valid: true,
      length: 0,
      headHash: GENESIS_HASH,
    });
    await store.append(event(0));
    await store.append(event(1));

    const chain = store.readChain("exec-1");
    expect(chain[0]?.previousHash).toBe(GENESIS_HASH);
    expect(chain[1]?.previousHash).toBe(chain[0]?.hash);
    expect(store.verify("exec-1")).toEqual({
      valid: true,
      length: 2,
      headHash: chain[1]?.hash,
    });
  });

  it("detects edited, reordered, and unserializable exported histories", async () => {
    const store = new InMemoryEventStore();
    await store.append(event(0));
    await store.append(event(1));
    await store.append(event(2));
    const chain = store.readChain("exec-1");

    const edited = chain.map((entry, i) =>
      i === 1
        ? { ...entry, event: { ...entry.event, actor: "attacker" } }
        : entry,
    );
    expect(verifyChain(edited)).toEqual({ valid: false, brokenAtSequence: 1 });
    expect(verifyChain([chain[1]!, chain[0]!, chain[2]!])).toEqual({
      valid: false,
      brokenAtSequence: 0,
    });
    expect(verifyChain(chain.slice(1))).toEqual({
      valid: false,
      brokenAtSequence: 0,
    });
    const corrupt = [
      { ...chain[0]!, event: { ...chain[0]!.event, payload: Number.NaN } },
    ];
    expect(verifyChain(corrupt)).toEqual({ valid: false, brokenAtSequence: 0 });
  });
});

describe("EventRecorder", () => {
  it("assigns contiguous sequences under concurrent calls", async () => {
    const store = new InMemoryEventStore();
    let id = 0;
    const recorder = new EventRecorder(store, "exec-1", {
      actor: "runner",
      now: () => new Date("2026-02-03T04:05:06.000Z"),
      generateId: () => `id-${id++}`,
    });

    const recorded = await Promise.all([
      recorder.record("execution.started", { a: 1 }),
      recorder.record("workflow.step.started", { b: 2 }, "id-0"),
      recorder.record("execution.completed", {}),
    ]);

    expect(recorded.map((e) => e.sequence)).toEqual([0, 1, 2]);
    expect(recorded[1]).toMatchObject({
      id: "id-1",
      actor: "runner",
      parentEventId: "id-0",
      occurredAt: "2026-02-03T04:05:06.000Z",
    });
    expect(recorded[0]).not.toHaveProperty("parentEventId");
    expect(store.verify("exec-1").valid).toBe(true);
  });

  it("does not consume a sequence when an append fails", async () => {
    const store = new InMemoryEventStore();
    const recorder = new EventRecorder(store, "exec-1", { actor: "runner" });

    await expect(
      recorder.record("tool.failed", { bad: Number.NaN }),
    ).rejects.toThrow(EventOrderingError);
    const next = await recorder.record("tool.completed", { ok: true });

    expect(next.sequence).toBe(0);
    expect(next.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.read("exec-1")).toHaveLength(1);
  });
});

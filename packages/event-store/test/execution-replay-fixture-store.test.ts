import { describe, expect, it } from "vitest";

import type { ExecutionReplayFixture } from "../src/execution-replay-evidence.js";
import {
  ExecutionReplayFixtureRepository,
  InMemoryExecutionReplayFixtureStorage,
  serializeExecutionReplayFixture,
} from "../src/execution-replay-fixture-store.js";

const fixture: ExecutionReplayFixture = Object.freeze({
  fixtureId: "day-7-release-fixture",
  events: Object.freeze([
    Object.freeze({
      id: "event-1",
      executionId: "exec-release-1",
      sequence: 1,
      type: "execution.started" as const,
      actor: "runner",
      occurredAt: "2026-08-20T00:00:00.000Z",
      payload: Object.freeze({}),
    }),
  ]),
  budget: Object.freeze({
    maxToolCalls: 10,
    maxRetries: 3,
    maxIterations: 5,
    maxTokens: 2000,
    maxDurationMs: 60000,
    maxCostUsd: 1,
  }),
  usage: Object.freeze({
    toolCalls: 1,
    retries: 0,
    iterations: 1,
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 1000,
    costUsd: 0.01,
  }),
});

describe("ExecutionReplayFixtureRepository", () => {
  it("round-trips canonical governed replay fixtures", () => {
    const repository = new ExecutionReplayFixtureRepository(new InMemoryExecutionReplayFixtureStorage());
    repository.save(fixture);

    const restored = repository.load(fixture.fixtureId);
    expect(serializeExecutionReplayFixture(restored)).toBe(serializeExecutionReplayFixture(fixture));
  });

  it("fails closed when persisted fixture identity is substituted", () => {
    const storage = new InMemoryExecutionReplayFixtureStorage();
    storage.save("requested-fixture", serializeExecutionReplayFixture(fixture));
    const repository = new ExecutionReplayFixtureRepository(storage);

    expect(() => repository.load("requested-fixture")).toThrow(/identity does not match/);
  });

  it("requires exact authoritative readback after persistence", () => {
    const storage = {
      save: () => undefined,
      load: () => JSON.stringify({ substituted: true }),
    };
    const repository = new ExecutionReplayFixtureRepository(storage);

    expect(() => repository.save(fixture)).toThrow(/acknowledge the exact canonical fixture/);
  });

  it("rejects malformed persisted fixtures through the governed replay boundary", () => {
    const storage = new InMemoryExecutionReplayFixtureStorage();
    storage.save("broken", JSON.stringify({
      fixtureId: "broken",
      events: [],
      budget: fixture.budget,
      usage: fixture.usage,
    }));
    const repository = new ExecutionReplayFixtureRepository(storage);

    expect(() => repository.load("broken")).toThrow();
  });
});

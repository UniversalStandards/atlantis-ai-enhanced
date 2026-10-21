import type { ExecutionBudget, ExecutionEvent, ExecutionUsage } from "@atlantis/contracts";

import { InvalidEventError } from "./index.js";
import {
  projectExecutionReplayEvidence,
  type ExecutionReplayFixture,
} from "./execution-replay-evidence.js";

export interface ExecutionReplayFixtureStorage {
  load(fixtureId: string): string | null;
  save(fixtureId: string, canonicalFixture: string): void;
}

function assertFixtureId(value: string): void {
  if (value.trim().length === 0) {
    throw new InvalidEventError("fixtureId must be non-empty.");
  }
}

function parseFixture(serialized: string): ExecutionReplayFixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new InvalidEventError("persisted replay fixture must be valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidEventError("persisted replay fixture must be an object.");
  }

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["budget", "events", "fixtureId", "usage"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new InvalidEventError("persisted replay fixture must contain exactly fixtureId, events, budget, and usage.");
  }
  if (typeof record.fixtureId !== "string" || !Array.isArray(record.events)) {
    throw new InvalidEventError("persisted replay fixture has invalid fixtureId or events.");
  }

  const fixture: ExecutionReplayFixture = Object.freeze({
    fixtureId: record.fixtureId,
    events: Object.freeze(record.events) as readonly ExecutionEvent[],
    budget: record.budget as ExecutionBudget,
    usage: record.usage as ExecutionUsage,
  });

  // Reuse the governed replay projection as the authoritative structural and
  // semantic validation boundary rather than maintaining a second validator.
  projectExecutionReplayEvidence(fixture);
  return fixture;
}

export function serializeExecutionReplayFixture(fixture: ExecutionReplayFixture): string {
  const evidence = projectExecutionReplayEvidence(fixture);
  return JSON.stringify({
    fixtureId: evidence.fixtureId,
    events: fixture.events,
    budget: fixture.budget,
    usage: fixture.usage,
  });
}

/**
 * Provider-neutral persistence boundary for deterministic Day-7 replay fixtures.
 * Storage owns durability; this repository owns canonical serialization,
 * authoritative readback, identity binding, and governed replay validation.
 */
export class ExecutionReplayFixtureRepository {
  public constructor(private readonly storage: ExecutionReplayFixtureStorage) {}

  public save(fixture: ExecutionReplayFixture): void {
    const canonicalFixture = serializeExecutionReplayFixture(fixture);
    this.storage.save(fixture.fixtureId, canonicalFixture);

    const acknowledged = this.storage.load(fixture.fixtureId);
    if (acknowledged !== canonicalFixture) {
      throw new InvalidEventError("replay fixture storage must acknowledge the exact canonical fixture after save.");
    }
  }

  public load(fixtureId: string): ExecutionReplayFixture {
    assertFixtureId(fixtureId);
    const serialized = this.storage.load(fixtureId);
    if (serialized === null) {
      throw new InvalidEventError(`replay fixture ${fixtureId} was not found.`);
    }
    const fixture = parseFixture(serialized);
    if (fixture.fixtureId !== fixtureId) {
      throw new InvalidEventError("persisted replay fixture identity does not match the requested fixtureId.");
    }
    return fixture;
  }
}

/** Process-local reference storage only; not production durability evidence. */
export class InMemoryExecutionReplayFixtureStorage implements ExecutionReplayFixtureStorage {
  readonly #fixtures = new Map<string, string>();

  public load(fixtureId: string): string | null {
    assertFixtureId(fixtureId);
    return this.#fixtures.get(fixtureId) ?? null;
  }

  public save(fixtureId: string, canonicalFixture: string): void {
    assertFixtureId(fixtureId);
    if (canonicalFixture.length === 0) {
      throw new InvalidEventError("canonical replay fixture must be non-empty.");
    }
    this.#fixtures.set(fixtureId, canonicalFixture);
  }
}

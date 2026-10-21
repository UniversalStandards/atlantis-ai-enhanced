import { canonicalizeTrackerProjectionValue } from "@atlantis/contracts/tracker-projection";

export interface TrackerSynchronizationIdentity {
  readonly sourceSystem: string;
  readonly repository: string;
  readonly entityType: "issue" | "pull_request";
  readonly entityId: number;
  readonly sourceRevision: string;
  readonly targetSystem: string;
  readonly projectionVersion: Readonly<{ major: number; minor: number }>;
}

export type IdentityResult =
  | Readonly<{
      status: "valid";
      identity: TrackerSynchronizationIdentity;
      key: string;
    }>
  | Readonly<{ status: "invalid"; code: "MALFORMED_IDENTITY"; reason: string }>;

export type IdempotencyOutcome =
  | Readonly<{ status: "applied"; result: unknown }>
  | Readonly<{ status: "failed"; code: string }>;

export type IdempotencyClaim =
  | Readonly<{ status: "claimed" }>
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "invalid-key" }>
  | Readonly<{ status: "replay" }>;

export type IdempotencyRecordResult =
  | Readonly<{ status: "recorded" }>
  | Readonly<{ status: "claim-missing" }>
  | Readonly<{ status: "malformed-key" }>
  | Readonly<{ status: "port-failed" }>;

export interface IdempotencyPort {
  claim(key: string): Promise<IdempotencyClaim>;
  record(key: string, outcome: IdempotencyOutcome): Promise<IdempotencyRecordResult>;
  replay(key: string): Promise<IdempotencyOutcome | null>;
}

export const IN_MEMORY_REFERENCE_STORE_PRODUCTION_READY = false;

export function createTrackerSynchronizationIdentity(
  value: unknown,
): IdentityResult {
  try {
    const record = plainRecord(value);
    const sourceSystem = nonBlankText(record.sourceSystem, "sourceSystem");
    const repository = nonBlankText(record.repository, "repository");
    const entityType = record.entityType;
    if (entityType !== "issue" && entityType !== "pull_request") {
      throw new TypeError("entityType must be issue or pull_request");
    }
    const entityId = record.entityId;
    if (!Number.isSafeInteger(entityId) || (entityId as number) < 1) {
      throw new TypeError("entityId must be a positive safe integer");
    }
    const sourceRevision = record.sourceRevision;
    if (typeof sourceRevision !== "string" || !/^[a-f0-9]{64}$/u.test(sourceRevision)) {
      throw new TypeError("sourceRevision must be a lowercase SHA-256 digest");
    }
    const targetSystem = nonBlankText(record.targetSystem, "targetSystem");
    const version = plainRecord(record.projectionVersion);
    const major = version.major;
    const minor = version.minor;
    if (!Number.isSafeInteger(major) || (major as number) < 1) {
      throw new TypeError("projectionVersion.major must be a positive safe integer");
    }
    if (!Number.isSafeInteger(minor) || (minor as number) < 0) {
      throw new TypeError("projectionVersion.minor must be a non-negative safe integer");
    }

    const identity = Object.freeze({
      sourceSystem,
      repository,
      entityType,
      entityId: entityId as number,
      sourceRevision,
      targetSystem,
      projectionVersion: Object.freeze({
        major: major as number,
        minor: minor as number,
      }),
    });
    const key = `tracker-sync:v1:${canonicalizeTrackerProjectionValue(identity)}`;
    return Object.freeze({ status: "valid", identity, key });
  } catch (error) {
    return Object.freeze({
      status: "invalid",
      code: "MALFORMED_IDENTITY",
      reason: error instanceof Error ? error.message : "identity is malformed",
    });
  }
}

export function isValidTrackerIdempotencyKey(key: unknown): key is string {
  if (typeof key !== "string" || !key.startsWith("tracker-sync:v1:")) {
    return false;
  }
  try {
    const encodedIdentity = key.slice("tracker-sync:v1:".length);
    const identity = JSON.parse(encodedIdentity) as unknown;
    const result = createTrackerSynchronizationIdentity(identity);
    return result.status === "valid" && result.key === key;
  } catch {
    return false;
  }
}

export class InMemoryReferenceIdempotencyStore implements IdempotencyPort {
  readonly #records = new Map<
    string,
    | Readonly<{ state: "claimed"; priorOutcome?: IdempotencyOutcome }>
    | Readonly<{ state: "succeeded"; outcome: IdempotencyOutcome }>
    | Readonly<{ state: "failed"; outcome: IdempotencyOutcome }>
  >();

  public async claim(key: string): Promise<IdempotencyClaim> {
    if (!isValidTrackerIdempotencyKey(key)) {
      return Object.freeze({ status: "invalid-key" });
    }
    const current = this.#records.get(key);
    if (current?.state === "claimed") {
      return Object.freeze({ status: "conflict" });
    }
    if (current?.state === "succeeded") {
      return Object.freeze({ status: "replay" });
    }
    this.#records.set(
      key,
      Object.freeze({
        state: "claimed",
        ...(current?.state === "failed" ? { priorOutcome: current.outcome } : {}),
      }),
    );
    return Object.freeze({ status: "claimed" });
  }

  public async record(
    key: string,
    outcome: IdempotencyOutcome,
  ): Promise<IdempotencyRecordResult> {
    if (!isValidTrackerIdempotencyKey(key)) {
      return Object.freeze({ status: "malformed-key" });
    }
    if (this.#records.get(key)?.state !== "claimed") {
      return Object.freeze({ status: "claim-missing" });
    }
    this.#records.set(
      key,
      Object.freeze({
        state: outcome.status === "applied" ? "succeeded" : "failed",
        outcome: Object.freeze(outcome),
      }),
    );
    return Object.freeze({ status: "recorded" });
  }

  public async replay(key: string): Promise<IdempotencyOutcome | null> {
    if (!isValidTrackerIdempotencyKey(key)) {
      return null;
    }
    const current = this.#records.get(key);
    if (current?.state === "succeeded" || current?.state === "failed") {
      return current.outcome;
    }
    return current?.state === "claimed" ? current.priorOutcome ?? null : null;
  }
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("identity must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("identity must be a plain object");
  }
  const record: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError("identity must not contain symbol fields");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`identity.${key} must be a data property`);
    }
    record[key] = descriptor.value;
  }
  return record;
}

function nonBlankText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be non-blank text`);
  }
  return value.trim();
}

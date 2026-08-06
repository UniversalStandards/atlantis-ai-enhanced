import {
  createPersistenceProofConsumptionIndex,
  restorePersistenceProofConsumptionIndex,
  type PersistenceProofConsumptionIndex,
} from "@atlantis/contracts/persistence-proof-consumption";
import {
  planPersistenceUncertaintyAtomicTransitionWithTrustedClock,
  type TrustedPersistenceUncertaintyAtomicPlanInput,
} from "@atlantis/contracts/persistence-uncertainty-atomic-plan";
import type { PersistenceUncertaintyRecord } from "@atlantis/contracts/persistence-uncertainty";
import type { TrustedPersistenceClock } from "@atlantis/contracts/trusted-persistence-reconciliation";

import type { AtomicSnapshotStorage } from "./index.js";
import { createCanonicalJsonCandidate } from "./canonical-json-candidate.js";
import { restoreExactPersistenceUncertaintyRecord } from "./persistence-uncertainty-restoration-validation.js";

interface PersistedUncertaintyEntry {
  readonly version: number;
  readonly record: PersistenceUncertaintyRecord;
}

interface PersistedUncertaintyState {
  readonly records: readonly PersistedUncertaintyEntry[];
  readonly proofConsumptionIndex: PersistenceProofConsumptionIndex;
}

export interface PersistenceUncertaintySnapshot {
  readonly version: number;
  readonly record: PersistenceUncertaintyRecord;
}

export class PersistenceUncertaintyNotFoundError extends Error {
  public constructor(public readonly recordId: string) {
    super(`Persistence uncertainty record ${recordId} was not found.`);
    this.name = "PersistenceUncertaintyNotFoundError";
  }
}

export class PersistenceUncertaintyVersionConflictError extends Error {
  public constructor(
    public readonly recordId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Persistence uncertainty record ${recordId} expected version ${expectedVersion}, but is at version ${actualVersion}.`,
    );
    this.name = "PersistenceUncertaintyVersionConflictError";
  }
}

export class PersistenceUncertaintyRepositoryConflictError extends Error {
  public constructor(public readonly attempts: number) {
    super(
      `Could not persist persistence-uncertainty state after ${attempts} atomic attempts.`,
    );
    this.name = "PersistenceUncertaintyRepositoryConflictError";
  }
}

export class InvalidPersistedUncertaintyStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistedUncertaintyStateError";
  }
}

function requirePositiveVersion(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new InvalidPersistedUncertaintyStateError(
      `${field} must be a positive safe integer.`,
    );
  }
}

function requireExactDataObject(
  value: unknown,
  subject: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new InvalidPersistedUncertaintyStateError(
      `${subject} must be a standard object.`,
    );
  }

  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length
    || keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) {
    throw new InvalidPersistedUncertaintyStateError(
      `${subject} must contain exactly: ${fields.join(", ")}.`,
    );
  }

  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (
      descriptor === undefined
      || descriptor.enumerable !== true
      || !("value" in descriptor)
    ) {
      throw new InvalidPersistedUncertaintyStateError(
        `${subject}.${field} must be an enumerable data property.`,
      );
    }
  }

  return value as Record<string, unknown>;
}

function requireDenseStandardArray(
  value: unknown,
  subject: string,
): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new InvalidPersistedUncertaintyStateError(
      `${subject} must be a standard array.`,
    );
  }

  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (key === "length") {
      continue;
    }
    if (
      typeof key !== "string"
      || !/^(0|[1-9]\d*)$/.test(key)
      || Number(key) >= value.length
      || String(Number(key)) !== key
    ) {
      throw new InvalidPersistedUncertaintyStateError(
        `${subject} must not contain non-index fields.`,
      );
    }
  }

  if (keys.length !== value.length + 1) {
    throw new InvalidPersistedUncertaintyStateError(
      `${subject} must not contain sparse elements.`,
    );
  }

  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined
      || descriptor.enumerable !== true
      || !("value" in descriptor)
    ) {
      throw new InvalidPersistedUncertaintyStateError(
        `${subject}[${index}] must be an enumerable data property.`,
      );
    }
  }
}

function requireExactBooleanSettlement(value: unknown): boolean {
  if (value !== true && value !== false) {
    throw new InvalidPersistedUncertaintyStateError(
      "storage compareAndSwap result must be a synchronous boolean.",
    );
  }
  return value;
}

function emptyState(): PersistedUncertaintyState {
  return Object.freeze({
    records: Object.freeze([]),
    proofConsumptionIndex: createPersistenceProofConsumptionIndex(),
  });
}

function restoreParsedState(parsed: unknown): PersistedUncertaintyState {
  const candidate = requireExactDataObject(
    parsed,
    "persisted uncertainty state",
    ["records", "proofConsumptionIndex"],
  );
  requireDenseStandardArray(
    candidate.records,
    "persisted uncertainty state.records",
  );

  const recordIds = new Set<string>();
  const records = candidate.records.map((entry, index) => {
    const normalizedEntry = requireExactDataObject(
      entry,
      `persisted uncertainty entry ${index + 1}`,
      ["version", "record"],
    );
    requirePositiveVersion(
      normalizedEntry.version,
      `records[${index}].version`,
    );
    const record = restoreExactPersistenceUncertaintyRecord(
      normalizedEntry.record,
    );
    if (recordIds.has(record.recordId)) {
      throw new InvalidPersistedUncertaintyStateError(
        "persisted uncertainty recordId must be unique.",
      );
    }
    recordIds.add(record.recordId);
    return Object.freeze({ version: normalizedEntry.version, record });
  });

  const proofConsumptionIndex = restorePersistenceProofConsumptionIndex(
    candidate.proofConsumptionIndex,
  );
  for (const consumption of proofConsumptionIndex.entries) {
    const entry = records.find(
      (recordEntry) => recordEntry.record.recordId === consumption.uncertaintyRecordId,
    );
    if (entry === undefined) {
      throw new InvalidPersistedUncertaintyStateError(
        "proof consumption must reference a persisted uncertainty record.",
      );
    }
    const matchingAttempt = entry.record.attempts.find(
      (attempt) => attempt.attemptId === consumption.consumedByAttemptId,
    );
    if (matchingAttempt?.proofId !== consumption.proofId) {
      throw new InvalidPersistedUncertaintyStateError(
        "proof consumption must match its persisted reconciliation attempt.",
      );
    }
  }

  return Object.freeze({
    records: Object.freeze(records),
    proofConsumptionIndex,
  });
}

function restoreState(value: string | null): PersistedUncertaintyState {
  if (value === null) {
    return emptyState();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidPersistedUncertaintyStateError(
      "persisted uncertainty state must be valid JSON.",
    );
  }

  return restoreParsedState(parsed);
}

function createPersistedStateCandidate(
  state: PersistedUncertaintyState,
): string {
  return createCanonicalJsonCandidate(state, restoreParsedState).serialized;
}

function restoreAtomicSnapshot(value: unknown): {
  readonly revision: number;
  readonly value: string | null;
} {
  const snapshot = requireExactDataObject(
    value,
    "atomic snapshot",
    ["revision", "value"],
  );
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0) {
    throw new InvalidPersistedUncertaintyStateError(
      "storage revision must be a non-negative safe integer.",
    );
  }
  if (snapshot.value !== null && typeof snapshot.value !== "string") {
    throw new InvalidPersistedUncertaintyStateError(
      "storage value must be a string or null.",
    );
  }
  return Object.freeze({
    revision: snapshot.revision as number,
    value: snapshot.value as string | null,
  });
}

function requireEntry(
  state: PersistedUncertaintyState,
  recordId: string,
): PersistedUncertaintyEntry {
  const entry = state.records.find(
    (candidate) => candidate.record.recordId === recordId,
  );
  if (entry === undefined) {
    throw new InvalidPersistedUncertaintyStateError(
      "acknowledged persistence state must contain the committed uncertainty record.",
    );
  }
  return entry;
}

function createSnapshot(
  entry: PersistedUncertaintyEntry,
): PersistenceUncertaintySnapshot {
  return Object.freeze({ version: entry.version, record: entry.record });
}

/**
 * Reference repository backed by the provider-neutral atomic snapshot boundary.
 * It proves restart-safe, compare-and-swap persistence semantics without
 * selecting or claiming readiness for a production storage provider.
 */
export class DurableSnapshotPersistenceUncertaintyRepository {
  public constructor(
    private readonly storage: AtomicSnapshotStorage,
    private readonly maxPersistenceAttempts = 3,
  ) {
    if (!Number.isSafeInteger(maxPersistenceAttempts) || maxPersistenceAttempts < 1) {
      throw new InvalidPersistedUncertaintyStateError(
        "maxPersistenceAttempts must be a positive safe integer.",
      );
    }
    this.loadState();
  }

  private loadState(): {
    readonly revision: number;
    readonly state: PersistedUncertaintyState;
  } {
    const snapshot = restoreAtomicSnapshot(this.storage.load());
    return Object.freeze({
      revision: snapshot.revision,
      state: restoreState(snapshot.value),
    });
  }

  private requireCommittedCandidateAcknowledgement(
    expectedRevision: number,
    candidate: string,
  ): PersistedUncertaintyState {
    const acknowledged = restoreAtomicSnapshot(this.storage.load());
    if (
      acknowledged.revision !== expectedRevision + 1
      || acknowledged.value !== candidate
    ) {
      throw new InvalidPersistedUncertaintyStateError(
        "storage acknowledged a commit without exposing the exact candidate at the expected successor revision.",
      );
    }
    return restoreState(acknowledged.value);
  }

  public create(record: PersistenceUncertaintyRecord): PersistenceUncertaintySnapshot {
    const validatedRecord = restoreExactPersistenceUncertaintyRecord(record);

    for (let attempt = 1; attempt <= this.maxPersistenceAttempts; attempt += 1) {
      const { revision, state } = this.loadState();
      if (state.records.some((entry) => entry.record.recordId === validatedRecord.recordId)) {
        throw new PersistenceUncertaintyVersionConflictError(
          validatedRecord.recordId,
          0,
          1,
        );
      }
      const nextState = {
        records: [...state.records, { version: 1, record: validatedRecord }],
        proofConsumptionIndex: state.proofConsumptionIndex,
      };
      const candidate = createPersistedStateCandidate(nextState);
      const committed = requireExactBooleanSettlement(
        this.storage.compareAndSwap(revision, candidate),
      );
      if (committed) {
        const acknowledgedState = this.requireCommittedCandidateAcknowledgement(
          revision,
          candidate,
        );
        const acknowledgedEntry = requireEntry(
          acknowledgedState,
          validatedRecord.recordId,
        );
        if (acknowledgedEntry.version !== 1) {
          throw new InvalidPersistedUncertaintyStateError(
            "acknowledged created uncertainty record must be at version 1.",
          );
        }
        return createSnapshot(acknowledgedEntry);
      }
    }

    throw new PersistenceUncertaintyRepositoryConflictError(
      this.maxPersistenceAttempts,
    );
  }

  public get(recordId: string): PersistenceUncertaintySnapshot {
    if (recordId.trim().length === 0) {
      throw new InvalidPersistedUncertaintyStateError(
        "recordId must be non-empty.",
      );
    }
    const { state } = this.loadState();
    const entry = state.records.find((candidate) => candidate.record.recordId === recordId);
    if (entry === undefined) {
      throw new PersistenceUncertaintyNotFoundError(recordId);
    }
    return createSnapshot(entry);
  }

  public list(): readonly PersistenceUncertaintySnapshot[] {
    const { state } = this.loadState();
    return Object.freeze(state.records.map(createSnapshot));
  }

  public reconcile(
    recordId: string,
    expectedVersion: number,
    input: TrustedPersistenceUncertaintyAtomicPlanInput,
    clock: TrustedPersistenceClock,
  ): PersistenceUncertaintySnapshot {
    requirePositiveVersion(expectedVersion, "expectedVersion");

    for (let attempt = 1; attempt <= this.maxPersistenceAttempts; attempt += 1) {
      const { revision, state } = this.loadState();
      const entryIndex = state.records.findIndex(
        (candidate) => candidate.record.recordId === recordId,
      );
      if (entryIndex < 0) {
        throw new PersistenceUncertaintyNotFoundError(recordId);
      }
      const current = state.records[entryIndex];
      if (current === undefined) {
        throw new PersistenceUncertaintyNotFoundError(recordId);
      }
      if (current.version !== expectedVersion) {
        throw new PersistenceUncertaintyVersionConflictError(
          recordId,
          expectedVersion,
          current.version,
        );
      }

      const plan = planPersistenceUncertaintyAtomicTransitionWithTrustedClock(
        current.record,
        state.proofConsumptionIndex,
        input,
        clock,
      );
      const nextVersion = current.version + 1;
      const nextRecords = [...state.records];
      nextRecords[entryIndex] = {
        version: nextVersion,
        record: plan.nextRecord,
      };
      const nextState = {
        records: nextRecords,
        proofConsumptionIndex: plan.nextProofConsumptionIndex,
      };

      const candidate = createPersistedStateCandidate(nextState);
      const committed = requireExactBooleanSettlement(
        this.storage.compareAndSwap(revision, candidate),
      );
      if (committed) {
        const acknowledgedState = this.requireCommittedCandidateAcknowledgement(
          revision,
          candidate,
        );
        const acknowledgedEntry = requireEntry(acknowledgedState, recordId);
        if (acknowledgedEntry.version !== nextVersion) {
          throw new InvalidPersistedUncertaintyStateError(
            "acknowledged reconciled uncertainty record must be at the expected successor version.",
          );
        }
        return createSnapshot(acknowledgedEntry);
      }
    }

    throw new PersistenceUncertaintyRepositoryConflictError(
      this.maxPersistenceAttempts,
    );
  }
}

import {
  createPersistenceProofConsumptionIndex,
  restorePersistenceProofConsumptionIndex,
  type PersistenceProofConsumptionIndex,
} from "@atlantis/contracts/persistence-proof-consumption";
import {
  planPersistenceUncertaintyAtomicTransitionWithTrustedClock,
  type TrustedPersistenceUncertaintyAtomicPlanInput,
} from "@atlantis/contracts/persistence-uncertainty-atomic-plan";
import {
  createPersistenceUncertaintyRecord,
  type PersistenceUncertaintyRecord,
} from "@atlantis/contracts/persistence-uncertainty";
import type { TrustedPersistenceClock } from "@atlantis/contracts/trusted-persistence-reconciliation";

import type { AtomicSnapshotStorage } from "./index.js";

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

function freezeRecord(record: PersistenceUncertaintyRecord): PersistenceUncertaintyRecord {
  const expected = Object.freeze({ ...record.expected });
  const attempts = Object.freeze(
    record.attempts.map((attempt) => Object.freeze({
      ...attempt,
      decision: Object.freeze({ ...attempt.decision }),
    })),
  );
  return Object.freeze({ ...record, expected, attempts });
}

function restoreRecord(value: unknown): PersistenceUncertaintyRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidPersistedUncertaintyStateError(
      "persisted uncertainty record must be an object.",
    );
  }

  const candidate = value as PersistenceUncertaintyRecord;
  const base = createPersistenceUncertaintyRecord({
    recordId: candidate.recordId,
    expected: candidate.expected,
    ...(candidate.providerOperationId === undefined
      ? {}
      : { providerOperationId: candidate.providerOperationId }),
    firstObservedAt: candidate.firstObservedAt,
  });

  if (!Array.isArray(candidate.attempts)) {
    throw new InvalidPersistedUncertaintyStateError(
      "persisted uncertainty attempts must be an array.",
    );
  }
  if (
    candidate.status !== "pending"
    && candidate.status !== "quarantined"
    && candidate.status !== "resolved_committed"
    && candidate.status !== "resolved_not_committed"
  ) {
    throw new InvalidPersistedUncertaintyStateError(
      "persisted uncertainty status is invalid.",
    );
  }

  const attemptIds = new Set<string>();
  const proofIds = new Set<string>();
  const attempts = candidate.attempts.map((attempt, index) => {
    if (attempt === null || typeof attempt !== "object" || Array.isArray(attempt)) {
      throw new InvalidPersistedUncertaintyStateError(
        `persisted uncertainty attempt ${index + 1} must be an object.`,
      );
    }
    if (attempt.attemptNumber !== index + 1) {
      throw new InvalidPersistedUncertaintyStateError(
        "persisted uncertainty attempt numbers must be contiguous.",
      );
    }
    if (typeof attempt.attemptId !== "string" || attempt.attemptId.trim().length === 0) {
      throw new InvalidPersistedUncertaintyStateError(
        "persisted uncertainty attemptId must be non-empty.",
      );
    }
    if (attemptIds.has(attempt.attemptId)) {
      throw new InvalidPersistedUncertaintyStateError(
        "persisted uncertainty attemptId must be unique.",
      );
    }
    attemptIds.add(attempt.attemptId);
    for (const [field, timestamp] of [
      ["observedAt", attempt.observedAt],
      ["reconciledAt", attempt.reconciledAt],
    ] as const) {
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
        throw new InvalidPersistedUncertaintyStateError(
          `persisted uncertainty ${field} must be canonical UTC.`,
        );
      }
    }
    if (attempt.proofId !== undefined) {
      if (proofIds.has(attempt.proofId)) {
        throw new InvalidPersistedUncertaintyStateError(
          "persisted uncertainty proofId must be unique within a record.",
        );
      }
      proofIds.add(attempt.proofId);
    }
    return Object.freeze({
      ...attempt,
      decision: Object.freeze({ ...attempt.decision }),
    });
  });

  if (attempts.length === 0 && candidate.status !== "pending") {
    throw new InvalidPersistedUncertaintyStateError(
      "non-pending uncertainty state requires reconciliation evidence.",
    );
  }

  return freezeRecord({
    ...base,
    status: candidate.status,
    attempts: Object.freeze(attempts),
  });
}

function emptyState(): PersistedUncertaintyState {
  return Object.freeze({
    records: Object.freeze([]),
    proofConsumptionIndex: createPersistenceProofConsumptionIndex(),
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
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidPersistedUncertaintyStateError(
      "persisted uncertainty state must be an object.",
    );
  }

  const candidate = parsed as PersistedUncertaintyState;
  if (!Array.isArray(candidate.records)) {
    throw new InvalidPersistedUncertaintyStateError(
      "persisted uncertainty records must be an array.",
    );
  }

  const recordIds = new Set<string>();
  const records = candidate.records.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new InvalidPersistedUncertaintyStateError(
        `persisted uncertainty entry ${index + 1} must be an object.`,
      );
    }
    requirePositiveVersion(entry.version, `records[${index}].version`);
    const record = restoreRecord(entry.record);
    if (recordIds.has(record.recordId)) {
      throw new InvalidPersistedUncertaintyStateError(
        "persisted uncertainty recordId must be unique.",
      );
    }
    recordIds.add(record.recordId);
    return Object.freeze({ version: entry.version, record });
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
    const snapshot = this.storage.load();
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new InvalidPersistedUncertaintyStateError(
        "storage revision must be a non-negative safe integer.",
      );
    }
    return Object.freeze({
      revision: snapshot.revision,
      state: restoreState(snapshot.value),
    });
  }

  public create(record: PersistenceUncertaintyRecord): PersistenceUncertaintySnapshot {
    const validatedRecord = restoreRecord(record);

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
      if (this.storage.compareAndSwap(revision, JSON.stringify(nextState))) {
        return Object.freeze({ version: 1, record: validatedRecord });
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
    return Object.freeze({ version: entry.version, record: entry.record });
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

      if (this.storage.compareAndSwap(revision, JSON.stringify(nextState))) {
        return Object.freeze({
          version: nextVersion,
          record: plan.nextRecord,
        });
      }
    }

    throw new PersistenceUncertaintyRepositoryConflictError(
      this.maxPersistenceAttempts,
    );
  }
}

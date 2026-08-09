import type { PersistenceUncertaintyStatus } from "@atlantis/contracts/persistence-uncertainty";

import type { PersistenceUncertaintySnapshot } from "./persistence-uncertainty-repository.js";

export class InvalidPersistenceUncertaintyRecoverySelectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistenceUncertaintyRecoverySelectionError";
  }
}

export class InvalidPersistenceUncertaintyRecoverySnapshotInspectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistenceUncertaintyRecoverySnapshotInspectionError";
  }
}

export interface PersistenceUncertaintyRecoverySelection {
  readonly statuses: readonly PersistenceUncertaintyStatus[];
  readonly limit: number;
}

const selectableStatuses = new Set<PersistenceUncertaintyStatus>([
  "pending",
  "quarantined",
]);

interface CanonicalRecoverySelection {
  readonly statuses: unknown;
  readonly limit: unknown;
}

interface ValidatedRecoverySelection {
  readonly statuses: ReadonlySet<PersistenceUncertaintyStatus>;
  readonly limit: number;
}

function isRecoverySelectionDomainError(error: unknown): boolean {
  try {
    return error instanceof InvalidPersistenceUncertaintyRecoverySelectionError;
  } catch {
    return false;
  }
}

function rethrowInspectionFailure(error: unknown, field: string): never {
  if (isRecoverySelectionDomainError(error)) {
    throw error;
  }
  throw new InvalidPersistenceUncertaintyRecoverySelectionError(
    `${field} could not be inspected safely.`,
  );
}

function requireExactSelectionObject(
  selection: unknown,
): CanonicalRecoverySelection {
  try {
    if (
      selection === null
      || typeof selection !== "object"
      || Array.isArray(selection)
      || Object.getPrototypeOf(selection) !== Object.prototype
    ) {
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        "recovery selection must be a standard object.",
      );
    }

    const fields = ["statuses", "limit"] as const;
    const keys = Reflect.ownKeys(selection);
    if (
      keys.length !== fields.length
      || keys.some((key) => typeof key !== "string" || !fields.includes(key as typeof fields[number]))
    ) {
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        "recovery selection must contain exactly: statuses, limit.",
      );
    }

    const descriptors = new Map<typeof fields[number], PropertyDescriptor>();
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(selection, field);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !("value" in descriptor)
      ) {
        throw new InvalidPersistenceUncertaintyRecoverySelectionError(
          `recovery selection.${field} must be an enumerable data property.`,
        );
      }
      descriptors.set(field, descriptor);
    }

    const statusesDescriptor = descriptors.get("statuses");
    const limitDescriptor = descriptors.get("limit");
    if (statusesDescriptor === undefined || limitDescriptor === undefined) {
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        "recovery selection descriptors could not be normalized.",
      );
    }

    return Object.freeze({
      statuses: statusesDescriptor.value,
      limit: limitDescriptor.value,
    });
  } catch (error) {
    rethrowInspectionFailure(error, "recovery selection");
  }
}

function requireDenseStandardStatuses(
  value: unknown,
): readonly PersistenceUncertaintyStatus[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        "recovery selection statuses must be a standard array.",
      );
    }

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined
      || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || (lengthDescriptor.value as number) < 0
    ) {
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        "recovery selection statuses must have a canonical array length.",
      );
    }
    const length = lengthDescriptor.value as number;

    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (key === "length") {
        continue;
      }
      if (
        typeof key !== "string"
        || !/^(0|[1-9]\d*)$/.test(key)
        || Number(key) >= length
        || String(Number(key)) !== key
      ) {
        throw new InvalidPersistenceUncertaintyRecoverySelectionError(
          "recovery selection statuses must not contain non-index fields.",
        );
      }
    }

    if (keys.length !== length + 1) {
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        "recovery selection statuses must not contain sparse elements.",
      );
    }

    const statuses: PersistenceUncertaintyStatus[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !("value" in descriptor)
      ) {
        throw new InvalidPersistenceUncertaintyRecoverySelectionError(
          `recovery selection statuses[${index}] must be an enumerable data property.`,
        );
      }
      statuses.push(descriptor.value as PersistenceUncertaintyStatus);
    }

    return Object.freeze(statuses);
  } catch (error) {
    rethrowInspectionFailure(error, "recovery selection statuses");
  }
}

function validateSelection(
  selection: PersistenceUncertaintyRecoverySelection,
): ValidatedRecoverySelection {
  const candidate = requireExactSelectionObject(selection);
  if (!Number.isSafeInteger(candidate.limit) || (candidate.limit as number) < 1) {
    throw new InvalidPersistenceUncertaintyRecoverySelectionError(
      "recovery selection limit must be a positive safe integer.",
    );
  }

  const selectedStatuses = requireDenseStandardStatuses(candidate.statuses);
  if (selectedStatuses.length === 0) {
    throw new InvalidPersistenceUncertaintyRecoverySelectionError(
      "recovery selection must include at least one status.",
    );
  }

  const statuses = new Set<PersistenceUncertaintyStatus>();
  for (const status of selectedStatuses) {
    if (typeof status !== "string" || !selectableStatuses.has(status)) {
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        "recovery selection contains a status that is not eligible for recovery.",
      );
    }
    if (statuses.has(status)) {
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        `status ${status} must not be duplicated.`,
      );
    }
    statuses.add(status);
  }

  return Object.freeze({
    statuses,
    limit: candidate.limit as number,
  });
}

export function assertValidPersistenceUncertaintyRecoverySelection(
  selection: PersistenceUncertaintyRecoverySelection,
): void {
  validateSelection(selection);
}

/**
 * Selects a bounded recovery batch from one authoritative repository
 * enumeration. Durable order is preserved so repeated workers make the same
 * choice for the same snapshot without introducing provider-specific cursors.
 */
export function selectPersistenceUncertaintyRecoveryBatch(
  snapshots: readonly PersistenceUncertaintySnapshot[],
  selection: PersistenceUncertaintyRecoverySelection,
): readonly PersistenceUncertaintySnapshot[] {
  const validated = validateSelection(selection);
  const selected: PersistenceUncertaintySnapshot[] = [];

  try {
    for (const snapshot of snapshots) {
      if (validated.statuses.has(snapshot.record.status)) {
        selected.push(snapshot);
        if (selected.length === validated.limit) {
          break;
        }
      }
    }
  } catch {
    throw new InvalidPersistenceUncertaintyRecoverySnapshotInspectionError(
      "authoritative recovery snapshots could not be inspected safely.",
    );
  }

  return Object.freeze(selected);
}

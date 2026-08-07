import type { PersistenceUncertaintyStatus } from "@atlantis/contracts/persistence-uncertainty";

import type { PersistenceUncertaintySnapshot } from "./persistence-uncertainty-repository.js";

export class InvalidPersistenceUncertaintyRecoverySelectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistenceUncertaintyRecoverySelectionError";
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

function requireExactSelectionObject(
  selection: unknown,
): Record<"statuses" | "limit", unknown> {
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
  }

  return selection as Record<"statuses" | "limit", unknown>;
}

function requireDenseStandardStatuses(
  value: unknown,
): readonly PersistenceUncertaintyStatus[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new InvalidPersistenceUncertaintyRecoverySelectionError(
      "recovery selection statuses must be a standard array.",
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
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        "recovery selection statuses must not contain non-index fields.",
      );
    }
  }

  if (keys.length !== value.length + 1) {
    throw new InvalidPersistenceUncertaintyRecoverySelectionError(
      "recovery selection statuses must not contain sparse elements.",
    );
  }

  for (let index = 0; index < value.length; index += 1) {
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
  }

  return value as PersistenceUncertaintyStatus[];
}

function validateSelection(
  selection: PersistenceUncertaintyRecoverySelection,
): ReadonlySet<PersistenceUncertaintyStatus> {
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
  return statuses;
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
  const statuses = validateSelection(selection);
  const selected: PersistenceUncertaintySnapshot[] = [];

  for (const snapshot of snapshots) {
    if (statuses.has(snapshot.record.status)) {
      selected.push(snapshot);
      if (selected.length === selection.limit) {
        break;
      }
    }
  }

  return Object.freeze(selected);
}

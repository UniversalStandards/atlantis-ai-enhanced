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

function validateSelection(
  selection: PersistenceUncertaintyRecoverySelection,
): ReadonlySet<PersistenceUncertaintyStatus> {
  if (!Number.isSafeInteger(selection.limit) || selection.limit < 1) {
    throw new InvalidPersistenceUncertaintyRecoverySelectionError(
      "recovery selection limit must be a positive safe integer.",
    );
  }
  if (selection.statuses.length === 0) {
    throw new InvalidPersistenceUncertaintyRecoverySelectionError(
      "recovery selection must include at least one status.",
    );
  }

  const statuses = new Set<PersistenceUncertaintyStatus>();
  for (const status of selection.statuses) {
    if (!selectableStatuses.has(status)) {
      throw new InvalidPersistenceUncertaintyRecoverySelectionError(
        `status ${status} is not eligible for recovery selection.`,
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

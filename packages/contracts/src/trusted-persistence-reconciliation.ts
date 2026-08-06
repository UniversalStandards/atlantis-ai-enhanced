import {
  reconcilePersistenceUncertainty,
  type PersistenceUncertaintyRecord,
  type ReconcilePersistenceUncertaintyInput,
} from "./persistence-uncertainty.js";

export interface TrustedPersistenceClock {
  /** Returns a canonical ISO-8601 UTC timestamp from the trusted runtime boundary. */
  now(): string;
}

export type TrustedPersistenceReconciliationInput = Omit<
  ReconcilePersistenceUncertaintyInput,
  "reconciledAt"
>;

/**
 * Reconciles persistence uncertainty using exactly one timestamp sampled from
 * the trusted runtime boundary. Callers cannot supply or revise reconciledAt.
 * Canonical formatting, ordering, and proof-expiry validation remain owned by
 * reconcilePersistenceUncertainty and therefore fail closed.
 */
export function reconcilePersistenceUncertaintyWithTrustedClock(
  record: PersistenceUncertaintyRecord,
  input: TrustedPersistenceReconciliationInput,
  clock: TrustedPersistenceClock,
): PersistenceUncertaintyRecord {
  const reconciledAt = clock.now();

  return reconcilePersistenceUncertainty(record, {
    ...input,
    reconciledAt,
  });
}

import {
  normalizeExactDataRecord,
  requireExactDataFields,
} from "./exact-data-record.js";
import {
  InvalidPersistenceUncertaintyTransitionError,
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

function normalizeTrustedPersistenceReconciliationInput(
  value: unknown,
): TrustedPersistenceReconciliationInput {
  try {
    const input = normalizeExactDataRecord(
      "trusted persistence reconciliation input",
      value,
      ["attemptId", "observedAt", "providerObservationId", "evidence"],
    );
    requireExactDataFields(
      "trusted persistence reconciliation input",
      input,
      ["attemptId", "observedAt", "evidence"],
    );

    return Object.freeze({
      attemptId: input.attemptId as string,
      observedAt: input.observedAt as string,
      ...(Object.prototype.hasOwnProperty.call(input, "providerObservationId")
        ? { providerObservationId: input.providerObservationId as string }
        : {}),
      evidence: input.evidence as ReconcilePersistenceUncertaintyInput["evidence"],
    });
  } catch (error) {
    throw new InvalidPersistenceUncertaintyTransitionError(
      error instanceof Error
        ? error.message
        : "trusted persistence reconciliation input is invalid",
    );
  }
}

/**
 * Reconciles persistence uncertainty using exactly one timestamp sampled from
 * the trusted runtime boundary. The caller envelope is normalized before any
 * caller-controlled field is read or the clock is sampled, so hostile object
 * structure fails closed without executing accessors. Callers cannot supply or
 * revise reconciledAt. Canonical formatting, ordering, and proof-expiry
 * validation remain owned by reconcilePersistenceUncertainty.
 */
export function reconcilePersistenceUncertaintyWithTrustedClock(
  record: PersistenceUncertaintyRecord,
  input: TrustedPersistenceReconciliationInput,
  clock: TrustedPersistenceClock,
): PersistenceUncertaintyRecord {
  const normalizedInput = normalizeTrustedPersistenceReconciliationInput(input);
  const reconciledAt = clock.now();

  return reconcilePersistenceUncertainty(record, {
    attemptId: normalizedInput.attemptId,
    observedAt: normalizedInput.observedAt,
    ...(normalizedInput.providerObservationId === undefined
      ? {}
      : { providerObservationId: normalizedInput.providerObservationId }),
    evidence: normalizedInput.evidence,
    reconciledAt,
  });
}

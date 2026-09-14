import {
  normalizeExactDataRecord,
  requireExactDataFields,
} from "./exact-data-record.js";
import {
  consumePersistenceProof,
  restorePersistenceProofConsumptionIndex,
  type PersistenceProofConsumption,
  type PersistenceProofConsumptionIndex,
} from "./persistence-proof-consumption.js";
import {
  reconcilePersistenceUncertainty,
  type PersistenceUncertaintyRecord,
  type ReconcilePersistenceUncertaintyInput,
} from "./persistence-uncertainty.js";
import type { TrustedPersistenceClock } from "./trusted-persistence-reconciliation.js";

export interface PersistenceUncertaintyAtomicPlan {
  readonly previousRecord: PersistenceUncertaintyRecord;
  readonly nextRecord: PersistenceUncertaintyRecord;
  readonly previousProofConsumptionIndex: PersistenceProofConsumptionIndex;
  readonly nextProofConsumptionIndex: PersistenceProofConsumptionIndex;
  readonly proofConsumption?: PersistenceProofConsumption;
}

export type TrustedPersistenceUncertaintyAtomicPlanInput = Omit<
  ReconcilePersistenceUncertaintyInput,
  "reconciledAt"
>;

export class InvalidPersistenceUncertaintyAtomicPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistenceUncertaintyAtomicPlanError";
  }
}

function normalizeTrustedAtomicPlanInput(
  value: unknown,
): TrustedPersistenceUncertaintyAtomicPlanInput {
  try {
    const input = normalizeExactDataRecord(
      "trusted uncertainty atomic-plan input",
      value,
      ["attemptId", "observedAt", "providerObservationId", "evidence"],
    );
    requireExactDataFields(
      "trusted uncertainty atomic-plan input",
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
    throw new InvalidPersistenceUncertaintyAtomicPlanError(
      error instanceof Error
        ? error.message
        : "trusted uncertainty atomic-plan input is invalid",
    );
  }
}

/**
 * Produces the complete provider-neutral state change that a durable repository
 * must commit atomically. Retry-authorizing proof consumption is inseparable
 * from the uncertainty transition it authorizes; all other decisions preserve
 * the proof-consumption index unchanged.
 */
export function planPersistenceUncertaintyAtomicTransition(
  record: PersistenceUncertaintyRecord,
  proofConsumptionIndex: PersistenceProofConsumptionIndex,
  input: ReconcilePersistenceUncertaintyInput,
): PersistenceUncertaintyAtomicPlan {
  const validatedIndex = restorePersistenceProofConsumptionIndex(
    proofConsumptionIndex,
  );
  const nextRecord = reconcilePersistenceUncertainty(record, input);
  const latestAttempt = nextRecord.attempts.at(-1);

  if (latestAttempt === undefined) {
    throw new InvalidPersistenceUncertaintyAtomicPlanError(
      "reconciliation must produce an attempt",
    );
  }

  if (latestAttempt.decision.kind !== "retry_permitted") {
    return Object.freeze({
      previousRecord: record,
      nextRecord,
      previousProofConsumptionIndex: validatedIndex,
      nextProofConsumptionIndex: validatedIndex,
    });
  }

  const proof = input.evidence.nonCommitProof;
  if (proof === undefined || latestAttempt.proofId !== proof.proofId) {
    throw new InvalidPersistenceUncertaintyAtomicPlanError(
      "retry-permitted transition requires its exact non-commit proof",
    );
  }
  if (record.providerOperationId === undefined) {
    throw new InvalidPersistenceUncertaintyAtomicPlanError(
      "retry-permitted transition requires a stored provider operation",
    );
  }

  const proofConsumption = Object.freeze({
    proofId: proof.proofId,
    uncertaintyRecordId: record.recordId,
    providerOperationId: record.providerOperationId,
    consumedByAttemptId: latestAttempt.attemptId,
    consumedAt: latestAttempt.reconciledAt,
  });
  const nextProofConsumptionIndex = consumePersistenceProof(
    validatedIndex,
    proofConsumption,
  );

  return Object.freeze({
    previousRecord: record,
    nextRecord,
    previousProofConsumptionIndex: validatedIndex,
    nextProofConsumptionIndex,
    proofConsumption,
  });
}

/**
 * Production composition boundary for atomic uncertainty transitions. The
 * caller envelope is normalized before any fields are read or the trusted
 * clock is sampled. The reconciliation timestamp is then sampled exactly once
 * from the trusted runtime clock and cannot be supplied or revised by the
 * caller.
 */
export function planPersistenceUncertaintyAtomicTransitionWithTrustedClock(
  record: PersistenceUncertaintyRecord,
  proofConsumptionIndex: PersistenceProofConsumptionIndex,
  input: TrustedPersistenceUncertaintyAtomicPlanInput,
  clock: TrustedPersistenceClock,
): PersistenceUncertaintyAtomicPlan {
  const normalizedInput = normalizeTrustedAtomicPlanInput(input);
  const reconciledAt = clock.now();

  return planPersistenceUncertaintyAtomicTransition(
    record,
    proofConsumptionIndex,
    {
      attemptId: normalizedInput.attemptId,
      observedAt: normalizedInput.observedAt,
      ...(normalizedInput.providerObservationId === undefined
        ? {}
        : { providerObservationId: normalizedInput.providerObservationId }),
      evidence: normalizedInput.evidence,
      reconciledAt,
    },
  );
}

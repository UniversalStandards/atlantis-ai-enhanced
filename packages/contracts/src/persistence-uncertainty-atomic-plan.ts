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

export interface PersistenceUncertaintyAtomicPlan {
  readonly previousRecord: PersistenceUncertaintyRecord;
  readonly nextRecord: PersistenceUncertaintyRecord;
  readonly previousProofConsumptionIndex: PersistenceProofConsumptionIndex;
  readonly nextProofConsumptionIndex: PersistenceProofConsumptionIndex;
  readonly proofConsumption?: PersistenceProofConsumption;
}

export class InvalidPersistenceUncertaintyAtomicPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPersistenceUncertaintyAtomicPlanError";
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

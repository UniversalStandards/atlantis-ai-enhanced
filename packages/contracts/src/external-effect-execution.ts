import type { EventSink, ExecutionEvent } from "./index.js";
import {
  reconcileExternalEffect,
  type ExternalEffectIdentity,
  type ExternalEffectReceipt,
} from "./external-effect.js";
import {
  InvalidExternalEffectOwnershipError,
  type ExternalEffectClaim,
  type ExternalEffectOwnershipRequest,
  type ExternalEffectOwnershipStore,
} from "./external-effect-ownership.js";
import { StructurallyValidatedExternalEffectOwnershipStore } from "./validated-external-effect-ownership-store.js";

export interface ExternalEffectReceiptStore {
  load(
    identity: ExternalEffectIdentity,
  ): ExternalEffectReceipt | undefined | Promise<ExternalEffectReceipt | undefined>;
  save(receipt: ExternalEffectReceipt): void | Promise<void>;
}

export interface ExternalEffectProvider {
  reconcile(
    identity: ExternalEffectIdentity,
  ): ExternalEffectReceipt | undefined | Promise<ExternalEffectReceipt | undefined>;
  execute(
    identity: ExternalEffectIdentity,
  ): ExternalEffectReceipt | Promise<ExternalEffectReceipt>;
}

export type ExternalEffectRecoverySource = "durable_store" | "provider";

export type ExternalEffectExecutionResult =
  | Readonly<{
      status: "executed";
      receipt: ExternalEffectReceipt;
    }>
  | Readonly<{
      status: "reconciled";
      source: ExternalEffectRecoverySource;
      receipt: ExternalEffectReceipt;
    }>
  | Readonly<{
      status: "owned";
      identity: ExternalEffectIdentity;
      ownerId: string;
      acquiredAt: string;
      expiresAt: string;
      generation: number;
    }>;

export interface ExternalEffectExecutionHooks {
  readonly onExecuted?: (
    receipt: ExternalEffectReceipt,
  ) => void | Promise<void>;
  readonly onReconciled?: (
    source: ExternalEffectRecoverySource,
    receipt: ExternalEffectReceipt,
  ) => void | Promise<void>;
}

export interface ExternalEffectExecutionOptions {
  readonly store: ExternalEffectReceiptStore;
  readonly provider: ExternalEffectProvider;
  readonly ownershipStore: ExternalEffectOwnershipStore;
  readonly ownershipRequest: ExternalEffectOwnershipRequest;
  readonly hooks?: ExternalEffectExecutionHooks;
}

export interface ExternalEffectEvidenceContext {
  readonly eventSink: EventSink;
  readonly executionId: string;
  readonly actor: string;
  readonly initialSequence: number;
  readonly createEventId: () => string;
  readonly now: () => string;
  readonly parentEventId?: string;
}

export interface ExternalEffectExecutedPayload {
  readonly receipt: ExternalEffectReceipt;
}

export interface ExternalEffectReconciledPayload {
  readonly source: ExternalEffectRecoverySource;
  readonly receipt: ExternalEffectReceipt;
}

function requireCommittedReceipt(
  identity: ExternalEffectIdentity,
  receipt: ExternalEffectReceipt,
): ExternalEffectReceipt {
  const reconciliation = reconcileExternalEffect(identity, receipt);
  if (reconciliation.status !== "committed") {
    throw new Error("External effect receipt unexpectedly failed reconciliation");
  }
  return reconciliation.receipt;
}

function requireNonBlank(field: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${field} must be a non-blank string`);
  }
  return normalized;
}

function requireCanonicalTimestamp(field: string, value: string): string {
  const timestamp = requireNonBlank(field, value);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function validateEvidenceContext(context: ExternalEffectEvidenceContext): void {
  requireNonBlank("executionId", context.executionId);
  requireNonBlank("actor", context.actor);
  if (!Number.isSafeInteger(context.initialSequence) || context.initialSequence < 0) {
    throw new Error("initialSequence must be a non-negative safe integer");
  }
  if (context.parentEventId !== undefined) {
    requireNonBlank("parentEventId", context.parentEventId);
  }
  if (context.initialSequence === 0 && context.parentEventId !== undefined) {
    throw new Error("An empty evidence stream cannot have a parent event");
  }
  if (context.initialSequence > 0 && context.parentEventId === undefined) {
    throw new Error("A non-empty evidence stream must identify its tail event");
  }
}

function createEvidenceEvent<T>(
  context: ExternalEffectEvidenceContext,
  receipt: ExternalEffectReceipt,
  sequence: number,
  parentEventId: string | undefined,
  type: "external.effect.executed" | "external.effect.reconciled",
  payload: T,
): ExecutionEvent<T> {
  if (receipt.executionId !== context.executionId) {
    throw new Error("External effect receipt executionId does not match evidence context");
  }

  return Object.freeze({
    id: requireNonBlank("event id", context.createEventId()),
    executionId: context.executionId,
    sequence,
    type,
    occurredAt: requireCanonicalTimestamp("occurredAt", context.now()),
    actor: requireNonBlank("actor", context.actor),
    ...(parentEventId === undefined ? {} : { parentEventId }),
    payload,
  });
}

export function createExternalEffectEvidenceHooks(
  context: ExternalEffectEvidenceContext,
): ExternalEffectExecutionHooks {
  validateEvidenceContext(context);
  let sequence = context.initialSequence;
  let parentEventId = context.parentEventId;

  const appendEvidence = async <T>(
    receipt: ExternalEffectReceipt,
    type: "external.effect.executed" | "external.effect.reconciled",
    payload: T,
  ): Promise<void> => {
    if (sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error("External effect evidence sequence is exhausted");
    }
    const event = createEvidenceEvent(
      context,
      receipt,
      sequence + 1,
      parentEventId,
      type,
      payload,
    );
    await context.eventSink.append(event);
    sequence = event.sequence;
    parentEventId = event.id;
  };

  return Object.freeze({
    async onExecuted(receipt: ExternalEffectReceipt) {
      await appendEvidence(
        receipt,
        "external.effect.executed",
        Object.freeze({ receipt }),
      );
    },
    async onReconciled(
      source: ExternalEffectRecoverySource,
      receipt: ExternalEffectReceipt,
    ) {
      await appendEvidence(
        receipt,
        "external.effect.reconciled",
        Object.freeze({ source, receipt }),
      );
    },
  });
}

async function releasePreExecutionFailure(
  store: ExternalEffectOwnershipStore,
  claim: ExternalEffectClaim,
): Promise<void> {
  await store.release(claim, "pre_execution_failure");
}

export async function executeExternalEffectWithReconciliation(
  rawIdentity: ExternalEffectIdentity,
  options: ExternalEffectExecutionOptions,
): Promise<ExternalEffectExecutionResult> {
  const identity = reconcileExternalEffect(rawIdentity).identity;
  const ownershipStore =
    options.ownershipStore instanceof StructurallyValidatedExternalEffectOwnershipStore
      ? options.ownershipStore
      : new StructurallyValidatedExternalEffectOwnershipStore(options.ownershipStore);

  const stored = await options.store.load(identity);
  if (stored !== undefined) {
    const receipt = requireCommittedReceipt(identity, stored);
    await options.hooks?.onReconciled?.("durable_store", receipt);
    return Object.freeze({
      status: "reconciled",
      source: "durable_store",
      receipt,
    });
  }

  const ownership = await ownershipStore.acquire(
    identity,
    options.ownershipRequest,
  );
  if (ownership.status === "rejected") {
    throw new InvalidExternalEffectOwnershipError(ownership.message);
  }
  if (ownership.status === "owned") {
    return Object.freeze({
      status: "owned",
      identity: ownership.identity,
      ownerId: ownership.ownerId,
      acquiredAt: ownership.acquiredAt,
      expiresAt: ownership.expiresAt,
      generation: ownership.generation,
    });
  }
  if (ownership.status === "committed") {
    const receipt = requireCommittedReceipt(identity, ownership.receipt);
    await options.store.save(receipt);
    await options.hooks?.onReconciled?.("durable_store", receipt);
    return Object.freeze({
      status: "reconciled",
      source: "durable_store",
      receipt,
    });
  }

  const claim = ownership.claim;
  let providerReceipt: ExternalEffectReceipt | undefined;
  try {
    providerReceipt = await options.provider.reconcile(identity);
    if (providerReceipt !== undefined) {
      providerReceipt = requireCommittedReceipt(identity, providerReceipt);
    }
  } catch (error) {
    await releasePreExecutionFailure(ownershipStore, claim);
    throw error;
  }

  if (providerReceipt !== undefined) {
    const receipt = await ownershipStore.commit(claim, providerReceipt);
    await options.store.save(receipt);
    await options.hooks?.onReconciled?.("provider", receipt);
    return Object.freeze({
      status: "reconciled",
      source: "provider",
      receipt,
    });
  }

  const receipt = requireCommittedReceipt(
    identity,
    await options.provider.execute(identity),
  );
  const committed = await ownershipStore.commit(claim, receipt);
  await options.store.save(committed);
  await options.hooks?.onExecuted?.(committed);
  return Object.freeze({ status: "executed", receipt: committed });
}

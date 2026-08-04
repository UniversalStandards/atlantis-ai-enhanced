import type { EventSink, ExecutionEvent } from "./index.js";
import {
  reconcileExternalEffect,
  type ExternalEffectIdentity,
  type ExternalEffectReceipt,
} from "./external-effect.js";

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
  readonly hooks?: ExternalEffectExecutionHooks;
}

export interface ExternalEffectEvidenceContext {
  readonly eventSink: EventSink;
  readonly actor: string;
  readonly nextSequence: () => number;
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

function createEvidenceEvent<T>(
  context: ExternalEffectEvidenceContext,
  receipt: ExternalEffectReceipt,
  type: "external.effect.executed" | "external.effect.reconciled",
  payload: T,
): ExecutionEvent<T> {
  return Object.freeze({
    id: context.createEventId(),
    executionId: receipt.executionId,
    sequence: context.nextSequence(),
    type,
    occurredAt: context.now(),
    actor: context.actor,
    ...(context.parentEventId === undefined
      ? {}
      : { parentEventId: context.parentEventId }),
    payload,
  });
}

export function createExternalEffectEvidenceHooks(
  context: ExternalEffectEvidenceContext,
): ExternalEffectExecutionHooks {
  return Object.freeze({
    async onExecuted(receipt: ExternalEffectReceipt) {
      await context.eventSink.append(
        createEvidenceEvent<ExternalEffectExecutedPayload>(
          context,
          receipt,
          "external.effect.executed",
          Object.freeze({ receipt }),
        ),
      );
    },
    async onReconciled(
      source: ExternalEffectRecoverySource,
      receipt: ExternalEffectReceipt,
    ) {
      await context.eventSink.append(
        createEvidenceEvent<ExternalEffectReconciledPayload>(
          context,
          receipt,
          "external.effect.reconciled",
          Object.freeze({ source, receipt }),
        ),
      );
    },
  });
}

export async function executeExternalEffectWithReconciliation(
  rawIdentity: ExternalEffectIdentity,
  options: ExternalEffectExecutionOptions,
): Promise<ExternalEffectExecutionResult> {
  const identity = reconcileExternalEffect(rawIdentity).identity;

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

  const providerReceipt = await options.provider.reconcile(identity);
  if (providerReceipt !== undefined) {
    const receipt = requireCommittedReceipt(identity, providerReceipt);
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
  await options.store.save(receipt);
  await options.hooks?.onExecuted?.(receipt);
  return Object.freeze({ status: "executed", receipt });
}

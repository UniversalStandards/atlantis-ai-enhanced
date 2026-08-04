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

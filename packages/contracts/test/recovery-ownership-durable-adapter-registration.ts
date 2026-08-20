import type { RecoveryOwnershipStore } from "../src/recovery-ownership-store.js";
import {
  durableRecoveryOwnershipStoreConformance,
  type DurableRecoveryOwnershipConformanceHarness,
} from "./recovery-ownership-durable-conformance.js";
import {
  recoveryOwnershipFairnessConformance,
  type RecoveryOwnershipFairnessHarness,
} from "./recovery-ownership-fairness-conformance.js";
import {
  recoveryOwnershipRetentionConformance,
  type RecoveryOwnershipRetentionConformanceHarness,
} from "./recovery-ownership-retention-conformance.js";
import {
  recoveryOwnershipStoreConformance,
  type RecoveryOwnershipConformanceHarness,
} from "./recovery-ownership-store-conformance.js";

/**
 * Architecture-neutral registration surface for the first durable recovery
 * ownership adapter. A production adapter supplies factories backed by its own
 * persistence mechanism; this module selects no provider, topology, credential,
 * or deployment authority.
 *
 * Baseline, durable, and fairness conformance are mandatory. Retention/
 * compaction conformance is mandatory when the adapter exposes a maintenance
 * operation capable of deleting, compacting, or rewriting ownership history.
 */
export interface DurableRecoveryOwnershipAdapterRegistration {
  readonly createBaselineHarness: () => RecoveryOwnershipConformanceHarness;
  readonly createDurableHarness: () => DurableRecoveryOwnershipConformanceHarness;
  readonly createFairnessHarness: () => RecoveryOwnershipFairnessHarness;
  readonly createRetentionHarness?: () => RecoveryOwnershipRetentionConformanceHarness;
}

export function registerDurableRecoveryOwnershipAdapterConformance(
  registration: DurableRecoveryOwnershipAdapterRegistration,
): void {
  recoveryOwnershipStoreConformance(registration.createBaselineHarness);
  durableRecoveryOwnershipStoreConformance(registration.createDurableHarness);
  recoveryOwnershipFairnessConformance(registration.createFairnessHarness);

  if (registration.createRetentionHarness !== undefined) {
    recoveryOwnershipRetentionConformance(registration.createRetentionHarness);
  }
}

/**
 * Compile-time helper for adapter packages that need to expose their store
 * without coupling this shared test registration surface to a concrete engine.
 */
export type DurableRecoveryOwnershipAdapterFactory =
  () => RecoveryOwnershipStore | Promise<RecoveryOwnershipStore>;
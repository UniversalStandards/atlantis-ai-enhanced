import type { RecoveryOwnershipStore } from "../src/recovery-ownership-store.js";
import {
  durableRecoveryOwnershipStoreConformance,
  type DurableRecoveryOwnershipConformanceHarness,
} from "./recovery-ownership-durable-conformance.js";
import {
  recoveryOwnershipRetentionConformance,
  type RecoveryOwnershipRetentionConformanceHarness,
} from "./recovery-ownership-retention-conformance.js";

/**
 * Architecture-neutral registration surface for the first durable recovery
 * ownership adapter. A production adapter supplies factories backed by its own
 * persistence mechanism; this module selects no provider, topology, credential,
 * or deployment authority.
 *
 * The durable harness is mandatory. Retention/compaction conformance is
 * mandatory when the adapter exposes a maintenance operation capable of
 * deleting, compacting, or rewriting ownership history.
 */
export interface DurableRecoveryOwnershipAdapterRegistration {
  readonly createDurableHarness: () => DurableRecoveryOwnershipConformanceHarness;
  readonly createRetentionHarness?: () => RecoveryOwnershipRetentionConformanceHarness;
}

export function registerDurableRecoveryOwnershipAdapterConformance(
  registration: DurableRecoveryOwnershipAdapterRegistration,
): void {
  durableRecoveryOwnershipStoreConformance(registration.createDurableHarness);

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

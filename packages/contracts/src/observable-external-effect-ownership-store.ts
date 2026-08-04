import type {
  ExternalEffectClaim,
  ExternalEffectOwnershipObservation,
  ExternalEffectOwnershipRequest,
  ExternalEffectOwnershipResult,
  ExternalEffectOwnershipStore,
  ExternalEffectReleaseReason,
  ExternalEffectRenewalRequest,
} from "./external-effect-ownership.js";
import type {
  ExternalEffectIdentity,
  ExternalEffectReceipt,
} from "./external-effect.js";

export type ExternalEffectOwnershipLifecycleEvent =
  | Readonly<{
      type: "ownership.acquired";
      result: Extract<ExternalEffectOwnershipResult, { status: "acquired" }>;
    }>
  | Readonly<{
      type: "ownership.contended";
      result: Extract<ExternalEffectOwnershipResult, { status: "owned" }>;
    }>
  | Readonly<{
      type: "ownership.committed_observed";
      result: Extract<ExternalEffectOwnershipResult, { status: "committed" }>;
    }>
  | Readonly<{
      type: "ownership.rejected";
      result: Extract<ExternalEffectOwnershipResult, { status: "rejected" }>;
    }>
  | Readonly<{
      type: "ownership.renewed";
      previousClaim: ExternalEffectClaim;
      claim: ExternalEffectClaim;
    }>
  | Readonly<{
      type: "ownership.receipt_committed";
      claim: ExternalEffectClaim;
      receipt: ExternalEffectReceipt;
    }>
  | Readonly<{
      type: "ownership.released";
      claim: ExternalEffectClaim;
      reason: ExternalEffectReleaseReason;
    }>
  | Readonly<{
      type: "ownership.observed";
      observation: ExternalEffectOwnershipObservation;
    }>;

export interface ExternalEffectOwnershipLifecycleObserver {
  onLifecycleEvent(
    event: ExternalEffectOwnershipLifecycleEvent,
  ): void | Promise<void>;
  onLifecycleObservationError?(
    error: unknown,
    event: ExternalEffectOwnershipLifecycleEvent,
  ): void | Promise<void>;
}

/**
 * Decorates an ownership store with lifecycle observation without changing
 * ownership authority or operation outcomes. Observer failures are reported
 * through onLifecycleObservationError and never grant, revoke, renew, release,
 * or commit ownership.
 */
export class ObservableExternalEffectOwnershipStore
  implements ExternalEffectOwnershipStore
{
  readonly #store: ExternalEffectOwnershipStore;
  readonly #observer: ExternalEffectOwnershipLifecycleObserver;

  public constructor(
    store: ExternalEffectOwnershipStore,
    observer: ExternalEffectOwnershipLifecycleObserver,
  ) {
    this.#store = store;
    this.#observer = observer;
  }

  async #emit(event: ExternalEffectOwnershipLifecycleEvent): Promise<void> {
    try {
      await this.#observer.onLifecycleEvent(event);
    } catch (error) {
      try {
        await this.#observer.onLifecycleObservationError?.(error, event);
      } catch {
        // Observation must never mutate or obscure authoritative ownership state.
      }
    }
  }

  public async acquire(
    identity: ExternalEffectIdentity,
    request: ExternalEffectOwnershipRequest,
  ): Promise<ExternalEffectOwnershipResult> {
    const result = await this.#store.acquire(identity, request);
    switch (result.status) {
      case "acquired":
        await this.#emit(Object.freeze({ type: "ownership.acquired", result }));
        break;
      case "owned":
        await this.#emit(Object.freeze({ type: "ownership.contended", result }));
        break;
      case "committed":
        await this.#emit(
          Object.freeze({ type: "ownership.committed_observed", result }),
        );
        break;
      case "rejected":
        await this.#emit(Object.freeze({ type: "ownership.rejected", result }));
        break;
    }
    return result;
  }

  public async renew(
    claim: ExternalEffectClaim,
    request: ExternalEffectRenewalRequest,
  ): Promise<ExternalEffectClaim> {
    const renewed = await this.#store.renew(claim, request);
    await this.#emit(
      Object.freeze({
        type: "ownership.renewed",
        previousClaim: claim,
        claim: renewed,
      }),
    );
    return renewed;
  }

  public async commit(
    claim: ExternalEffectClaim,
    receipt: ExternalEffectReceipt,
  ): Promise<ExternalEffectReceipt> {
    const committed = await this.#store.commit(claim, receipt);
    await this.#emit(
      Object.freeze({
        type: "ownership.receipt_committed",
        claim,
        receipt: committed,
      }),
    );
    return committed;
  }

  public async release(
    claim: ExternalEffectClaim,
    reason: ExternalEffectReleaseReason,
  ): Promise<void> {
    await this.#store.release(claim, reason);
    await this.#emit(Object.freeze({ type: "ownership.released", claim, reason }));
  }

  public async observe(
    identity: ExternalEffectIdentity,
  ): Promise<ExternalEffectOwnershipObservation> {
    const observation = await this.#store.observe(identity);
    await this.#emit(
      Object.freeze({ type: "ownership.observed", observation }),
    );
    return observation;
  }
}

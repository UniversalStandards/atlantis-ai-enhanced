import {
  normalizeExternalEffectClaim,
  normalizeExternalEffectOwnershipRequest,
  normalizeExternalEffectRenewalRequest,
} from "./external-effect-ownership-validation.js";
import {
  type ExternalEffectClaim,
  type ExternalEffectOwnershipObservation,
  type ExternalEffectOwnershipRequest,
  type ExternalEffectOwnershipResult,
  type ExternalEffectOwnershipStore,
  type ExternalEffectReleaseReason,
  type ExternalEffectRenewalRequest,
} from "./external-effect-ownership.js";
import {
  normalizeExternalEffectIdentity,
  type ExternalEffectIdentity,
  type ExternalEffectReceipt,
} from "./external-effect.js";

/**
 * Descriptor-safe boundary for ownership-store implementations.
 *
 * The wrapper validates every caller-controlled ownership record before the
 * underlying store can access it. This prevents accessor execution and rejects
 * inherited, hidden, symbol-keyed, or unexpected authorization fields at the
 * store boundary without coupling the contract to a persistence provider.
 */
export class StructurallyValidatedExternalEffectOwnershipStore
  implements ExternalEffectOwnershipStore
{
  readonly #store: ExternalEffectOwnershipStore;

  public constructor(store: ExternalEffectOwnershipStore) {
    this.#store = store;
  }

  public acquire(
    identity: ExternalEffectIdentity,
    request: ExternalEffectOwnershipRequest,
  ): ExternalEffectOwnershipResult | Promise<ExternalEffectOwnershipResult> {
    return this.#store.acquire(
      normalizeExternalEffectIdentity(identity),
      normalizeExternalEffectOwnershipRequest(request),
    );
  }

  public renew(
    claim: ExternalEffectClaim,
    request: ExternalEffectRenewalRequest,
  ): ExternalEffectClaim | Promise<ExternalEffectClaim> {
    return this.#store.renew(
      normalizeExternalEffectClaim(claim),
      normalizeExternalEffectRenewalRequest(request),
    );
  }

  public commit(
    claim: ExternalEffectClaim,
    receipt: ExternalEffectReceipt,
  ): ExternalEffectReceipt | Promise<ExternalEffectReceipt> {
    return this.#store.commit(normalizeExternalEffectClaim(claim), receipt);
  }

  public release(
    claim: ExternalEffectClaim,
    reason: ExternalEffectReleaseReason,
  ): void | Promise<void> {
    return this.#store.release(normalizeExternalEffectClaim(claim), reason);
  }

  public observe(
    identity: ExternalEffectIdentity,
  ): ExternalEffectOwnershipObservation | Promise<ExternalEffectOwnershipObservation> {
    return this.#store.observe(normalizeExternalEffectIdentity(identity));
  }
}

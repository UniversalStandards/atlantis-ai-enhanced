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

export interface ObservableExternalEffectOwnershipStoreOptions {
  /**
   * Maximum time an observer callback may delay an authoritative operation.
   * The callback is not cancelled after the deadline; its late settlement is
   * isolated from the ownership result.
   */
  observationTimeoutMs?: number;
}

export class ExternalEffectOwnershipObservationTimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly eventType: ExternalEffectOwnershipLifecycleEvent["type"];

  public constructor(
    timeoutMs: number,
    eventType: ExternalEffectOwnershipLifecycleEvent["type"],
  ) {
    super(
      `external-effect ownership observer exceeded ${timeoutMs} ms for ${eventType}`,
    );
    this.name = "ExternalEffectOwnershipObservationTimeoutError";
    this.timeoutMs = timeoutMs;
    this.eventType = eventType;
  }
}

const DEFAULT_OBSERVATION_TIMEOUT_MS = 1_000;

function normalizeObservationTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_OBSERVATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("observationTimeoutMs must be a positive safe integer");
  }
  return timeoutMs;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreeze(descriptor.value);
    }
  }

  return Object.freeze(value);
}

function snapshotLifecycleEvent(
  event: ExternalEffectOwnershipLifecycleEvent,
): ExternalEffectOwnershipLifecycleEvent {
  return deepFreeze(structuredClone(event));
}

/**
 * Decorates an ownership store with lifecycle observation without changing
 * ownership authority or operation outcomes. Observers receive a deeply frozen
 * structured snapshot, so they cannot mutate authoritative operation inputs or
 * outputs. Observer failures and stalls are bounded, reported through
 * onLifecycleObservationError, and never grant, revoke, renew, release, or
 * commit ownership.
 */
export class ObservableExternalEffectOwnershipStore
  implements ExternalEffectOwnershipStore
{
  readonly #store: ExternalEffectOwnershipStore;
  readonly #observer: ExternalEffectOwnershipLifecycleObserver;
  readonly #observationTimeoutMs: number;

  public constructor(
    store: ExternalEffectOwnershipStore,
    observer: ExternalEffectOwnershipLifecycleObserver,
    options: ObservableExternalEffectOwnershipStoreOptions = {},
  ) {
    this.#store = store;
    this.#observer = observer;
    this.#observationTimeoutMs = normalizeObservationTimeoutMs(
      options.observationTimeoutMs,
    );
  }

  async #withinObservationDeadline(
    callback: () => void | Promise<void>,
    eventType: ExternalEffectOwnershipLifecycleEvent["type"],
  ): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const callbackSettlement = Promise.resolve()
      .then(callback)
      .then(
        () => undefined,
        (error: unknown) => Promise.reject(error),
      );
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new ExternalEffectOwnershipObservationTimeoutError(
            this.#observationTimeoutMs,
            eventType,
          ),
        );
      }, this.#observationTimeoutMs);
    });

    try {
      await Promise.race([callbackSettlement, timeout]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async #emit(event: ExternalEffectOwnershipLifecycleEvent): Promise<void> {
    const snapshot = snapshotLifecycleEvent(event);
    try {
      await this.#withinObservationDeadline(
        () => this.#observer.onLifecycleEvent(snapshot),
        snapshot.type,
      );
    } catch (error) {
      try {
        const errorSnapshot = snapshotLifecycleEvent(event);
        await this.#withinObservationDeadline(
          () =>
            this.#observer.onLifecycleObservationError?.(error, errorSnapshot),
          errorSnapshot.type,
        );
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

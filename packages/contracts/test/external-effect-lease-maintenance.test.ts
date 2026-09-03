import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExternalEffectOwnershipLostError,
  executeExternalEffectWithReconciliation,
  type ExternalEffectExecutionOptions,
  type ExternalEffectProvider,
  type ExternalEffectReceiptStore,
} from "../src/external-effect-execution.js";
import {
  ExternalEffectOwnershipConflictError,
  InMemoryExternalEffectOwnershipStore,
  type ExternalEffectClaim,
  type ExternalEffectOwnershipStore,
} from "../src/external-effect-ownership.js";
import type {
  ExternalEffectIdentity,
  ExternalEffectReceipt,
} from "../src/external-effect.js";

const baseEpochMs = Date.parse("2026-08-04T05:00:00.000Z");
const identity: ExternalEffectIdentity = {
  idempotencyKey: "execution-1:publish-change",
  executionId: "execution-1",
  stepId: "publish-change",
  effectType: "github.commit.create",
};
const receipt: ExternalEffectReceipt = {
  ...identity,
  providerReference: "commit:abc123",
  committedAt: "2026-08-04T05:00:35.000Z",
  payloadDigest: `sha256:${"a".repeat(64)}`,
  metadata: { repository: "UniversalStandards/atlantis-ai-enhanced" },
};
const ownershipRequest = {
  ownerId: "external-effect-worker",
  leaseDurationMs: 30_000,
} as const;
const leaseMaintenance = { renewalIntervalMs: 10_000 } as const;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createReceiptStore(): ExternalEffectReceiptStore & {
  current: ExternalEffectReceipt | undefined;
} {
  return {
    current: undefined,
    load() {
      return this.current;
    },
    save(value) {
      this.current = value;
    },
  };
}

function createTimedOwnershipStore() {
  let nowEpochMs = baseEpochMs;
  let tokenNumber = 0;
  const ownershipStore = new InMemoryExternalEffectOwnershipStore({
    now: () => new Date(nowEpochMs).toISOString(),
    createClaimToken: () => {
      tokenNumber += 1;
      return `claim-${String(tokenNumber)}`;
    },
    maxLeaseDurationMs: 60_000,
  });
  return {
    ownershipStore,
    setElapsed(elapsedMs: number) {
      nowEpochMs = baseEpochMs + elapsedMs;
    },
  };
}

function executionOptions(
  store: ExternalEffectReceiptStore,
  provider: ExternalEffectProvider,
  ownershipStore: ExternalEffectOwnershipStore,
  overrides: Partial<ExternalEffectExecutionOptions> = {},
): ExternalEffectExecutionOptions {
  return {
    store,
    provider,
    ownershipStore,
    ownershipRequest,
    leaseMaintenance,
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("external effect lease maintenance", () => {
  it("keeps an executing owner fenced beyond the original lease boundary", async () => {
    vi.useFakeTimers();
    const store = createReceiptStore();
    const timed = createTimedOwnershipStore();
    const renewal = vi.spyOn(timed.ownershipStore, "renew");
    const execution = deferred<ExternalEffectReceipt>();
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn(() => execution.promise),
    };
    const options = executionOptions(store, provider, timed.ownershipStore);

    const owner = executeExternalEffectWithReconciliation(identity, options);
    await flushMicrotasks();
    expect(provider.execute).toHaveBeenCalledOnce();

    timed.setElapsed(20_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(renewal).toHaveBeenCalledTimes(2);

    timed.setElapsed(35_000);
    const contender = await executeExternalEffectWithReconciliation(
      identity,
      options,
    );
    expect(contender).toMatchObject({
      status: "owned",
      ownerId: ownershipRequest.ownerId,
      generation: 1,
    });
    expect(provider.execute).toHaveBeenCalledOnce();

    execution.resolve(receipt);
    await expect(owner).resolves.toEqual({ status: "executed", receipt });
    expect(store.current).toEqual(receipt);
  });

  it("keeps a reconciling owner fenced beyond the original lease boundary", async () => {
    vi.useFakeTimers();
    const store = createReceiptStore();
    const timed = createTimedOwnershipStore();
    const reconciliation = deferred<ExternalEffectReceipt | undefined>();
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn(() => reconciliation.promise),
      execute: vi.fn(),
    };
    const options = executionOptions(store, provider, timed.ownershipStore);

    const owner = executeExternalEffectWithReconciliation(identity, options);
    await flushMicrotasks();
    expect(provider.reconcile).toHaveBeenCalledOnce();

    timed.setElapsed(20_000);
    await vi.advanceTimersByTimeAsync(10_000);
    timed.setElapsed(35_000);

    const contender = await executeExternalEffectWithReconciliation(
      identity,
      options,
    );
    expect(contender).toMatchObject({
      status: "owned",
      generation: 1,
    });
    expect(provider.execute).not.toHaveBeenCalled();

    reconciliation.resolve(receipt);
    await expect(owner).resolves.toEqual({
      status: "reconciled",
      source: "provider",
      receipt,
    });
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("fails closed without releasing after ownership is lost during execution", async () => {
    vi.useFakeTimers();
    const store = createReceiptStore();
    const timed = createTimedOwnershipStore();
    let renewalAttempts = 0;
    const release = vi.fn(
      (
        claim: ExternalEffectClaim,
        reason: Parameters<ExternalEffectOwnershipStore["release"]>[1],
      ) => timed.ownershipStore.release(claim, reason),
    );
    const ownershipStore: ExternalEffectOwnershipStore = {
      acquire: (effectIdentity, request) =>
        timed.ownershipStore.acquire(effectIdentity, request),
      renew: (claim, request) => {
        renewalAttempts += 1;
        if (renewalAttempts === 2) {
          throw new ExternalEffectOwnershipConflictError(
            "simulated ownership loss",
          );
        }
        return timed.ownershipStore.renew(claim, request);
      },
      commit: (claim, committedReceipt) =>
        timed.ownershipStore.commit(claim, committedReceipt),
      release,
      observe: (effectIdentity) =>
        timed.ownershipStore.observe(effectIdentity),
    };
    const execution = deferred<ExternalEffectReceipt>();
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn(() => execution.promise),
    };
    const options = executionOptions(store, provider, ownershipStore);

    const owner = executeExternalEffectWithReconciliation(identity, options);
    const ownerOutcome = owner.then(
      (value) => value,
      (error: unknown) => error,
    );
    await flushMicrotasks();
    expect(provider.execute).toHaveBeenCalledOnce();

    timed.setElapsed(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await ownerOutcome;

    expect(error).toBeInstanceOf(ExternalEffectOwnershipLostError);
    expect(error).toMatchObject({
      stage: "provider_execution",
      ownerId: ownershipRequest.ownerId,
      generation: 1,
    });
    expect(release).not.toHaveBeenCalled();
    expect(await timed.ownershipStore.observe(identity)).toMatchObject({
      status: "owned",
      generation: 1,
    });

    const contender = await executeExternalEffectWithReconciliation(
      identity,
      options,
    );
    expect(contender).toMatchObject({ status: "owned", generation: 1 });
    expect(provider.execute).toHaveBeenCalledOnce();

    execution.resolve(receipt);
    await flushMicrotasks();
    expect(store.current).toBeUndefined();
  });

  it("rejects a renewal interval that cannot precede lease expiry", async () => {
    const store = createReceiptStore();
    const timed = createTimedOwnershipStore();
    const acquire = vi.spyOn(timed.ownershipStore, "acquire");
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn(),
      execute: vi.fn(),
    };

    await expect(
      executeExternalEffectWithReconciliation(
        identity,
        executionOptions(store, provider, timed.ownershipStore, {
          leaseMaintenance: { renewalIntervalMs: 30_000 },
        }),
      ),
    ).rejects.toThrow(
      "renewalIntervalMs must be a positive safe integer smaller than the ownership lease duration",
    );
    expect(acquire).not.toHaveBeenCalled();
    expect(provider.reconcile).not.toHaveBeenCalled();
  });
});

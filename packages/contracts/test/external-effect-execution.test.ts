import { describe, expect, it, vi } from "vitest";

import {
  createExternalEffectEvidenceHooks,
  executeExternalEffectWithReconciliation,
  type ExternalEffectExecutionOptions,
  type ExternalEffectProvider,
  type ExternalEffectReceiptStore,
} from "../src/external-effect-execution.js";
import {
  InMemoryExternalEffectOwnershipStore,
  type ExternalEffectOwnershipStore,
} from "../src/external-effect-ownership.js";
import type {
  ExternalEffectIdentity,
  ExternalEffectReceipt,
} from "../src/external-effect.js";
import type { ExecutionEvent } from "../src/index.js";

const identity: ExternalEffectIdentity = {
  idempotencyKey: "execution-1:publish-change",
  executionId: "execution-1",
  stepId: "publish-change",
  effectType: "github.commit.create",
};

const receipt: ExternalEffectReceipt = {
  ...identity,
  providerReference: "commit:abc123",
  committedAt: "2026-08-04T03:45:00.000Z",
  payloadDigest: `sha256:${"a".repeat(64)}`,
  metadata: { repository: "UniversalStandards/atlantis-ai-enhanced" },
};

const ownershipRequest = {
  ownerId: "external-effect-worker",
  leaseDurationMs: 30_000,
} as const;

function createStore(): ExternalEffectReceiptStore & {
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

function createOwnershipStore(): ExternalEffectOwnershipStore {
  let tokenNumber = 0;
  return new InMemoryExternalEffectOwnershipStore({
    now: () => "2026-08-04T05:00:00.000Z",
    createClaimToken: () => {
      tokenNumber += 1;
      return `claim-${String(tokenNumber)}`;
    },
    maxLeaseDurationMs: 60_000,
  });
}

function executionOptions(
  store: ExternalEffectReceiptStore,
  provider: ExternalEffectProvider,
  overrides: Partial<ExternalEffectExecutionOptions> = {},
): ExternalEffectExecutionOptions {
  return {
    store,
    provider,
    ownershipStore: createOwnershipStore(),
    ownershipRequest,
    ...overrides,
  };
}

function createEvidenceHarness(
  append?: (event: ExecutionEvent) => void | Promise<void>,
) {
  const events: ExecutionEvent[] = [];
  let eventNumber = 0;
  const hooks = createExternalEffectEvidenceHooks({
    eventSink: {
      async append(event) {
        await append?.(event as ExecutionEvent);
        events.push(event as ExecutionEvent);
      },
    },
    executionId: "execution-1",
    actor: "external-effect-worker",
    initialSequence: 40,
    createEventId: () => {
      eventNumber += 1;
      return `event-${String(eventNumber)}`;
    },
    now: () => "2026-08-04T05:00:00.000Z",
    parentEventId: "step-event-1",
  });
  return { events, hooks };
}

describe("external effect execution reconciliation", () => {
  it("returns a durable receipt without acquiring ownership or consulting the provider", async () => {
    const store = createStore();
    store.current = receipt;
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn(),
      execute: vi.fn(),
    };
    const ownershipStore = createOwnershipStore();
    const acquire = vi.spyOn(ownershipStore, "acquire");

    const result = await executeExternalEffectWithReconciliation(
      identity,
      executionOptions(store, provider, { ownershipStore }),
    );

    expect(result).toEqual({
      status: "reconciled",
      source: "durable_store",
      receipt,
    });
    expect(acquire).not.toHaveBeenCalled();
    expect(provider.reconcile).not.toHaveBeenCalled();
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("persists a provider-reconciled receipt and skips duplicate execution", async () => {
    const store = createStore();
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn().mockResolvedValue(receipt),
      execute: vi.fn(),
    };

    const result = await executeExternalEffectWithReconciliation(
      identity,
      executionOptions(store, provider),
    );

    expect(result.status).toBe("reconciled");
    expect(result).toMatchObject({ source: "provider", receipt });
    expect(store.current).toEqual(receipt);
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("executes once, validates the receipt, commits ownership, and persists it", async () => {
    const store = createStore();
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue(receipt),
    };

    const result = await executeExternalEffectWithReconciliation(
      identity,
      executionOptions(store, provider),
    );

    expect(result).toEqual({ status: "executed", receipt });
    expect(provider.execute).toHaveBeenCalledOnce();
    expect(store.current).toEqual(receipt);
  });

  it("allows only one concurrent caller to invoke the provider", async () => {
    const store = createStore();
    const ownershipStore = createOwnershipStore();
    let resolveExecution: ((value: ExternalEffectReceipt) => void) | undefined;
    const execution = new Promise<ExternalEffectReceipt>((resolve) => {
      resolveExecution = resolve;
    });
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn(() => execution),
    };
    const options = executionOptions(store, provider, { ownershipStore });

    const owner = executeExternalEffectWithReconciliation(identity, options);
    await vi.waitFor(() => expect(provider.execute).toHaveBeenCalledOnce());
    const contender = await executeExternalEffectWithReconciliation(identity, options);

    expect(contender).toMatchObject({
      status: "owned",
      ownerId: ownershipRequest.ownerId,
      generation: 1,
    });
    expect(provider.execute).toHaveBeenCalledOnce();

    resolveExecution?.(receipt);
    await expect(owner).resolves.toEqual({ status: "executed", receipt });
  });

  it("recovers from the ownership store after provider commit when receipt mirroring fails", async () => {
    let saveAttempts = 0;
    const durableStore = createStore();
    const store: ExternalEffectReceiptStore = {
      load: (effectIdentity) => durableStore.load(effectIdentity),
      save(value) {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          throw new Error("simulated durable store outage");
        }
        durableStore.save(value);
      },
    };
    const ownershipStore = createOwnershipStore();
    const execute = vi.fn().mockResolvedValue(receipt);
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn().mockResolvedValue(undefined),
      execute,
    };
    const options = executionOptions(store, provider, { ownershipStore });

    await expect(
      executeExternalEffectWithReconciliation(identity, options),
    ).rejects.toThrow("simulated durable store outage");

    const recovered = await executeExternalEffectWithReconciliation(identity, options);

    expect(recovered).toEqual({
      status: "reconciled",
      source: "durable_store",
      receipt,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(durableStore.current).toEqual(receipt);
  });

  it("releases ownership when provider reconciliation fails before execution", async () => {
    const store = createStore();
    const ownershipStore = createOwnershipStore();
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn().mockRejectedValueOnce(new Error("provider unavailable")).mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue(receipt),
    };
    const options = executionOptions(store, provider, { ownershipStore });

    await expect(
      executeExternalEffectWithReconciliation(identity, options),
    ).rejects.toThrow("provider unavailable");
    await expect(
      executeExternalEffectWithReconciliation(identity, options),
    ).resolves.toEqual({ status: "executed", receipt });
  });

  it("fails closed when a provider receipt belongs to another execution", async () => {
    const store = createStore();
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn().mockResolvedValue({
        ...receipt,
        executionId: "execution-2",
      }),
      execute: vi.fn(),
    };

    await expect(
      executeExternalEffectWithReconciliation(
        identity,
        executionOptions(store, provider),
      ),
    ).rejects.toThrow("executionId does not match");
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("appends durable execution evidence after receipt persistence", async () => {
    const store = createStore();
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue(receipt),
    };
    const evidence = createEvidenceHarness();

    await executeExternalEffectWithReconciliation(
      identity,
      executionOptions(store, provider, { hooks: evidence.hooks }),
    );

    expect(evidence.events).toEqual([
      {
        id: "event-1",
        executionId: "execution-1",
        sequence: 41,
        type: "external.effect.executed",
        occurredAt: "2026-08-04T05:00:00.000Z",
        actor: "external-effect-worker",
        parentEventId: "step-event-1",
        payload: { receipt },
      },
    ]);
  });

  it("appends reconciliation evidence with the recovery source", async () => {
    const store = createStore();
    store.current = receipt;
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn(),
      execute: vi.fn(),
    };
    const evidence = createEvidenceHarness();

    await executeExternalEffectWithReconciliation(
      identity,
      executionOptions(store, provider, { hooks: evidence.hooks }),
    );

    expect(evidence.events).toEqual([
      {
        id: "event-1",
        executionId: "execution-1",
        sequence: 41,
        type: "external.effect.reconciled",
        occurredAt: "2026-08-04T05:00:00.000Z",
        actor: "external-effect-worker",
        parentEventId: "step-event-1",
        payload: { source: "durable_store", receipt },
      },
    ]);
  });

  it("chains repeated evidence through the last successfully appended event", async () => {
    const evidence = createEvidenceHarness();

    await evidence.hooks.onExecuted?.(receipt);
    await evidence.hooks.onReconciled?.("durable_store", receipt);

    expect(evidence.events.map((event) => ({
      id: event.id,
      sequence: event.sequence,
      parentEventId: event.parentEventId,
    }))).toEqual([
      { id: "event-1", sequence: 41, parentEventId: "step-event-1" },
      { id: "event-2", sequence: 42, parentEventId: "event-1" },
    ]);
  });

  it("rejects evidence whose receipt belongs to another execution stream", async () => {
    const evidence = createEvidenceHarness();

    await expect(
      evidence.hooks.onExecuted?.({ ...receipt, executionId: "execution-2" }),
    ).rejects.toThrow("executionId does not match evidence context");
    expect(evidence.events).toHaveLength(0);
  });

  it("does not advance the evidence cursor when append fails", async () => {
    let attempts = 0;
    const evidence = createEvidenceHarness(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("simulated event store outage");
      }
    });

    await expect(evidence.hooks.onExecuted?.(receipt)).rejects.toThrow(
      "simulated event store outage",
    );
    await evidence.hooks.onExecuted?.(receipt);

    expect(evidence.events).toEqual([
      {
        id: "event-2",
        executionId: "execution-1",
        sequence: 41,
        type: "external.effect.executed",
        occurredAt: "2026-08-04T05:00:00.000Z",
        actor: "external-effect-worker",
        parentEventId: "step-event-1",
        payload: { receipt },
      },
    ]);
  });
});

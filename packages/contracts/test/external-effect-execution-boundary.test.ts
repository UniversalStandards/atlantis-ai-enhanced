import { describe, expect, it, vi } from "vitest";
import {
  executeExternalEffectWithReconciliation,
  type ExternalEffectProvider,
  type ExternalEffectReceiptStore,
} from "../src/external-effect-execution.js";
import type {
  ExternalEffectOwnershipRequest,
  ExternalEffectOwnershipStore,
} from "../src/external-effect-ownership.js";
import type { ExternalEffectIdentity } from "../src/external-effect.js";

const identity: ExternalEffectIdentity = {
  idempotencyKey: "github:pull-request:10",
  executionId: "execution-ownership-boundary",
  stepId: "open-pull-request",
  effectType: "github.pull_request.create",
};

describe("external-effect execution ownership boundary", () => {
  it("rejects accessor-backed authority without invoking it or reaching the store", async () => {
    let getterCalls = 0;
    const ownershipRequest = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(ownershipRequest, {
      ownerId: {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "worker-1";
        },
      },
      leaseDurationMs: {
        enumerable: true,
        value: 30_000,
      },
    });

    const receiptStore: ExternalEffectReceiptStore = {
      load: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(),
    };
    const ownershipStore: ExternalEffectOwnershipStore = {
      acquire: vi.fn(),
      renew: vi.fn(),
      commit: vi.fn(),
      release: vi.fn(),
      observe: vi.fn(),
    };
    const provider: ExternalEffectProvider = {
      reconcile: vi.fn(),
      execute: vi.fn(),
    };

    await expect(
      executeExternalEffectWithReconciliation(identity, {
        store: receiptStore,
        ownershipStore,
        ownershipRequest:
          ownershipRequest as unknown as ExternalEffectOwnershipRequest,
        provider,
      }),
    ).rejects.toThrow("ownerId must be an enumerable data property");

    expect(getterCalls).toBe(0);
    expect(ownershipStore.acquire).not.toHaveBeenCalled();
    expect(provider.reconcile).not.toHaveBeenCalled();
    expect(provider.execute).not.toHaveBeenCalled();
  });
});

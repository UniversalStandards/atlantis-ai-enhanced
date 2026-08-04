import { describe, expect, it, vi } from "vitest";
import { StructurallyValidatedExternalEffectOwnershipStore } from "../src/validated-external-effect-ownership-store.js";
import type {
  ExternalEffectClaim,
  ExternalEffectOwnershipStore,
} from "../src/external-effect-ownership.js";
import type {
  ExternalEffectIdentity,
  ExternalEffectReceipt,
} from "../src/external-effect.js";

const identity: ExternalEffectIdentity = Object.freeze({
  idempotencyKey: "effect-1",
  executionId: "execution-1",
  stepId: "step-1",
  effectType: "github.comment",
});

const claim: ExternalEffectClaim = Object.freeze({
  ...identity,
  claimToken: "claim-token-1",
  ownerId: "worker-1",
  acquiredAt: "2026-08-04T10:00:00.000Z",
  expiresAt: "2026-08-04T10:01:00.000Z",
  generation: 1,
});

const receipt: ExternalEffectReceipt = Object.freeze({
  ...identity,
  providerReference: "github:comment-1",
  committedAt: "2026-08-04T10:00:10.000Z",
  payloadDigest:
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  metadata: Object.freeze({
    url: "https://example.invalid/comment-1",
  }),
});

function createDelegate(): ExternalEffectOwnershipStore {
  return {
    acquire: vi.fn(() => ({
      status: "acquired" as const,
      identity,
      claim,
      acquisition: "new" as const,
    })),
    renew: vi.fn(() => claim),
    commit: vi.fn(() => receipt),
    release: vi.fn(() => undefined),
    observe: vi.fn(() => ({
      status: "unclaimed" as const,
      identity,
      generation: 0,
    })),
  };
}

describe("StructurallyValidatedExternalEffectOwnershipStore", () => {
  it("rejects accessor-backed acquisition fields without invoking getters", () => {
    const delegate = createDelegate();
    const store = new StructurallyValidatedExternalEffectOwnershipStore(delegate);
    const ownerGetter = vi.fn(() => "worker-1");
    const request = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(request, {
      ownerId: { enumerable: true, get: ownerGetter },
      leaseDurationMs: { enumerable: true, value: 60_000 },
    });

    expect(() => store.acquire(identity, request as never)).toThrow(
      /enumerable data property/,
    );
    expect(ownerGetter).not.toHaveBeenCalled();
    expect(delegate.acquire).not.toHaveBeenCalled();
  });

  it("rejects inherited renewal authority before delegating", () => {
    const delegate = createDelegate();
    const store = new StructurallyValidatedExternalEffectOwnershipStore(delegate);
    const request = Object.create({ leaseDurationMs: 60_000 });

    expect(() => store.renew(claim, request)).toThrow(/plain data record/);
    expect(delegate.renew).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed bearer claims without invoking getters", () => {
    const delegate = createDelegate();
    const store = new StructurallyValidatedExternalEffectOwnershipStore(delegate);
    const tokenGetter = vi.fn(() => "claim-token-1");
    const rawClaim = { ...claim } as Record<string, unknown>;
    Object.defineProperty(rawClaim, "claimToken", {
      enumerable: true,
      get: tokenGetter,
    });

    expect(() => store.commit(rawClaim as never, receipt)).toThrow(
      /enumerable data property/,
    );
    expect(tokenGetter).not.toHaveBeenCalled();
    expect(delegate.commit).not.toHaveBeenCalled();
  });

  it("forwards frozen normalized records to the underlying store", () => {
    const delegate = createDelegate();
    const store = new StructurallyValidatedExternalEffectOwnershipStore(delegate);

    const result = store.acquire(identity, {
      ownerId: " worker-1 ",
      leaseDurationMs: 60_000,
      metadata: { correlationId: " request-1 " },
    });

    expect(result).toMatchObject({ status: "acquired" });
    expect(delegate.acquire).toHaveBeenCalledTimes(1);
    const [forwardedIdentity, forwardedRequest] = vi.mocked(delegate.acquire).mock
      .calls[0] ?? [];
    expect(Object.isFrozen(forwardedIdentity)).toBe(true);
    expect(Object.isFrozen(forwardedRequest)).toBe(true);
    expect(forwardedRequest).toEqual({
      ownerId: "worker-1",
      leaseDurationMs: 60_000,
      metadata: { correlationId: "request-1" },
    });
  });
});

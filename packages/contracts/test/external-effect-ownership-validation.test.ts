import { describe, expect, it } from "vitest";

import {
  normalizeExternalEffectClaim,
  normalizeExternalEffectOwnershipRequest,
  normalizeExternalEffectRenewalRequest,
} from "../src/external-effect-ownership-validation.js";

const claim = {
  idempotencyKey: "execution-1:publish-change",
  executionId: "execution-1",
  stepId: "publish-change",
  effectType: "github.commit.create",
  claimToken: "claim-token-1",
  ownerId: "worker-1",
  acquiredAt: "2026-08-04T08:00:00.000Z",
  expiresAt: "2026-08-04T08:00:30.000Z",
  generation: 1,
};

describe("descriptor-safe ownership boundary validation", () => {
  it("normalizes exact acquisition, renewal, and claim records", () => {
    expect(
      normalizeExternalEffectOwnershipRequest({
        ownerId: " worker-1 ",
        leaseDurationMs: 30_000,
        metadata: { correlationId: " request-1 " },
      }),
    ).toEqual({
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
      metadata: { correlationId: "request-1" },
    });
    expect(
      normalizeExternalEffectRenewalRequest({ leaseDurationMs: 15_000 }),
    ).toEqual({ leaseDurationMs: 15_000 });
    expect(normalizeExternalEffectClaim(claim)).toEqual(claim);
  });

  it("never invokes acquisition request accessors", () => {
    let getterCalls = 0;
    const request = Object.defineProperty(
      { leaseDurationMs: 30_000 },
      "ownerId",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "worker-1";
        },
      },
    );

    expect(() => normalizeExternalEffectOwnershipRequest(request)).toThrow(
      "ownership request.ownerId must be an enumerable data property",
    );
    expect(getterCalls).toBe(0);
  });

  it("never invokes bearer claim accessors", () => {
    let getterCalls = 0;
    const accessorClaim = Object.defineProperty(
      { ...claim },
      "claimToken",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "claim-token-1";
        },
      },
    );

    expect(() => normalizeExternalEffectClaim(accessorClaim)).toThrow(
      "external-effect claim.claimToken must be an enumerable data property",
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects inherited required authorization fields", () => {
    const inheritedRequest = Object.create({ ownerId: "worker-1" }) as {
      ownerId: string;
      leaseDurationMs: number;
    };
    inheritedRequest.leaseDurationMs = 30_000;

    expect(() => normalizeExternalEffectOwnershipRequest(inheritedRequest)).toThrow(
      "ownership request must be a plain data record",
    );
  });

  it("rejects hidden, symbol-keyed, and unexpected authorization fields", () => {
    const hiddenClaim = { ...claim };
    Object.defineProperty(hiddenClaim, "claimToken", {
      value: "claim-token-1",
      enumerable: false,
    });
    expect(() => normalizeExternalEffectClaim(hiddenClaim)).toThrow(
      "external-effect claim.claimToken must be an enumerable data property",
    );

    const symbolRequest = {
      ownerId: "worker-1",
      leaseDurationMs: 30_000,
      [Symbol("authority")]: "hidden",
    };
    expect(() => normalizeExternalEffectOwnershipRequest(symbolRequest)).toThrow(
      "ownership request must not contain symbol fields",
    );

    expect(() =>
      normalizeExternalEffectRenewalRequest({
        leaseDurationMs: 30_000,
        generation: 99,
      }),
    ).toThrow("ownership renewal request contains unexpected field generation");
  });

  it("rejects accessor-backed metadata without invoking it", () => {
    let getterCalls = 0;
    const metadata = Object.defineProperty({}, "correlationId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "request-1";
      },
    });

    expect(() =>
      normalizeExternalEffectOwnershipRequest({
        ownerId: "worker-1",
        leaseDurationMs: 30_000,
        metadata,
      }),
    ).toThrow(
      "ownership request metadata.correlationId must be an enumerable data property",
    );
    expect(getterCalls).toBe(0);
  });
});

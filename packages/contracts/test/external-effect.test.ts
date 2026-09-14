import { describe, expect, it } from "vitest";

import {
  ExternalEffectConflictError,
  InvalidExternalEffectError,
  normalizeExternalEffectIdentity,
  normalizeExternalEffectReceipt,
  reconcileExternalEffect,
  type ExternalEffectIdentity,
  type ExternalEffectReceipt,
} from "../src/external-effect.js";

const digest = `sha256:${"a".repeat(64)}`;

function identity(
  overrides: Partial<ExternalEffectIdentity> = {},
): ExternalEffectIdentity {
  return {
    idempotencyKey: "execution-1:publish-change",
    executionId: "execution-1",
    stepId: "publish-change",
    effectType: "github.commit.create",
    ...overrides,
  };
}

function receipt(
  overrides: Partial<ExternalEffectReceipt> = {},
): ExternalEffectReceipt {
  return {
    ...identity(),
    providerReference: "commit:abc123",
    committedAt: "2026-08-03T23:45:00.000Z",
    payloadDigest: digest,
    metadata: { repository: "UniversalStandards/atlantis-ai-enhanced" },
    ...overrides,
  };
}

describe("external effect receipts", () => {
  it("normalizes and freezes an effect identity", () => {
    const normalized = normalizeExternalEffectIdentity(
      identity({ idempotencyKey: "  execution-1:publish-change  " }),
    );

    expect(normalized.idempotencyKey).toBe("execution-1:publish-change");
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it("returns not_committed when no receipt exists", () => {
    const result = reconcileExternalEffect(identity());

    expect(result).toEqual({ status: "not_committed", identity: identity() });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns a normalized committed receipt for an exact identity match", () => {
    const result = reconcileExternalEffect(identity(), receipt());

    expect(result.status).toBe("committed");
    if (result.status === "committed") {
      expect(result.receipt.providerReference).toBe("commit:abc123");
      expect(result.receipt.payloadDigest).toBe(digest);
      expect(Object.isFrozen(result.receipt)).toBe(true);
      expect(Object.isFrozen(result.receipt.metadata)).toBe(true);
    }
  });

  it.each([
    ["idempotencyKey", "different-key"],
    ["executionId", "execution-2"],
    ["stepId", "different-step"],
    ["effectType", "github.pull-request.create"],
  ] as const)("rejects a receipt with mismatched %s", (field, value) => {
    expect(() =>
      reconcileExternalEffect(identity(), receipt({ [field]: value })),
    ).toThrow(ExternalEffectConflictError);
  });

  it("rejects a non-canonical committed timestamp", () => {
    expect(() =>
      normalizeExternalEffectReceipt(receipt({ committedAt: "2026-08-03T23:45:00Z" })),
    ).toThrow(InvalidExternalEffectError);
  });

  it.each([
    "sha256:not-hex",
    `sha256:${"a".repeat(63)}`,
    `md5:${"a".repeat(64)}`,
  ])("rejects invalid payload digest %s", (payloadDigest) => {
    expect(() => normalizeExternalEffectReceipt(receipt({ payloadDigest }))).toThrow(
      InvalidExternalEffectError,
    );
  });

  it("normalizes uppercase hexadecimal digest input", () => {
    const normalized = normalizeExternalEffectReceipt(
      receipt({ payloadDigest: `SHA256:${"A".repeat(64)}` }),
    );

    expect(normalized.payloadDigest).toBe(digest);
  });

  it("rejects blank metadata values", () => {
    expect(() =>
      normalizeExternalEffectReceipt(receipt({ metadata: { repository: " " } })),
    ).toThrow(InvalidExternalEffectError);
  });

  it("rejects metadata keys that collide after normalization", () => {
    expect(() =>
      normalizeExternalEffectReceipt(
        receipt({ metadata: { repository: "one", " repository ": "two" } }),
      ),
    ).toThrow(InvalidExternalEffectError);
  });

  it("rejects symbol-keyed metadata", () => {
    const metadata = { repository: "UniversalStandards/atlantis-ai-enhanced" } as Record<
      string | symbol,
      string
    >;
    metadata[Symbol("hidden")] = "not-recorded";

    expect(() =>
      normalizeExternalEffectReceipt(
        receipt({ metadata: metadata as Readonly<Record<string, string>> }),
      ),
    ).toThrow(InvalidExternalEffectError);
  });

  it("rejects non-enumerable metadata", () => {
    const metadata = { repository: "UniversalStandards/atlantis-ai-enhanced" };
    Object.defineProperty(metadata, "hidden", {
      value: "not-recorded",
      enumerable: false,
    });

    expect(() => normalizeExternalEffectReceipt(receipt({ metadata }))).toThrow(
      InvalidExternalEffectError,
    );
  });

  it("rejects accessor metadata without invoking the getter", () => {
    let getterCalls = 0;
    const metadata = {} as Record<string, string>;
    Object.defineProperty(metadata, "repository", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "UniversalStandards/atlantis-ai-enhanced";
      },
    });

    expect(() => normalizeExternalEffectReceipt(receipt({ metadata }))).toThrow(
      InvalidExternalEffectError,
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects metadata with a custom prototype", () => {
    const metadata = Object.create({ inherited: "not-recorded" }) as Record<string, string>;
    metadata.repository = "UniversalStandards/atlantis-ai-enhanced";

    expect(() => normalizeExternalEffectReceipt(receipt({ metadata }))).toThrow(
      InvalidExternalEffectError,
    );
  });
});

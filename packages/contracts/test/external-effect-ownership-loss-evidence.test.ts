import { describe, expect, it, vi } from "vitest";
import { ExternalEffectOwnershipLostError } from "../src/external-effect-execution.js";
import { withExternalEffectOwnershipLossEvidence } from "../src/external-effect-ownership-loss-evidence.js";
import type { ExternalEffectClaim } from "../src/external-effect-ownership.js";

const claim: ExternalEffectClaim = {
  idempotencyKey: "execution-1:publish-change",
  executionId: "execution-1",
  stepId: "publish-change",
  effectType: "github.commit.create",
  ownerId: "worker-1",
  claimToken: "opaque-secret-token",
  acquiredAt: "2026-08-04T14:00:00.000Z",
  expiresAt: "2026-08-04T14:00:30.000Z",
  generation: 3,
};

function context(append: ReturnType<typeof vi.fn>) {
  return {
    eventSink: { append },
    executionId: "execution-1",
    actor: "external-effect-runtime",
    sequence: 12,
    parentEventId: "event-11",
    createEventId: () => "event-12",
    now: () => "2026-08-04T14:00:10.000Z",
  } as const;
}

describe("external effect ownership loss evidence", () => {
  it("records token-safe durable evidence and rethrows the authoritative error", async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const ownershipLoss = new ExternalEffectOwnershipLostError(
      "provider_execution",
      claim,
      new Error("claim superseded"),
    );

    await expect(
      withExternalEffectOwnershipLossEvidence(context(append), async () => {
        throw ownershipLoss;
      }),
    ).rejects.toBe(ownershipLoss);

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      id: "event-12",
      executionId: "execution-1",
      sequence: 12,
      type: "external.effect.ownership.lost",
      occurredAt: "2026-08-04T14:00:10.000Z",
      actor: "external-effect-runtime",
      parentEventId: "event-11",
      payload: {
        stage: "provider_execution",
        identity: {
          idempotencyKey: "execution-1:publish-change",
          executionId: "execution-1",
          stepId: "publish-change",
          effectType: "github.commit.create",
        },
        ownerId: "worker-1",
        generation: 3,
        expiresAt: "2026-08-04T14:00:30.000Z",
      },
    });
    expect(JSON.stringify(append.mock.calls)).not.toContain(claim.claimToken);
  });

  it("never lets evidence failure replace ownership loss", async () => {
    const evidenceFailure = new Error("event store unavailable");
    const onEvidenceError = vi.fn().mockRejectedValue(new Error("reporting failed"));
    const ownershipLoss = new ExternalEffectOwnershipLostError(
      "provider_reconciliation",
      claim,
      new Error("renewal rejected"),
    );

    await expect(
      withExternalEffectOwnershipLossEvidence(
        {
          ...context(vi.fn().mockRejectedValue(evidenceFailure)),
          onEvidenceError,
        },
        () => Promise.reject(ownershipLoss),
      ),
    ).rejects.toBe(ownershipLoss);

    expect(onEvidenceError).toHaveBeenCalledWith(evidenceFailure);
  });

  it("passes through successful results and unrelated failures without evidence", async () => {
    const append = vi.fn();

    await expect(
      withExternalEffectOwnershipLossEvidence(context(append), () => "ok"),
    ).resolves.toBe("ok");

    const unrelated = new Error("provider rejected request");
    await expect(
      withExternalEffectOwnershipLossEvidence(context(append), () => {
        throw unrelated;
      }),
    ).rejects.toBe(unrelated);

    expect(append).not.toHaveBeenCalled();
  });
});

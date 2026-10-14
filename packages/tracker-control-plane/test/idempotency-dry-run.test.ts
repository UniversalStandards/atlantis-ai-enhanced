import { describe, expect, it, vi } from "vitest";

import {
  createTrackerIssueProjection,
  type TrackerProjection,
} from "@atlantis/contracts/tracker-projection";

import {
  createTrackerSynchronizationIdentity,
  InMemoryReferenceIdempotencyStore,
} from "../src/idempotency.js";
import {
  synchronizeTrackerMutation,
  type AuthorityDecision,
  type TrackerSynchronizationRequest,
} from "../src/dry-run.js";

function makeProjection(title = "Shared tracker state", extra?: object) {
  return createTrackerIssueProjection({
    repository: "UniversalStandards/atlantis-ai-enhanced",
    issueNumber: 48,
    title,
    body: "One semantic state.",
    state: "open",
    labels: ["alpha"],
    assignees: [],
    linkedPullRequests: [],
    ...extra,
  });
}

function request(
  sourceProjection: unknown = makeProjection(),
  options: Partial<TrackerSynchronizationRequest> = {},
): TrackerSynchronizationRequest {
  return {
    sourceSystem: "github",
    sourceProjection,
    target: { system: "notion", entityType: "issue", entityId: "issue-48" },
    priorProjection: null,
    proposedProjection: sourceProjection,
    reason: "Synchronize semantic tracker state",
    dryRun: false,
    ...options,
  };
}

function ports(
  mutation: (value: unknown) => unknown = () => ({ accepted: true }),
  decision: () => AuthorityDecision = () => ({ classification: "authorized" }),
) {
  const idempotency = new InMemoryReferenceIdempotencyStore();
  const admit = vi.fn(mutation);
  const decide = vi.fn(decision);
  const claim = vi.spyOn(idempotency, "claim");
  return { idempotency, admit, decide, claim, authority: { decide }, mutation: { admit } };
}

describe("tracker shared idempotency and dry-run", () => {
  it("uses one key for webhook and anti-entropy state and applies the repeated key once", async () => {
    const webhookProjection = makeProjection();
    const antiEntropyProjection = makeProjection();
    const p = ports();

    const webhook = await synchronizeTrackerMutation(request(webhookProjection), p);
    const antiEntropy = await synchronizeTrackerMutation(request(antiEntropyProjection), p);

    expect(webhook.status).toBe("applied");
    expect(antiEntropy.status).toBe("replayed");
    expect(p.admit).toHaveBeenCalledTimes(1);
    if (webhook.status === "applied" && antiEntropy.status === "replayed") {
      expect(webhook.proposal.idempotencyKey).toBe(antiEntropy.proposal.idempotencyKey);
      expect(antiEntropy.outcome).toEqual({ status: "applied", result: { accepted: true } });
    }
  });

  it("admits a new projected source revision as a separate transition", async () => {
    const p = ports();
    const first = await synchronizeTrackerMutation(request(makeProjection()), p);
    const next = await synchronizeTrackerMutation(request(makeProjection("New title")), p);

    expect(first.status).toBe("applied");
    expect(next.status).toBe("applied");
    expect(p.admit).toHaveBeenCalledTimes(2);
  });

  it("changes identity for projected revisions but not for unprojected-only input", () => {
    const base = makeProjection();
    const volatileOnly = makeProjection("Shared tracker state", { updatedAt: "later" });
    const projectedChange = makeProjection("Changed projected title");
    const identity = (projection: typeof base) =>
      createTrackerSynchronizationIdentity({
        sourceSystem: "github",
        repository: projection.repository,
        entityType: projection.entityType,
        entityId: projection.entityId,
        sourceRevision: projection.sourceRevision,
        targetSystem: "notion",
        projectionVersion: projection.projectionVersion,
      });

    const baseIdentity = identity(base);
    const volatileIdentity = identity(volatileOnly);
    const changedIdentity = identity(projectedChange);
    expect(base.sourceRevision).toBe(volatileOnly.sourceRevision);
    expect(baseIdentity.status).toBe("valid");
    expect(volatileIdentity.status).toBe("valid");
    expect(changedIdentity.status).toBe("valid");
    if (
      baseIdentity.status === "valid" &&
      volatileIdentity.status === "valid" &&
      changedIdentity.status === "valid"
    ) {
      expect(volatileIdentity.key).toBe(baseIdentity.key);
      expect(changedIdentity.key).not.toBe(baseIdentity.key);
    }
  });

  it("returns a complete dry-run without claiming or admitting a mutation", async () => {
    const source = makeProjection();
    const p = ports();
    const result = await synchronizeTrackerMutation(
      request(source, {
        priorProjection: {
          semanticFields: { ...source.semanticFields, title: "Previous title" },
        },
        dryRun: true,
      }),
      p,
    );

    expect(result.status).toBe("dry-run");
    expect(p.decide).toHaveBeenCalledTimes(1);
    expect(p.claim).not.toHaveBeenCalled();
    expect(p.admit).not.toHaveBeenCalled();
    if (result.status === "dry-run") {
      expect(result.proposal).toMatchObject({
        source: {
          system: "github",
          repository: source.repository,
          entityType: "issue",
          entityId: 48,
          sourceRevision: source.sourceRevision,
        },
        target: { system: "notion", entityType: "issue", entityId: "issue-48" },
        priorProjection: { semanticFields: { title: "Previous title" } },
        proposedProjection: source,
        changedFields: ["title"],
        reason: "Synchronize semantic tracker state",
        authority: "authorized",
        projectionVersion: { major: 1, minor: 0 },
      });
      expect(result.proposal.idempotencyKey).toMatch(/^tracker-sync:v1:/u);
      expect(Object.isFrozen(result.proposal.proposedProjection)).toBe(true);
    }
  });

  it("evaluates authority before a claim and fails closed for denial or ambiguity", async () => {
    for (const classification of ["denied", "ambiguous"] as const) {
      const p = ports(() => ({ accepted: true }), () => ({
        classification,
        code: "POLICY_REQUIRES_REVIEW",
      }));
      const result = await synchronizeTrackerMutation(request(), p);
      expect(result.status).toBe(
        classification === "denied" ? "authority-denied" : "authority-ambiguous",
      );
      expect(p.admit).not.toHaveBeenCalled();
      expect(p.claim).not.toHaveBeenCalled();
    }
  });

  it("persists a failed attempt without consuming the key for a later retry", async () => {
    const p = ports();
    p.admit.mockImplementationOnce(() => {
      throw new Error("temporary target failure");
    });

    const first = await synchronizeTrackerMutation(request(), p);
    const retry = await synchronizeTrackerMutation(request(), p);

    expect(first).toMatchObject({ status: "mutation-failed", recorded: true });
    expect(retry.status).toBe("applied");
    expect(p.admit).toHaveBeenCalledTimes(2);
  });

  it("rejects concurrent claims and malformed idempotency keys", async () => {
    const projection = makeProjection();
    const identity = createTrackerSynchronizationIdentity({
      sourceSystem: "github",
      repository: projection.repository,
      entityType: projection.entityType,
      entityId: projection.entityId,
      sourceRevision: projection.sourceRevision,
      targetSystem: "notion",
      projectionVersion: projection.projectionVersion,
    });
    expect(identity.status).toBe("valid");
    if (identity.status !== "valid") {
      return;
    }
    const store = new InMemoryReferenceIdempotencyStore();
    await expect(Promise.all([store.claim(identity.key), store.claim(identity.key)])).resolves.toEqual([
      { status: "claimed" },
      { status: "conflict" },
    ]);
    await expect(store.claim("tracker-sync:v1:{malformed")).resolves.toEqual({
      status: "invalid-key",
    });
    await expect(new InMemoryReferenceIdempotencyStore().claim(identity.key)).resolves.toEqual({
      status: "claimed",
    });
  });

  it("records and replays outcomes while allowing a recorded failure to be retried", async () => {
    const projection = makeProjection();
    const identity = createTrackerSynchronizationIdentity({
      sourceSystem: "github",
      repository: projection.repository,
      entityType: projection.entityType,
      entityId: projection.entityId,
      sourceRevision: projection.sourceRevision,
      targetSystem: "notion",
      projectionVersion: projection.projectionVersion,
    });
    if (identity.status !== "valid") {
      throw new Error("test identity should be valid");
    }
    const store = new InMemoryReferenceIdempotencyStore();

    await expect(store.claim(identity.key)).resolves.toEqual({ status: "claimed" });
    await expect(
      store.record(identity.key, { status: "failed", code: "RETRYABLE_FAILURE" }),
    ).resolves.toEqual({ status: "recorded" });
    await expect(store.replay(identity.key)).resolves.toEqual({
      status: "failed",
      code: "RETRYABLE_FAILURE",
    });
    await expect(store.claim(identity.key)).resolves.toEqual({ status: "claimed" });
    await expect(store.replay(identity.key)).resolves.toEqual({
      status: "failed",
      code: "RETRYABLE_FAILURE",
    });
  });

  it("rejects malformed source identity before authority or admission", async () => {
    const source = { ...makeProjection(), entityId: 0 };
    const p = ports();

    const result = await synchronizeTrackerMutation(request(source), p);

    expect(result).toMatchObject({
      status: "invalid-identity",
      code: "MALFORMED_IDENTITY",
    });
    expect(p.decide).not.toHaveBeenCalled();
    expect(p.claim).not.toHaveBeenCalled();
    expect(p.admit).not.toHaveBeenCalled();
  });

  it("rejects unsupported projection schema versions before authority or claim", async () => {
    const source = {
      ...makeProjection(),
      projectionVersion: { major: 2, minor: 0 },
    } as TrackerProjection;
    const p = ports();

    const result = await synchronizeTrackerMutation(request(source), p);

    expect(result.status).toBe("unsupported-version");
    expect(p.decide).not.toHaveBeenCalled();
    expect(p.admit).not.toHaveBeenCalled();
  });
});

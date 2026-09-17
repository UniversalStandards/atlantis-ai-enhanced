import { describe, expect, it } from "vitest";
import {
  createTrackerProjectedSource,
  reconcileTrackerProjection,
  type TrackerIdempotencyClaimResult,
  type TrackerIdempotencyStore,
  type TrackerIncidentPolicy,
  type TrackerProjectionAdapter,
  type TrackerProjectionRecord,
  type TrackerReconciliationResult,
} from "../src/index.js";

const AUTHORITY = {
  actorId: "tracker-bot",
  roles: ["tracker-sync"] as const,
};

const INCIDENT_POLICY: TrackerIncidentPolicy = {
  owner: "tracker-ops",
  slaClass: "p1",
};

type FakeRecord = TrackerProjectionRecord<{
  readonly owner: string;
  readonly status: string;
}>;

class InMemoryIdempotencyStore
  implements TrackerIdempotencyStore<TrackerReconciliationResult<FakeRecord["planningContext"]>>
{
  readonly claims = new Map<string, TrackerReconciliationResult<FakeRecord["planningContext"]>>();
  readonly abandoned: string[] = [];

  claim(
    idempotencyKey: string,
  ): TrackerIdempotencyClaimResult<
    TrackerReconciliationResult<FakeRecord["planningContext"]>
  > {
    const existingResult = this.claims.get(idempotencyKey);
    return existingResult
      ? { claimed: false, existingResult }
      : { claimed: true };
  }

  record(
    idempotencyKey: string,
    result: TrackerReconciliationResult<FakeRecord["planningContext"]>,
  ): void {
    this.claims.set(idempotencyKey, result);
  }

  abandon(idempotencyKey: string): void {
    this.abandoned.push(idempotencyKey);
    this.claims.delete(idempotencyKey);
  }
}

class InMemoryAdapter
  implements
    TrackerProjectionAdapter<FakeRecord["planningContext"], { readonly id: string }>
{
  readonly targetSystem = "notion";
  readonly records: FakeRecord[];
  readonly compatible: boolean;
  readonly createCalls: Array<{ readonly title: string }> = [];
  readonly updateCalls: Array<{ readonly title: string }> = [];
  readonly readbackOverride: FakeRecord | undefined;

  constructor(args?: {
    readonly records?: FakeRecord[];
    readonly compatible?: boolean;
    readonly readbackOverride?: FakeRecord;
  }) {
    this.records = [...(args?.records ?? [])];
    this.compatible = args?.compatible ?? true;
    this.readbackOverride = args?.readbackOverride;
  }

  read(source: { readonly entityId: string }): readonly FakeRecord[] {
    return this.records.filter((record) => record.entityId === source.entityId);
  }

  validateSchema(): { readonly compatible: boolean; readonly reason?: string } {
    return this.compatible
      ? { compatible: true }
      : { compatible: false, reason: "Projection version notion-v1 is unsupported" };
  }

  create(source: {
    readonly sourceSystem: string;
    readonly repository: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly projectionVersion: string;
    readonly sourceRevision: string;
    readonly projectedFields: FakeRecord["projectedFields"];
  }): { readonly id: string } {
    this.createCalls.push({
      title: String(source.projectedFields.title ?? ""),
    });
    this.records.push({
      recordId: `record-${this.records.length + 1}`,
      targetSystem: this.targetSystem,
      sourceSystem: source.sourceSystem,
      repository: source.repository,
      entityType: source.entityType,
      entityId: source.entityId,
      projectionVersion: source.projectionVersion,
      sourceRevision: source.sourceRevision,
      projectedFields: source.projectedFields,
      planningContext: {
        owner: "unassigned",
        status: "todo",
      },
    });
    return { id: source.entityId };
  }

  update(
    record: FakeRecord,
    source: {
      readonly projectionVersion: string;
      readonly sourceRevision: string;
      readonly projectedFields: FakeRecord["projectedFields"];
    },
  ): { readonly id: string } {
    this.updateCalls.push({
      title: String(source.projectedFields.title ?? ""),
    });
    const index = this.records.findIndex(
      (candidate) => candidate.recordId === record.recordId,
    );
    this.records[index] = {
      ...record,
      projectionVersion: source.projectionVersion,
      sourceRevision: source.sourceRevision,
      projectedFields: source.projectedFields,
      planningContext: record.planningContext,
    };
    return { id: record.recordId };
  }

  readback(receipt: { readonly id: string }): FakeRecord | undefined {
    return (
      this.readbackOverride ??
      this.records.find(
        (record) =>
          record.recordId === receipt.id || record.entityId === receipt.id,
      )
    );
  }
}

function issueRecord(
  overrides: Partial<FakeRecord> = {},
): FakeRecord {
  return {
    recordId: "record-1",
    targetSystem: "notion",
    sourceSystem: "github",
    repository: "UniversalStandards/atlantis-ai-enhanced",
    entityType: "issue",
    entityId: "46",
    projectionVersion: "tracker-v1",
    sourceRevision: "fnv1a64:old",
    projectedFields: {
      labels: ["enhancement"],
      state: "open",
      title: "Original title",
    },
    planningContext: {
      owner: "platform",
      status: "in-progress",
    },
    ...overrides,
  };
}

describe("tracker control plane", () => {
  it("produces the same canonical source revision across normalized arrays and unicode", () => {
    const composed = createTrackerProjectedSource({
      sourceSystem: "github",
      repository: "UniversalStandards/atlantis-ai-enhanced",
      entityType: "issue",
      entityId: "46",
      projectionVersion: "tracker-v1",
      labels: ["enhancement", "bug"],
      projectedFields: {
        labels: ["bug", "enhancement"],
        title: "café",
      },
    });
    const decomposed = createTrackerProjectedSource({
      sourceSystem: "github",
      repository: "UniversalStandards/atlantis-ai-enhanced",
      entityType: "issue",
      entityId: "46",
      projectionVersion: "tracker-v1",
      labels: ["bug", "enhancement"],
      projectedFields: {
        labels: ["enhancement", "bug"],
        title: "cafe\u0301",
      },
    });

    expect(decomposed.canonicalProjection).toBe(composed.canonicalProjection);
    expect(decomposed.sourceRevision).toBe(composed.sourceRevision);
  });

  it("shares one idempotency identity between webhook and anti-entropy replays", async () => {
    const adapter = new InMemoryAdapter();
    const idempotencyStore = new InMemoryIdempotencyStore();
    const source = {
      sourceSystem: "github",
      repository: "UniversalStandards/atlantis-ai-enhanced",
      entityType: "issue",
      entityId: "46",
      projectionVersion: "tracker-v1",
      projectedFields: {
        labels: ["enhancement"],
        state: "open",
        title: "Tracker issue",
      },
    } as const;

    const first = await reconcileTrackerProjection({
      trigger: "webhook",
      authority: AUTHORITY,
      source,
      adapter,
      incidentPolicy: INCIDENT_POLICY,
      idempotencyStore,
    });
    const replay = await reconcileTrackerProjection({
      trigger: "anti-entropy",
      authority: AUTHORITY,
      source,
      adapter,
      incidentPolicy: INCIDENT_POLICY,
      idempotencyStore,
    });

    expect(first.status).toBe("applied");
    expect(replay.status).toBe("applied");
    expect(replay.idempotencyKey).toBe(first.idempotencyKey);
    expect(adapter.createCalls).toHaveLength(1);
  });

  it("returns an exact dry-run diff without mutating the target", async () => {
    const adapter = new InMemoryAdapter({
      records: [issueRecord()],
    });
    const idempotencyStore = new InMemoryIdempotencyStore();

    const result = await reconcileTrackerProjection({
      trigger: "webhook",
      authority: AUTHORITY,
      source: {
        sourceSystem: "github",
        repository: "UniversalStandards/atlantis-ai-enhanced",
        entityType: "issue",
        entityId: "46",
        projectionVersion: "tracker-v1",
        projectedFields: {
          labels: ["enhancement", "help wanted"],
          state: "closed",
          title: "Updated title",
        },
      },
      adapter,
      incidentPolicy: INCIDENT_POLICY,
      idempotencyStore,
      dryRun: true,
    });

    expect(result.status).toBe("dry-run");
    expect(result.mutationPlan.mutation).toBe("update");
    expect(result.mutationPlan.fieldChanges).toEqual([
      {
        field: "labels",
        before: ["enhancement"],
        after: ["enhancement", "help wanted"],
      },
      {
        field: "state",
        before: "open",
        after: "closed",
      },
      {
        field: "title",
        before: "Original title",
        after: "Updated title",
      },
    ]);
    expect(result.mutationPlan.planningContext).toEqual({
      owner: "platform",
      status: "in-progress",
    });
    expect(adapter.updateCalls).toHaveLength(0);
    expect(idempotencyStore.claims.size).toBe(0);
  });

  it("preserves Notion-owned planning context on verified updates", async () => {
    const adapter = new InMemoryAdapter({
      records: [issueRecord()],
    });

    const result = await reconcileTrackerProjection({
      trigger: "webhook",
      authority: AUTHORITY,
      source: {
        sourceSystem: "github",
        repository: "UniversalStandards/atlantis-ai-enhanced",
        entityType: "issue",
        entityId: "46",
        projectionVersion: "tracker-v1",
        projectedFields: {
          labels: ["enhancement", "priority"],
          state: "open",
          title: "Original title",
        },
      },
      adapter,
      incidentPolicy: INCIDENT_POLICY,
    });

    expect(result.status).toBe("applied");
    expect(result.verifiedRecord?.planningContext).toEqual({
      owner: "platform",
      status: "in-progress",
    });
    expect(adapter.updateCalls).toHaveLength(1);
  });

  it("fails closed on duplicate target rows and assigns ownership", async () => {
    const adapter = new InMemoryAdapter({
      records: [
        issueRecord({ recordId: "record-1" }),
        issueRecord({ recordId: "record-2", sourceRevision: "fnv1a64:other" }),
      ],
    });

    const result = await reconcileTrackerProjection({
      trigger: "anti-entropy",
      authority: AUTHORITY,
      source: {
        sourceSystem: "github",
        repository: "UniversalStandards/atlantis-ai-enhanced",
        entityType: "issue",
        entityId: "46",
        projectionVersion: "tracker-v1",
        projectedFields: {
          labels: ["enhancement"],
          state: "open",
          title: "Tracker issue",
        },
      },
      adapter,
      incidentPolicy: INCIDENT_POLICY,
    });

    expect(result.status).toBe("failed");
    expect(result.incident).toMatchObject({
      code: "duplicate-target-records",
      owner: "tracker-ops",
      slaClass: "p1",
      severity: "critical",
    });
    expect(adapter.updateCalls).toHaveLength(0);
    expect(adapter.createCalls).toHaveLength(0);
  });

  it("fails closed when the target schema is incompatible", async () => {
    const adapter = new InMemoryAdapter({
      records: [issueRecord()],
      compatible: false,
    });

    const result = await reconcileTrackerProjection({
      trigger: "webhook",
      authority: AUTHORITY,
      source: {
        sourceSystem: "github",
        repository: "UniversalStandards/atlantis-ai-enhanced",
        entityType: "issue",
        entityId: "46",
        projectionVersion: "tracker-v2",
        projectedFields: {
          labels: ["enhancement"],
          state: "open",
          title: "Tracker issue",
        },
      },
      adapter,
      incidentPolicy: INCIDENT_POLICY,
    });

    expect(result.status).toBe("failed");
    expect(result.incident).toMatchObject({
      code: "schema-incompatible",
      owner: "tracker-ops",
      slaClass: "p1",
      severity: "high",
    });
  });

  it("fails closed when post-write readback cannot verify the target state", async () => {
    const adapter = new InMemoryAdapter({
      records: [issueRecord()],
      readbackOverride: issueRecord({
        projectedFields: {
          labels: ["enhancement"],
          state: "closed",
          title: "Unexpected title",
        },
      }),
    });

    const result = await reconcileTrackerProjection({
      trigger: "webhook",
      authority: AUTHORITY,
      source: {
        sourceSystem: "github",
        repository: "UniversalStandards/atlantis-ai-enhanced",
        entityType: "issue",
        entityId: "46",
        projectionVersion: "tracker-v1",
        projectedFields: {
          labels: ["enhancement"],
          state: "closed",
          title: "Expected title",
        },
      },
      adapter,
      incidentPolicy: INCIDENT_POLICY,
    });

    expect(result.status).toBe("failed");
    expect(result.incident).toMatchObject({
      code: "unverifiable-write",
      owner: "tracker-ops",
      slaClass: "p1",
      severity: "critical",
    });
  });

  it("excludes control-plane incidents from ordinary projection", async () => {
    const adapter = new InMemoryAdapter();

    const result = await reconcileTrackerProjection({
      trigger: "webhook",
      authority: AUTHORITY,
      source: {
        sourceSystem: "github",
        repository: "UniversalStandards/atlantis-ai-enhanced",
        entityType: "issue",
        entityId: "99",
        projectionVersion: "tracker-v1",
        labels: ["tracker-drift"],
        projectedFields: {
          labels: ["tracker-drift"],
          state: "open",
          title: "Drift incident",
        },
      },
      adapter,
      incidentPolicy: INCIDENT_POLICY,
    });

    expect(result.status).toBe("excluded");
    expect(result.source.policyDecision).toEqual({
      classification: "control-plane",
      excludedFromProgramWork: true,
      matchedLabels: ["tracker-drift"],
    });
    expect(adapter.createCalls).toHaveLength(0);
  });
});

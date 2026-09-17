export type TrackerAuthorityRole =
  | "tracker-sync"
  | "coding-agent"
  | "release"
  | "deployment"
  | "repository-admin";

export interface TrackerAuthorityContext {
  readonly actorId: string;
  readonly roles: readonly TrackerAuthorityRole[];
}

export type TrackerCanonicalScalar = string | number | boolean | null;

export type TrackerCanonicalValue =
  | TrackerCanonicalScalar
  | readonly TrackerCanonicalValue[]
  | { readonly [key: string]: TrackerCanonicalValue };

export type TrackerProjectionFields = Readonly<
  Record<string, TrackerCanonicalValue>
>;

export type TrackerPlanningContext = Readonly<
  Record<string, TrackerCanonicalValue>
>;

export type TrackerProjectionClassification =
  | "program-work"
  | "control-plane";

export interface TrackerProjectionPolicyDecision {
  readonly classification: TrackerProjectionClassification;
  readonly excludedFromProgramWork: boolean;
  readonly matchedLabels: readonly string[];
}

export interface TrackerProjectionSourceInput {
  readonly sourceSystem: string;
  readonly repository: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly projectionVersion: string;
  readonly projectedFields: Readonly<Record<string, unknown>>;
  readonly labels?: readonly string[];
}

export interface TrackerProjectedSource {
  readonly sourceSystem: string;
  readonly repository: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly projectionVersion: string;
  readonly projectedFields: TrackerProjectionFields;
  readonly labels: readonly string[];
  readonly policyDecision: TrackerProjectionPolicyDecision;
  readonly canonicalProjection: string;
  readonly sourceRevision: string;
}

export interface TrackerIdempotencyIdentity {
  readonly sourceSystem: string;
  readonly repository: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly sourceRevision: string;
  readonly targetSystem: string;
  readonly projectionVersion: string;
}

export interface TrackerProjectionRecord<
  TPlanningContext extends TrackerPlanningContext = TrackerPlanningContext,
> {
  readonly recordId: string;
  readonly targetSystem: string;
  readonly sourceSystem: string;
  readonly repository: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly projectionVersion: string;
  readonly sourceRevision: string;
  readonly projectedFields: TrackerProjectionFields;
  readonly planningContext: TPlanningContext;
}

export interface TrackerProjectionFieldChange {
  readonly field: string;
  readonly before: TrackerCanonicalValue | undefined;
  readonly after: TrackerCanonicalValue | undefined;
}

export interface TrackerMutationPlan<
  TPlanningContext extends TrackerPlanningContext = TrackerPlanningContext,
> {
  readonly mutation: "none" | "create" | "update";
  readonly safeToApply: boolean;
  readonly fieldChanges: readonly TrackerProjectionFieldChange[];
  readonly sourceRevisionChanged: boolean;
  readonly projectionVersionChanged: boolean;
  readonly planningContext: TPlanningContext | null;
}

export interface TrackerSchemaCompatibilityResult {
  readonly compatible: boolean;
  readonly reason?: string;
}

export interface TrackerProjectionAdapter<
  TPlanningContext extends TrackerPlanningContext = TrackerPlanningContext,
  TWriteReceipt = unknown,
> {
  readonly targetSystem: string;
  read(
    source: TrackerProjectedSource,
  ):
    | Promise<readonly TrackerProjectionRecord<TPlanningContext>[]>
    | readonly TrackerProjectionRecord<TPlanningContext>[];
  validateSchema(
    record: TrackerProjectionRecord<TPlanningContext> | undefined,
    projectionVersion: string,
  ):
    | Promise<TrackerSchemaCompatibilityResult>
    | TrackerSchemaCompatibilityResult;
  create(
    source: TrackerProjectedSource,
    plan: TrackerMutationPlan<TPlanningContext>,
  ): Promise<TWriteReceipt> | TWriteReceipt;
  update(
    record: TrackerProjectionRecord<TPlanningContext>,
    source: TrackerProjectedSource,
    plan: TrackerMutationPlan<TPlanningContext>,
  ): Promise<TWriteReceipt> | TWriteReceipt;
  readback(
    receipt: TWriteReceipt,
    source: TrackerProjectedSource,
  ):
    | Promise<TrackerProjectionRecord<TPlanningContext> | undefined>
    | TrackerProjectionRecord<TPlanningContext>
    | undefined;
}

export interface TrackerReadbackVerificationResult {
  readonly verified: boolean;
  readonly reasons: readonly string[];
}

export type TrackerReconciliationIncidentCode =
  | "authority-denied"
  | "adapter-failure"
  | "duplicate-target-records"
  | "schema-incompatible"
  | "unverifiable-write";

export type TrackerIncidentSeverity = "low" | "medium" | "high" | "critical";

export type TrackerIncidentEscalationState =
  | "new"
  | "triaged"
  | "escalated"
  | "resolved";

export interface TrackerReconciliationIncident {
  readonly code: TrackerReconciliationIncidentCode;
  readonly severity: TrackerIncidentSeverity;
  readonly owner: string;
  readonly slaClass: string;
  readonly escalationState: TrackerIncidentEscalationState;
  readonly message: string;
  readonly idempotencyKey: string;
  readonly sourceRevision: string;
}

export interface TrackerIncidentPolicy {
  readonly owner: string;
  readonly slaClass: string;
  readonly escalationState?: TrackerIncidentEscalationState;
  readonly severityOverrides?: Partial<
    Record<TrackerReconciliationIncidentCode, TrackerIncidentSeverity>
  >;
}

export interface TrackerIdempotencyClaimResult<TResult> {
  readonly state: "claimed" | "in-progress" | "completed";
  readonly existingResult?: TResult;
}

export interface TrackerIdempotencyStore<TResult> {
  claim(
    idempotencyKey: string,
  ): Promise<TrackerIdempotencyClaimResult<TResult>> | TrackerIdempotencyClaimResult<TResult>;
  abandon(idempotencyKey: string): Promise<void> | void;
  record(
    idempotencyKey: string,
    result: TResult,
  ): Promise<void> | void;
}

export interface TrackerReconciliationRequest<
  TPlanningContext extends TrackerPlanningContext = TrackerPlanningContext,
  TWriteReceipt = unknown,
> {
  readonly trigger: "webhook" | "anti-entropy";
  readonly authority: TrackerAuthorityContext;
  readonly source: TrackerProjectionSourceInput;
  readonly adapter: TrackerProjectionAdapter<TPlanningContext, TWriteReceipt>;
  readonly incidentPolicy: TrackerIncidentPolicy;
  readonly idempotencyStore?: TrackerIdempotencyStore<
    TrackerReconciliationResult<TPlanningContext>
  >;
  readonly dryRun?: boolean;
}

export interface TrackerReconciliationResult<
  TPlanningContext extends TrackerPlanningContext = TrackerPlanningContext,
> {
  readonly status:
    | "excluded"
    | "duplicate"
    | "dry-run"
    | "noop"
    | "applied"
    | "failed";
  readonly trigger: "webhook" | "anti-entropy";
  readonly idempotencyKey: string;
  readonly source: TrackerProjectedSource;
  readonly mutationPlan: TrackerMutationPlan<TPlanningContext>;
  readonly verifiedRecord?: TrackerProjectionRecord<TPlanningContext>;
  readonly incident?: TrackerReconciliationIncident;
}

const TRACKER_CONTROL_PLANE_LABELS = [
  "tracker-drift",
  "automation-health",
  "sync-internal",
  "sync-dlq",
] as const;

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const FNV_MASK_64 = 0xffffffffffffffffn;
const TRACKER_SYNC_ROLE: TrackerAuthorityRole = "tracker-sync";

export class TrackerProjectionNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackerProjectionNormalizationError";
  }
}

export function classifyTrackerLabels(
  labels: readonly string[] = [],
): TrackerProjectionPolicyDecision {
  const normalizedLabels = [...new Set(labels.map((label) => label.trim()))]
    .filter((label) => label.length > 0)
    .sort();
  const matchedLabels = normalizedLabels.filter((label) =>
    TRACKER_CONTROL_PLANE_LABELS.includes(
      label.toLowerCase() as (typeof TRACKER_CONTROL_PLANE_LABELS)[number],
    ),
  );

  return {
    classification: matchedLabels.length > 0 ? "control-plane" : "program-work",
    excludedFromProgramWork: matchedLabels.length > 0,
    matchedLabels,
  };
}

export function normalizeTrackerProjectionFields(
  fields: Readonly<Record<string, unknown>>,
): TrackerProjectionFields {
  const normalized = normalizeTrackerCanonicalValue(fields, "projectedFields");
  if (!isTrackerCanonicalRecord(normalized)) {
    throw new TrackerProjectionNormalizationError(
      "projectedFields must normalize to a plain object",
    );
  }

  return normalized;
}

export function createTrackerProjectedSource(
  input: TrackerProjectionSourceInput,
): TrackerProjectedSource {
  const projectedFields = normalizeTrackerProjectionFields(input.projectedFields);
  const labels = extractTrackerLabels(projectedFields);
  const canonicalProjection = canonicalizeTrackerValue(projectedFields);
  const policyDecision = classifyTrackerLabels(labels);

  return {
    sourceSystem: input.sourceSystem,
    repository: input.repository,
    entityType: input.entityType,
    entityId: input.entityId,
    projectionVersion: input.projectionVersion,
    projectedFields,
    labels,
    policyDecision,
    canonicalProjection,
    sourceRevision: `fnv1a64:${fnv1a64(canonicalProjection)}`,
  };
}

export function createTrackerIdempotencyKey(
  identity: TrackerIdempotencyIdentity,
): string {
  return canonicalizeTrackerValue({
    entityId: identity.entityId,
    entityType: identity.entityType,
    projectionVersion: identity.projectionVersion,
    repository: identity.repository,
    sourceRevision: identity.sourceRevision,
    sourceSystem: identity.sourceSystem,
    targetSystem: identity.targetSystem,
  });
}

export function validateTrackerProjectionVersion(
  supportedVersions: readonly string[],
  actualVersion: string,
): TrackerSchemaCompatibilityResult {
  return supportedVersions.includes(actualVersion)
    ? { compatible: true }
    : {
        compatible: false,
        reason: `Projection version ${actualVersion} is not supported`,
      };
}

export function planTrackerMutation<
  TPlanningContext extends TrackerPlanningContext = TrackerPlanningContext,
>(
  source: TrackerProjectedSource,
  existingRecord?: TrackerProjectionRecord<TPlanningContext>,
): TrackerMutationPlan<TPlanningContext> {
  if (!existingRecord) {
    return {
      mutation: "create",
      safeToApply: true,
      fieldChanges: diffTrackerProjectionFields({}, source.projectedFields),
      sourceRevisionChanged: true,
      projectionVersionChanged: true,
      planningContext: null,
    };
  }

  const fieldChanges = diffTrackerProjectionFields(
    existingRecord.projectedFields,
    source.projectedFields,
  );
  const sourceRevisionChanged =
    existingRecord.sourceRevision !== source.sourceRevision;
  const projectionVersionChanged =
    existingRecord.projectionVersion !== source.projectionVersion;

  return {
    mutation:
      fieldChanges.length === 0 &&
      !sourceRevisionChanged &&
      !projectionVersionChanged
        ? "none"
        : "update",
    safeToApply: true,
    fieldChanges,
    sourceRevisionChanged,
    projectionVersionChanged,
    planningContext: existingRecord.planningContext,
  };
}

export function verifyTrackerReadback<
  TPlanningContext extends TrackerPlanningContext = TrackerPlanningContext,
>(args: {
  readonly source: TrackerProjectedSource;
  readonly targetSystem: string;
  readonly previousRecord: TrackerProjectionRecord<TPlanningContext> | undefined;
  readonly readbackRecord:
    | TrackerProjectionRecord<TPlanningContext>
    | undefined;
}): TrackerReadbackVerificationResult {
  const reasons: string[] = [];
  const { previousRecord, readbackRecord, source, targetSystem } = args;

  if (!readbackRecord) {
    reasons.push("Target readback did not return a record");
    return { verified: false, reasons };
  }

  if (readbackRecord.targetSystem !== targetSystem) {
    reasons.push("Readback target system did not match the adapter target");
  }
  if (readbackRecord.sourceSystem !== source.sourceSystem) {
    reasons.push("Readback source system did not match the source");
  }
  if (readbackRecord.repository !== source.repository) {
    reasons.push("Readback repository did not match the source");
  }
  if (readbackRecord.entityType !== source.entityType) {
    reasons.push("Readback entity type did not match the source");
  }
  if (readbackRecord.entityId !== source.entityId) {
    reasons.push("Readback entity id did not match the source");
  }
  if (readbackRecord.projectionVersion !== source.projectionVersion) {
    reasons.push("Readback projection version did not match the source");
  }
  if (readbackRecord.sourceRevision !== source.sourceRevision) {
    reasons.push("Readback source revision did not match the canonical source");
  }
  if (
    canonicalizeTrackerValue(readbackRecord.projectedFields) !==
    source.canonicalProjection
  ) {
    reasons.push("Readback projected fields did not match the canonical source");
  }
  if (
    previousRecord &&
    canonicalizeTrackerValue(readbackRecord.planningContext) !==
      canonicalizeTrackerValue(previousRecord.planningContext)
  ) {
    reasons.push("Readback planning context was unexpectedly overwritten");
  }

  return {
    verified: reasons.length === 0,
    reasons,
  };
}

export async function reconcileTrackerProjection<
  TPlanningContext extends TrackerPlanningContext = TrackerPlanningContext,
  TWriteReceipt = unknown,
>(
  request: TrackerReconciliationRequest<TPlanningContext, TWriteReceipt>,
): Promise<TrackerReconciliationResult<TPlanningContext>> {
  const source = createTrackerProjectedSource(request.source);
  const idempotencyKey = createTrackerIdempotencyKey({
    sourceSystem: source.sourceSystem,
    repository: source.repository,
    entityType: source.entityType,
    entityId: source.entityId,
    sourceRevision: source.sourceRevision,
    targetSystem: request.adapter.targetSystem,
    projectionVersion: source.projectionVersion,
  });

  const shouldClaimIdempotency = request.dryRun !== true;
  let idempotencyClaimed = false;

  const finalize = async (
    result: TrackerReconciliationResult<TPlanningContext>,
    shouldRecord = true,
  ) => {
    if (shouldClaimIdempotency && request.idempotencyStore && idempotencyClaimed) {
      if (shouldRecord && shouldPersistIdempotencyResult(result.status)) {
        await request.idempotencyStore.record(idempotencyKey, result);
      } else {
        await request.idempotencyStore.abandon(idempotencyKey);
        idempotencyClaimed = false;
      }
    }
    return result;
  };

  if (source.policyDecision.excludedFromProgramWork) {
    return finalize(
      {
        status: "excluded",
        trigger: request.trigger,
        idempotencyKey,
        source,
        mutationPlan: emptyTrackerMutationPlan<TPlanningContext>(null, false),
      },
      false,
    );
  }

  if (!hasTrackerSyncAuthority(request.authority)) {
    return finalize({
      status: "failed",
      trigger: request.trigger,
      idempotencyKey,
      source,
      mutationPlan: emptyTrackerMutationPlan<TPlanningContext>(null, false),
      incident: createTrackerIncident(
        request.incidentPolicy,
        "authority-denied",
        "Tracker reconciliation requires the tracker-sync authority role",
        idempotencyKey,
        source.sourceRevision,
      ),
    });
  }

  if (shouldClaimIdempotency && request.idempotencyStore) {
    const claim = await request.idempotencyStore.claim(idempotencyKey);
    if (claim.state !== "claimed") {
      if (claim.state === "completed" && claim.existingResult) {
        return claim.existingResult;
      }

      return {
        status: "duplicate",
        trigger: request.trigger,
        idempotencyKey,
        source,
        mutationPlan: emptyTrackerMutationPlan<TPlanningContext>(null, false),
      };
    }
    idempotencyClaimed = true;
  }

  try {
    const matchingRecords = [...(await request.adapter.read(source))];
    if (matchingRecords.length > 1) {
      return finalize({
        status: "failed",
        trigger: request.trigger,
        idempotencyKey,
        source,
        mutationPlan: emptyTrackerMutationPlan<TPlanningContext>(null, false),
        incident: createTrackerIncident(
          request.incidentPolicy,
          "duplicate-target-records",
          "Multiple target records matched the same source entity; auto-delete is forbidden",
          idempotencyKey,
          source.sourceRevision,
        ),
      });
    }

    const existingRecord = matchingRecords[0];
    const schemaCompatibility = await request.adapter.validateSchema(
      existingRecord,
      source.projectionVersion,
    );
    if (!schemaCompatibility.compatible) {
      return finalize({
        status: "failed",
        trigger: request.trigger,
        idempotencyKey,
        source,
        mutationPlan: emptyTrackerMutationPlan<TPlanningContext>(
          existingRecord?.planningContext ?? null,
          false,
        ),
        incident: createTrackerIncident(
          request.incidentPolicy,
          "schema-incompatible",
          schemaCompatibility.reason ??
            "The target projection schema was not compatible with the source",
          idempotencyKey,
          source.sourceRevision,
        ),
      });
    }

    const mutationPlan = planTrackerMutation(source, existingRecord);
    if (request.dryRun) {
      return finalize({
        status: "dry-run",
        trigger: request.trigger,
        idempotencyKey,
        source,
        mutationPlan,
        ...(existingRecord ? { verifiedRecord: existingRecord } : {}),
      });
    }

    if (mutationPlan.mutation === "none") {
      return finalize({
        status: "noop",
        trigger: request.trigger,
        idempotencyKey,
        source,
        mutationPlan,
        ...(existingRecord ? { verifiedRecord: existingRecord } : {}),
      });
    }

    const writeReceipt =
      mutationPlan.mutation === "create"
        ? await request.adapter.create(source, mutationPlan)
        : await request.adapter.update(existingRecord!, source, mutationPlan);
    const readbackRecord = await request.adapter.readback(writeReceipt, source);
    const verification = verifyTrackerReadback({
      source,
      targetSystem: request.adapter.targetSystem,
      previousRecord: existingRecord,
      readbackRecord,
    });

    if (!verification.verified) {
      return finalize({
        status: "failed",
        trigger: request.trigger,
        idempotencyKey,
        source,
        mutationPlan,
        incident: createTrackerIncident(
          request.incidentPolicy,
          "unverifiable-write",
          verification.reasons.join("; "),
          idempotencyKey,
          source.sourceRevision,
        ),
      });
    }

    return finalize({
      status: "applied",
      trigger: request.trigger,
      idempotencyKey,
      source,
      mutationPlan,
      ...(readbackRecord ? { verifiedRecord: readbackRecord } : {}),
    });
  } catch (error) {
    if (shouldClaimIdempotency && request.idempotencyStore) {
      await request.idempotencyStore.abandon(idempotencyKey);
    }

    return {
      status: "failed",
      trigger: request.trigger,
      idempotencyKey,
      source,
      mutationPlan: emptyTrackerMutationPlan<TPlanningContext>(null, false),
      incident: createTrackerIncident(
        request.incidentPolicy,
        "adapter-failure",
        error instanceof Error ? error.message : "Unknown adapter failure",
        idempotencyKey,
        source.sourceRevision,
      ),
    };
  }
}

function emptyTrackerMutationPlan<
  TPlanningContext extends TrackerPlanningContext = TrackerPlanningContext,
>(
  planningContext: TPlanningContext | null,
  safeToApply: boolean,
): TrackerMutationPlan<TPlanningContext> {
  return {
    mutation: "none",
    safeToApply,
    fieldChanges: [],
    sourceRevisionChanged: false,
    projectionVersionChanged: false,
    planningContext,
  };
}

function createTrackerIncident(
  policy: TrackerIncidentPolicy,
  code: TrackerReconciliationIncidentCode,
  message: string,
  idempotencyKey: string,
  sourceRevision: string,
): TrackerReconciliationIncident {
  return {
    code,
    severity: policy.severityOverrides?.[code] ?? defaultIncidentSeverity(code),
    owner: policy.owner,
    slaClass: policy.slaClass,
    escalationState: policy.escalationState ?? "new",
    message,
    idempotencyKey,
    sourceRevision,
  };
}

function defaultIncidentSeverity(
  code: TrackerReconciliationIncidentCode,
): TrackerIncidentSeverity {
  switch (code) {
    case "adapter-failure":
    case "authority-denied":
    case "schema-incompatible":
      return "high";
    case "duplicate-target-records":
    case "unverifiable-write":
      return "critical";
  }
}

function hasTrackerSyncAuthority(
  authority: TrackerAuthorityContext,
): boolean {
  return authority.roles.includes(TRACKER_SYNC_ROLE);
}

function diffTrackerProjectionFields(
  before: Readonly<Record<string, TrackerCanonicalValue>>,
  after: Readonly<Record<string, TrackerCanonicalValue>>,
): readonly TrackerProjectionFieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys
    .map((field) => ({
      field,
      before: before[field],
      after: after[field],
    }))
    .filter(
      ({ before: beforeValue, after: afterValue }) =>
        canonicalizeOptionalTrackerValue(beforeValue) !==
        canonicalizeOptionalTrackerValue(afterValue),
    );
}

function extractTrackerLabels(
  projectedFields: TrackerProjectionFields,
): readonly string[] {
  const labels = projectedFields.labels;
  if (!Array.isArray(labels)) {
    return [];
  }

  return labels
    .filter((label): label is string => typeof label === "string")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

function normalizeTrackerCanonicalValue(
  value: unknown,
  path: string,
): TrackerCanonicalValue {
  if (value === null) {
    return value;
  }

  switch (typeof value) {
    case "string":
      return value.normalize("NFC");
    case "number":
      if (!Number.isFinite(value)) {
        throw new TrackerProjectionNormalizationError(
          `${path} must not contain non-finite numbers`,
        );
      }
      return value;
    case "boolean":
      return value;
    case "undefined":
      throw new TrackerProjectionNormalizationError(
        `${path} must not contain undefined`,
      );
    case "object":
      if (Array.isArray(value)) {
        assertCanonicalArray(value, path);
        return value
          .map((entry, index) =>
            normalizeTrackerCanonicalValue(entry, `${path}[${index}]`),
          )
          .sort((left, right) =>
            canonicalizeTrackerValue(left).localeCompare(
              canonicalizeTrackerValue(right),
            ),
          );
      }
      if (!isPlainObject(value)) {
        throw new TrackerProjectionNormalizationError(
          `${path} must be a plain object`,
        );
      }
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [
            key,
            normalizeTrackerCanonicalValue(
              (value as Record<string, unknown>)[key],
              `${path}.${key}`,
            ),
          ]),
      );
    default:
      throw new TrackerProjectionNormalizationError(
        `${path} contains an unsupported value type`,
      );
  }
}

function assertCanonicalArray(value: readonly unknown[], path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) {
      throw new TrackerProjectionNormalizationError(
        `${path} must not contain sparse array holes`,
      );
    }
  }

  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") {
      continue;
    }
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
      throw new TrackerProjectionNormalizationError(
        `${path} must not contain non-index array properties`,
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || "get" in descriptor || "set" in descriptor) {
      throw new TrackerProjectionNormalizationError(
        `${path} must not contain accessor array entries`,
      );
    }
  }
}

function canonicalizeTrackerValue(value: TrackerCanonicalValue): string {
  return JSON.stringify(value);
}

function canonicalizeOptionalTrackerValue(
  value: TrackerCanonicalValue | undefined,
): string {
  return value === undefined ? "__undefined__" : canonicalizeTrackerValue(value);
}

function fnv1a64(value: string): string {
  let hash = FNV_OFFSET_BASIS_64;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & FNV_MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

function shouldPersistIdempotencyResult(
  status: TrackerReconciliationResult["status"],
): boolean {
  return status === "applied" || status === "noop";
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTrackerCanonicalRecord(
  value: TrackerCanonicalValue,
): value is TrackerProjectionFields {
  return !Array.isArray(value) && typeof value === "object" && value !== null;
}

import type { ExecutionUsage } from "@atlantis/contracts";
import {
  normalizeApprovalRequest,
  resolveApproval,
  type ApprovalRequest,
  type ApprovalResolution,
} from "@atlantis/contracts/approval-control";
import {
  normalizeExternalEffectIdentity,
  type ExternalEffectIdentity,
} from "@atlantis/contracts/external-effect";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export interface JsonArray extends ReadonlyArray<JsonValue> {}

export interface HarnessEvidenceRecord {
  readonly iteration: number;
  readonly phase: "inspect" | "plan" | "action" | "observe" | "evaluate" | "refine";
  readonly source: string;
  readonly detail: string;
  readonly recordedAt: string;
  readonly value?: JsonValue;
}

export interface HarnessEvidenceInput {
  readonly source: string;
  readonly detail: string;
  readonly value?: JsonValue;
}

export interface HarnessPlanAction {
  readonly actionId: string;
  readonly toolName: string;
  readonly input: JsonValue;
}

export interface HarnessPlan {
  readonly planId: string;
  readonly summary: string;
  readonly rationale: string;
  readonly desiredOutcome: string;
  readonly action: HarnessPlanAction;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface HarnessPlanRecord {
  readonly iteration: number;
  readonly selectedAt: string;
  readonly plan: HarnessPlan;
}

export interface ToolFailure {
  readonly kind: "deterministic" | "transient";
  readonly code: string;
  readonly message: string;
  readonly details?: JsonValue;
}

export interface ToolAttemptRecord {
  readonly attempt: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "succeeded" | "failed";
  readonly failure?: ToolFailure;
  readonly backoffMsAfter?: number;
}

export interface ActionAttemptRecord {
  readonly iteration: number;
  readonly actionId: string;
  readonly toolName: string;
  readonly capability: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly correlationId: string;
  readonly idempotency: ExternalEffectIdentity;
  readonly input: JsonValue;
  readonly outcome:
    | "succeeded"
    | "policy_denied"
    | "approval_denied"
    | "budget_exhausted"
    | "tool_failed";
  readonly attempts: readonly ToolAttemptRecord[];
  readonly output?: JsonValue;
  readonly failure?: ToolFailure;
}

export interface HarnessPolicyDecisionRecord {
  readonly iteration: number;
  readonly actionId: string;
  readonly toolName: string;
  readonly decidedAt: string;
  readonly allowed: boolean;
  readonly reason: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface HarnessApprovalDecisionRecord {
  readonly iteration: number;
  readonly actionId: string;
  readonly toolName: string;
  readonly outcome: "approved" | "rejected" | "required";
  readonly recordedAt: string;
  readonly request: ApprovalRequest;
  readonly resolution?: ApprovalResolution;
}

export interface HarnessEvaluationRecord {
  readonly iteration: number;
  readonly recordedAt: string;
  readonly score: number;
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly metrics: Readonly<Record<string, number>>;
  readonly summary?: JsonValue;
}

export interface HarnessStateChangeRecord {
  readonly iteration: number;
  readonly recordedAt: string;
  readonly before: JsonValue;
  readonly after: JsonValue;
  readonly summary?: JsonValue;
}

export type HarnessTerminalState =
  | "succeeded"
  | "evaluation_failed"
  | "policy_denied"
  | "approval_denied"
  | "tool_failed"
  | "budget_exhausted"
  | "no_progress";

export interface WorkDelta {
  readonly schemaVersion: 1;
  readonly executionId: string;
  readonly correlationId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly input: JsonValue;
  readonly startState: JsonValue;
  readonly selectedPlans: readonly HarnessPlanRecord[];
  readonly evidenceReads: readonly HarnessEvidenceRecord[];
  readonly attemptedActions: readonly ActionAttemptRecord[];
  readonly policyDecisions: readonly HarnessPolicyDecisionRecord[];
  readonly approvalDecisions: readonly HarnessApprovalDecisionRecord[];
  readonly evaluations: readonly HarnessEvaluationRecord[];
  readonly stateChanges: readonly HarnessStateChangeRecord[];
  readonly usage: ExecutionUsage;
  readonly terminalState: HarnessTerminalState;
  readonly finalState: JsonValue;
  readonly output?: JsonValue;
  readonly unresolvedItems: readonly string[];
}

export class InvalidHarnessDataError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidHarnessDataError";
  }
}

export function normalizeJsonValue(subject: string, value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InvalidHarnessDataError(`${subject} must contain only finite JSON numbers`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    const allowedKeys = new Set<PropertyKey>([
      "length",
      ...Array.from({ length: value.length }, (_unused, index) => String(index)),
    ]);
    if (ownKeys.some((key) => !allowedKeys.has(key))) {
      throw new InvalidHarnessDataError(`${subject} arrays must not contain extra properties`);
    }
    const normalized = value.map((entry, index) =>
      normalizeJsonValue(`${subject}[${index}]`, entry),
    );
    return Object.freeze(normalized) as JsonArray;
  }
  if (typeof value !== "object") {
    throw new InvalidHarnessDataError(`${subject} must contain only JSON-compatible data`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidHarnessDataError(`${subject} must be a plain JSON object`);
  }

  const entries = Reflect.ownKeys(value)
    .map((key) => {
      if (typeof key !== "string") {
        throw new InvalidHarnessDataError(`${subject} must not contain symbol keys`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        throw new InvalidHarnessDataError(
          `${subject}.${key} must be an enumerable data property`,
        );
      }
      return [key, descriptor.value] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right));

  const normalized: Record<string, JsonValue> = {};
  for (const [key, entry] of entries) {
    normalized[key] = normalizeJsonValue(`${subject}.${key}`, entry);
  }
  return Object.freeze(normalized) as JsonObject;
}

export function normalizeString(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidHarnessDataError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

export function normalizeTimestamp(field: string, value: unknown): string {
  const timestamp = normalizeString(field, value);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new InvalidHarnessDataError(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

export function normalizeStringRecord(
  subject: string,
  value: unknown,
): Readonly<Record<string, string>> {
  if (value === undefined) {
    return Object.freeze({});
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidHarnessDataError(`${subject} must be a string record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidHarnessDataError(`${subject} must be a plain string record`);
  }

  const normalized: Record<string, string> = {};
  for (const key of Reflect.ownKeys(value).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )) {
    if (typeof key !== "string") {
      throw new InvalidHarnessDataError(`${subject} must not contain symbol keys`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new InvalidHarnessDataError(`${subject}.${key} must be enumerable data`);
    }
    normalized[normalizeString(`${subject} key`, key)] = normalizeString(
      `${subject}.${key}`,
      descriptor.value,
    );
  }
  return Object.freeze(normalized);
}

export function normalizeUsage(subject: string, value: unknown): ExecutionUsage {
  const record = requireJsonObject(subject, value);
  const fields = [
    "toolCalls",
    "retries",
    "iterations",
    "inputTokens",
    "outputTokens",
    "durationMs",
    "costUsd",
  ] as const;

  const usage: Record<(typeof fields)[number], number> = {
    toolCalls: 0,
    retries: 0,
    iterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
  };
  for (const field of fields) {
    const candidate = record[field];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      throw new InvalidHarnessDataError(`${subject}.${field} must be a finite non-negative number`);
    }
    usage[field] = candidate;
  }
  return Object.freeze(usage) as ExecutionUsage;
}

export function normalizeEvidenceInput(
  iteration: number,
  phase: HarnessEvidenceRecord["phase"],
  recordedAt: string,
  input: HarnessEvidenceInput,
): HarnessEvidenceRecord {
  return Object.freeze({
    iteration: normalizePositiveInteger("evidence.iteration", iteration),
    phase,
    source: normalizeString("evidence.source", input.source),
    detail: normalizeString("evidence.detail", input.detail),
    recordedAt: normalizeTimestamp("evidence.recordedAt", recordedAt),
    ...(input.value === undefined
      ? {}
      : { value: normalizeJsonValue("evidence.value", input.value) }),
  });
}

export function normalizeToolFailure(subject: string, failure: ToolFailure): ToolFailure {
  const kind = failure.kind;
  if (kind !== "deterministic" && kind !== "transient") {
    throw new InvalidHarnessDataError(`${subject}.kind must be deterministic or transient`);
  }
  return Object.freeze({
    kind,
    code: normalizeString(`${subject}.code`, failure.code),
    message: normalizeString(`${subject}.message`, failure.message),
    ...(failure.details === undefined
      ? {}
      : { details: normalizeJsonValue(`${subject}.details`, failure.details) }),
  });
}

export function normalizeHarnessPlan(plan: HarnessPlan): HarnessPlan {
  return Object.freeze({
    planId: normalizeString("plan.planId", plan.planId),
    summary: normalizeString("plan.summary", plan.summary),
    rationale: normalizeString("plan.rationale", plan.rationale),
    desiredOutcome: normalizeString("plan.desiredOutcome", plan.desiredOutcome),
    action: Object.freeze({
      actionId: normalizeString("plan.action.actionId", plan.action.actionId),
      toolName: normalizeString("plan.action.toolName", plan.action.toolName),
      input: normalizeJsonValue("plan.action.input", plan.action.input),
    }),
    metadata: normalizeStringRecord("plan.metadata", plan.metadata),
  });
}

export function validateWorkDelta(value: unknown): WorkDelta {
  const record = requireJsonObject("workDelta", value);
  const schemaVersion = record.schemaVersion;
  if (schemaVersion !== 1) {
    throw new InvalidHarnessDataError("workDelta.schemaVersion must equal 1");
  }
  return Object.freeze({
    schemaVersion: 1,
    executionId: normalizeString("workDelta.executionId", record.executionId),
    correlationId: normalizeString("workDelta.correlationId", record.correlationId),
    startedAt: normalizeTimestamp("workDelta.startedAt", record.startedAt),
    completedAt: normalizeTimestamp("workDelta.completedAt", record.completedAt),
    input: normalizeJsonValue("workDelta.input", record.input),
    startState: normalizeJsonValue("workDelta.startState", record.startState),
    selectedPlans: normalizePlanRecords(record.selectedPlans),
    evidenceReads: normalizeEvidenceRecords(record.evidenceReads),
    attemptedActions: normalizeActionRecords(record.attemptedActions),
    policyDecisions: normalizePolicyRecords(record.policyDecisions),
    approvalDecisions: normalizeApprovalRecords(record.approvalDecisions),
    evaluations: normalizeEvaluationRecords(record.evaluations),
    stateChanges: normalizeStateChangeRecords(record.stateChanges),
    usage: normalizeUsage("workDelta.usage", record.usage),
    terminalState: normalizeTerminalState(record.terminalState),
    finalState: normalizeJsonValue("workDelta.finalState", record.finalState),
    ...(record.output === undefined
      ? {}
      : { output: normalizeJsonValue("workDelta.output", record.output) }),
    unresolvedItems: normalizeStringArray("workDelta.unresolvedItems", record.unresolvedItems),
  });
}

export function serializeWorkDelta(delta: WorkDelta): string {
  return stableStringify(validateWorkDelta(delta));
}

export function stableStringify(value: unknown): string {
  const normalized = normalizeJsonValue("stableStringify", value);
  return stableStringifyNormalized(normalized);
}

function stableStringifyNormalized(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringifyNormalized(entry)).join(",")}]`;
  }
  const objectValue = value as JsonObject;
  return `{${Object.keys(objectValue)
    .sort((left, right) => left.localeCompare(right))
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringifyNormalized(objectValue[key] as JsonValue)}`,
    )
    .join(",")}}`;
}

function normalizePositiveInteger(field: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new InvalidHarnessDataError(`${field} must be a positive safe integer`);
  }
  return value as number;
}

function normalizeStringArray(field: string, value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InvalidHarnessDataError(`${field} must be an array`);
  }
  return Object.freeze(value.map((entry, index) => normalizeString(`${field}[${index}]`, entry)));
}

function normalizePlanRecords(value: unknown): readonly HarnessPlanRecord[] {
  if (!Array.isArray(value)) {
    throw new InvalidHarnessDataError("workDelta.selectedPlans must be an array");
  }
  return Object.freeze(
    value.map((entry, index) => {
      const record = requireJsonObject(`workDelta.selectedPlans[${index}]`, entry);
      return Object.freeze({
        iteration: normalizePositiveInteger(
          `workDelta.selectedPlans[${index}].iteration`,
          record.iteration,
        ),
        selectedAt: normalizeTimestamp(
          `workDelta.selectedPlans[${index}].selectedAt`,
          record.selectedAt,
        ),
        plan: normalizeHarnessPlan(record.plan as unknown as HarnessPlan),
      });
    }),
  );
}

function normalizeEvidenceRecords(value: unknown): readonly HarnessEvidenceRecord[] {
  if (!Array.isArray(value)) {
    throw new InvalidHarnessDataError("workDelta.evidenceReads must be an array");
  }
  return Object.freeze(
    value.map((entry, index) => {
      const record = requireJsonObject(`workDelta.evidenceReads[${index}]`, entry);
      const phase = record.phase;
      if (
        phase !== "inspect" &&
        phase !== "plan" &&
        phase !== "action" &&
        phase !== "observe" &&
        phase !== "evaluate" &&
        phase !== "refine"
      ) {
        throw new InvalidHarnessDataError(`evidenceReads[${index}].phase is invalid`);
      }
      return Object.freeze({
        iteration: normalizePositiveInteger(`evidenceReads[${index}].iteration`, record.iteration),
        phase,
        source: normalizeString(`evidenceReads[${index}].source`, record.source),
        detail: normalizeString(`evidenceReads[${index}].detail`, record.detail),
        recordedAt: normalizeTimestamp(
          `evidenceReads[${index}].recordedAt`,
          record.recordedAt,
        ),
        ...(record.value === undefined
          ? {}
          : { value: normalizeJsonValue(`evidenceReads[${index}].value`, record.value) }),
      });
    }),
  );
}

function normalizeActionRecords(value: unknown): readonly ActionAttemptRecord[] {
  if (!Array.isArray(value)) {
    throw new InvalidHarnessDataError("workDelta.attemptedActions must be an array");
  }
  return Object.freeze(
    value.map((entry, index) => {
      const record = requireJsonObject(`workDelta.attemptedActions[${index}]`, entry);
      const outcome = record.outcome;
      if (
        outcome !== "succeeded" &&
        outcome !== "policy_denied" &&
        outcome !== "approval_denied" &&
        outcome !== "budget_exhausted" &&
        outcome !== "tool_failed"
      ) {
        throw new InvalidHarnessDataError(`attemptedActions[${index}].outcome is invalid`);
      }
      return Object.freeze({
        iteration: normalizePositiveInteger(`attemptedActions[${index}].iteration`, record.iteration),
        actionId: normalizeString(`attemptedActions[${index}].actionId`, record.actionId),
        toolName: normalizeString(`attemptedActions[${index}].toolName`, record.toolName),
        capability: normalizeString(`attemptedActions[${index}].capability`, record.capability),
        startedAt: normalizeTimestamp(`attemptedActions[${index}].startedAt`, record.startedAt),
        completedAt: normalizeTimestamp(
          `attemptedActions[${index}].completedAt`,
          record.completedAt,
        ),
        correlationId: normalizeString(
          `attemptedActions[${index}].correlationId`,
          record.correlationId,
        ),
        idempotency: normalizeExternalEffectIdentity(
          record.idempotency as unknown as ExternalEffectIdentity,
        ),
        input: normalizeJsonValue(`attemptedActions[${index}].input`, record.input),
        outcome,
        attempts: normalizeToolAttemptRecords(record.attempts, index),
        ...(record.output === undefined
          ? {}
          : { output: normalizeJsonValue(`attemptedActions[${index}].output`, record.output) }),
        ...(record.failure === undefined
          ? {}
          : {
              failure: normalizeToolFailure(
                `attemptedActions[${index}].failure`,
                record.failure as unknown as ToolFailure,
              ),
            }),
      });
    }),
  );
}

function normalizeToolAttemptRecords(
  value: unknown,
  parentIndex: number,
): readonly ToolAttemptRecord[] {
  if (!Array.isArray(value)) {
    throw new InvalidHarnessDataError("attempted action attempts must be an array");
  }
  return Object.freeze(
    value.map((entry, index) => {
      const record = requireJsonObject(`attemptedActions[${parentIndex}].attempts[${index}]`, entry);
      const status = record.status;
      if (status !== "succeeded" && status !== "failed") {
        throw new InvalidHarnessDataError(`attempt status ${String(status)} is invalid`);
      }
      const backoffMsAfter = record.backoffMsAfter;
      return Object.freeze({
        attempt: normalizePositiveInteger(
          `attemptedActions[${parentIndex}].attempts[${index}].attempt`,
          record.attempt,
        ),
        startedAt: normalizeTimestamp(
          `attemptedActions[${parentIndex}].attempts[${index}].startedAt`,
          record.startedAt,
        ),
        completedAt: normalizeTimestamp(
          `attemptedActions[${parentIndex}].attempts[${index}].completedAt`,
          record.completedAt,
        ),
        status,
        ...(record.failure === undefined
          ? {}
          : {
              failure: normalizeToolFailure(
                `attemptedActions[${parentIndex}].attempts[${index}].failure`,
                record.failure as unknown as ToolFailure,
              ),
            }),
        ...(backoffMsAfter === undefined
          ? {}
          : { backoffMsAfter: normalizeNonNegativeNumber("backoffMsAfter", backoffMsAfter) }),
      });
    }),
  );
}

function normalizePolicyRecords(value: unknown): readonly HarnessPolicyDecisionRecord[] {
  if (!Array.isArray(value)) {
    throw new InvalidHarnessDataError("workDelta.policyDecisions must be an array");
  }
  return Object.freeze(
    value.map((entry, index) => {
      const record = requireJsonObject(`workDelta.policyDecisions[${index}]`, entry);
      if (typeof record.allowed !== "boolean") {
        throw new InvalidHarnessDataError(`policyDecisions[${index}].allowed must be boolean`);
      }
      return Object.freeze({
        iteration: normalizePositiveInteger(`policyDecisions[${index}].iteration`, record.iteration),
        actionId: normalizeString(`policyDecisions[${index}].actionId`, record.actionId),
        toolName: normalizeString(`policyDecisions[${index}].toolName`, record.toolName),
        decidedAt: normalizeTimestamp(`policyDecisions[${index}].decidedAt`, record.decidedAt),
        allowed: record.allowed,
        reason: normalizeString(`policyDecisions[${index}].reason`, record.reason),
        metadata: normalizeStringRecord(`policyDecisions[${index}].metadata`, record.metadata),
      });
    }),
  );
}

function normalizeApprovalRecords(value: unknown): readonly HarnessApprovalDecisionRecord[] {
  if (!Array.isArray(value)) {
    throw new InvalidHarnessDataError("workDelta.approvalDecisions must be an array");
  }
  return Object.freeze(
    value.map((entry, index) => {
      const record = requireJsonObject(`workDelta.approvalDecisions[${index}]`, entry);
      const outcome = record.outcome;
      if (outcome !== "approved" && outcome !== "rejected" && outcome !== "required") {
        throw new InvalidHarnessDataError(`approvalDecisions[${index}].outcome is invalid`);
      }
      return Object.freeze({
        iteration: normalizePositiveInteger(
          `approvalDecisions[${index}].iteration`,
          record.iteration,
        ),
        actionId: normalizeString(`approvalDecisions[${index}].actionId`, record.actionId),
        toolName: normalizeString(`approvalDecisions[${index}].toolName`, record.toolName),
        outcome,
        recordedAt: normalizeTimestamp(
          `approvalDecisions[${index}].recordedAt`,
          record.recordedAt,
        ),
        request: normalizeApprovalRequest(record.request as unknown as ApprovalRequest),
        ...(record.resolution === undefined
          ? {}
          : {
              resolution: resolveApproval(
                record.request as unknown as ApprovalRequest,
                record.resolution as unknown as ApprovalResolution,
              ).resolution,
            }),
      });
    }),
  );
}

function normalizeEvaluationRecords(value: unknown): readonly HarnessEvaluationRecord[] {
  if (!Array.isArray(value)) {
    throw new InvalidHarnessDataError("workDelta.evaluations must be an array");
  }
  return Object.freeze(
    value.map((entry, index) => {
      const record = requireJsonObject(`workDelta.evaluations[${index}]`, entry);
      if (typeof record.passed !== "boolean") {
        throw new InvalidHarnessDataError(`evaluations[${index}].passed must be boolean`);
      }
      return Object.freeze({
        iteration: normalizePositiveInteger(`evaluations[${index}].iteration`, record.iteration),
        recordedAt: normalizeTimestamp(`evaluations[${index}].recordedAt`, record.recordedAt),
        score: normalizeNonNegativeNumber(`evaluations[${index}].score`, record.score),
        passed: record.passed,
        reasons: normalizeStringArray(`evaluations[${index}].reasons`, record.reasons),
        metrics: normalizeNumberRecord(`evaluations[${index}].metrics`, record.metrics),
        ...(record.summary === undefined
          ? {}
          : { summary: normalizeJsonValue(`evaluations[${index}].summary`, record.summary) }),
      });
    }),
  );
}

function normalizeStateChangeRecords(value: unknown): readonly HarnessStateChangeRecord[] {
  if (!Array.isArray(value)) {
    throw new InvalidHarnessDataError("workDelta.stateChanges must be an array");
  }
  return Object.freeze(
    value.map((entry, index) => {
      const record = requireJsonObject(`workDelta.stateChanges[${index}]`, entry);
      return Object.freeze({
        iteration: normalizePositiveInteger(`stateChanges[${index}].iteration`, record.iteration),
        recordedAt: normalizeTimestamp(`stateChanges[${index}].recordedAt`, record.recordedAt),
        before: normalizeJsonValue(`stateChanges[${index}].before`, record.before),
        after: normalizeJsonValue(`stateChanges[${index}].after`, record.after),
        ...(record.summary === undefined
          ? {}
          : { summary: normalizeJsonValue(`stateChanges[${index}].summary`, record.summary) }),
      });
    }),
  );
}

function normalizeNumberRecord(
  field: string,
  value: unknown,
): Readonly<Record<string, number>> {
  const record = requireJsonObject(field, value);
  const normalized: Record<string, number> = {};
  for (const key of Reflect.ownKeys(record).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )) {
    if (typeof key !== "string") {
      throw new InvalidHarnessDataError(`${field} must not contain symbol keys`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new InvalidHarnessDataError(`${field}.${key} must be enumerable data`);
    }
    normalized[normalizeString(`${field} key`, key)] = normalizeNonNegativeNumber(
      `${field}.${key}`,
      descriptor.value,
    );
  }
  return Object.freeze(normalized);
}

function normalizeNonNegativeNumber(field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new InvalidHarnessDataError(`${field} must be a finite non-negative number`);
  }
  return value;
}

function normalizeTerminalState(value: unknown): HarnessTerminalState {
  if (
    value !== "succeeded" &&
    value !== "evaluation_failed" &&
    value !== "policy_denied" &&
    value !== "approval_denied" &&
    value !== "tool_failed" &&
    value !== "budget_exhausted" &&
    value !== "no_progress"
  ) {
    throw new InvalidHarnessDataError("workDelta.terminalState is invalid");
  }
  return value;
}

function requireJsonObject(subject: string, value: unknown): JsonObject {
  const normalized = normalizeJsonValue(subject, value);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    throw new InvalidHarnessDataError(`${subject} must be a JSON object`);
  }
  return normalized as JsonObject;
}

import { createHash } from "node:crypto";

export const TRACKER_PROJECTION_VERSION = Object.freeze({
  major: 1,
  minor: 0,
} as const);

export const TRACKER_PROJECTION_COMPATIBILITY = Object.freeze({
  supportedMajor: TRACKER_PROJECTION_VERSION.major,
  minimumMinor: TRACKER_PROJECTION_VERSION.minor,
  maximumMinor: TRACKER_PROJECTION_VERSION.minor,
} as const);

export type TrackerProjectionEntityType = "issue" | "pull_request";
export type TrackerIssueState = "open" | "closed";
export type TrackerPullRequestState = "open" | "closed" | "merged";
export type TrackerCheckStatus = "queued" | "in_progress" | "completed";
export type TrackerCheckConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "neutral";
export type TrackerFileChangeType = "added" | "modified" | "removed" | "renamed";

export interface TrackerProjectionVersion {
  readonly major: number;
  readonly minor: number;
}

export interface TrackerIssueLinkedPullRequest {
  readonly pullRequestNumber: number;
  readonly state: TrackerPullRequestState;
  readonly title: string;
}

export interface TrackerPullRequestLinkedIssue {
  readonly issueNumber: number;
  readonly state: TrackerIssueState;
  readonly title: string;
}

export interface TrackerPullRequestCheck {
  readonly context: string;
  readonly status: TrackerCheckStatus;
  readonly conclusion: TrackerCheckConclusion | null;
}

export interface TrackerPullRequestChangedFile {
  readonly path: string;
  readonly changeType: TrackerFileChangeType;
  readonly additions: number;
  readonly deletions: number;
}

export interface TrackerPullRequestCommitSummary {
  readonly sha: string;
  readonly title: string;
}

export interface TrackerIssueProjectionInput {
  readonly repository: string;
  readonly issueNumber: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: TrackerIssueState;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly linkedPullRequests: readonly TrackerIssueLinkedPullRequest[];
}

export interface TrackerPullRequestProjectionInput {
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: TrackerPullRequestState;
  readonly draft: boolean;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly linkedIssues: readonly TrackerPullRequestLinkedIssue[];
  readonly checks: readonly TrackerPullRequestCheck[];
  readonly changedFiles: readonly TrackerPullRequestChangedFile[];
  readonly commits: readonly TrackerPullRequestCommitSummary[];
}

export interface TrackerIssueProjection {
  readonly projectionVersion: TrackerProjectionVersion;
  readonly entityType: "issue";
  readonly repository: string;
  readonly entityId: number;
  readonly sourceRevision: string;
  readonly semanticFields: Readonly<{
    title: string;
    body: string | null;
    state: TrackerIssueState;
    labels: readonly string[];
    assignees: readonly string[];
    linkedPullRequests: readonly TrackerIssueLinkedPullRequest[];
  }>;
}

export interface TrackerPullRequestProjection {
  readonly projectionVersion: TrackerProjectionVersion;
  readonly entityType: "pull_request";
  readonly repository: string;
  readonly entityId: number;
  readonly sourceRevision: string;
  readonly semanticFields: Readonly<{
    title: string;
    body: string | null;
    state: TrackerPullRequestState;
    draft: boolean;
    labels: readonly string[];
    assignees: readonly string[];
    linkedIssues: readonly TrackerPullRequestLinkedIssue[];
    checks: readonly TrackerPullRequestCheck[];
    changedFiles: readonly TrackerPullRequestChangedFile[];
    commits: readonly TrackerPullRequestCommitSummary[];
  }>;
}

export type TrackerProjection = TrackerIssueProjection | TrackerPullRequestProjection;

export type TrackerProjectionCompatibility =
  | Readonly<{
      status: "supported";
      version: TrackerProjectionVersion;
      supportedMajor: number;
      minimumMinor: number;
      maximumMinor: number;
    }>
  | Readonly<{
      status: "unsupported-major";
      version: TrackerProjectionVersion;
      supportedMajor: number;
      minimumMinor: number;
      maximumMinor: number;
      reason: string;
    }>
  | Readonly<{
      status: "malformed";
      reason: string;
    }>;

export class InvalidTrackerProjectionError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidTrackerProjectionError";
  }
}

export class UnsupportedTrackerProjectionVersionError extends Error {
  public constructor(
    public readonly version: TrackerProjectionVersion,
    message: string,
  ) {
    super(message);
    this.name = "UnsupportedTrackerProjectionVersionError";
  }
}

const issueInputFields = [
  "repository",
  "issueNumber",
  "title",
  "body",
  "state",
  "labels",
  "assignees",
  "linkedPullRequests",
] as const;

const pullRequestInputFields = [
  "repository",
  "pullRequestNumber",
  "title",
  "body",
  "state",
  "draft",
  "labels",
  "assignees",
  "linkedIssues",
  "checks",
  "changedFiles",
  "commits",
] as const;

const issueProjectionFields = [
  "projectionVersion",
  "entityType",
  "repository",
  "entityId",
  "sourceRevision",
  "semanticFields",
] as const;

const issueSemanticFields = [
  "title",
  "body",
  "state",
  "labels",
  "assignees",
  "linkedPullRequests",
] as const;

const pullRequestSemanticFields = [
  "title",
  "body",
  "state",
  "draft",
  "labels",
  "assignees",
  "linkedIssues",
  "checks",
  "changedFiles",
  "commits",
] as const;

const issueLinkedPullRequestFields = ["pullRequestNumber", "state", "title"] as const;
const pullRequestLinkedIssueFields = ["issueNumber", "state", "title"] as const;
const pullRequestCheckFields = ["context", "status", "conclusion"] as const;
const pullRequestChangedFileFields = [
  "path",
  "changeType",
  "additions",
  "deletions",
] as const;
const pullRequestCommitFields = ["sha", "title"] as const;
const projectionVersionFields = ["major", "minor"] as const;

export function createTrackerIssueProjection(
  input: unknown,
): TrackerIssueProjection {
  const normalized = normalizeTrackerIssueProjectionInput(input);
  const semanticFields = Object.freeze({
    title: normalized.title,
    body: normalized.body,
    state: normalized.state,
    labels: normalized.labels,
    assignees: normalized.assignees,
    linkedPullRequests: normalized.linkedPullRequests,
  });
  const projectionCore = Object.freeze({
    projectionVersion: TRACKER_PROJECTION_VERSION,
    entityType: "issue" as const,
    repository: normalized.repository,
    entityId: normalized.issueNumber,
    semanticFields,
  });

  return Object.freeze({
    ...projectionCore,
    sourceRevision: hashCanonicalProjection(projectionCore),
  });
}

export function createTrackerPullRequestProjection(
  input: unknown,
): TrackerPullRequestProjection {
  const normalized = normalizeTrackerPullRequestProjectionInput(input);
  const semanticFields = Object.freeze({
    title: normalized.title,
    body: normalized.body,
    state: normalized.state,
    draft: normalized.draft,
    labels: normalized.labels,
    assignees: normalized.assignees,
    linkedIssues: normalized.linkedIssues,
    checks: normalized.checks,
    changedFiles: normalized.changedFiles,
    commits: normalized.commits,
  });
  const projectionCore = Object.freeze({
    projectionVersion: TRACKER_PROJECTION_VERSION,
    entityType: "pull_request" as const,
    repository: normalized.repository,
    entityId: normalized.pullRequestNumber,
    semanticFields,
  });

  return Object.freeze({
    ...projectionCore,
    sourceRevision: hashCanonicalProjection(projectionCore),
  });
}

export function normalizeTrackerIssueProjectionInput(
  input: unknown,
): Readonly<TrackerIssueProjectionInput> {
  const record = plainRecord("tracker issue projection input", input);
  requirePresentFields("tracker issue projection input", record, issueInputFields);

  return Object.freeze({
    repository: nonBlankText("repository", ownDataValue(record, "repository")),
    issueNumber: positiveSafeInteger("issueNumber", ownDataValue(record, "issueNumber")),
    title: nonBlankText("title", ownDataValue(record, "title")),
    body: optionalText("body", ownDataValue(record, "body")),
    state: issueState("state", ownDataValue(record, "state")),
    labels: stringSet("labels", ownDataValue(record, "labels")),
    assignees: stringSet("assignees", ownDataValue(record, "assignees")),
    linkedPullRequests: objectSet(
      "linkedPullRequests",
      ownDataValue(record, "linkedPullRequests"),
      issueLinkedPullRequest,
      (value) => value.pullRequestNumber,
    ),
  });
}

export function normalizeTrackerPullRequestProjectionInput(
  input: unknown,
): Readonly<TrackerPullRequestProjectionInput> {
  const record = plainRecord("tracker pull request projection input", input);
  requirePresentFields(
    "tracker pull request projection input",
    record,
    pullRequestInputFields,
  );

  return Object.freeze({
    repository: nonBlankText("repository", ownDataValue(record, "repository")),
    pullRequestNumber: positiveSafeInteger(
      "pullRequestNumber",
      ownDataValue(record, "pullRequestNumber"),
    ),
    title: nonBlankText("title", ownDataValue(record, "title")),
    body: optionalText("body", ownDataValue(record, "body")),
    state: pullRequestState("state", ownDataValue(record, "state")),
    draft: booleanField("draft", ownDataValue(record, "draft")),
    labels: stringSet("labels", ownDataValue(record, "labels")),
    assignees: stringSet("assignees", ownDataValue(record, "assignees")),
    linkedIssues: objectSet(
      "linkedIssues",
      ownDataValue(record, "linkedIssues"),
      pullRequestLinkedIssue,
      (value) => value.issueNumber,
    ),
    checks: objectSet(
      "checks",
      ownDataValue(record, "checks"),
      pullRequestCheck,
      (value) => value.context,
    ),
    changedFiles: objectSet(
      "changedFiles",
      ownDataValue(record, "changedFiles"),
      pullRequestChangedFile,
      (value) => value.path,
    ),
    commits: objectSet(
      "commits",
      ownDataValue(record, "commits"),
      pullRequestCommit,
      (value) => value.sha,
    ),
  });
}

export function assessTrackerProjectionCompatibility(
  projection: unknown,
): TrackerProjectionCompatibility {
  try {
    const record = plainRecord("tracker projection", projection);
    requirePresentFields("tracker projection", record, issueProjectionFields);
    const version = normalizeProjectionVersion(
      ownDataValue(record, "projectionVersion"),
      "tracker projection.projectionVersion",
    );

    if (version.major !== TRACKER_PROJECTION_COMPATIBILITY.supportedMajor) {
      return Object.freeze({
        status: "unsupported-major" as const,
        version,
        supportedMajor: TRACKER_PROJECTION_COMPATIBILITY.supportedMajor,
        minimumMinor: TRACKER_PROJECTION_COMPATIBILITY.minimumMinor,
        maximumMinor: TRACKER_PROJECTION_COMPATIBILITY.maximumMinor,
        reason: `tracker projection major version ${version.major} is unsupported`,
      });
    }

    if (
      version.minor < TRACKER_PROJECTION_COMPATIBILITY.minimumMinor ||
      version.minor > TRACKER_PROJECTION_COMPATIBILITY.maximumMinor
    ) {
      return Object.freeze({
        status: "malformed" as const,
        reason: `tracker projection minor version ${version.minor} is outside supported range ${TRACKER_PROJECTION_COMPATIBILITY.minimumMinor}-${TRACKER_PROJECTION_COMPATIBILITY.maximumMinor}`,
      });
    }

    return Object.freeze({
      status: "supported" as const,
      version,
      supportedMajor: TRACKER_PROJECTION_COMPATIBILITY.supportedMajor,
      minimumMinor: TRACKER_PROJECTION_COMPATIBILITY.minimumMinor,
      maximumMinor: TRACKER_PROJECTION_COMPATIBILITY.maximumMinor,
    });
  } catch (error) {
    return Object.freeze({
      status: "malformed" as const,
      reason: error instanceof Error ? error.message : "tracker projection is malformed",
    });
  }
}

export function assertSupportedTrackerProjection(
  projection: unknown,
): TrackerProjection {
  const compatibility = assessTrackerProjectionCompatibility(projection);
  if (compatibility.status === "unsupported-major") {
    throw new UnsupportedTrackerProjectionVersionError(
      compatibility.version,
      compatibility.reason,
    );
  }
  if (compatibility.status === "malformed") {
    throw new InvalidTrackerProjectionError(compatibility.reason);
  }

  const record = plainRecord("tracker projection", projection);
  const entityType = trackerEntityType("entityType", ownDataValue(record, "entityType"));
  const repository = nonBlankText("repository", ownDataValue(record, "repository"));
  const entityId = positiveSafeInteger("entityId", ownDataValue(record, "entityId"));
  const sourceRevision = sha256Digest(
    "sourceRevision",
    ownDataValue(record, "sourceRevision"),
  );
  const semanticRecord = plainRecord(
    "tracker projection.semanticFields",
    ownDataValue(record, "semanticFields"),
  );

  if (entityType === "issue") {
    requirePresentFields(
      "tracker projection.semanticFields",
      semanticRecord,
      issueSemanticFields,
    );
    const normalized: TrackerIssueProjection = Object.freeze({
      projectionVersion: compatibility.version,
      entityType,
      repository,
      entityId,
      sourceRevision,
      semanticFields: Object.freeze({
        title: nonBlankText("semanticFields.title", ownDataValue(semanticRecord, "title")),
        body: optionalText("semanticFields.body", ownDataValue(semanticRecord, "body")),
        state: issueState("semanticFields.state", ownDataValue(semanticRecord, "state")),
        labels: stringSet("semanticFields.labels", ownDataValue(semanticRecord, "labels")),
        assignees: stringSet(
          "semanticFields.assignees",
          ownDataValue(semanticRecord, "assignees"),
        ),
        linkedPullRequests: objectSet(
          "semanticFields.linkedPullRequests",
          ownDataValue(semanticRecord, "linkedPullRequests"),
          issueLinkedPullRequest,
          (value) => value.pullRequestNumber,
        ),
      }),
    });

    const expectedSourceRevision = hashCanonicalProjection({
      projectionVersion: normalized.projectionVersion,
      entityType: normalized.entityType,
      repository: normalized.repository,
      entityId: normalized.entityId,
      semanticFields: normalized.semanticFields,
    });
    if (normalized.sourceRevision !== expectedSourceRevision) {
      throw new InvalidTrackerProjectionError(
        "tracker projection sourceRevision does not match canonical semantic fields",
      );
    }
    return normalized;
  }

  requirePresentFields(
    "tracker projection.semanticFields",
    semanticRecord,
    pullRequestSemanticFields,
  );
  const normalized: TrackerPullRequestProjection = Object.freeze({
    projectionVersion: compatibility.version,
    entityType,
    repository,
    entityId,
    sourceRevision,
    semanticFields: Object.freeze({
      title: nonBlankText("semanticFields.title", ownDataValue(semanticRecord, "title")),
      body: optionalText("semanticFields.body", ownDataValue(semanticRecord, "body")),
      state: pullRequestState("semanticFields.state", ownDataValue(semanticRecord, "state")),
      draft: booleanField("semanticFields.draft", ownDataValue(semanticRecord, "draft")),
      labels: stringSet("semanticFields.labels", ownDataValue(semanticRecord, "labels")),
      assignees: stringSet(
        "semanticFields.assignees",
        ownDataValue(semanticRecord, "assignees"),
      ),
      linkedIssues: objectSet(
        "semanticFields.linkedIssues",
        ownDataValue(semanticRecord, "linkedIssues"),
        pullRequestLinkedIssue,
        (value) => value.issueNumber,
      ),
      checks: objectSet(
        "semanticFields.checks",
        ownDataValue(semanticRecord, "checks"),
        pullRequestCheck,
        (value) => value.context,
      ),
      changedFiles: objectSet(
        "semanticFields.changedFiles",
        ownDataValue(semanticRecord, "changedFiles"),
        pullRequestChangedFile,
        (value) => value.path,
      ),
      commits: objectSet(
        "semanticFields.commits",
        ownDataValue(semanticRecord, "commits"),
        pullRequestCommit,
        (value) => value.sha,
      ),
    }),
  });

  const expectedSourceRevision = hashCanonicalProjection({
    projectionVersion: normalized.projectionVersion,
    entityType: normalized.entityType,
    repository: normalized.repository,
    entityId: normalized.entityId,
    semanticFields: normalized.semanticFields,
  });
  if (normalized.sourceRevision !== expectedSourceRevision) {
    throw new InvalidTrackerProjectionError(
      "tracker projection sourceRevision does not match canonical semantic fields",
    );
  }
  return normalized;
}

export function canonicalizeTrackerProjectionValue(value: unknown): string {
  return renderCanonicalJson(value, new Set<object>());
}

function issueLinkedPullRequest(value: unknown): Readonly<TrackerIssueLinkedPullRequest> {
  const record = plainRecord("linkedPullRequest", value);
  requirePresentFields("linkedPullRequest", record, issueLinkedPullRequestFields);
  return Object.freeze({
    pullRequestNumber: positiveSafeInteger(
      "linkedPullRequest.pullRequestNumber",
      ownDataValue(record, "pullRequestNumber"),
    ),
    state: pullRequestState("linkedPullRequest.state", ownDataValue(record, "state")),
    title: nonBlankText("linkedPullRequest.title", ownDataValue(record, "title")),
  });
}

function pullRequestLinkedIssue(value: unknown): Readonly<TrackerPullRequestLinkedIssue> {
  const record = plainRecord("linkedIssue", value);
  requirePresentFields("linkedIssue", record, pullRequestLinkedIssueFields);
  return Object.freeze({
    issueNumber: positiveSafeInteger(
      "linkedIssue.issueNumber",
      ownDataValue(record, "issueNumber"),
    ),
    state: issueState("linkedIssue.state", ownDataValue(record, "state")),
    title: nonBlankText("linkedIssue.title", ownDataValue(record, "title")),
  });
}

function pullRequestCheck(value: unknown): Readonly<TrackerPullRequestCheck> {
  const record = plainRecord("check", value);
  requirePresentFields("check", record, pullRequestCheckFields);
  return Object.freeze({
    context: nonBlankText("check.context", ownDataValue(record, "context")),
    status: checkStatus("check.status", ownDataValue(record, "status")),
    conclusion: checkConclusion("check.conclusion", ownDataValue(record, "conclusion")),
  });
}

function pullRequestChangedFile(
  value: unknown,
): Readonly<TrackerPullRequestChangedFile> {
  const record = plainRecord("changedFile", value);
  requirePresentFields("changedFile", record, pullRequestChangedFileFields);
  return Object.freeze({
    path: nonBlankText("changedFile.path", ownDataValue(record, "path")),
    changeType: fileChangeType(
      "changedFile.changeType",
      ownDataValue(record, "changeType"),
    ),
    additions: nonNegativeSafeInteger(
      "changedFile.additions",
      ownDataValue(record, "additions"),
    ),
    deletions: nonNegativeSafeInteger(
      "changedFile.deletions",
      ownDataValue(record, "deletions"),
    ),
  });
}

function pullRequestCommit(
  value: unknown,
): Readonly<TrackerPullRequestCommitSummary> {
  const record = plainRecord("commit", value);
  requirePresentFields("commit", record, pullRequestCommitFields);
  return Object.freeze({
    sha: gitSha("commit.sha", ownDataValue(record, "sha")),
    title: nonBlankText("commit.title", ownDataValue(record, "title")),
  });
}

function plainRecord(
  subject: string,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidTrackerProjectionError(`${subject} must be a plain data record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidTrackerProjectionError(`${subject} must be a plain data record`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new InvalidTrackerProjectionError(
        `${subject} must not contain symbol fields`,
      );
    }
  }
  return value as Readonly<Record<string, unknown>>;
}

function ownDataValue(
  record: Readonly<Record<string, unknown>>,
  field: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  if (descriptor === undefined) {
    return undefined;
  }
  if (descriptor.enumerable !== true || !("value" in descriptor)) {
    throw new InvalidTrackerProjectionError(
      `${field} must be an enumerable data property`,
    );
  }
  return descriptor.value;
}

function requirePresentFields(
  subject: string,
  record: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new InvalidTrackerProjectionError(`${subject} is missing required field ${field}`);
    }
  }
}

function nonBlankText(field: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidTrackerProjectionError(`${field} must be a non-blank string`);
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.length === 0) {
    throw new InvalidTrackerProjectionError(`${field} must be a non-blank string`);
  }
  return normalized;
}

function optionalText(field: string, value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new InvalidTrackerProjectionError(`${field} must be a string or null`);
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  return normalized.length === 0 ? null : normalized;
}

function positiveSafeInteger(field: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new InvalidTrackerProjectionError(`${field} must be a positive safe integer`);
  }
  return value as number;
}

function nonNegativeSafeInteger(field: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InvalidTrackerProjectionError(
      `${field} must be a non-negative safe integer`,
    );
  }
  return value as number;
}

function booleanField(field: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidTrackerProjectionError(`${field} must be a boolean`);
  }
  return value;
}

function issueState(field: string, value: unknown): TrackerIssueState {
  if (value !== "open" && value !== "closed") {
    throw new InvalidTrackerProjectionError(`${field} must be open or closed`);
  }
  return value;
}

function pullRequestState(field: string, value: unknown): TrackerPullRequestState {
  if (value !== "open" && value !== "closed" && value !== "merged") {
    throw new InvalidTrackerProjectionError(`${field} must be open, closed, or merged`);
  }
  return value;
}

function trackerEntityType(
  field: string,
  value: unknown,
): TrackerProjectionEntityType {
  if (value !== "issue" && value !== "pull_request") {
    throw new InvalidTrackerProjectionError(`${field} must be issue or pull_request`);
  }
  return value;
}

function checkStatus(field: string, value: unknown): TrackerCheckStatus {
  if (value !== "queued" && value !== "in_progress" && value !== "completed") {
    throw new InvalidTrackerProjectionError(
      `${field} must be queued, in_progress, or completed`,
    );
  }
  return value;
}

function checkConclusion(
  field: string,
  value: unknown,
): TrackerCheckConclusion | null {
  if (value === null) {
    return null;
  }
  if (
    value !== "success" &&
    value !== "failure" &&
    value !== "cancelled" &&
    value !== "skipped" &&
    value !== "timed_out" &&
    value !== "action_required" &&
    value !== "neutral"
  ) {
    throw new InvalidTrackerProjectionError(
      `${field} must be null, success, failure, cancelled, skipped, timed_out, action_required, or neutral`,
    );
  }
  return value;
}

function fileChangeType(field: string, value: unknown): TrackerFileChangeType {
  if (
    value !== "added" &&
    value !== "modified" &&
    value !== "removed" &&
    value !== "renamed"
  ) {
    throw new InvalidTrackerProjectionError(
      `${field} must be added, modified, removed, or renamed`,
    );
  }
  return value;
}

function stringSet(field: string, value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InvalidTrackerProjectionError(`${field} must be an array`);
  }
  const normalized = value.map((entry, index) =>
    nonBlankText(`${field}[${index}]`, entry),
  );
  return freezeSortedUnique(
    field,
    normalized,
    (left, right) => left.localeCompare(right),
    (entry) => entry,
  );
}

function objectSet<T>(
  field: string,
  value: unknown,
  normalize: (entry: unknown) => Readonly<T>,
  identity: (entry: Readonly<T>) => string | number,
): readonly Readonly<T>[] {
  if (!Array.isArray(value)) {
    throw new InvalidTrackerProjectionError(`${field} must be an array`);
  }
  const normalized = value.map((entry) => normalize(entry));
  return freezeSortedUnique(
    field,
    normalized,
    (left, right) => canonicalizeTrackerProjectionValue(left).localeCompare(canonicalizeTrackerProjectionValue(right)),
    identity,
  );
}

function freezeSortedUnique<T>(
  field: string,
  values: readonly T[],
  compare: (left: T, right: T) => number,
  identity: (entry: T) => string | number,
): readonly T[] {
  const sorted = [...values].sort(compare);
  for (let index = 1; index < sorted.length; index += 1) {
    if (identity(sorted[index - 1]) === identity(sorted[index])) {
      throw new InvalidTrackerProjectionError(
        `${field} must not contain duplicate semantic entries for ${String(identity(sorted[index]))}`,
      );
    }
  }
  return Object.freeze(sorted);
}

function normalizeProjectionVersion(
  value: unknown,
  field: string,
): TrackerProjectionVersion {
  const record = plainRecord(field, value);
  requirePresentFields(field, record, projectionVersionFields);
  const major = positiveSafeInteger(`${field}.major`, ownDataValue(record, "major"));
  const minor = nonNegativeSafeInteger(`${field}.minor`, ownDataValue(record, "minor"));
  return Object.freeze({ major, minor });
}

function sha256Digest(field: string, value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new InvalidTrackerProjectionError(
      `${field} must be a lowercase SHA-256 hex digest`,
    );
  }
  return value;
}

function gitSha(field: string, value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value.trim())) {
    throw new InvalidTrackerProjectionError(
      `${field} must be a canonical lowercase 40-character Git SHA`,
    );
  }
  return value.trim();
}

function hashCanonicalProjection(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeTrackerProjectionValue(value))
    .digest("hex");
}

function renderCanonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new InvalidTrackerProjectionError(
        "canonical tracker projection values must use finite JSON-safe numbers",
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
    throw new InvalidTrackerProjectionError(
      `unsupported canonical tracker projection value type: ${typeof value}`,
    );
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new InvalidTrackerProjectionError(
        "canonical tracker projection values must not contain cycles",
      );
    }
    ancestors.add(value);
    try {
      return `[${value.map((entry) => renderCanonicalJson(entry, ancestors)).join(",")}]`;
    } finally {
      ancestors.delete(value);
    }
  }

  const record = plainRecord("canonical tracker projection value", value);
  if (ancestors.has(record as object)) {
    throw new InvalidTrackerProjectionError(
      "canonical tracker projection values must not contain cycles",
    );
  }
  ancestors.add(record as object);
  try {
    const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
    const entries = keys.map((key) => {
      const entryValue = ownDataValue(record, key);
      if (entryValue === undefined) {
        throw new InvalidTrackerProjectionError(
          `canonical tracker projection value ${key} must not be undefined`,
        );
      }
      return `${JSON.stringify(key)}:${renderCanonicalJson(entryValue, ancestors)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(record as object);
  }
}

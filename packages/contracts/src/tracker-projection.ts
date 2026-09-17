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

    normalizeSupportedTrackerProjectionRecord(record, version);

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

  return normalizeSupportedTrackerProjectionRecord(
    plainRecord("tracker projection", projection),
    compatibility.version,
  );
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
  const normalized = normalizeProjectionText(value);
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
  const normalized = normalizeProjectionText(value);
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
  const normalized = ownArrayEntries(field, value).map((entry, index) =>
    nonBlankText(`${field}[${index}]`, entry),
  );
  return freezeSortedUnique(
    field,
    normalized,
    compareCanonicalStrings,
    (entry) => entry,
  );
}

function objectSet<T>(
  field: string,
  value: unknown,
  normalize: (entry: unknown) => Readonly<T>,
  identity: (entry: Readonly<T>) => string | number,
): readonly Readonly<T>[] {
  const normalized = ownArrayEntries(field, value).map((entry) => normalize(entry));
  return freezeSortedUnique(
    field,
    normalized,
    (left, right) =>
      compareCanonicalStrings(
        canonicalizeTrackerProjectionValue(left),
        canonicalizeTrackerProjectionValue(right),
      ),
    identity,
  );
}

function freezeSortedUnique<T>(
  field: string,
  values: readonly T[],
  compare: (left: T, right: T) => number,
  identity: (entry: T) => string | number,
): readonly T[] {
  const seenIdentities = new Set<string>();
  for (const entry of values) {
    const duplicateKey = identityKey(identity(entry));
    if (seenIdentities.has(duplicateKey)) {
      throw new InvalidTrackerProjectionError(
        `${field} must not contain duplicate semantic entries for ${String(identity(entry))}`,
      );
    }
    seenIdentities.add(duplicateKey);
  }
  return Object.freeze([...values].sort(compare));
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
  return sha256Hex(canonicalizeTrackerProjectionValue(value));
}

function normalizeSupportedTrackerProjectionRecord(
  record: Readonly<Record<string, unknown>>,
  version: TrackerProjectionVersion,
): TrackerProjection {
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
      projectionVersion: version,
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
    assertProjectionSourceRevision(normalized);
    return normalized;
  }

  requirePresentFields(
    "tracker projection.semanticFields",
    semanticRecord,
    pullRequestSemanticFields,
  );
  const normalized: TrackerPullRequestProjection = Object.freeze({
    projectionVersion: version,
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
  assertProjectionSourceRevision(normalized);
  return normalized;
}

function assertProjectionSourceRevision(projection: TrackerProjection): void {
  const expectedSourceRevision = hashCanonicalProjection({
    projectionVersion: projection.projectionVersion,
    entityType: projection.entityType,
    repository: projection.repository,
    entityId: projection.entityId,
    semanticFields: projection.semanticFields,
  });
  if (projection.sourceRevision !== expectedSourceRevision) {
    throw new InvalidTrackerProjectionError(
      "tracker projection sourceRevision does not match canonical semantic fields",
    );
  }
}

function normalizeProjectionText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
}

function compareCanonicalStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function ownArrayEntries(field: string, value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new InvalidTrackerProjectionError(`${field} must be an array`);
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw new InvalidTrackerProjectionError(`${field} must not contain symbol entries`);
    }
    if (key === "length") {
      continue;
    }
    const index = arrayIndexKey(key);
    if (index === null) {
      throw new InvalidTrackerProjectionError(
        `${field} must not contain non-index properties`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new InvalidTrackerProjectionError(
        `${field}[${index}] must be an enumerable data property`,
      );
    }
  }

  const entries: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new InvalidTrackerProjectionError(
        `${field}[${index}] must be an enumerable data property`,
      );
    }
    entries.push(descriptor.value);
  }
  return Object.freeze(entries);
}

function arrayIndexKey(key: string): number | null {
  if (!/^(0|[1-9]\d*)$/u.test(key)) {
    return null;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index <= 0xfffffffe ? index : null;
}

function identityKey(value: string | number): string {
  return `${typeof value}:${String(value)}`;
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
      return `[${ownArrayEntries("canonical tracker projection value", value)
        .map((entry) => renderCanonicalJson(entry, ancestors))
        .join(",")}]`;
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
    const keys = Object.keys(record).sort(compareCanonicalStrings);
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

function sha256Hex(value: string): string {
  const words = sha256Words(utf8Bytes(value));
  return words.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256Words(bytes: Uint8Array): readonly number[] {
  const roundConstants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ] as const;
  const state: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const padded = padSha256(bytes);
  const schedule = new Array<number>(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      schedule[index] =
        ((padded[base] ?? 0) << 24) |
        ((padded[base + 1] ?? 0) << 16) |
        ((padded[base + 2] ?? 0) << 8) |
        (padded[base + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(schedule[index - 15] ?? 0, 7) ^
        rotateRight(schedule[index - 15] ?? 0, 18) ^
        ((schedule[index - 15] ?? 0) >>> 3);
      const s1 =
        rotateRight(schedule[index - 2] ?? 0, 17) ^
        rotateRight(schedule[index - 2] ?? 0, 19) ^
        ((schedule[index - 2] ?? 0) >>> 10);
      schedule[index] = add32(
        schedule[index - 16] ?? 0,
        s0,
        schedule[index - 7] ?? 0,
        s1,
      );
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = add32(h, sum1, choice, roundConstants[index] ?? 0, schedule[index] ?? 0);
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = add32(sum0, majority);

      h = g;
      g = f;
      f = e;
      e = add32(d, temporary1);
      d = c;
      c = b;
      b = a;
      a = add32(temporary1, temporary2);
    }

    state[0] = add32(state[0] ?? 0, a);
    state[1] = add32(state[1] ?? 0, b);
    state[2] = add32(state[2] ?? 0, c);
    state[3] = add32(state[3] ?? 0, d);
    state[4] = add32(state[4] ?? 0, e);
    state[5] = add32(state[5] ?? 0, f);
    state[6] = add32(state[6] ?? 0, g);
    state[7] = add32(state[7] ?? 0, h);
  }

  return Object.freeze(state);
}

function padSha256(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const remainder = (bytes.length + 9) % 64;
  const zeroPaddingLength = remainder === 0 ? 0 : 64 - remainder;
  const padded = new Uint8Array(bytes.length + 1 + zeroPaddingLength + 8);
  padded.set(bytes, 0);
  padded[bytes.length] = 0x80;

  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  padded[padded.length - 8] = (high >>> 24) & 0xff;
  padded[padded.length - 7] = (high >>> 16) & 0xff;
  padded[padded.length - 6] = (high >>> 8) & 0xff;
  padded[padded.length - 5] = high & 0xff;
  padded[padded.length - 4] = (low >>> 24) & 0xff;
  padded[padded.length - 3] = (low >>> 16) & 0xff;
  padded[padded.length - 2] = (low >>> 8) & 0xff;
  padded[padded.length - 1] = low & 0xff;
  return padded;
}

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function add32(...values: readonly number[]): number {
  let sum = 0;
  for (const value of values) {
    sum = (sum + value) >>> 0;
  }
  return sum;
}

import { describe, expect, it } from "vitest";

import {
  InvalidTrackerProjectionError,
  TRACKER_PROJECTION_VERSION,
  UnsupportedTrackerProjectionVersionError,
  assertSupportedTrackerProjection,
  assessTrackerProjectionCompatibility,
  canonicalizeTrackerProjectionValue,
  createTrackerIssueProjection,
  createTrackerPullRequestProjection,
} from "../src/tracker-projection.js";

function issueInput() {
  return {
    repository: "UniversalStandards/atlantis-ai-enhanced",
    issueNumber: 47,
    title: " Tracker projection contract ",
    body: "Canonical hashing for engineering sync.\r\n",
    state: "open" as const,
    labels: ["tracker", "contracts"],
    assignees: ["Copilot", "UniversalStandards"],
    linkedPullRequests: [
      {
        pullRequestNumber: 52,
        state: "open" as const,
        title: "Copilot Request",
      },
    ],
  };
}

function pullRequestInput() {
  return {
    repository: "UniversalStandards/atlantis-ai-enhanced",
    pullRequestNumber: 52,
    title: "Copilot Request",
    body: "Implements the tracker projection contract.",
    state: "open" as const,
    draft: true,
    labels: ["contracts", "tracker"],
    assignees: ["UniversalStandards", "Copilot"],
    linkedIssues: [
      {
        issueNumber: 47,
        state: "open" as const,
        title: "TRACKER A1",
      },
    ],
    checks: [
      {
        context: "contracts",
        status: "completed" as const,
        conclusion: "success" as const,
      },
      {
        context: "typecheck",
        status: "completed" as const,
        conclusion: "success" as const,
      },
    ],
    changedFiles: [
      {
        path: "packages/contracts/src/tracker-projection.ts",
        changeType: "added" as const,
        additions: 1,
        deletions: 0,
      },
      {
        path: "packages/contracts/test/tracker-projection.test.ts",
        changeType: "added" as const,
        additions: 1,
        deletions: 0,
      },
    ],
    commits: [
      {
        sha: "4c3f20029a8a82e8bc1223545d0cc2e51051dd59",
        title: "Add tracker projection contract",
      },
    ],
  };
}

describe("tracker projection contract", () => {
  it("produces fixed source-revision hash vectors for issue and pull request projections", () => {
    const issue = createTrackerIssueProjection(issueInput());
    const pullRequest = createTrackerPullRequestProjection(pullRequestInput());

    expect(issue.sourceRevision).toBe(
      "9618d05d603954e5543ece4d0b2803acfd5c43609b506d6e532ad9e8bda26cc1",
    );
    expect(pullRequest.sourceRevision).toBe(
      "1eec20b78b4f811877697632c0b35b456b1037f94cfdc2c844faec757b85fe35",
    );
    expect(issue.projectionVersion).toEqual(TRACKER_PROJECTION_VERSION);
    expect(pullRequest.projectionVersion).toEqual(TRACKER_PROJECTION_VERSION);
  });

  it("normalizes unordered semantic collections and reordered object fields to the same revision", () => {
    const original = createTrackerPullRequestProjection(pullRequestInput());
    const reordered = createTrackerPullRequestProjection({
      commits: [...pullRequestInput().commits].reverse(),
      changedFiles: [...pullRequestInput().changedFiles].reverse(),
      linkedIssues: [...pullRequestInput().linkedIssues],
      assignees: [...pullRequestInput().assignees].reverse(),
      title: "Copilot Request",
      labels: [...pullRequestInput().labels].reverse(),
      state: "open",
      repository: "UniversalStandards/atlantis-ai-enhanced",
      draft: true,
      pullRequestNumber: 52,
      body: "Implements the tracker projection contract.",
      checks: [...pullRequestInput().checks].reverse(),
      updatedAt: "2026-09-15T21:00:00.000Z",
      actor: "some-user",
      sessionId: "session-1",
      deliveryId: "delivery-1",
    });

    expect(reordered.sourceRevision).toBe(original.sourceRevision);
    expect(reordered.semanticFields.labels).toEqual(["contracts", "tracker"]);
    expect(reordered.semanticFields.assignees).toEqual(["Copilot", "UniversalStandards"]);
    expect(reordered.semanticFields.checks.map((check) => check.context)).toEqual([
      "contracts",
      "typecheck",
    ]);
  });

  it("changes the revision when projected semantic fields change", () => {
    const baseline = createTrackerIssueProjection(issueInput());
    const changedTitle = createTrackerIssueProjection({
      ...issueInput(),
      title: "Tracker projection contract v2",
    });

    expect(changedTitle.sourceRevision).not.toBe(baseline.sourceRevision);
  });

  it("ignores volatile timestamps, actors, sessions, delivery ids, and extra payload keys", () => {
    const baseline = createTrackerIssueProjection(issueInput());
    const withVolatileFields = createTrackerIssueProjection({
      ...issueInput(),
      updatedAt: "2026-09-15T21:00:00.000Z",
      createdAt: "2026-09-15T20:00:00.000Z",
      closedAt: null,
      actor: "UniversalStandards",
      sessionId: "abc123",
      deliveryId: "delivery-99",
      transport: { retry: 2 },
    });

    expect(withVolatileFields.sourceRevision).toBe(baseline.sourceRevision);
  });

  it("returns typed compatibility results and rejects unsupported or malformed projections", () => {
    const supported = createTrackerIssueProjection(issueInput());
    expect(assessTrackerProjectionCompatibility(supported)).toEqual({
      status: "supported",
      version: TRACKER_PROJECTION_VERSION,
      supportedMajor: 1,
      minimumMinor: 0,
      maximumMinor: 0,
    });

    const unsupported = assessTrackerProjectionCompatibility({
      ...supported,
      projectionVersion: { major: 2, minor: 0 },
    });
    expect(unsupported).toEqual({
      status: "unsupported-major",
      version: { major: 2, minor: 0 },
      supportedMajor: 1,
      minimumMinor: 0,
      maximumMinor: 0,
      reason: "tracker projection major version 2 is unsupported",
    });

    const malformed = assessTrackerProjectionCompatibility({
      sourceRevision: supported.sourceRevision,
    });
    expect(malformed).toEqual({
      status: "malformed",
      reason: "tracker projection is missing required field projectionVersion",
    });

    expect(() =>
      assertSupportedTrackerProjection({
        ...supported,
        projectionVersion: { major: 2, minor: 0 },
      }),
    ).toThrow(UnsupportedTrackerProjectionVersionError);
    expect(() =>
      assertSupportedTrackerProjection({
        ...supported,
        sourceRevision: "bad",
      }),
    ).toThrow(InvalidTrackerProjectionError);
  });

  it("fails closed on malformed canonical values, cycles, and non-canonical collections", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => canonicalizeTrackerProjectionValue(cyclic)).toThrow(
      InvalidTrackerProjectionError,
    );
    expect(() =>
      createTrackerIssueProjection({
        ...issueInput(),
        labels: ["tracker", "tracker"],
      }),
    ).toThrow(/duplicate semantic entries/);
    expect(() =>
      createTrackerPullRequestProjection({
        ...pullRequestInput(),
        checks: [
          pullRequestInput().checks[0],
          { ...pullRequestInput().checks[0] },
        ],
      }),
    ).toThrow(/duplicate semantic entries/);
    expect(() =>
      createTrackerPullRequestProjection({
        ...pullRequestInput(),
        commits: [{ sha: "HEAD", title: "bad sha" }],
      }),
    ).toThrow(/canonical lowercase 40-character Git SHA/);
  });
});

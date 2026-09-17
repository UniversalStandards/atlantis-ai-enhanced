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
    const issueBaseline = createTrackerIssueProjection(issueInput());
    const issueCases = [
      {
        name: "title",
        input: { ...issueInput(), title: "Tracker projection contract v2" },
      },
      {
        name: "body",
        input: { ...issueInput(), body: "Updated canonical hashing body." },
      },
      {
        name: "state",
        input: { ...issueInput(), state: "closed" as const },
      },
      {
        name: "labels",
        input: { ...issueInput(), labels: ["contracts", "tracker-v2"] },
      },
      {
        name: "assignees",
        input: { ...issueInput(), assignees: ["Copilot"] },
      },
      {
        name: "linkedPullRequests",
        input: {
          ...issueInput(),
          linkedPullRequests: [
            {
              pullRequestNumber: 52,
              state: "closed" as const,
              title: "Copilot Request",
            },
          ],
        },
      },
    ] as const;

    for (const testCase of issueCases) {
      expect(createTrackerIssueProjection(testCase.input).sourceRevision, testCase.name).not.toBe(
        issueBaseline.sourceRevision,
      );
    }

    const pullRequestBaseline = createTrackerPullRequestProjection(pullRequestInput());
    const pullRequestCases = [
      {
        name: "title",
        input: { ...pullRequestInput(), title: "Copilot Request v2" },
      },
      {
        name: "body",
        input: {
          ...pullRequestInput(),
          body: "Implements the tracker projection contract with hardening.",
        },
      },
      {
        name: "state",
        input: { ...pullRequestInput(), state: "closed" as const },
      },
      {
        name: "draft",
        input: { ...pullRequestInput(), draft: false },
      },
      {
        name: "labels",
        input: { ...pullRequestInput(), labels: ["contracts", "tracker-v2"] },
      },
      {
        name: "assignees",
        input: { ...pullRequestInput(), assignees: ["UniversalStandards"] },
      },
      {
        name: "linkedIssues",
        input: {
          ...pullRequestInput(),
          linkedIssues: [
            {
              issueNumber: 47,
              state: "closed" as const,
              title: "TRACKER A1",
            },
          ],
        },
      },
      {
        name: "checks",
        input: {
          ...pullRequestInput(),
          checks: [
            {
              context: "contracts",
              status: "completed" as const,
              conclusion: "failure" as const,
            },
            pullRequestInput().checks[1],
          ],
        },
      },
      {
        name: "changedFiles",
        input: {
          ...pullRequestInput(),
          changedFiles: [
            {
              path: "packages/contracts/src/tracker-projection.ts",
              changeType: "modified" as const,
              additions: 2,
              deletions: 0,
            },
            pullRequestInput().changedFiles[1],
          ],
        },
      },
      {
        name: "commits",
        input: {
          ...pullRequestInput(),
          commits: [
            {
              sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              title: "Add tracker projection contract",
            },
          ],
        },
      },
    ] as const;

    for (const testCase of pullRequestCases) {
      expect(
        createTrackerPullRequestProjection(testCase.input).sourceRevision,
        testCase.name,
      ).not.toBe(pullRequestBaseline.sourceRevision);
    }
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

    expect(
      assessTrackerProjectionCompatibility({
        ...supported,
        entityType: "pull-request",
      }),
    ).toEqual({
      status: "malformed",
      reason: "entityType must be issue or pull_request",
    });
    expect(
      assessTrackerProjectionCompatibility({
        ...supported,
        semanticFields: {
          ...supported.semanticFields,
          state: "merged",
        },
      }),
    ).toEqual({
      status: "malformed",
      reason: "semanticFields.state must be open or closed",
    });
    expect(
      assessTrackerProjectionCompatibility({
        ...supported,
        sourceRevision:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toEqual({
      status: "malformed",
      reason: "tracker projection sourceRevision does not match canonical semantic fields",
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
    const sparseLabels = ["tracker", "contracts"];
    delete sparseLabels[1];
    const accessorChecks = [...pullRequestInput().checks];
    Object.defineProperty(accessorChecks, "0", {
      enumerable: true,
      get() {
        return pullRequestInput().checks[0];
      },
    });

    expect(() => canonicalizeTrackerProjectionValue(cyclic)).toThrow(
      InvalidTrackerProjectionError,
    );
    expect(() =>
      createTrackerIssueProjection({
        ...issueInput(),
        labels: sparseLabels,
      }),
    ).toThrow(/labels\[1\] must be an enumerable data property/);
    expect(() =>
      createTrackerPullRequestProjection({
        ...pullRequestInput(),
        checks: accessorChecks,
      }),
    ).toThrow(/checks\[0\] must be an enumerable data property/);
    expect(() =>
      createTrackerIssueProjection({
        ...issueInput(),
        labels: ["e\u0301", "\u00e9"],
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

  it("normalizes unicode-equivalent semantic text before hashing", () => {
    const composed = createTrackerIssueProjection({
      ...issueInput(),
      title: "Caf\u00e9 tracker",
      labels: ["caf\u00e9", "tracker"],
    });
    const decomposed = createTrackerIssueProjection({
      ...issueInput(),
      title: "Cafe\u0301 tracker",
      labels: ["cafe\u0301", "tracker"],
    });

    expect(decomposed.sourceRevision).toBe(composed.sourceRevision);
    expect(decomposed.semanticFields.title).toBe("Caf\u00e9 tracker");
    expect(decomposed.semanticFields.labels).toEqual(["caf\u00e9", "tracker"]);
  });
});

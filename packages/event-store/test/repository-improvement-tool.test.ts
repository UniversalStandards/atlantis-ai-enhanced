import { describe, expect, it } from "vitest";

import {
  InvalidRepositoryImprovementEvidenceError,
  RepositoryImprovementTask,
  type RepositoryImprovementEvidence,
  type RepositoryImprovementTool,
} from "../src/repository-improvement-tool.js";

const request = Object.freeze({
  repository: "UniversalStandards/atlantis-ai-enhanced",
  branch: "day7/improvement-1",
  objective: "Improve one bounded repository concern.",
});

function evidence(overrides: Partial<RepositoryImprovementEvidence> = {}): RepositoryImprovementEvidence {
  return Object.freeze({
    repository: request.repository,
    branch: request.branch,
    testsPassed: true,
    independentlyVerified: true,
    pullRequestNumber: 101,
    pullRequestUrl: "https://github.com/UniversalStandards/atlantis-ai-enhanced/pull/101",
    reportArtifactId: "artifact-101",
    traceExecutionId: "exec-101",
    costUsd: 0.12,
    ...overrides,
  });
}

function tool(result: RepositoryImprovementEvidence): RepositoryImprovementTool {
  return { execute: async () => result };
}

describe("RepositoryImprovementTask", () => {
  it("accepts complete evidence bound to repository, branch, and execution", async () => {
    const result = await new RepositoryImprovementTask(tool(evidence())).execute(request, "exec-101");
    expect(result).toEqual(evidence());
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["repository substitution", { repository: "other/repository" }],
    ["branch substitution", { branch: "main" }],
    ["failed tests", { testsPassed: false }],
    ["missing independent verification", { independentlyVerified: false }],
    ["trace substitution", { traceExecutionId: "exec-other" }],
    ["invalid cost", { costUsd: Number.NaN }],
  ] as const)("rejects %s", async (_name, overrides) => {
    await expect(
      new RepositoryImprovementTask(tool(evidence(overrides))).execute(request, "exec-101"),
    ).rejects.toBeInstanceOf(InvalidRepositoryImprovementEvidenceError);
  });
});

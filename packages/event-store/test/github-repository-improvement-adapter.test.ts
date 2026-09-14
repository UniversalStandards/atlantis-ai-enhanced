import { describe, expect, it, vi } from "vitest";
import {
  ApprovalGatedGitHubRepositoryImprovementTool,
  InvalidRepositoryImprovementApprovalError,
  type GitHubRepositoryImprovementPort,
  type RepositoryImprovementApprovalVerifier,
} from "../src/github-repository-improvement-adapter.js";

const request = Object.freeze({
  repository: "UniversalStandards/atlantis-ai-enhanced",
  branch: "sprint/7-day-operational-alpha",
  objective: "Advance the governed Day-7 workflow",
});

const evidence = Object.freeze({
  repository: request.repository,
  branch: request.branch,
  testsPassed: true,
  independentlyVerified: true,
  pullRequestNumber: 10,
  pullRequestUrl: "https://github.com/UniversalStandards/atlantis-ai-enhanced/pull/10",
  reportArtifactId: "release/day7.json",
  traceExecutionId: "execution-1",
  costUsd: 0.01,
});

function fixture(approvalId = "approval-1") {
  const approvals: RepositoryImprovementApprovalVerifier = {
    requireApproved: vi.fn(async () => approvalId),
  };
  const github: GitHubRepositoryImprovementPort = {
    executeApproved: vi.fn(async () => evidence),
  };
  return { approvals, github, tool: new ApprovalGatedGitHubRepositoryImprovementTool(approvals, github) };
}

describe("ApprovalGatedGitHubRepositoryImprovementTool", () => {
  it("requires approval before invoking the GitHub mutation port", async () => {
    const { approvals, github, tool } = fixture();

    await expect(tool.execute(request, "execution-1")).resolves.toEqual(evidence);
    expect(approvals.requireApproved).toHaveBeenCalledWith(request, "execution-1");
    expect(github.executeApproved).toHaveBeenCalledWith(
      { ...request, approvalId: "approval-1" },
      "execution-1",
    );
  });

  it("does not invoke GitHub when approval fails", async () => {
    const approvals: RepositoryImprovementApprovalVerifier = {
      requireApproved: vi.fn(async () => { throw new Error("not approved"); }),
    };
    const github: GitHubRepositoryImprovementPort = { executeApproved: vi.fn() };
    const tool = new ApprovalGatedGitHubRepositoryImprovementTool(approvals, github);

    await expect(tool.execute(request, "execution-1")).rejects.toThrow("not approved");
    expect(github.executeApproved).not.toHaveBeenCalled();
  });

  it("fails closed on an empty approval receipt", async () => {
    const { github, tool } = fixture("   ");

    await expect(tool.execute(request, "execution-1")).rejects.toBeInstanceOf(
      InvalidRepositoryImprovementApprovalError,
    );
    expect(github.executeApproved).not.toHaveBeenCalled();
  });

  it("normalizes governed request fields before approval and mutation", async () => {
    const { approvals, github, tool } = fixture();

    await tool.execute(
      { repository: ` ${request.repository} `, branch: ` ${request.branch} `, objective: ` ${request.objective} ` },
      " execution-1 ",
    );

    expect(approvals.requireApproved).toHaveBeenCalledWith(request, "execution-1");
    expect(github.executeApproved).toHaveBeenCalledWith(
      { ...request, approvalId: "approval-1" },
      "execution-1",
    );
  });
});

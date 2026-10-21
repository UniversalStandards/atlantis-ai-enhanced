import { describe, expect, it } from "vitest";
import {
  ApprovalGatedGitHubRepositoryImprovementTool,
  InvalidRepositoryImprovementApprovalError,
} from "../src/index.js";
import type {
  ApprovedRepositoryImprovementRequest,
  GitHubRepositoryImprovementExecution,
  GitHubRepositoryImprovementPort,
  RepositoryImprovementApprovalVerifier,
} from "../src/index.js";

void (null as unknown as ApprovedRepositoryImprovementRequest);
void (null as unknown as GitHubRepositoryImprovementExecution);
void (null as unknown as GitHubRepositoryImprovementPort);
void (null as unknown as RepositoryImprovementApprovalVerifier);

describe("GitHub repository-improvement public API", () => {
  it("exports the approval-gated adapter and error through the event-store package boundary", () => {
    expect(ApprovalGatedGitHubRepositoryImprovementTool).toBeTypeOf("function");
    expect(InvalidRepositoryImprovementApprovalError).toBeTypeOf("function");
  });
});

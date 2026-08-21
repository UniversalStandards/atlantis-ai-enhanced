import { describe, expect, it, vi } from "vitest";

import {
  InvalidSelfImprovementPatchEvidenceError,
  SelfImprovementEvaluationDidNotFailError,
  proposeSelfImprovementFromFailedEvaluation,
  type SelfImprovementPatchEvidence,
  type SelfImprovementPatchRequest,
} from "./self-improvement-development-workflow.js";

const failedRequest: SelfImprovementPatchRequest = Object.freeze({
  executionId: "exec-improve-7",
  observedProblem: "evaluation score fell below the release threshold",
  objective: "restore deterministic evaluation quality",
  evaluation: Object.freeze({
    score: 0.62,
    passed: false,
    reasons: Object.freeze(["quality threshold missed"]),
    metrics: Object.freeze({ quality: 0.62 }),
  }),
});

function patchEvidence(overrides: Partial<SelfImprovementPatchEvidence> = {}): SelfImprovementPatchEvidence {
  return {
    proposalId: "proposal-improve-7",
    executionId: failedRequest.executionId,
    observedProblem: failedRequest.observedProblem,
    objective: failedRequest.objective,
    isolatedBranch: "proposal/evaluation-quality-7",
    evidenceArtifactIds: ["artifact-failing-evaluation", "artifact-patch", "artifact-tests"],
    expectedBenefit: "restore evaluation quality above the release threshold",
    risk: "patch may overfit the failing fixture",
    rollbackPlan: "discard the isolated proposal branch before merge",
    testsPassed: true,
    evaluationPassed: true,
    securityReviewPassed: true,
    ...overrides,
  };
}

describe("proposeSelfImprovementFromFailedEvaluation", () => {
  it("detects a failing evaluation, generates isolated patch evidence, and stops at human review", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));

    const proposal = await proposeSelfImprovementFromFailedEvaluation(failedRequest, { generate });

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(failedRequest);
    expect(proposal.status).toBe("awaiting-human-review");
    expect(proposal.isolatedBranch).toBe("proposal/evaluation-quality-7");
    expect(proposal.evidenceArtifactIds).toEqual([
      "artifact-failing-evaluation",
      "artifact-patch",
      "artifact-tests",
    ]);
    expect(Object.isFrozen(proposal)).toBe(true);
  });

  it("does not generate a patch when the triggering evaluation passed", async () => {
    const generate = vi.fn(async () => Object.freeze(patchEvidence()));
    const passingRequest = {
      ...failedRequest,
      evaluation: Object.freeze({ ...failedRequest.evaluation, passed: true }),
    };

    await expect(
      proposeSelfImprovementFromFailedEvaluation(passingRequest, { generate }),
    ).rejects.toBeInstanceOf(SelfImprovementEvaluationDidNotFailError);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["executionId", "exec-substituted"],
    ["observedProblem", "different problem"],
    ["objective", "different objective"],
  ] as const)("rejects generated %s substitution", async (field, value) => {
    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ [field]: value })),
      }),
    ).rejects.toBeInstanceOf(InvalidSelfImprovementPatchEvidenceError);
  });

  it("rejects a generated patch that still fails evaluation", async () => {
    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ evaluationPassed: false })),
      }),
    ).rejects.toBeInstanceOf(InvalidSelfImprovementPatchEvidenceError);
  });

  it("reuses the immutable proposal gate for tests, security, isolation, and provenance", async () => {
    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ testsPassed: false })),
      }),
    ).rejects.toThrow("tests must pass before human review");

    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ securityReviewPassed: false })),
      }),
    ).rejects.toThrow("security review must pass before human review");

    await expect(
      proposeSelfImprovementFromFailedEvaluation(failedRequest, {
        generate: async () => Object.freeze(patchEvidence({ isolatedBranch: "main" })),
      }),
    ).rejects.toThrow("isolatedBranch must use an isolated sprint/ or proposal/ branch namespace");
  });
});

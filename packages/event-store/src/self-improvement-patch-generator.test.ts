import { describe, expect, it, vi } from "vitest";

import {
  EvidenceBackedSelfImprovementPatchGenerator,
  InvalidConcreteSelfImprovementPatchError,
  type IsolatedSelfImprovementPatchResult,
} from "./self-improvement-patch-generator.js";
import {
  proposeSelfImprovementFromFailedEvaluation,
  type SelfImprovementPatchRequest,
} from "./self-improvement-development-workflow.js";

const request: SelfImprovementPatchRequest = Object.freeze({
  executionId: "exec-concrete-improve-1",
  observedProblem: "release evaluation missed its deterministic quality threshold",
  objective: "restore deterministic quality without production mutation",
  evaluation: Object.freeze({
    score: 0.61,
    passed: false,
    reasons: Object.freeze(["quality threshold missed"]),
    metrics: Object.freeze({ quality: 0.61 }),
  }),
});

function patch(overrides: Partial<IsolatedSelfImprovementPatchResult> = {}): IsolatedSelfImprovementPatchResult {
  return {
    proposalId: "proposal-concrete-1",
    executionId: request.executionId,
    observedProblem: request.observedProblem,
    objective: request.objective,
    isolatedBranch: "proposal/concrete-improve-1",
    patchArtifactId: "artifact-patch-1",
    expectedBenefit: "restore deterministic release quality",
    risk: "the patch could overfit the failing evaluation",
    rollbackPlan: "discard the isolated proposal branch before review acceptance",
    ...overrides,
  };
}

function fixture(overrides: { patch?: Partial<IsolatedSelfImprovementPatchResult>; testsPassed?: boolean; evaluationPassed?: boolean; securityPassed?: boolean } = {}) {
  const prepare = vi.fn(async () => Object.freeze(patch(overrides.patch)));
  const run = vi.fn(async () => Object.freeze({ passed: overrides.testsPassed ?? true, artifactId: "artifact-tests-1" }));
  const evaluate = vi.fn(async () => Object.freeze({ passed: overrides.evaluationPassed ?? true, artifactId: "artifact-evaluation-1" }));
  const review = vi.fn(async () => Object.freeze({ passed: overrides.securityPassed ?? true, artifactId: "artifact-security-1" }));
  return {
    generator: new EvidenceBackedSelfImprovementPatchGenerator({ prepare }, { run }, { evaluate }, { review }),
    prepare,
    run,
    evaluate,
    review,
  };
}

describe("EvidenceBackedSelfImprovementPatchGenerator", () => {
  it("executes isolated patch, tests, evaluation, security evidence and stops at human review", async () => {
    const { generator, prepare, run, evaluate, review } = fixture();

    const proposal = await proposeSelfImprovementFromFailedEvaluation(request, generator);

    expect(prepare).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
    expect(proposal.status).toBe("awaiting-human-review");
    expect(proposal.isolatedBranch).toBe("proposal/concrete-improve-1");
    expect(proposal.evidenceArtifactIds).toEqual([
      "artifact-patch-1",
      "artifact-tests-1",
      "artifact-evaluation-1",
      "artifact-security-1",
    ]);
    expect(Object.isFrozen(proposal)).toBe(true);
  });

  it("fails before evaluation and security review when tests fail", async () => {
    const { generator, evaluate, review } = fixture({ testsPassed: false });
    await expect(generator.generate(request)).rejects.toThrow("tests must pass before evaluation");
    expect(evaluate).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it("fails before security review when follow-up evaluation fails", async () => {
    const { generator, review } = fixture({ evaluationPassed: false });
    await expect(generator.generate(request)).rejects.toThrow("must pass follow-up evaluation");
    expect(review).not.toHaveBeenCalled();
  });

  it("rejects failed security review", async () => {
    const { generator } = fixture({ securityPassed: false });
    await expect(generator.generate(request)).rejects.toThrow("must pass security review");
  });

  it.each([
    ["executionId", "exec-substituted"],
    ["observedProblem", "substituted problem"],
    ["objective", "substituted objective"],
  ] as const)("rejects isolated patch %s substitution", async (field, value) => {
    const { generator } = fixture({ patch: { [field]: value } });
    await expect(generator.generate(request)).rejects.toBeInstanceOf(InvalidConcreteSelfImprovementPatchError);
  });

  it("rejects a non-isolated branch before test execution", async () => {
    const { generator, run } = fixture({ patch: { isolatedBranch: "main" } });
    await expect(generator.generate(request)).rejects.toThrow("isolatedBranch must use an isolated");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects duplicate evidence identities", async () => {
    const prepare = vi.fn(async () => Object.freeze(patch({ patchArtifactId: "artifact-shared" })));
    const generator = new EvidenceBackedSelfImprovementPatchGenerator(
      { prepare },
      { run: async () => Object.freeze({ passed: true, artifactId: "artifact-shared" }) },
      { evaluate: async () => Object.freeze({ passed: true, artifactId: "artifact-evaluation-1" }) },
      { review: async () => Object.freeze({ passed: true, artifactId: "artifact-security-1" }) },
    );
    await expect(generator.generate(request)).rejects.toThrow("artifact identities must be unique");
  });
});

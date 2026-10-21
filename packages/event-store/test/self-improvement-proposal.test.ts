import { describe, expect, it } from "vitest";

import {
  InvalidSelfImprovementProposalError,
  createSelfImprovementProposal,
} from "../src/self-improvement-proposal.js";

const validInput = () => ({
  proposalId: "proposal-001",
  executionId: "execution-001",
  observedProblem: "A deterministic evaluation failed.",
  objective: "Correct the failing behavior without changing production directly.",
  isolatedBranch: "proposal/execution-001-fix",
  evidenceArtifactIds: ["evaluation-report-001", "test-report-001"],
  expectedBenefit: "Restore the governed evaluation to passing.",
  risk: "The patch could regress adjacent behavior.",
  rollbackPlan: "Discard the proposal branch or revert the reviewed commit.",
  testsPassed: true,
  evaluationPassed: true,
  securityReviewPassed: true,
} as const);

describe("createSelfImprovementProposal", () => {
  it("creates immutable evidence and stops at human review", () => {
    const proposal = createSelfImprovementProposal(validInput());

    expect(proposal.status).toBe("awaiting-human-review");
    expect(proposal.executionId).toBe("execution-001");
    expect(proposal.isolatedBranch).toBe("proposal/execution-001-fix");
    expect(proposal.evidenceArtifactIds).toEqual(["evaluation-report-001", "test-report-001"]);
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Object.isFrozen(proposal.evidenceArtifactIds)).toBe(true);
    expect("merge" in proposal).toBe(false);
    expect("deploy" in proposal).toBe(false);
    expect("credential" in proposal).toBe(false);
  });

  it.each([
    ["testsPassed", { testsPassed: false }],
    ["evaluationPassed", { evaluationPassed: false }],
    ["securityReviewPassed", { securityReviewPassed: false }],
  ] as const)("fails closed when %s is not satisfied", (_field, override) => {
    expect(() => createSelfImprovementProposal({ ...validInput(), ...override })).toThrow(
      InvalidSelfImprovementProposalError,
    );
  });

  it("rejects a non-isolated branch", () => {
    expect(() =>
      createSelfImprovementProposal({ ...validInput(), isolatedBranch: "main" }),
    ).toThrow(/isolated/);
  });

  it("requires provenance evidence and rejects duplicate artifact identities", () => {
    expect(() =>
      createSelfImprovementProposal({ ...validInput(), evidenceArtifactIds: [] }),
    ).toThrow(/evidence artifact/);

    expect(() =>
      createSelfImprovementProposal({
        ...validInput(),
        evidenceArtifactIds: ["same", "same"],
      }),
    ).toThrow(/unique/);
  });

  it("normalizes review-bound textual identities without mutating the caller input", () => {
    const input = {
      ...validInput(),
      proposalId: "  proposal-001  ",
      objective: "  Correct the failing evaluation.  ",
    };
    const proposal = createSelfImprovementProposal(input);

    expect(proposal.proposalId).toBe("proposal-001");
    expect(proposal.objective).toBe("Correct the failing evaluation.");
    expect(input.proposalId).toBe("  proposal-001  ");
  });
});

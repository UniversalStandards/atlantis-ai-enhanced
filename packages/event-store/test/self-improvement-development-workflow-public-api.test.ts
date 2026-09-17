import { describe, expect, it } from "vitest";

import {
  InvalidSelfImprovementPatchEvidenceError,
  SelfImprovementEvaluationDidNotFailError,
  proposeSelfImprovementFromFailedEvaluation,
} from "../src/index.js";
import type {
  SelfImprovementPatchEvidence,
  SelfImprovementPatchGenerator,
  SelfImprovementPatchRequest,
} from "../src/index.js";

void (null as unknown as SelfImprovementPatchEvidence);
void (null as unknown as SelfImprovementPatchGenerator);
void (null as unknown as SelfImprovementPatchRequest);

describe("self-improvement development workflow public API", () => {
  it("exports the review-gated development workflow through the event-store package root", () => {
    expect(proposeSelfImprovementFromFailedEvaluation).toBeTypeOf("function");
    expect(SelfImprovementEvaluationDidNotFailError).toBeTypeOf("function");
    expect(InvalidSelfImprovementPatchEvidenceError).toBeTypeOf("function");
  });
});

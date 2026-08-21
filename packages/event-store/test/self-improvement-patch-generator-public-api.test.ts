import { describe, expect, it } from "vitest";

import {
  EvidenceBackedSelfImprovementPatchGenerator,
  InvalidConcreteSelfImprovementPatchError,
} from "@atlantis/event-store/self-improvement-patch-generator";
import type {
  IsolatedSelfImprovementPatchResult,
  IsolatedSelfImprovementPatchWorkspace,
  SelfImprovementPatchEvaluator,
  SelfImprovementPatchSecurityReviewer,
  SelfImprovementPatchTestResult,
  SelfImprovementPatchTestRunner,
} from "@atlantis/event-store/self-improvement-patch-generator";

void (null as unknown as IsolatedSelfImprovementPatchResult);
void (null as unknown as IsolatedSelfImprovementPatchWorkspace);
void (null as unknown as SelfImprovementPatchEvaluator);
void (null as unknown as SelfImprovementPatchSecurityReviewer);
void (null as unknown as SelfImprovementPatchTestResult);
void (null as unknown as SelfImprovementPatchTestRunner);

describe("concrete self-improvement generator public API", () => {
  it("exports the concrete evidence-backed generator through a supported package subpath", () => {
    expect(EvidenceBackedSelfImprovementPatchGenerator).toBeTypeOf("function");
    expect(InvalidConcreteSelfImprovementPatchError).toBeTypeOf("function");
  });
});

import { describe, expect, it } from "vitest";

import {
  InvalidSelfImprovementProposalError,
  createSelfImprovementProposal,
} from "../src/index.js";
import type {
  SelfImprovementProposal,
  SelfImprovementProposalInput,
} from "../src/index.js";

void (null as unknown as SelfImprovementProposal);
void (null as unknown as SelfImprovementProposalInput);

describe("self-improvement proposal public API", () => {
  it("exports the governed proposal boundary through the event-store package root", () => {
    expect(createSelfImprovementProposal).toBeTypeOf("function");
    expect(InvalidSelfImprovementProposalError).toBeTypeOf("function");
  });
});

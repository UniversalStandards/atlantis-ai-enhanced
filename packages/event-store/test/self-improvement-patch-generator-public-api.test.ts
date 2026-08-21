import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  EvidenceBackedSelfImprovementPatchGenerator,
  InvalidConcreteSelfImprovementPatchError,
} from "../src/self-improvement-patch-generator.js";

interface EventStorePackageDefinition {
  readonly exports?: Readonly<Record<string, string>>;
}

describe("concrete self-improvement generator public API", () => {
  it("exposes the concrete generator through the supported package subpath", () => {
    const packageDefinition = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as EventStorePackageDefinition;

    expect(packageDefinition.exports?.["./self-improvement-patch-generator"]).toBe(
      "./src/self-improvement-patch-generator.ts",
    );
    expect(EvidenceBackedSelfImprovementPatchGenerator).toBeTypeOf("function");
    expect(InvalidConcreteSelfImprovementPatchError).toBeTypeOf("function");
  });
});

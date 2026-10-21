import { describe, expect, it } from "vitest";

import { executionEventTypes } from "../src/index.js";

describe("executionEventTypes", () => {
  it("is immutable, unique, and canonically formatted", () => {
    expect(Object.isFrozen(executionEventTypes)).toBe(true);
    expect(new Set(executionEventTypes).size).toBe(executionEventTypes.length);

    for (const type of executionEventTypes) {
      expect(type).toBe(type.trim());
      expect(type.length).toBeGreaterThan(0);
    }
  });
});

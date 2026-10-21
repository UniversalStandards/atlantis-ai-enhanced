import { describe, expect, it } from "vitest";

import { HarnessRuntime, ToolRouter, serializeWorkDelta } from "../src/index.js";
import { HarnessRuntime as HarnessRuntimeSubpath } from "../src/harness-runtime.js";
import { ToolRouter as ToolRouterSubpath } from "../src/tool-router.js";
import { validateWorkDelta } from "../src/work-delta.js";

describe("harness-runtime public api", () => {
  it("exposes the documented entrypoints and subpaths", () => {
    expect(HarnessRuntime).toBeTypeOf("function");
    expect(ToolRouter).toBeTypeOf("function");
    expect(serializeWorkDelta).toBeTypeOf("function");
    expect(HarnessRuntimeSubpath).toBe(HarnessRuntime);
    expect(ToolRouterSubpath).toBe(ToolRouter);
    expect(validateWorkDelta).toBeTypeOf("function");
  });
});

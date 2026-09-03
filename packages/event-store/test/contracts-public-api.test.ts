import { describe, expect, it } from "vitest";
import {
  ExecutionTimedOutError,
  executeWithControl,
} from "@atlantis/contracts/execution-control";

describe("contracts public package boundary", () => {
  it("exposes execution controls to downstream workspace packages", async () => {
    await expect(
      executeWithControl(
        async () => "unreachable",
        { maxAttempts: 1 },
        {
          deadline: {
            deadlineAtMs: 10,
            nowMs: () => 10,
          },
        },
      ),
    ).rejects.toEqual(new ExecutionTimedOutError(10, 10));
  });
});

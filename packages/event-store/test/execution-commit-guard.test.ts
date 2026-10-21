import { describe, expect, it } from "vitest";

import {
  ExecutionCommitClosedError,
  ExecutionCommitGuard,
} from "../src/execution-commit-guard.js";
import { InvalidEventError } from "../src/index.js";

describe("ExecutionCommitGuard", () => {
  it("permits synchronous mutation before the gate closes", () => {
    const guard = new ExecutionCommitGuard("execution-1");
    const durableValues: string[] = [];

    const result = guard.commit(() => {
      durableValues.push("committed");
      return 1;
    });

    expect(result).toBe(1);
    expect(durableValues).toEqual(["committed"]);
    expect(guard.isClosed()).toBe(false);
  });

  it("blocks every late mutation after the gate closes", () => {
    const guard = new ExecutionCommitGuard("execution-1");
    const durableValues: string[] = [];
    const reason = new Error("deadline exceeded");

    guard.close(reason);

    expect(() =>
      guard.commit(() => {
        durableValues.push("late mutation");
      }),
    ).toThrow(ExecutionCommitClosedError);
    expect(durableValues).toEqual([]);
    expect(guard.isClosed()).toBe(true);
  });

  it("preserves the first close reason and remains permanently closed", () => {
    const guard = new ExecutionCommitGuard("execution-1");
    const firstReason = new Error("ownership lost");

    guard.close(firstReason);
    guard.close(new Error("later timeout"));

    try {
      guard.commit(() => undefined);
      throw new Error("expected commit to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionCommitClosedError);
      expect((error as ExecutionCommitClosedError).reason).toBe(firstReason);
    }
  });

  it("does not let one execution gate close another", () => {
    const first = new ExecutionCommitGuard("execution-1");
    const second = new ExecutionCommitGuard("execution-2");

    first.close("cancelled");

    expect(() => first.commit(() => "first")).toThrow(
      ExecutionCommitClosedError,
    );
    expect(second.commit(() => "second")).toBe("second");
  });

  it.each(["", " execution-1 "])(
    "rejects non-canonical execution identity %p",
    (executionId) => {
      expect(() => new ExecutionCommitGuard(executionId)).toThrow(
        InvalidEventError,
      );
    },
  );

  it("rejects a non-function commit operation before mutation", () => {
    const guard = new ExecutionCommitGuard("execution-1");

    expect(() =>
      guard.commit(null as unknown as () => void),
    ).toThrow(InvalidEventError);
  });
});

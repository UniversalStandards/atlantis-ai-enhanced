import { describe, expect, it } from "vitest";
import {
  ExecutionCancelledError,
  InvalidRetryPolicyError,
  executeWithControl,
} from "../src/execution-control.js";

describe("executeWithControl", () => {
  it("retries only within the configured bound", async () => {
    let calls = 0;
    const attempts: number[] = [];

    await expect(
      executeWithControl(
        async ({ attempt }) => {
          calls += 1;
          if (attempt < 3) throw new Error(`failure-${attempt}`);
          return "ok";
        },
        { maxAttempts: 3 },
        {
          hooks: {
            onAttemptStarted: ({ attempt }) => attempts.push(attempt),
          },
        },
      ),
    ).resolves.toBe("ok");

    expect(calls).toBe(3);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("does not retry when policy rejects the error", async () => {
    let calls = 0;

    await expect(
      executeWithControl(
        async () => {
          calls += 1;
          throw new TypeError("not retryable");
        },
        {
          maxAttempts: 5,
          shouldRetry: (error) => !(error instanceof TypeError),
        },
      ),
    ).rejects.toThrow("not retryable");

    expect(calls).toBe(1);
  });

  it("fails before work when cancellation is already requested", async () => {
    let called = false;

    await expect(
      executeWithControl(
        async () => {
          called = true;
          return "unexpected";
        },
        { maxAttempts: 2 },
        {
          cancellation: {
            isCancellationRequested: true,
            reason: "operator cancelled",
          },
        },
      ),
    ).rejects.toEqual(new ExecutionCancelledError("operator cancelled"));

    expect(called).toBe(false);
  });

  it("stops before retry when cancellation is requested after failure", async () => {
    const signal = { isCancellationRequested: false, reason: "stop now" };
    let calls = 0;

    await expect(
      executeWithControl(
        async () => {
          calls += 1;
          signal.isCancellationRequested = true;
          throw new Error("transient");
        },
        { maxAttempts: 3 },
        { cancellation: signal },
      ),
    ).rejects.toBeInstanceOf(ExecutionCancelledError);

    expect(calls).toBe(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid maxAttempts %s",
    async (maxAttempts) => {
      await expect(
        executeWithControl(async () => "never", { maxAttempts }),
      ).rejects.toBeInstanceOf(InvalidRetryPolicyError);
    },
  );

  it("reports whether a failed attempt will retry", async () => {
    const failures: boolean[] = [];

    await expect(
      executeWithControl(
        async () => {
          throw new Error("always fails");
        },
        { maxAttempts: 2 },
        {
          hooks: {
            onAttemptFailed: (_context, _error, willRetry) => {
              failures.push(willRetry);
            },
          },
        },
      ),
    ).rejects.toThrow("always fails");

    expect(failures).toEqual([true, false]);
  });
});

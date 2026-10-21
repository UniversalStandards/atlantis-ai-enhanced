import { describe, expect, it } from "vitest";
import {
  ExecutionCancelledError,
  ExecutionTimedOutError,
  InvalidExecutionDeadlineError,
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
            onAttemptStarted: ({ attempt }) => {
              attempts.push(attempt);
            },
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

  it("fails before starting work when the deadline is reached", async () => {
    let called = false;
    const timeouts: number[] = [];

    await expect(
      executeWithControl(
        async () => {
          called = true;
          return "unexpected";
        },
        { maxAttempts: 1 },
        {
          deadline: { deadlineAtMs: 100, nowMs: () => 100 },
          hooks: {
            onTimedOut: ({ observedAtMs }) => {
              timeouts.push(observedAtMs);
            },
          },
        },
      ),
    ).rejects.toEqual(new ExecutionTimedOutError(100, 100));

    expect(called).toBe(false);
    expect(timeouts).toEqual([100]);
  });

  it("detects a deadline crossed while work is running", async () => {
    const times = [10, 101];

    await expect(
      executeWithControl(
        async () => "completed-after-deadline",
        { maxAttempts: 1 },
        {
          deadline: {
            deadlineAtMs: 100,
            nowMs: () => times.shift() ?? 101,
          },
        },
      ),
    ).rejects.toEqual(new ExecutionTimedOutError(100, 101));
  });

  it("actively times out an attempt that never settles", async () => {
    const deadlineAtMs = Date.now() + 25;
    const timeouts: number[] = [];

    await expect(
      executeWithControl(
        async () => new Promise<string>(() => undefined),
        { maxAttempts: 1 },
        {
          deadline: {
            deadlineAtMs,
            nowMs: () => Date.now(),
          },
          hooks: {
            onTimedOut: ({ observedAtMs }) => {
              timeouts.push(observedAtMs);
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionTimedOutError);

    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThanOrEqual(deadlineAtMs);
  });

  it("does not retry a failure after the deadline has elapsed", async () => {
    const times = [10, 100];
    let calls = 0;

    await expect(
      executeWithControl(
        async () => {
          calls += 1;
          throw new Error("transient");
        },
        { maxAttempts: 3 },
        {
          deadline: {
            deadlineAtMs: 100,
            nowMs: () => times.shift() ?? 100,
          },
        },
      ),
    ).rejects.toEqual(new ExecutionTimedOutError(100, 100));

    expect(calls).toBe(1);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid deadline %s",
    async (deadlineAtMs) => {
      await expect(
        executeWithControl(async () => "never", { maxAttempts: 1 }, {
          deadline: { deadlineAtMs, nowMs: () => 0 },
        }),
      ).rejects.toBeInstanceOf(InvalidExecutionDeadlineError);
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid clock output %s",
    async (observedAtMs) => {
      await expect(
        executeWithControl(async () => "never", { maxAttempts: 1 }, {
          deadline: { deadlineAtMs: 100, nowMs: () => observedAtMs },
        }),
      ).rejects.toBeInstanceOf(InvalidExecutionDeadlineError);
    },
  );
});

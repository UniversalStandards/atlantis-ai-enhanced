import { describe, expect, it } from "vitest";
import {
  CommitAuthorityRevokedError,
  ExecutionFenceNotAcknowledgedError,
  ExecutionTimedOutError,
  InvalidExecutionFencingError,
  executeWithControl,
  type CommitAuthority,
  type ExecutionFenceStatus,
  type ExecutionLateSettlementContext,
} from "../src/execution-control.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function activeDeadline(afterMs = 20): {
  readonly deadlineAtMs: number;
  readonly nowMs: () => number;
} {
  return { deadlineAtMs: Date.now() + afterMs, nowMs: () => Date.now() };
}

describe("executeWithControl fencing", () => {
  it("cancels and revokes commit authority before terminal timeout publication", async () => {
    const cancellations: string[] = [];
    let revokedAtPublication: boolean | undefined;
    let publishedFence: ExecutionFenceStatus | undefined;

    await expect(
      executeWithControl(
        async (context) => {
          context.cancellation.onCancellationRequested((reason) => {
            cancellations.push(reason);
          });
          return await new Promise<string>(() => undefined);
        },
        { maxAttempts: 1 },
        {
          deadline: activeDeadline(),
          hooks: {
            onTimedOut: (context) => {
              revokedAtPublication = context.commitAuthority.isRevoked;
              publishedFence = context.fence;
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionTimedOutError);

    expect(cancellations).toEqual(["deadline"]);
    expect(revokedAtPublication).toBe(true);
    expect(publishedFence).toEqual({
      revoked: true,
      revocationReason: "deadline",
      acknowledged: true,
      pendingCommitCount: 0,
    });
  });

  it("absorbs a late resolution without altering the terminal outcome", async () => {
    const settled = deferred<ExecutionLateSettlementContext>();

    await expect(
      executeWithControl(
        async () => {
          await sleep(60);
          return "late-value";
        },
        { maxAttempts: 1 },
        {
          deadline: activeDeadline(),
          hooks: { onLateSettlement: settled.resolve },
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionTimedOutError);

    const late = await settled.promise;
    expect(late.kind).toBe("resolved");
    expect(late.value).toBe("late-value");
    expect(late.commitAuthority.isRevoked).toBe(true);
  });

  it("absorbs a late rejection without altering the terminal outcome", async () => {
    const settled = deferred<ExecutionLateSettlementContext>();

    await expect(
      executeWithControl(
        async () => {
          await sleep(60);
          throw new Error("late-failure");
        },
        { maxAttempts: 3 },
        {
          deadline: activeDeadline(),
          hooks: { onLateSettlement: settled.resolve },
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionTimedOutError);

    const late = await settled.promise;
    expect(late.kind).toBe("rejected");
    expect(late.error).toEqual(new Error("late-failure"));
  });

  it("rejects an externally consequential commit attempted after the deadline", async () => {
    const settled = deferred<ExecutionLateSettlementContext>();
    let commitPerformed = false;
    let commitError: unknown;

    await expect(
      executeWithControl(
        async (context) => {
          await sleep(60);
          try {
            await context.commitAuthority.commit(async () => {
              commitPerformed = true;
              return "external-write";
            });
          } catch (error) {
            commitError = error;
          }
          return "late-value";
        },
        { maxAttempts: 1 },
        {
          deadline: activeDeadline(),
          hooks: { onLateSettlement: settled.resolve },
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionTimedOutError);

    await settled.promise;
    expect(commitPerformed).toBe(false);
    expect(commitError).toBeInstanceOf(CommitAuthorityRevokedError);
    expect((commitError as CommitAuthorityRevokedError).revocationReason).toBe(
      "deadline",
    );
  });

  it("waits for an in-flight commit to drain before publishing the timeout", async () => {
    const gate = deferred<void>();
    let commitCompleted = false;
    let publishedFence: ExecutionFenceStatus | undefined;
    let commitCompletedAtPublication: boolean | undefined;

    setTimeout(() => {
      gate.resolve();
    }, 40);

    await expect(
      executeWithControl(
        async (context) =>
          await context.commitAuthority.commit(async () => {
            await gate.promise;
            commitCompleted = true;
            return "external-write";
          }),
        { maxAttempts: 1 },
        {
          deadline: activeDeadline(),
          fencing: { acknowledgementTimeoutMs: 1_000 },
          hooks: {
            onTimedOut: (context) => {
              publishedFence = context.fence;
              commitCompletedAtPublication = commitCompleted;
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionTimedOutError);

    expect(commitCompletedAtPublication).toBe(true);
    expect(publishedFence?.acknowledged).toBe(true);
    expect(publishedFence?.pendingCommitCount).toBe(0);
  });

  it("fails closed within the bound when the fence is never acknowledged", async () => {
    let publishedFence: ExecutionFenceStatus | undefined;
    const startedAtMs = Date.now();
    let calls = 0;

    await expect(
      executeWithControl(
        async () => {
          calls += 1;
          return await new Promise<string>(() => undefined);
        },
        { maxAttempts: 3 },
        {
          deadline: activeDeadline(),
          fencing: { requireAcknowledgement: true, acknowledgementTimeoutMs: 30 },
          hooks: {
            onTimedOut: (context) => {
              publishedFence = context.fence;
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionFenceNotAcknowledgedError);

    expect(calls).toBe(1);
    expect(publishedFence?.acknowledged).toBe(false);
    expect(Date.now() - startedAtMs).toBeLessThan(2_000);
  });

  it("fails closed when an in-flight commit does not drain within the bound", async () => {
    const gate = deferred<void>();
    let error: unknown;

    try {
      await executeWithControl(
        async (context) =>
          await context.commitAuthority.commit(async () => {
            await gate.promise;
            return "external-write";
          }),
        { maxAttempts: 1 },
        {
          deadline: activeDeadline(),
          fencing: { acknowledgementTimeoutMs: 30 },
        },
      );
    } catch (caught) {
      error = caught;
    } finally {
      gate.resolve();
    }

    expect(error).toBeInstanceOf(ExecutionFenceNotAcknowledgedError);
    expect((error as ExecutionFenceNotAcknowledgedError).pendingCommitCount).toBe(1);
    expect(
      (error as ExecutionFenceNotAcknowledgedError).acknowledgementTimeoutMs,
    ).toBe(30);
  });

  it("keeps the fenced outcome when the operation settles during finalization", async () => {
    const settled = deferred<ExecutionLateSettlementContext>();
    let calls = 0;

    await expect(
      executeWithControl(
        async () => {
          calls += 1;
          await sleep(30);
          throw new Error("late-failure");
        },
        { maxAttempts: 3 },
        {
          deadline: activeDeadline(),
          fencing: { requireAcknowledgement: true, acknowledgementTimeoutMs: 60 },
          hooks: { onLateSettlement: settled.resolve },
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionFenceNotAcknowledgedError);

    expect(calls).toBe(1);
    expect((await settled.promise).kind).toBe("rejected");
  });

  it("publishes a plain timeout once the operation acknowledges revocation", async () => {
    await expect(
      executeWithControl(
        async (context) => {
          context.cancellation.onCancellationRequested(() => {
            context.commitAuthority.acknowledgeRevocation();
          });
          return await new Promise<string>(() => undefined);
        },
        { maxAttempts: 1 },
        {
          deadline: activeDeadline(),
          fencing: { requireAcknowledgement: true, acknowledgementTimeoutMs: 1_000 },
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionTimedOutError);
  });

  it("revokes commit authority once an attempt settles", async () => {
    let leaked: CommitAuthority | undefined;

    await expect(
      executeWithControl(async (context) => {
        leaked = context.commitAuthority;
        return await context.commitAuthority.commit(async () => "external-write");
      }, { maxAttempts: 1 }),
    ).resolves.toBe("external-write");

    expect(leaked?.isRevoked).toBe(true);
    expect(leaked?.revocationReason).toBe("attempt_settled");
    expect(() => leaked?.assertActive()).toThrow(CommitAuthorityRevokedError);
    await expect(leaked?.commit(async () => "late-write")).rejects.toBeInstanceOf(
      CommitAuthorityRevokedError,
    );
  });

  it("grants each retry a fresh, active commit authority", async () => {
    const revokedAtStart: boolean[] = [];

    await expect(
      executeWithControl(
        async (context) => {
          revokedAtStart.push(context.commitAuthority.isRevoked);
          if (context.attempt < 2) throw new Error("transient");
          return await context.commitAuthority.commit(async () => "external-write");
        },
        { maxAttempts: 2 },
      ),
    ).resolves.toBe("external-write");

    expect(revokedAtStart).toEqual([false, false]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid fence acknowledgement timeout %s",
    async (acknowledgementTimeoutMs) => {
      await expect(
        executeWithControl(async () => "never", { maxAttempts: 1 }, {
          fencing: { acknowledgementTimeoutMs },
        }),
      ).rejects.toBeInstanceOf(InvalidExecutionFencingError);
    },
  );
});

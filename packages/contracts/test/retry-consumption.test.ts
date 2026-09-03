import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  consumeRetryAllowance,
  InMemoryRetryConsumptionStore,
  InvalidFailedAttemptRecordError,
  loadRetryAllowance,
  reconcileRetryConsumption,
  reconcileRetryUsageFromDurableEvidence,
  RetryConsumptionConflictError,
  RetryConsumptionReconciliationError,
  SimulatedRetryConsumptionCrashError,
  type FailedAttemptRecord,
  type RetryConsumptionFailureInjection,
  type RetryConsumptionState,
  type WorkflowContext,
} from "../src/index.js";

const executionId = "exec-1";
const stepId = "step-1";
const maxRetries = 2;

function failedAttempt(
  attempt: number,
  overrides: Partial<FailedAttemptRecord> = {},
): FailedAttemptRecord {
  return {
    executionId,
    stepId,
    attempt,
    eventId: `evt-${attempt}`,
    occurredAt: `2026-09-03T00:0${attempt}:00.000Z`,
    reason: "transient boundary failure",
    retryable: true,
    ...overrides,
  };
}

function context(): WorkflowContext {
  return {
    executionId,
    workflowId: "test-workflow",
    workflowVersion: "1.0.0",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries,
      maxIterations: 5,
      maxTokens: 10_000,
      maxDurationMs: 60_000,
      maxCostUsd: 1,
    },
    usage: {
      toolCalls: 0,
      retries: 0,
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      costUsd: 0,
    },
    metadata: {},
  };
}

/** Simulates a process restart over the surviving durable state. */
function restart(
  store: InMemoryRetryConsumptionStore,
  failureInjections: readonly RetryConsumptionFailureInjection[] = [],
): InMemoryRetryConsumptionStore {
  return new InMemoryRetryConsumptionStore({
    initialState: store.snapshot(),
    failureInjections,
  });
}

describe("retry consumption", () => {
  it("consumes exactly one allowance per durable failed attempt", async () => {
    const store = new InMemoryRetryConsumptionStore();

    const first = await consumeRetryAllowance(store, failedAttempt(1), maxRetries);
    expect(first.consumedRetries).toBe(1);
    expect(first.remainingRetries).toBe(1);
    expect(first.nextAttempt).toBe(2);
    expect(first.mayRetry).toBe(true);

    const second = await consumeRetryAllowance(store, failedAttempt(2), maxRetries);
    expect(second.consumedRetries).toBe(2);
    expect(second.remainingRetries).toBe(0);
    expect(second.mayRetry).toBe(false);
  });

  it("treats replayed evidence for one attempt identity as a single allowance", async () => {
    const store = new InMemoryRetryConsumptionStore();
    await consumeRetryAllowance(store, failedAttempt(1), maxRetries);

    const replay = await consumeRetryAllowance(store, failedAttempt(1), maxRetries);

    expect(replay.consumedRetries).toBe(1);
    expect(replay.state.failedAttempts).toHaveLength(1);
  });

  it("rejects conflicting evidence for an already recorded attempt", async () => {
    const store = new InMemoryRetryConsumptionStore();
    await consumeRetryAllowance(store, failedAttempt(1), maxRetries);

    await expect(
      consumeRetryAllowance(
        store,
        failedAttempt(1, { eventId: "evt-other" }),
        maxRetries,
      ),
    ).rejects.toBeInstanceOf(RetryConsumptionConflictError);
  });

  it("rejects out-of-order attempt ordinals", async () => {
    const store = new InMemoryRetryConsumptionStore();

    await expect(
      consumeRetryAllowance(store, failedAttempt(2), maxRetries),
    ).rejects.toBeInstanceOf(RetryConsumptionConflictError);
  });

  it("fails closed when the retry budget is exhausted", async () => {
    const store = new InMemoryRetryConsumptionStore();
    await consumeRetryAllowance(store, failedAttempt(1), maxRetries);
    await consumeRetryAllowance(store, failedAttempt(2), maxRetries);

    await expect(
      consumeRetryAllowance(store, failedAttempt(3), maxRetries),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("keeps the consumed allowance when acknowledgement is lost after commit", async () => {
    const store = new InMemoryRetryConsumptionStore({
      failureInjections: [
        { point: "after_commit_before_acknowledgement", attempt: 1 },
      ],
    });

    await expect(
      consumeRetryAllowance(store, failedAttempt(1), maxRetries),
    ).rejects.toBeInstanceOf(SimulatedRetryConsumptionCrashError);

    const recovered = restart(store);
    const decision = await loadRetryAllowance(
      recovered,
      { executionId, stepId },
      maxRetries,
    );

    expect(decision.consumedRetries).toBe(1);
    expect(decision.remainingRetries).toBe(1);
    expect(decision.nextAttempt).toBe(2);
  });

  it("publishes no evidence and no allowance when the commit never lands", async () => {
    const store = new InMemoryRetryConsumptionStore({
      failureInjections: [{ point: "before_commit", attempt: 1 }],
    });

    await expect(
      consumeRetryAllowance(store, failedAttempt(1), maxRetries),
    ).rejects.toBeInstanceOf(SimulatedRetryConsumptionCrashError);
    expect(store.snapshot()).toHaveLength(0);

    const retried = await consumeRetryAllowance(
      restart(store),
      failedAttempt(1),
      maxRetries,
    );
    expect(retried.consumedRetries).toBe(1);
  });

  it("bounds retry exhaustion across repeated crash and restart cycles", async () => {
    let store = new InMemoryRetryConsumptionStore();
    let executions = 0;

    for (let cycle = 0; cycle < 10; cycle += 1) {
      const surviving = await loadRetryAllowance(
        restart(store),
        { executionId, stepId },
        maxRetries,
      );
      if (!surviving.mayRetry) {
        break;
      }

      store = restart(store, [
        {
          point: "after_commit_before_acknowledgement",
          attempt: surviving.nextAttempt,
        },
      ]);
      executions += 1;
      await expect(
        consumeRetryAllowance(
          store,
          failedAttempt(surviving.nextAttempt),
          maxRetries,
        ),
      ).rejects.toBeInstanceOf(SimulatedRetryConsumptionCrashError);
    }

    const final = await loadRetryAllowance(
      restart(store),
      { executionId, stepId },
      maxRetries,
    );
    expect(executions).toBe(maxRetries);
    expect(final.consumedRetries).toBe(maxRetries);
    expect(final.mayRetry).toBe(false);
    await expect(
      consumeRetryAllowance(restart(store), failedAttempt(3), maxRetries),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("does not permit retry after non-retryable failure evidence", async () => {
    const store = new InMemoryRetryConsumptionStore();

    const decision = await consumeRetryAllowance(
      store,
      failedAttempt(1, { retryable: false }),
      maxRetries,
    );

    expect(decision.consumedRetries).toBe(1);
    expect(decision.mayRetry).toBe(false);
  });

  it("rebuilds execution retry usage from durable evidence during recovery", async () => {
    const store = new InMemoryRetryConsumptionStore();
    await consumeRetryAllowance(store, failedAttempt(1), maxRetries);
    await consumeRetryAllowance(
      store,
      failedAttempt(1, { stepId: "step-2", eventId: "evt-2-1" }),
      maxRetries,
    );

    const recovered = context();
    const consumed = await reconcileRetryUsageFromDurableEvidence(
      restart(store),
      recovered,
      [stepId, "step-2", stepId],
    );

    expect(consumed).toBe(2);
    expect(recovered.usage.retries).toBe(2);
  });

  it("fails closed when durable usage exceeds the execution retry budget", async () => {
    const store = new InMemoryRetryConsumptionStore();
    await consumeRetryAllowance(store, failedAttempt(1), maxRetries);
    await consumeRetryAllowance(store, failedAttempt(2), maxRetries);
    await consumeRetryAllowance(
      store,
      failedAttempt(1, { stepId: "step-2", eventId: "evt-2-1" }),
      maxRetries,
    );

    await expect(
      reconcileRetryUsageFromDurableEvidence(store, context(), [stepId, "step-2"]),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("rejects durable state whose counter diverges from its evidence", () => {
    const diverged: RetryConsumptionState = {
      executionId,
      stepId,
      consumedRetries: 0,
      failedAttempts: [failedAttempt(1)],
      revision: 2,
    };

    expect(() => reconcileRetryConsumption(diverged)).toThrow(
      RetryConsumptionReconciliationError,
    );
  });

  it("rejects durable state with gaps in its attempt sequence", () => {
    const gapped: RetryConsumptionState = {
      executionId,
      stepId,
      consumedRetries: 1,
      failedAttempts: [failedAttempt(2)],
      revision: 2,
    };

    expect(() => reconcileRetryConsumption(gapped)).toThrow(
      RetryConsumptionReconciliationError,
    );
  });

  it("rejects malformed failed-attempt evidence", async () => {
    const store = new InMemoryRetryConsumptionStore();

    await expect(
      consumeRetryAllowance(store, failedAttempt(0), maxRetries),
    ).rejects.toBeInstanceOf(InvalidFailedAttemptRecordError);
    await expect(
      consumeRetryAllowance(store, failedAttempt(1, { eventId: " " }), maxRetries),
    ).rejects.toBeInstanceOf(InvalidFailedAttemptRecordError);
    await expect(
      consumeRetryAllowance(
        store,
        failedAttempt(1, { occurredAt: "not-a-time" }),
        maxRetries,
      ),
    ).rejects.toBeInstanceOf(InvalidFailedAttemptRecordError);
  });
});

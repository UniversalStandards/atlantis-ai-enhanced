import { describe, expect, it } from "vitest";
import type {
  EvaluationResult,
  EventStore,
  ExecutionBudget,
  WorkflowContext,
} from "@atlantis/contracts";
import { InvalidBudgetStateError } from "@atlantis/contracts";
import { InMemoryEventStore } from "@atlantis/events";
import {
  runSequentialWorkflow,
  sequence,
  WorkflowDefinitionError,
  type RunOptions,
  type SequentialStep,
} from "../src/index.js";

const budget: ExecutionBudget = {
  maxToolCalls: 10,
  maxRetries: 3,
  maxIterations: 3,
  maxTokens: 1_000,
  maxDurationMs: 60_000,
  maxCostUsd: 1,
};

function options(overrides: Partial<RunOptions> = {}): RunOptions & {
  store: InMemoryEventStore;
} {
  let id = 0;
  return {
    store: new InMemoryEventStore(),
    userId: "user-1",
    budget,
    executionId: "exec-1",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    generateId: () => `evt-${id++}`,
    ...overrides,
  } as RunOptions & { store: InMemoryEventStore };
}

function step<I, O>(
  id: string,
  execute: (input: I, context: WorkflowContext) => O | Promise<O>,
  extra: Partial<SequentialStep<I, O>> = {},
): SequentialStep<I, O> {
  return {
    id,
    description: id,
    execute: async (input, context) => execute(input, context),
    ...extra,
  };
}

const meta = { id: "wf", version: "1.0.0", description: "test workflow" };

async function types(store: EventStore, executionId = "exec-1") {
  return (await store.read(executionId)).map((e) => e.type);
}

function verdict(score: number, passed: boolean): EvaluationResult {
  return { score, passed, reasons: [`score ${score}`], metrics: { score } };
}

describe("sequence", () => {
  it("rejects duplicate step ids and defaults to workflow mode", () => {
    expect(() =>
      sequence<number>(meta)
        .step(step("a", (n: number) => n))
        .step(step("a", (n: number) => n))
        .build(),
    ).toThrow(WorkflowDefinitionError);
    expect(sequence<number>(meta).build().mode).toBe("workflow");
  });
});

describe("runSequentialWorkflow", () => {
  it("pipes outputs through steps and records a verifiable history", async () => {
    const opts = options();
    const workflow = sequence<number>(meta)
      .step(step("double", (n: number) => n * 2))
      .step(step("label", (n: number) => `value=${n}`))
      .build();

    const result = await runSequentialWorkflow(workflow, 21, opts);

    expect(result).toMatchObject({
      executionId: "exec-1",
      status: "succeeded",
      output: "value=42",
    });
    expect(result.error).toBeUndefined();
    expect(await types(opts.store)).toEqual([
      "execution.started",
      "workflow.step.started",
      "workflow.step.completed",
      "workflow.step.started",
      "workflow.step.completed",
      "execution.completed",
    ]);
    expect(opts.store.verify("exec-1").valid).toBe(true);
  });

  it("never writes step inputs or outputs to the event history", async () => {
    const opts = options();
    const workflow = sequence<string>(meta)
      .step(step("echo", (s: string) => `${s}-processed`))
      .build();

    await runSequentialWorkflow(workflow, "sk-live-secret", opts);

    expect(JSON.stringify(await opts.store.read("exec-1"))).not.toContain(
      "sk-live-secret",
    );
  });

  it("produces identical histories for identical deterministic runs", async () => {
    const run = async () => {
      const opts = options({ monotonicNow: () => 0 });
      const workflow = sequence<number>(meta)
        .step(step("inc", (n: number) => n + 1))
        .build();
      await runSequentialWorkflow(workflow, 1, opts);
      return opts.store.verify("exec-1");
    };
    expect(await run()).toEqual(await run());
  });

  it("generates an execution id and uses defaults when none are injected", async () => {
    const store = new InMemoryEventStore();
    const result = await runSequentialWorkflow(sequence<number>(meta).build(), 7, {
      store,
      userId: "user-1",
      budget,
    });
    expect(result.status).toBe("succeeded");
    expect(result.output).toBe(7);
    const events = await store.read(result.executionId);
    expect(events[0]?.actor).toBe("workflow-runner");
  });

  it("retries within maxAttempts and counts retries against the budget", async () => {
    const opts = options();
    let calls = 0;
    const workflow = sequence<number>(meta)
      .step(
        step(
          "flaky",
          (n: number) => {
            calls += 1;
            if (calls < 3) throw new Error("transient");
            return n;
          },
          { maxAttempts: 3 },
        ),
      )
      .build();

    const result = await runSequentialWorkflow(workflow, 1, opts);

    expect(result.status).toBe("succeeded");
    expect(result.usage.retries).toBe(2);
    const completed = (await opts.store.read("exec-1")).find(
      (e) => e.type === "workflow.step.completed",
    );
    expect(completed?.payload).toMatchObject({ attempts: 3 });
  });

  it("fails the execution and stops when a step exhausts its attempts", async () => {
    const opts = options();
    let reached = false;
    const workflow = sequence<number>(meta)
      .step(
        step("broken", (): number => {
          throw new TypeError("x".repeat(600));
        }),
      )
      .step(
        step("after", (n: number) => {
          reached = true;
          return n;
        }),
      )
      .build();

    const result = await runSequentialWorkflow(workflow, 1, opts);

    expect(result.status).toBe("failed");
    expect(result.output).toBeUndefined();
    expect(result.error).toMatchObject({
      name: "StepFailedError",
      stepId: "broken",
    });
    expect(reached).toBe(false);
    expect(await types(opts.store)).toEqual([
      "execution.started",
      "workflow.step.started",
      "workflow.step.failed",
      "execution.failed",
    ]);
    const failed = (await opts.store.read("exec-1"))[2]?.payload as {
      error: { name: string; message: string };
    };
    expect(failed.error.name).toBe("StepFailedError");
    expect(failed.error.message.length).toBeLessThanOrEqual(501);
  });

  it("describes non-Error throwables", async () => {
    const workflow = sequence<number>(meta)
      .step(
        step("throws-string", (): number => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "plain string";
        }),
      )
      .build();
    const result = await runSequentialWorkflow(workflow, 1, options());
    expect(result.error?.message).toContain("plain string");
  });

  it("stops retrying when the retry budget is exhausted", async () => {
    const opts = options({ budget: { ...budget, maxRetries: 1 } });
    let calls = 0;
    const workflow = sequence<number>(meta)
      .step(
        step(
          "always-fails",
          (): number => {
            calls += 1;
            throw new Error("nope");
          },
          { maxAttempts: 10 },
        ),
      )
      .build();

    const result = await runSequentialWorkflow(workflow, 1, opts);

    expect(result.status).toBe("budget_exceeded");
    expect(result.error?.message).toMatch(/maxRetries/);
    expect(calls).toBe(2);
    expect((await types(opts.store)).at(-1)).toBe("budget.exceeded");
  });

  it("halts when a step reports usage beyond a limit", async () => {
    const opts = options();
    let reached = false;
    const workflow = sequence<number>(meta)
      .step(
        step("expensive", (n: number, context) => {
          context.usage.costUsd += 5;
          return n;
        }),
      )
      .step(
        step("after", (n: number) => {
          reached = true;
          return n;
        }),
      )
      .build();

    const result = await runSequentialWorkflow(workflow, 1, opts);

    expect(result.status).toBe("budget_exceeded");
    expect(result.usage.costUsd).toBe(5);
    expect(reached).toBe(false);
    const last = (await opts.store.read("exec-1")).at(-1);
    expect(last?.payload).toMatchObject({
      dimension: "maxCostUsd",
      limit: 1,
      observed: 5,
    });
  });

  it("fails closed, and still audits, when a step corrupts usage", async () => {
    const opts = options();
    const workflow = sequence<number>(meta)
      .step(
        step("corrupt", (n: number, context) => {
          context.usage.inputTokens = Number.NaN;
          return n;
        }),
      )
      .build();

    const result = await runSequentialWorkflow(workflow, 1, opts);

    expect(result.status).toBe("failed");
    expect(result.error?.name).toBe("StepFailedError");
    const last = (await opts.store.read("exec-1")).at(-1);
    expect(last?.type).toBe("execution.failed");
    expect(last?.payload).toMatchObject({ usage: { inputTokens: null } });
    expect(opts.store.verify("exec-1").valid).toBe(true);
  });

  it("abandons a step that outlives the duration budget and aborts its signal", async () => {
    const opts = options({ budget: { ...budget, maxDurationMs: 20 } });
    let aborted = false;
    const workflow = sequence<number>(meta)
      .step(
        step(
          "hangs",
          (_n: number, context) =>
            new Promise<number>(() => {
              context.signal?.addEventListener("abort", () => {
                aborted = true;
              });
            }),
        ),
      )
      .build();

    const result = await runSequentialWorkflow(workflow, 1, opts);

    expect(result.status).toBe("budget_exceeded");
    expect(result.error?.message).toMatch(/maxDurationMs/);
    expect(result.usage.durationMs).toBeGreaterThan(20);
    expect(aborted).toBe(true);
  });

  it("enforces the duration budget between steps using the injected clock", async () => {
    let clock = 0;
    const opts = options({ monotonicNow: () => clock });
    const workflow = sequence<number>(meta)
      .step(
        step("slow", (n: number) => {
          clock = 120_000;
          return n;
        }),
      )
      .build();

    const result = await runSequentialWorkflow(workflow, 1, opts);
    expect(result.status).toBe("budget_exceeded");
    expect(result.usage.durationMs).toBe(120_000);
  });

  it("cancels before starting when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const opts = options({ signal: controller.signal });
    let ran = false;
    const workflow = sequence<number>(meta)
      .step(
        step("never", (n: number) => {
          ran = true;
          return n;
        }),
      )
      .build();

    const result = await runSequentialWorkflow(workflow, 1, opts);

    expect(result.status).toBe("cancelled");
    expect(ran).toBe(false);
    expect((await types(opts.store)).at(-1)).toBe("execution.cancelled");
  });

  it("cancels a step that is in flight", async () => {
    const controller = new AbortController();
    const opts = options({ signal: controller.signal });
    const workflow = sequence<number>(meta)
      .step(
        step("waits", () => {
          queueMicrotask(() => {
            controller.abort();
          });
          return new Promise<number>(() => undefined);
        }),
      )
      .build();

    const result = await runSequentialWorkflow(workflow, 1, opts);
    expect(result.status).toBe("cancelled");
    expect(result.error?.name).toBe("ExecutionCancelledError");
  });

  describe("supervisor escalation", () => {
    const failing = (resolve: () => Promise<number>) =>
      step(
        "risky",
        (): number => {
          throw new Error("unanticipated");
        },
        {
          escalate: (error, input: number) => ({
            reason: `step failed: ${(error as Error).message}`,
            input,
            resolve,
          }),
        },
      );

    it("fails closed in workflow mode even when a step can escalate", async () => {
      const opts = options();
      let resolved = false;
      const workflow = sequence<number>(meta)
        .step(
          failing(async () => {
            resolved = true;
            return 1;
          }),
        )
        .build();

      const result = await runSequentialWorkflow(workflow, 1, opts);

      expect(result.status).toBe("failed");
      expect(resolved).toBe(false);
      expect(await types(opts.store)).not.toContain("supervisor.escalated");
    });

    it("escalates in hybrid mode and returns to the workflow", async () => {
      const opts = options();
      const workflow = sequence<number>({ ...meta, mode: "hybrid" })
        .step(failing(async () => 99))
        .step(step("after", (n: number) => n + 1))
        .build();

      const result = await runSequentialWorkflow(workflow, 1, opts);

      expect(result).toMatchObject({ status: "succeeded", output: 100 });
      const events = await opts.store.read("exec-1");
      expect(events.map((e) => e.type).slice(1, 5)).toEqual([
        "workflow.step.started",
        "supervisor.escalated",
        "supervisor.returned",
        "workflow.step.completed",
      ]);
      expect(events[2]?.payload).toMatchObject({
        reason: "step failed: unanticipated",
      });
      expect(events[3]?.parentEventId).toBe(events[2]?.id);
    });

    it("fails the step when the supervisor also fails", async () => {
      const workflow = sequence<number>({ ...meta, mode: "supervisor" })
        .step(
          failing(async () => {
            throw new Error("supervisor gave up");
          }),
        )
        .build();

      const result = await runSequentialWorkflow(workflow, 1, options());

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("supervisor gave up");
    });

    it("holds the supervisor to the same budget", async () => {
      const workflow = sequence<number>({ ...meta, mode: "hybrid" })
        .step({
          ...failing(async () => 1),
          escalate: (_error, input: number) => ({
            reason: "needs help",
            input,
            resolve: async (context) => {
              context.usage.toolCalls += 50;
              return 1;
            },
          }),
        })
        .build();

      const result = await runSequentialWorkflow(workflow, 1, options());
      expect(result.status).toBe("budget_exceeded");
      expect(result.error?.message).toMatch(/maxToolCalls/);
    });
  });

  describe("bounded refinement", () => {
    const drafting = (
      scores: readonly number[],
      extra: { maxRevisions?: number; onExhausted?: "fail" | "accept_best" } = {},
    ) => {
      let evaluations = 0;
      return step("draft", (n: number) => `draft-${n}`, {
        refinement: {
          maxRevisions: extra.maxRevisions ?? 2,
          ...(extra.onExhausted ? { onExhausted: extra.onExhausted } : {}),
          evaluator: {
            evaluate: async () => {
              const score = scores[evaluations] ?? 0;
              evaluations += 1;
              return verdict(score, score >= 0.8);
            },
          },
          revise: async (_input, previous: string) => `${previous}+`,
        },
      });
    };

    it("accepts a first output that passes without revising", async () => {
      const opts = options();
      const workflow = sequence<number>(meta).step(drafting([0.9])).build();
      const result = await runSequentialWorkflow(workflow, 1, opts);
      expect(result).toMatchObject({ status: "succeeded", output: "draft-1" });
      expect(result.usage.iterations).toBe(0);
    });

    it("revises until the evaluator passes and records each evaluation", async () => {
      const opts = options();
      const workflow = sequence<number>(meta)
        .step(drafting([0.2, 0.5, 0.9]))
        .build();

      const result = await runSequentialWorkflow(workflow, 1, opts);

      expect(result).toMatchObject({ status: "succeeded", output: "draft-1++" });
      expect(result.usage.iterations).toBe(2);
      const evaluations = (await opts.store.read("exec-1")).filter(
        (e) => e.type === "evaluation.completed",
      );
      expect(evaluations.map((e) => e.payload)).toMatchObject([
        { revision: 0, score: 0.2, passed: false },
        { revision: 1, score: 0.5, passed: false },
        { revision: 2, score: 0.9, passed: true },
      ]);
    });

    it("fails by default when revisions are exhausted", async () => {
      const workflow = sequence<number>(meta)
        .step(drafting([0.1, 0.3, 0.2]))
        .build();
      const result = await runSequentialWorkflow(workflow, 1, options());
      expect(result.status).toBe("failed");
      expect(result.error).toMatchObject({
        name: "RefinementExhaustedError",
        stepId: "draft",
      });
      expect(result.error?.message).toContain("best score 0.3");
    });

    it("can accept the best-scoring output when configured", async () => {
      const workflow = sequence<number>(meta)
        .step(drafting([0.1, 0.6, 0.2], { onExhausted: "accept_best" }))
        .build();
      const result = await runSequentialWorkflow(workflow, 1, options());
      expect(result).toMatchObject({ status: "succeeded", output: "draft-1+" });
    });

    it("is capped by the iteration budget regardless of maxRevisions", async () => {
      const workflow = sequence<number>(meta)
        .step(drafting([0, 0, 0, 0, 0, 0, 0, 0], { maxRevisions: 7 }))
        .build();
      const result = await runSequentialWorkflow(workflow, 1, options());
      expect(result.status).toBe("budget_exceeded");
      expect(result.error?.message).toMatch(/maxIterations/);
      expect(result.usage.iterations).toBe(4);
    });
  });

  describe("fail-closed preconditions", () => {
    const workflow = sequence<number>(meta)
      .step(step("id", (n: number) => n))
      .build();

    it("rejects an invalid budget before anything is recorded", async () => {
      const opts = options({ budget: { ...budget, maxTokens: Number.NaN } });
      await expect(runSequentialWorkflow(workflow, 1, opts)).rejects.toThrow(
        InvalidBudgetStateError,
      );
      expect(await opts.store.read("exec-1")).toEqual([]);
    });

    it.each([
      ["maxAttempts", { maxAttempts: 0 }],
      ["maxAttempts", { maxAttempts: 1.5 }],
      [
        "maxRevisions",
        {
          refinement: {
            maxRevisions: -1,
            evaluator: { evaluate: async () => verdict(1, true) },
            revise: async (_i: number, p: number) => p,
          },
        },
      ],
    ])("rejects an invalid %s", async (label, extra) => {
      const bad = sequence<number>(meta)
        .step(step("id", (n: number) => n, extra))
        .build();
      await expect(runSequentialWorkflow(bad, 1, options())).rejects.toThrow(
        new RegExp(label),
      );
    });

    it("rejects when the event store refuses an event", async () => {
      const store: EventStore = {
        append: async () => {
          throw new Error("store unavailable");
        },
        read: async () => [],
      };
      await expect(
        runSequentialWorkflow(workflow, 1, options({ store })),
      ).rejects.toThrow("store unavailable");
    });
  });
});

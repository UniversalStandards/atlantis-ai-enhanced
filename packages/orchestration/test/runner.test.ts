import { describe, expect, it } from "vitest";
import type {
  ApprovalGate,
  EvaluationResult,
  PolicyDecision,
  PolicyEvaluator,
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
    const result = await runSequentialWorkflow(
      sequence<number>(meta).build(),
      7,
      {
        store,
        userId: "user-1",
        budget,
      },
    );
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
      extra: {
        maxRevisions?: number;
        onExhausted?: "fail" | "accept_best";
      } = {},
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
      const workflow = sequence<number>(meta)
        .step(drafting([0.9]))
        .build();
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

      expect(result).toMatchObject({
        status: "succeeded",
        output: "draft-1++",
      });
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

  describe("review regressions", () => {
    it("keeps evaluator reasons and metrics out of the event history", async () => {
      const opts = options();
      const workflow = sequence<number>(meta)
        .step(
          step("draft", (n: number) => `draft-${n}`, {
            refinement: {
              maxRevisions: 0,
              evaluator: {
                evaluate: async () => ({
                  score: 1,
                  passed: true,
                  reasons: ["candidate contained sk-live-secret"],
                  metrics: { leaked: 1 },
                }),
              },
              revise: async (_i, previous: string) => previous,
            },
          }),
        )
        .build();

      await runSequentialWorkflow(workflow, 1, opts);

      const history = JSON.stringify(await opts.store.read("exec-1"));
      expect(history).not.toContain("sk-live-secret");
      expect(history).not.toContain("leaked");
      expect(history).toContain('"reasonCount":1');
    });

    it("fails the step, with an audit record, on a malformed evaluation", async () => {
      const opts = options();
      const workflow = sequence<number>(meta)
        .step(
          step("draft", (n: number) => n, {
            refinement: {
              maxRevisions: 1,
              evaluator: {
                evaluate: async () =>
                  ({
                    score: Number.NaN,
                    passed: "yes",
                    reasons: "not-an-array",
                    metrics: {},
                  }) as unknown as EvaluationResult,
              },
              revise: async (_i, previous: number) => previous,
            },
          }),
        )
        .build();

      const result = await runSequentialWorkflow(workflow, 1, opts);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("non-finite score");
      const evaluation = (await opts.store.read("exec-1")).find(
        (e) => e.type === "evaluation.completed",
      );
      expect(evaluation?.payload).toMatchObject({
        score: null,
        passed: false,
        reasonCount: 0,
      });
    });

    it("records when accept_best continues with a non-passing output", async () => {
      const opts = options();
      const workflow = sequence<number>(meta)
        .step(
          step("draft", (n: number) => n, {
            refinement: {
              maxRevisions: 0,
              onExhausted: "accept_best",
              evaluator: { evaluate: async () => verdict(0.4, false) },
              revise: async (_i, previous: number) => previous,
            },
          }),
        )
        .step(step("plain", (n: number) => n))
        .build();

      await runSequentialWorkflow(workflow, 1, opts);

      const completed = (await opts.store.read("exec-1")).filter(
        (e) => e.type === "workflow.step.completed",
      );
      expect(completed[0]?.payload).toMatchObject({
        acceptedWithoutPassing: true,
      });
      expect(completed[1]?.payload).not.toHaveProperty(
        "acceptedWithoutPassing",
      );
    });

    it("aborts the step signal even when the run rejects", async () => {
      const inner = new InMemoryEventStore();
      let appended = 0;
      const store: EventStore = {
        append: async (event) => {
          appended += 1;
          if (appended > 2) throw new Error("store unavailable");
          await inner.append(event);
        },
        read: (id) => inner.read(id),
      };
      let signal: AbortSignal | undefined;
      const workflow = sequence<number>(meta)
        .step(
          step("captures", (n: number, context) => {
            signal = context.signal;
            return n;
          }),
        )
        .build();

      await expect(
        runSequentialWorkflow(workflow, 1, options({ store })),
      ).rejects.toThrow("store unavailable");
      expect(signal?.aborted).toBe(true);
    });
  });

  describe("policy and approval gating", () => {
    const action = { action: "email.send", reversible: false, external: true };
    const policyOf = (decision: PolicyDecision): PolicyEvaluator => ({
      evaluate: async () => decision,
    });
    const gated = (onRun: () => void, extra = {}) =>
      sequence<number>({ ...meta, mode: "hybrid" })
        .step(
          step(
            "send",
            (n: number) => {
              onRun();
              return n;
            },
            { action, ...extra },
          ),
        )
        .build();
    const allow: PolicyDecision = { effect: "allow", policyId: "p-allow" };
    const needsApproval: PolicyDecision = {
      effect: "require_approval",
      policyId: "p-gate",
      reason: "external and irreversible",
    };

    it("denies a consequential step when no policy is configured", async () => {
      const opts = options();
      let ran = false;
      const result = await runSequentialWorkflow(
        gated(() => (ran = true)),
        1,
        opts,
      );
      expect(result.status).toBe("failed");
      expect(result.error).toMatchObject({
        name: "PolicyDeniedError",
        stepId: "send",
      });
      expect(ran).toBe(false);
    });

    it("runs the step and records the decision when policy allows", async () => {
      const opts = options({ policy: policyOf(allow) });
      let ran = false;
      const result = await runSequentialWorkflow(
        gated(() => (ran = true)),
        1,
        opts,
      );
      expect(result.status).toBe("succeeded");
      expect(ran).toBe(true);
      const evaluated = (await opts.store.read("exec-1")).find(
        (e) => e.type === "policy.evaluated",
      );
      expect(evaluated?.payload).toEqual({
        stepId: "send",
        action: "email.send",
        reversible: false,
        external: true,
        policyId: "p-allow",
        effect: "allow",
      });
    });

    it("does not retry or escalate around a denial", async () => {
      let ran = false;
      let escalated = false;
      const opts = options({
        policy: policyOf({
          effect: "deny",
          policyId: "p-deny",
          reason: "blocked",
        }),
      });
      const result = await runSequentialWorkflow(
        gated(() => (ran = true), {
          maxAttempts: 3,
          escalate: (_e: unknown, input: number) => {
            escalated = true;
            return { reason: "x", input, resolve: async () => input };
          },
        }),
        1,
        opts,
      );
      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("blocked");
      expect(ran).toBe(false);
      expect(escalated).toBe(false);
      expect(result.usage.retries).toBe(0);
    });

    it("treats an unrecognized policy decision as a denial", async () => {
      const opts = options({
        policy: policyOf({ effect: "maybe", policyId: "p-odd" } as never),
      });
      let ran = false;
      const result = await runSequentialWorkflow(
        gated(() => (ran = true)),
        1,
        opts,
      );
      expect(result.error?.name).toBe("PolicyDeniedError");
      expect(result.error?.message).toContain("unrecognized policy decision");
      expect(ran).toBe(false);
      const malformed = options({
        policy: policyOf({ effect: 7, policyId: "p-odd" } as never),
      });
      await runSequentialWorkflow(
        gated(() => undefined),
        1,
        malformed,
      );
      expect(
        (await malformed.store.read("exec-1")).find(
          (e) => e.type === "policy.evaluated",
        )?.payload,
      ).toMatchObject({ effect: "invalid" });
    });

    it("waits for approval and runs only when approved", async () => {
      const seen: string[] = [];
      const approvals: ApprovalGate = {
        request: async (request) => {
          seen.push(`${request.stepId}:${request.reason}:${request.userId}`);
          return { approved: true, approver: "director" };
        },
      };
      const opts = options({ policy: policyOf(needsApproval), approvals });
      let ran = false;
      const result = await runSequentialWorkflow(
        gated(() => (ran = true)),
        1,
        opts,
      );
      expect(result.status).toBe("succeeded");
      expect(ran).toBe(true);
      expect(seen).toEqual(["send:external and irreversible:user-1"]);
      expect((await types(opts.store)).slice(1, 6)).toEqual([
        "workflow.step.started",
        "policy.evaluated",
        "approval.requested",
        "approval.resolved",
        "workflow.step.completed",
      ]);
    });

    it.each([
      ["rejected", { approved: false, approver: "director" }],
      ["not literally true", { approved: "yes", approver: "director" }],
    ])("does not run when approval is %s", async (_label, resolution) => {
      const approvals: ApprovalGate = {
        request: async () => resolution as never,
      };
      const opts = options({ policy: policyOf(needsApproval), approvals });
      let ran = false;
      const result = await runSequentialWorkflow(
        gated(() => (ran = true)),
        1,
        opts,
      );
      expect(result.error).toMatchObject({
        name: "ApprovalRejectedError",
        stepId: "send",
      });
      expect(ran).toBe(false);
    });

    it("does not run when approval is required but no gate is configured", async () => {
      const opts = options({ policy: policyOf(needsApproval) });
      let ran = false;
      const result = await runSequentialWorkflow(
        gated(() => (ran = true)),
        1,
        opts,
      );
      expect(result.error?.message).toContain("no approval gate configured");
      expect(ran).toBe(false);
    });

    it("stops waiting for approval when the execution is cancelled", async () => {
      const controller = new AbortController();
      const approvals: ApprovalGate = {
        request: () => {
          queueMicrotask(() => {
            controller.abort();
          });
          return new Promise(() => undefined);
        },
      };
      const opts = options({
        policy: policyOf(needsApproval),
        approvals,
        signal: controller.signal,
      });
      const result = await runSequentialWorkflow(
        gated(() => undefined),
        1,
        opts,
      );
      expect(result.status).toBe("cancelled");
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

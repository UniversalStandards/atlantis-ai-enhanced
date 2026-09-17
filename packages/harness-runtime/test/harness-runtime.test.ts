import type { ApprovalRequest, ApprovalResolution } from "@atlantis/contracts/approval-control";
import { describe, expect, it, vi } from "vitest";

import {
  HarnessRuntime,
  ToolRouter,
  serializeWorkDelta,
  type HarnessClock,
  type HarnessIdSource,
  type JsonValue,
  type ToolDescriptor,
  type ToolExecutionMetadata,
} from "../src/index.js";

function budget(overrides: Partial<{
  maxToolCalls: number;
  maxRetries: number;
  maxIterations: number;
  maxTokens: number;
  maxDurationMs: number;
  maxCostUsd: number;
}> = {}) {
  return {
    maxToolCalls: overrides.maxToolCalls ?? 10,
    maxRetries: overrides.maxRetries ?? 10,
    maxIterations: overrides.maxIterations ?? 5,
    maxTokens: overrides.maxTokens ?? 100,
    maxDurationMs: overrides.maxDurationMs ?? 10_000,
    maxCostUsd: overrides.maxCostUsd ?? 5,
  };
}

class DeterministicClock implements HarnessClock {
  #nowMs = 1_700_000_000_000;
  readonly sleeps: number[] = [];

  public nowIso(): string {
    return new Date(this.#nowMs).toISOString();
  }

  public nowMs(): number {
    return this.#nowMs;
  }

  public async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.#nowMs += ms;
  }

  public tick(ms = 1): void {
    this.#nowMs += ms;
  }
}

class DeterministicIds implements HarnessIdSource {
  #counts = new Map<string, number>();

  public nextId(prefix: string): string {
    const next = (this.#counts.get(prefix) ?? 0) + 1;
    this.#counts.set(prefix, next);
    return `${prefix}-${next}`;
  }
}

function jsonSchema<T extends JsonValue>(assertion: (input: unknown) => T) {
  return {
    parse(input: unknown): T {
      return assertion(input);
    },
  };
}

function createRuntime(options: {
  tools: readonly ToolDescriptor[];
  policy?: ConstructorParameters<typeof ToolRouter>[0]["policy"];
  approvals?: ConstructorParameters<typeof ToolRouter>[0]["approvals"];
  clock?: DeterministicClock;
}) {
  const clock = options.clock ?? new DeterministicClock();
  const ids = new DeterministicIds();
  return {
    clock,
    runtime: new HarnessRuntime({
      toolRouter: new ToolRouter({
        tools: options.tools,
        ...(options.policy === undefined ? {} : { policy: options.policy }),
        ...(options.approvals === undefined ? {} : { approvals: options.approvals }),
      }),
      clock,
      ids,
    }),
  };
}

const echoSchema = jsonSchema<Readonly<{ message: string }>>((input) => {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof (input as { message?: unknown }).message !== "string"
  ) {
    throw new Error("message is required");
  }
  return Object.freeze({ message: (input as { message: string }).message });
});

function messageOf(input: JsonValue): string {
  return (input as Readonly<{ message: string }>).message;
}

describe("HarnessRuntime", () => {
  it("runs a successful bounded execution and records immutable authoritative evidence", async () => {
    const toolCalls: ToolExecutionMetadata[] = [];
    const { runtime } = createRuntime({
      tools: [
        {
          name: "echo",
          capability: "read-only",
          description: "returns the provided message",
          schema: echoSchema,
          execute: async (input, metadata) => {
            toolCalls.push(metadata);
            return {
              status: "succeeded",
              output: { echoed: messageOf(input) },
              evidence: [
                { source: "tool:echo", detail: "message echoed", value: { echoed: messageOf(input) } },
              ],
              usage: { outputTokens: 2 },
            } as const;
          },
        } satisfies ToolDescriptor,
      ],
    });

    const result = await runtime.run({
      input: { request: "hello" },
      budget: budget(),
      metadata: { lane: "slice-a" },
      inspect: async () => ({
        startState: { phase: "inspected" },
        evidence: [{ source: "inspect", detail: "loaded start state", value: { phase: "inspected" } }],
      }),
      plan: async () => ({
        summary: "Echo the request",
        rationale: "Need a deterministic reference action",
        desiredOutcome: "A stable echoed result",
        toolName: "echo",
        input: { message: "hello" },
        metadata: { stage: "plan" },
      }),
      observe: async ({ toolOutput }) => ({
        summary: { observed: toolOutput },
        evidence: [{ source: "observe", detail: "captured tool output", value: toolOutput }],
      }),
      evaluate: async ({ observation }) => ({
        score: 1,
        passed: true,
        reasons: ["Observation matched expected output"],
        metrics: { quality: 1 },
        summary: observation.summary,
      }),
      refine: async ({ toolOutput }) => ({
        status: "complete",
        finalState: { completed: true },
        output: toolOutput,
        stateChangeSummary: { transitionedTo: "complete" },
      }),
    });

    expect(result.terminalState).toBe("succeeded");
    expect(result.output).toEqual({ echoed: "hello" });
    expect(result.workDelta.evidenceReads).toHaveLength(3);
    expect(result.workDelta.evidenceReads.map((entry) => entry.source)).toEqual([
      "inspect",
      "tool:echo",
      "observe",
    ]);
    expect(result.workDelta.attemptedActions).toHaveLength(1);
    expect(result.workDelta.attemptedActions[0]?.output).toEqual({ echoed: "hello" });
    expect(result.workDelta.usage).toMatchObject({ toolCalls: 1, iterations: 1, outputTokens: 2 });
    expect(Object.isFrozen(result.workDelta)).toBe(true);
    expect(Object.isFrozen(result.workDelta.attemptedActions)).toBe(true);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.correlationId).toBe(result.workDelta.correlationId);
    expect(serializeWorkDelta(result.workDelta)).toContain('"terminalState":"succeeded"');
  });

  it("fails closed on policy denial without invoking the tool", async () => {
    const execute = vi.fn(async () => ({ status: "succeeded", output: { ok: true } } as const));
    const policy = {
      evaluate: vi.fn(async () => ({ allowed: false, reason: "policy denied", metadata: { gate: "deny" } })),
    };
    const { runtime } = createRuntime({
      tools: [
        {
          name: "echo",
          capability: "read-only",
          description: "returns the provided message",
          schema: echoSchema,
          execute,
        } satisfies ToolDescriptor,
      ],
      policy,
    });

    const result = await runtime.run({
      input: { request: "hello" },
      budget: budget(),
      metadata: { lane: "review" },
      inspect: async () => ({ startState: { phase: "inspected" } }),
      plan: async () => ({
        summary: "Attempt echo",
        rationale: "Policy will deny",
        desiredOutcome: "No tool call",
        toolName: "echo",
        input: { message: "hello" },
        metadata: {},
      }),
      observe: async () => ({ summary: { unreachable: true } }),
      evaluate: async () => ({ score: 0, passed: false, reasons: ["unreachable"], metrics: {} }),
      refine: async () => ({ status: "continue", nextState: { unreachable: true } }),
    });

    expect(result.terminalState).toBe("policy_denied");
    expect(policy.evaluate).toHaveBeenCalledOnce();
    expect(policy.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        executionMetadata: { lane: "review" },
      }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(result.workDelta.policyDecisions[0]).toMatchObject({ allowed: false, reason: "policy denied" });
  });

  it("fails closed on approval rejection", async () => {
    const execute = vi.fn(async () => ({ status: "succeeded", output: { ok: true } } as const));
    const approvals = {
      resolve: vi.fn(async (request: ApprovalRequest): Promise<ApprovalResolution> => ({
        approvalId: request.approvalId,
        executionId: request.executionId,
        requestVersion: request.requestVersion,
        decision: "rejected",
        resolvedBy: "reviewer",
        resolvedAt: request.requestedAt,
        comment: "denied",
      })),
    };
    const { runtime } = createRuntime({
      tools: [
        {
          name: "dangerous",
          capability: "write",
          description: "requires approval",
          schema: echoSchema,
          approval: {
            action: "tool:dangerous",
            reason: "Needs human approval",
          },
          execute,
        } satisfies ToolDescriptor,
      ],
      approvals,
    });

    const result = await runtime.run({
      input: { request: "hello" },
      budget: budget(),
      inspect: async () => ({ startState: { phase: "inspected" } }),
      plan: async () => ({
        summary: "Attempt dangerous tool",
        rationale: "Approval should reject",
        desiredOutcome: "No tool call",
        toolName: "dangerous",
        input: { message: "hello" },
        metadata: {},
      }),
      observe: async () => ({ summary: { unreachable: true } }),
      evaluate: async () => ({ score: 0, passed: false, reasons: ["unreachable"], metrics: {} }),
      refine: async () => ({ status: "continue", nextState: { unreachable: true } }),
    });

    expect(result.terminalState).toBe("approval_denied");
    expect(approvals.resolve).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(result.workDelta.approvalDecisions[0]).toMatchObject({ outcome: "rejected" });
  });

  it("does not retry deterministic tool failures", async () => {
    const execute = vi.fn(async () => ({
      status: "failed",
      failure: { kind: "deterministic", code: "bad_input", message: "cannot proceed" },
    } as const));
    const { runtime } = createRuntime({
      tools: [
        {
          name: "echo",
          capability: "read-only",
          description: "fails deterministically",
          schema: echoSchema,
          retry: { maxAttempts: 3, backoffMs: [5, 5] },
          execute,
        } satisfies ToolDescriptor,
      ],
    });

    const result = await runtime.run({
      input: { request: "hello" },
      budget: budget(),
      inspect: async () => ({ startState: { phase: "inspected" } }),
      plan: async () => ({
        summary: "Attempt echo",
        rationale: "Should fail once",
        desiredOutcome: "Stop immediately",
        toolName: "echo",
        input: { message: "hello" },
        metadata: {},
      }),
      observe: async () => ({ summary: { unreachable: true } }),
      evaluate: async () => ({ score: 0, passed: false, reasons: ["unreachable"], metrics: {} }),
      refine: async () => ({ status: "continue", nextState: { unreachable: true } }),
    });

    expect(result.terminalState).toBe("tool_failed");
    expect(execute).toHaveBeenCalledOnce();
    expect(result.workDelta.attemptedActions[0]?.attempts).toHaveLength(1);
    expect(result.workDelta.attemptedActions[0]?.failure).toMatchObject({ kind: "deterministic" });
  });

  it("retries transient failures within the configured bound and preserves stable metadata", async () => {
    const seenMetadata: ToolExecutionMetadata[] = [];
    let attempts = 0;
    const clock = new DeterministicClock();
    const { runtime } = createRuntime({
      clock,
      tools: [
        {
          name: "echo",
          capability: "read-only",
          description: "retries transient failures",
          schema: echoSchema,
          retry: { maxAttempts: 3, backoffMs: [10, 20] },
          execute: async (input, metadata) => {
            attempts += 1;
            seenMetadata.push(metadata);
            if (attempts < 3) {
              return {
                status: "failed",
                failure: { kind: "transient", code: "busy", message: "retry" },
              } as const;
            }
            return {
              status: "succeeded",
              output: { echoed: messageOf(input) },
            } as const;
          },
        } satisfies ToolDescriptor,
      ],
    });

    const result = await runtime.run({
      input: { request: "hello" },
      budget: budget(),
      inspect: async () => ({ startState: { phase: "inspected" } }),
      plan: async () => ({
        summary: "Attempt echo",
        rationale: "Transient retries should succeed",
        desiredOutcome: "Success after bounded retries",
        toolName: "echo",
        input: { message: "hello" },
        metadata: {},
      }),
      observe: async ({ toolOutput }) => ({ summary: { observed: toolOutput } }),
      evaluate: async () => ({ score: 1, passed: true, reasons: ["recovered"], metrics: { retries: 2 } }),
      refine: async ({ toolOutput }) => ({ status: "complete", finalState: { completed: true }, output: toolOutput }),
    });

    expect(result.terminalState).toBe("succeeded");
    expect(seenMetadata).toHaveLength(3);
    expect(new Set(seenMetadata.map((item) => item.idempotency.idempotencyKey))).toEqual(
      new Set([seenMetadata[0]?.idempotency.idempotencyKey]),
    );
    expect(new Set(seenMetadata.map((item) => item.correlationId))).toEqual(
      new Set([result.workDelta.correlationId]),
    );
    expect(result.workDelta.attemptedActions[0]?.attempts).toHaveLength(3);
    expect(result.workDelta.attemptedActions[0]?.attempts[0]).toMatchObject({ backoffMsAfter: 10 });
    expect(result.workDelta.attemptedActions[0]?.attempts[1]).toMatchObject({ backoffMsAfter: 20 });
    expect(clock.sleeps).toEqual([10, 20]);
    expect(result.workDelta.usage).toMatchObject({ toolCalls: 3, retries: 2 });
  });

  it("terminates on repeated non-progress", async () => {
    const execute = vi.fn(async () => ({ status: "succeeded", output: { echoed: "hello" } } as const));
    const { runtime } = createRuntime({
      tools: [
        {
          name: "echo",
          capability: "read-only",
          description: "returns the provided message",
          schema: echoSchema,
          execute,
        } satisfies ToolDescriptor,
      ],
    });

    const result = await runtime.run({
      input: { request: "hello" },
      budget: budget({ maxIterations: 4 }),
      maxConsecutiveNonProgress: 2,
      inspect: async () => ({ startState: { phase: "inspected" } }),
      plan: async () => ({
        summary: "Attempt echo",
        rationale: "No progress expected",
        desiredOutcome: "Terminate after repeated stasis",
        toolName: "echo",
        input: { message: "hello" },
        metadata: {},
      }),
      observe: async ({ toolOutput }) => ({ summary: { observed: toolOutput } }),
      evaluate: async () => ({ score: 0.5, passed: false, reasons: ["still pending"], metrics: { progress: 0 } }),
      refine: async ({ iteration }) => ({
        status: "continue",
        nextState:
          iteration % 2 === 0
            ? { status: "pending", phase: "inspected" }
            : { phase: "inspected", status: "pending" },
        unresolvedItems: ["needs-change"],
      }),
    });

    expect(result.terminalState).toBe("no_progress");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.workDelta.usage.iterations).toBe(2);
    expect(result.workDelta.unresolvedItems).toContain("needs-change");
  });

  it("preserves a successful tool action before terminating on post-action budget exhaustion", async () => {
    const observe = vi.fn(async () => ({ summary: { unreachable: true } }));
    const { runtime } = createRuntime({
      tools: [
        {
          name: "echo",
          capability: "read-only",
          description: "returns the provided message",
          schema: echoSchema,
          execute: async () =>
            ({
              status: "succeeded",
              output: { echoed: "hello" },
              usage: { outputTokens: 2 },
            }) as const,
        } satisfies ToolDescriptor,
      ],
    });

    const result = await runtime.run({
      input: { request: "hello" },
      budget: budget({ maxTokens: 1 }),
      inspect: async () => ({ startState: { phase: "inspected" } }),
      plan: async () => ({
        summary: "Attempt echo",
        rationale: "Tool call itself succeeds but exhausts budget",
        desiredOutcome: "Record success and stop before observe",
        toolName: "echo",
        input: { message: "hello" },
        metadata: {},
      }),
      observe,
      evaluate: async () => ({ score: 0, passed: false, reasons: ["unreachable"], metrics: {} }),
      refine: async () => ({ status: "continue", nextState: { unreachable: true } }),
    });

    expect(result.terminalState).toBe("budget_exhausted");
    expect(observe).not.toHaveBeenCalled();
    expect(result.workDelta.attemptedActions[0]).toMatchObject({
      outcome: "succeeded",
      output: { echoed: "hello" },
    });
  });

  it("does not mark a failed evaluation as succeeded even when refine completes", async () => {
    const { runtime } = createRuntime({
      tools: [
        {
          name: "echo",
          capability: "read-only",
          description: "returns the provided message",
          schema: echoSchema,
          execute: async () => ({ status: "succeeded", output: { echoed: "hello" } }) as const,
        } satisfies ToolDescriptor,
      ],
    });

    const result = await runtime.run({
      input: { request: "hello" },
      budget: budget(),
      inspect: async () => ({ startState: { phase: "inspected" } }),
      plan: async () => ({
        summary: "Attempt echo",
        rationale: "Evaluation should fail",
        desiredOutcome: "Terminal state must reflect evaluation outcome",
        toolName: "echo",
        input: { message: "hello" },
        metadata: {},
      }),
      observe: async ({ toolOutput }) => ({ summary: { observed: toolOutput } }),
      evaluate: async () => ({
        score: 0,
        passed: false,
        reasons: ["result did not satisfy acceptance"],
        metrics: { quality: 0 },
      }),
      refine: async ({ toolOutput }) => ({
        status: "complete",
        finalState: { completed: false },
        output: toolOutput,
      }),
    });

    expect(result.terminalState).toBe("evaluation_failed");
    expect(result.output).toBeUndefined();
  });

  it("terminates on budget exhaustion before unauthorized work", async () => {
    const execute = vi.fn(async () => ({ status: "succeeded", output: { ok: true } } as const));
    const policy = { evaluate: vi.fn(async () => ({ allowed: true, reason: "allow", metadata: {} })) };
    const { runtime } = createRuntime({
      tools: [
        {
          name: "echo",
          capability: "read-only",
          description: "returns the provided message",
          schema: echoSchema,
          execute,
        } satisfies ToolDescriptor,
      ],
      policy,
    });

    const result = await runtime.run({
      input: { request: "hello" },
      budget: budget({ maxToolCalls: 0 }),
      inspect: async () => ({ startState: { phase: "inspected" } }),
      plan: async () => ({
        summary: "Attempt echo",
        rationale: "Budget should preflight-fail",
        desiredOutcome: "No policy or tool activity",
        toolName: "echo",
        input: { message: "hello" },
        metadata: {},
      }),
      observe: async () => ({ summary: { unreachable: true } }),
      evaluate: async () => ({ score: 0, passed: false, reasons: ["unreachable"], metrics: {} }),
      refine: async () => ({ status: "continue", nextState: { unreachable: true } }),
    });

    expect(result.terminalState).toBe("budget_exhausted");
    expect(policy.evaluate).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(result.workDelta.attemptedActions[0]).toMatchObject({ outcome: "budget_exhausted" });
  });
});

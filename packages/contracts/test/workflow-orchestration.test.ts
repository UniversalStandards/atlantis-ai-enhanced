import { describe, expect, it } from "vitest";
import type {
  EventSink,
  ExecutionEvent,
  WorkflowContext,
  WorkflowDefinition,
} from "../src/index.js";
import {
  SupervisorResolutionError,
  UnhandledWorkflowConditionError,
  UnknownWorkflowError,
  VersionedWorkflowRegistry,
  WorkflowRegistrationConflictError,
  WorkflowReturnMismatchError,
  orchestrateWorkflow,
} from "../src/index.js";

const FIXED_TIME = "2026-09-05T07:30:00.000Z";

function context(mode: WorkflowContext["mode"] = "workflow"): WorkflowContext {
  return {
    executionId: "exec-orchestration-1",
    workflowId: "demo",
    workflowVersion: "1.0.0",
    userId: "user-1",
    mode,
    budget: {
      maxToolCalls: 10,
      maxRetries: 2,
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

function sink(): { readonly events: ExecutionEvent[]; readonly sink: EventSink } {
  const events: ExecutionEvent[] = [];
  return {
    events,
    sink: {
      async append(event) {
        events.push(event);
      },
    },
  };
}

function workflow(run: WorkflowDefinition<string, string>["run"]): WorkflowDefinition<string, string> {
  return {
    id: "demo",
    version: "1.0.0",
    description: "deterministic orchestration fixture",
    mode: "workflow",
    run,
  };
}

function now(): Date {
  return new Date(FIXED_TIME);
}

describe("VersionedWorkflowRegistry", () => {
  it("performs exact version lookup and rejects conflicting registration", () => {
    const registry = new VersionedWorkflowRegistry();
    const definition = workflow(async (input) => `ok:${input}`);
    registry.register(definition);

    expect(registry.get("demo", "1.0.0")).toBe(definition);
    expect(() => registry.get("demo", "2.0.0")).toThrow(UnknownWorkflowError);
    expect(() => registry.register(definition)).toThrow(WorkflowRegistrationConflictError);
  });
});

describe("orchestrateWorkflow", () => {
  it("completes a registered workflow with deterministic, non-epoch audit time", async () => {
    const registry = new VersionedWorkflowRegistry();
    registry.register(workflow(async (input) => `ok:${input}`));
    const evidence = sink();

    await expect(
      orchestrateWorkflow({
        registry,
        workflowId: "demo",
        workflowVersion: "1.0.0",
        input: "alpha",
        context: context("workflow"),
        events: evidence.sink,
        now,
      }),
    ).resolves.toBe("ok:alpha");

    expect(evidence.events.map((event) => event.type)).toEqual([
      "execution.started",
      "execution.completed",
    ]);
    expect(evidence.events.every((event) => event.occurredAt === FIXED_TIME)).toBe(true);
  });

  it("persists supervisor resolution before explicit return-to-workflow completion", async () => {
    const registry = new VersionedWorkflowRegistry();
    registry.register(
      workflow(async (input) => {
        throw new UnhandledWorkflowConditionError("needs deterministic supervisor", input);
      }),
    );
    const evidence = sink();
    const returnInputs: string[] = [];

    await expect(
      orchestrateWorkflow({
        registry,
        workflowId: "demo",
        workflowVersion: "1.0.0",
        input: "beta",
        context: context("hybrid"),
        events: evidence.sink,
        now,
        supervisorFactory: (condition) => ({
          reason: condition.reason,
          input: condition.input,
          async resolve() {
            return {
              workflowId: "demo",
              workflowVersion: "1.0.0",
              output: "supervised:beta",
            };
          },
        }),
        async returnToWorkflow(supervisorOutput) {
          returnInputs.push(supervisorOutput);
          return `workflow-resumed:${supervisorOutput}`;
        },
      }),
    ).resolves.toBe("workflow-resumed:supervised:beta");

    expect(returnInputs).toEqual(["supervised:beta"]);
    expect(evidence.events.map((event) => event.type)).toEqual([
      "execution.started",
      "supervisor.escalated",
      "supervisor.returned",
      "execution.completed",
    ]);
    expect(evidence.events[2]?.payload).toMatchObject({
      workflowId: "demo",
      workflowVersion: "1.0.0",
      resolution: "supervised:beta",
    });
    expect(evidence.events[3]?.parentEventId).toBe(evidence.events[2]?.id);
  });

  it("fails closed on mismatched supervisor return with terminal failure evidence", async () => {
    const registry = new VersionedWorkflowRegistry();
    registry.register(
      workflow(async (input) => {
        throw new UnhandledWorkflowConditionError("needs supervisor", input);
      }),
    );
    const evidence = sink();
    let returned = false;

    await expect(
      orchestrateWorkflow({
        registry,
        workflowId: "demo",
        workflowVersion: "1.0.0",
        input: "gamma",
        context: context("hybrid"),
        events: evidence.sink,
        now,
        supervisorFactory: (condition) => ({
          reason: condition.reason,
          input: condition.input,
          async resolve() {
            return {
              workflowId: "demo",
              workflowVersion: "2.0.0",
              output: "invalid",
            };
          },
        }),
        async returnToWorkflow(output) {
          returned = true;
          return output;
        },
      }),
    ).rejects.toBeInstanceOf(WorkflowReturnMismatchError);

    expect(returned).toBe(false);
    expect(evidence.events.some((event) => event.type === "supervisor.returned")).toBe(false);
    expect(evidence.events.at(-1)?.type).toBe("execution.failed");
    expect(evidence.events.some((event) => event.type === "execution.completed")).toBe(false);
  });

  it("records supervisor failure without return/completion success", async () => {
    const registry = new VersionedWorkflowRegistry();
    registry.register(
      workflow(async (input) => {
        throw new UnhandledWorkflowConditionError("needs supervisor", input);
      }),
    );
    const evidence = sink();

    await expect(
      orchestrateWorkflow({
        registry,
        workflowId: "demo",
        workflowVersion: "1.0.0",
        input: "delta",
        context: context("hybrid"),
        events: evidence.sink,
        now,
        supervisorFactory: (condition) => ({
          reason: condition.reason,
          input: condition.input,
          async resolve() {
            throw new SupervisorResolutionError("reference supervisor failed");
          },
        }),
        async returnToWorkflow(output) {
          return output;
        },
      }),
    ).rejects.toBeInstanceOf(SupervisorResolutionError);

    expect(evidence.events.some((event) => event.type === "supervisor.returned")).toBe(false);
    expect(evidence.events.at(-1)?.type).toBe("execution.failed");
    expect(evidence.events.some((event) => event.type === "execution.completed")).toBe(false);
  });

  it("requires an explicit return-to-workflow handler and records the configuration failure", async () => {
    const registry = new VersionedWorkflowRegistry();
    registry.register(
      workflow(async (input) => {
        throw new UnhandledWorkflowConditionError("needs supervisor", input);
      }),
    );
    const evidence = sink();

    await expect(
      orchestrateWorkflow({
        registry,
        workflowId: "demo",
        workflowVersion: "1.0.0",
        input: "eta",
        context: context("hybrid"),
        events: evidence.sink,
        now,
        supervisorFactory: (condition) => ({
          reason: condition.reason,
          input: condition.input,
          async resolve() {
            return {
              workflowId: "demo",
              workflowVersion: "1.0.0",
              output: "supervised:eta",
            };
          },
        }),
      }),
    ).rejects.toThrow(/return-to-workflow/);

    expect(evidence.events.map((event) => event.type)).toEqual([
      "execution.started",
      "execution.failed",
    ]);
  });

  it("records preflight budget rejection instead of leaving an audit gap", async () => {
    const registry = new VersionedWorkflowRegistry();
    registry.register(workflow(async (input) => `ok:${input}`));
    const evidence = sink();
    const overBudget = context("hybrid");
    overBudget.usage.toolCalls = 11;

    await expect(
      orchestrateWorkflow({
        registry,
        workflowId: "demo",
        workflowVersion: "1.0.0",
        input: "epsilon",
        context: overBudget,
        events: evidence.sink,
        now,
      }),
    ).rejects.toThrow(/maxToolCalls/);

    expect(evidence.events.map((event) => event.type)).toEqual([
      "budget.exceeded",
      "execution.failed",
    ]);
    expect(evidence.events.some((event) => event.type === "execution.started")).toBe(false);
  });

  it("records ordinary workflow failure as terminal evidence", async () => {
    const registry = new VersionedWorkflowRegistry();
    registry.register(
      workflow(async () => {
        throw new Error("deterministic workflow failure");
      }),
    );
    const evidence = sink();

    await expect(
      orchestrateWorkflow({
        registry,
        workflowId: "demo",
        workflowVersion: "1.0.0",
        input: "theta",
        context: context("workflow"),
        events: evidence.sink,
        now,
      }),
    ).rejects.toThrow("deterministic workflow failure");

    expect(evidence.events.map((event) => event.type)).toEqual([
      "execution.started",
      "execution.failed",
    ]);
  });

  it("rejects supervisor-only routing with terminal failure evidence", async () => {
    const registry = new VersionedWorkflowRegistry();
    registry.register(workflow(async (input) => `ok:${input}`));
    const evidence = sink();

    await expect(
      orchestrateWorkflow({
        registry,
        workflowId: "demo",
        workflowVersion: "1.0.0",
        input: "zeta",
        context: context("supervisor"),
        events: evidence.sink,
        now,
      }),
    ).rejects.toBeInstanceOf(SupervisorResolutionError);

    expect(evidence.events.map((event) => event.type)).toEqual([
      "execution.started",
      "execution.failed",
    ]);
  });
});

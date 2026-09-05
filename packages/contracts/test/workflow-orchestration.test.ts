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
} from "../src/workflow-orchestration.js";

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
  it("completes a deterministic registered workflow and records route/completion", async () => {
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
      }),
    ).resolves.toBe("ok:alpha");

    expect(evidence.events.map((event) => event.type)).toEqual([
      "execution.started",
      "execution.completed",
    ]);
  });

  it("escalates an unhandled hybrid condition and executes explicit return-to-workflow before completion", async () => {
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
    expect(evidence.events[3]?.parentEventId).toBe(evidence.events[2]?.id);
  });

  it("fails closed on mismatched supervisor return without invoking workflow return or success evidence", async () => {
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
    expect(evidence.events.some((event) => event.type === "execution.completed")).toBe(false);
  });

  it("does not convert supervisor failure into return/completion success", async () => {
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
    expect(evidence.events.some((event) => event.type === "execution.completed")).toBe(false);
  });

  it("requires an explicit return-to-workflow handler for hybrid escalation", async () => {
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

    expect(evidence.events.map((event) => event.type)).toEqual(["execution.started"]);
  });

  it("fails closed when budget is exceeded rather than escalating", async () => {
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
      }),
    ).rejects.toThrow(/maxToolCalls/);

    expect(evidence.events).toHaveLength(0);
  });

  it("rejects supervisor-only routing instead of silently bypassing workflow return semantics", async () => {
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
      }),
    ).rejects.toBeInstanceOf(SupervisorResolutionError);

    expect(evidence.events.map((event) => event.type)).toEqual(["execution.started"]);
  });
});

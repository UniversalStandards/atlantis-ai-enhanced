import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  type ExecutionEvent,
  type WorkflowContext,
} from "../src/index.js";
import { SequentialWorkflowRunner } from "../src/sequential-runner.js";

function context(maxIterations = 10): WorkflowContext {
  return {
    executionId: "execution-1",
    workflowId: "workflow-1",
    workflowVersion: "1.0.0",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 0,
      maxRetries: 0,
      maxIterations,
      maxTokens: 0,
      maxDurationMs: 0,
      maxCostUsd: 0,
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

function deterministicRunner(events: ExecutionEvent[]): SequentialWorkflowRunner {
  let eventNumber = 0;
  let timestampNumber = 0;
  return new SequentialWorkflowRunner({
    eventSink: {
      append: async (event) => {
        events.push(event);
      },
    },
    nextEventId: () => `event-${++eventNumber}`,
    now: () => `2026-08-01T00:00:0${timestampNumber++}.000Z`,
  });
}

describe("SequentialWorkflowRunner", () => {
  it("executes steps in order and emits a deterministic causal event chain", async () => {
    const events: ExecutionEvent[] = [];
    const runner = deterministicRunner(events);

    const result = await runner.run(
      {
        id: "workflow-1",
        version: "1.0.0",
        steps: [
          {
            id: "increment",
            description: "increment",
            execute: async (value) => Number(value) + 1,
          },
          {
            id: "double",
            description: "double",
            execute: async (value) => Number(value) * 2,
          },
        ],
      },
      2,
      context(),
    );

    expect(result).toBe(6);
    expect(events.map((event) => event.type)).toEqual([
      "execution.started",
      "workflow.step.started",
      "workflow.step.completed",
      "workflow.step.started",
      "workflow.step.completed",
      "execution.completed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.map((event) => event.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
      "event-6",
    ]);
    expect(events.slice(1).map((event) => event.parentEventId)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
    ]);
  });

  it("fails closed when a completed step crosses its iteration budget", async () => {
    const events: ExecutionEvent[] = [];
    const runner = deterministicRunner(events);

    await expect(
      runner.run(
        {
          id: "workflow-1",
          version: "1.0.0",
          steps: [
            {
              id: "bounded-step",
              description: "bounded",
              execute: async (value) => value,
            },
          ],
        },
        "input",
        context(0),
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    expect(events.map((event) => event.type)).toEqual([
      "execution.started",
      "workflow.step.started",
      "budget.exceeded",
    ]);
  });

  it("records step and execution failure without executing later steps", async () => {
    const events: ExecutionEvent[] = [];
    const runner = deterministicRunner(events);
    let laterStepExecuted = false;

    await expect(
      runner.run(
        {
          id: "workflow-1",
          version: "1.0.0",
          steps: [
            {
              id: "failing-step",
              description: "fails",
              execute: async () => {
                throw new Error("expected failure");
              },
            },
            {
              id: "later-step",
              description: "must not run",
              execute: async (value) => {
                laterStepExecuted = true;
                return value;
              },
            },
          ],
        },
        "input",
        context(),
      ),
    ).rejects.toThrow("expected failure");

    expect(laterStepExecuted).toBe(false);
    expect(events.map((event) => event.type)).toEqual([
      "execution.started",
      "workflow.step.started",
      "workflow.step.failed",
      "execution.failed",
    ]);
  });
});

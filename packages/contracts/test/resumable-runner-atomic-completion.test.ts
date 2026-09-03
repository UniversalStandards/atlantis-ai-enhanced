import { describe, expect, it } from "vitest";
import type { EventSink, ExecutionEvent, ExecutionUsage, WorkflowContext } from "../src/index.js";
import { InMemoryStepCompletionCommitPort } from "../src/in-memory-step-completion-commit.js";
import {
  ResumableSequentialWorkflowRunner,
  type ExecutionEventCursor,
} from "../src/resumable-runner.js";

class ContiguousMemoryEventSink implements EventSink {
  public readonly events: ExecutionEvent[] = [];

  public async append<T>(event: ExecutionEvent<T>): Promise<void> {
    const expectedSequence = this.events.length + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(`event sequence ${event.sequence} does not match ${expectedSequence}`);
    }
    if (this.events.some((stored) => stored.id === event.id)) {
      throw new Error(`duplicate event id ${event.id}`);
    }
    this.events.push(event as ExecutionEvent);
  }

  public cursor(): ExecutionEventCursor {
    const tail = this.events.at(-1);
    return tail === undefined ? { sequence: 0 } : { sequence: tail.sequence, parentEventId: tail.id };
  }
}

/**
 * A production durability adapter is a single authority for both plain events
 * and the atomic completion transition. In these tests that authority is
 * split across `ContiguousMemoryEventSink` (everything else) and
 * `InMemoryStepCompletionCommitPort` (the atomic step-completion transition),
 * so the cursor handed back to the runner must reflect whichever of the two
 * actually holds the current tail.
 */
function combinedCursor(
  events: ContiguousMemoryEventSink,
  port: InMemoryStepCompletionCommitPort,
  executionId: string,
): ExecutionEventCursor {
  const eventsCursor = events.cursor();
  const checkpoint = port.loadCheckpoint(executionId);
  if (checkpoint === undefined || checkpoint.lastEventSequence <= eventsCursor.sequence) {
    return eventsCursor;
  }
  return {
    sequence: checkpoint.lastEventSequence,
    ...(checkpoint.parentEventId === undefined ? {} : { parentEventId: checkpoint.parentEventId }),
  };
}

function usage(): ExecutionUsage {
  return {
    toolCalls: 0,
    retries: 0,
    iterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
  };
}

function context(): WorkflowContext {
  return {
    executionId: "execution-1",
    workflowId: "atomic-workflow",
    workflowVersion: "1",
    userId: "user-1",
    mode: "workflow",
    budget: {
      maxToolCalls: 10,
      maxRetries: 3,
      maxIterations: 10,
      maxTokens: 1000,
      maxDurationMs: 10000,
      maxCostUsd: 5,
    },
    usage: usage(),
    metadata: {},
  };
}

function ids(): () => string {
  let next = 0;
  return () => `event-${++next}`;
}

describe("ResumableSequentialWorkflowRunner with an atomic durability port", () => {
  it("completes a multi-step workflow through the atomic transition without duplicate execution", async () => {
    const port = new InMemoryStepCompletionCommitPort();
    const events = new ContiguousMemoryEventSink();
    const nextEventId = ids();
    const calls = { first: 0, second: 0 };

    const workflow = {
      id: "atomic-workflow",
      version: "1",
      steps: [
        {
          id: "first",
          description: "first",
          execute: async (value: unknown) => {
            calls.first += 1;
            return Number(value) * 2;
          },
        },
        {
          id: "second",
          description: "second",
          execute: async (value: unknown) => {
            calls.second += 1;
            return Number(value) + 100;
          },
        },
      ],
      mapOutput: (value: unknown) => Number(value),
    } as const;

    const runner = new ResumableSequentialWorkflowRunner({
      checkpointStore: port,
      eventSink: events,
      durability: port,
      loadEventCursor: () => combinedCursor(events, port, "execution-1"),
      nextEventId,
    });

    await expect(runner.run(workflow, 3, context())).resolves.toBe(106);

    expect(calls).toEqual({ first: 1, second: 1 });
    // Completion events now flow through the atomic port, not the plain sink.
    expect(events.events.some((event) => event.type === "workflow.step.completed")).toBe(false);
    expect(port.loadCompletionEvent("execution-1")).toMatchObject({
      payload: { stepId: "second", stepIndex: 1 },
    });
    // Workflow finished, so the checkpoint is cleared like the non-atomic path.
    expect(port.loadCheckpoint("execution-1")).toBeUndefined();
  });

  it("does not replay a step whose atomic completion was acknowledged before a later interruption", async () => {
    const port = new InMemoryStepCompletionCommitPort();
    const events = new ContiguousMemoryEventSink();
    const nextEventId = ids();
    const calls = { first: 0, second: 0 };
    let failSecond = true;

    const workflow = {
      id: "atomic-workflow",
      version: "1",
      steps: [
        {
          id: "first",
          description: "first",
          execute: async (value: unknown) => {
            calls.first += 1;
            return Number(value) * 2;
          },
        },
        {
          id: "second",
          description: "second",
          execute: async (value: unknown) => {
            calls.second += 1;
            if (failSecond) throw new Error("simulated crash after first step committed");
            return Number(value) + 100;
          },
        },
      ],
      mapOutput: (value: unknown) => Number(value),
    } as const;

    const buildRunner = () =>
      new ResumableSequentialWorkflowRunner({
        checkpointStore: port,
        eventSink: events,
        durability: port,
        loadEventCursor: () => combinedCursor(events, port, "execution-1"),
        nextEventId,
      });

    await expect(buildRunner().run(workflow, 3, context())).rejects.toThrow(
      "simulated crash after first step committed",
    );

    // "first" is durably, atomically completed and acknowledged before the interruption.
    expect(calls.first).toBe(1);
    expect(port.loadCheckpoint("execution-1")).toMatchObject({
      nextStepIndex: 1,
      completedStepIds: ["first"],
      value: 6,
      revision: 1,
    });

    failSecond = false;
    const resumedContext = context();
    await expect(buildRunner().run(workflow, 999, resumedContext)).resolves.toBe(106);

    // "first" was never re-executed on resume; exact post-step value/usage restored.
    expect(calls).toEqual({ first: 1, second: 2 });
    expect(resumedContext.usage.iterations).toBe(2);
    expect(port.loadCheckpoint("execution-1")).toBeUndefined();
  });

  it("leaves neither completion evidence nor checkpoint progress visible when atomic publication fails", async () => {
    const port = new InMemoryStepCompletionCommitPort({
      failAt: "after_validation_before_publish",
    });
    const events = new ContiguousMemoryEventSink();
    const nextEventId = ids();

    const workflow = {
      id: "atomic-workflow",
      version: "1",
      steps: [
        {
          id: "first",
          description: "first",
          execute: async (value: unknown) => Number(value) * 2,
        },
      ],
    } as const;

    const runner = new ResumableSequentialWorkflowRunner({
      checkpointStore: port,
      eventSink: events,
      durability: port,
      loadEventCursor: () => combinedCursor(events, port, "execution-1"),
      nextEventId,
    });

    await expect(runner.run(workflow, 3, context())).rejects.toThrow(
      "injected step-completion failure before atomic publish",
    );

    expect(port.loadCheckpoint("execution-1")).toBeUndefined();
    expect(port.loadCompletionEvent("execution-1")).toBeUndefined();
  });
});

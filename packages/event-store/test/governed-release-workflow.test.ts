import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@atlantis/contracts";

import { GovernedReleaseWorkflow } from "../src/governed-release-workflow.js";
import { ExecutionReleasePublisher } from "../src/execution-release-publisher.js";
import { ExecutionReleaseEvidenceService } from "../src/execution-release-service.js";
import {
  ExecutionReleaseArtifactRepository,
  InMemoryExecutionReleaseArtifactStorage,
} from "../src/execution-release-artifact-store.js";
import {
  ExecutionReplayFixtureRepository,
  InMemoryExecutionReplayFixtureStorage,
} from "../src/execution-replay-fixture-store.js";

const budget = Object.freeze({
  maxToolCalls: 4,
  maxRetries: 2,
  maxIterations: 3,
  maxTokens: 1_000,
  maxDurationMs: 10_000,
  maxCostUsd: 1,
});

const usage = Object.freeze({
  toolCalls: 2,
  retries: 1,
  iterations: 2,
  inputTokens: 300,
  outputTokens: 200,
  durationMs: 4_000,
  costUsd: 0.25,
});

function trace(executionId: string): readonly ExecutionEvent[] {
  return Object.freeze([
    Object.freeze({
      id: "root",
      executionId,
      sequence: 1,
      type: "execution.started" as const,
      occurredAt: "2026-08-21T00:00:00.000Z",
      actor: "runner",
      payload: Object.freeze({}),
    }),
    Object.freeze({
      id: "child",
      executionId,
      sequence: 2,
      type: "execution.completed" as const,
      occurredAt: "2026-08-21T00:00:05.000Z",
      actor: "runner",
      parentEventId: "root",
      payload: Object.freeze({}),
    }),
  ]);
}

function publisher(storage: InMemoryExecutionReleaseArtifactStorage): ExecutionReleasePublisher {
  return new ExecutionReleasePublisher(
    new ExecutionReleaseEvidenceService(
      new ExecutionReplayFixtureRepository(new InMemoryExecutionReplayFixtureStorage()),
    ),
    new ExecutionReleaseArtifactRepository(storage),
  );
}

describe("governed release workflow", () => {
  it("publishes runner-bound accounting with the completed governed trace", async () => {
    const storage = new InMemoryExecutionReleaseArtifactStorage();
    const tasks = {
      submit: async () => Object.freeze({
        status: "completed" as const,
        executionId: "execution-1",
        output: "published",
        trace: trace("execution-1"),
        accounting: Object.freeze({ budget, usage }),
      }),
    };
    const workflow = new GovernedReleaseWorkflow(tasks as never, publisher(storage));

    const result = await workflow.execute({
      task: { workflowId: "reference" },
      artifactId: "day-7/execution-1.json",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completion");
    expect(result.publication.evidence.executionId).toBe("execution-1");
    expect(result.publication.evidence.summary).toMatchObject({
      toolCalls: usage.toolCalls,
      retries: usage.retries,
      iterations: usage.iterations,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
    });
    expect(result.publication.evidence.summary.budget.durationMs.observed).toBe(usage.durationMs);
    expect(storage.get("day-7/execution-1.json")).toBe(result.publication.serializedEvidence);
  });

  it("does not accept caller-supplied accounting substitution", async () => {
    const storage = new InMemoryExecutionReleaseArtifactStorage();
    const tasks = {
      submit: async () => Object.freeze({
        status: "completed" as const,
        executionId: "execution-1",
        output: "published",
        trace: trace("execution-1"),
        accounting: Object.freeze({ budget, usage }),
      }),
    };
    const workflow = new GovernedReleaseWorkflow(tasks as never, publisher(storage));

    const substituted = {
      task: { workflowId: "reference" },
      artifactId: "day-7/execution-1.json",
      budget: { ...budget, maxCostUsd: 999 },
      usage: { ...usage, costUsd: 999 },
    };
    const result = await workflow.execute(substituted);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completion");
    expect(result.publication.evidence.summary.costUsd).toBe(usage.costUsd);
    expect(result.publication.evidence.summary.budget.costUsd.limit).toBe(budget.maxCostUsd);
  });

  it("does not publish partial release evidence while execution waits for approval", async () => {
    const storage = new InMemoryExecutionReleaseArtifactStorage();
    const tasks = {
      submit: async () => Object.freeze({
        status: "waiting_for_approval" as const,
        executionId: "execution-2",
        approval: Object.freeze({
          approvalId: "approval-1",
          executionId: "execution-2",
          requestVersion: 1,
          stepId: "publish",
          action: "publish release",
          reason: "protected action",
          requestedBy: "runner",
          requestedAt: "2026-08-21T00:00:01.000Z",
          metadata: Object.freeze({}),
        }),
        trace: Object.freeze([]),
      }),
    };
    const workflow = new GovernedReleaseWorkflow(tasks as never, publisher(storage));

    const result = await workflow.execute({
      task: { workflowId: "reference" },
      artifactId: "day-7/execution-2.json",
    });

    expect(result.status).toBe("waiting_for_approval");
    expect(storage.get("day-7/execution-2.json")).toBeNull();
  });
});

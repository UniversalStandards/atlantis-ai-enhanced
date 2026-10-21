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
  maxToolCalls: 8,
  maxRetries: 2,
  maxIterations: 6,
  maxTokens: 4_000,
  maxDurationMs: 60_000,
  maxCostUsd: 2,
});

const usage = Object.freeze({
  toolCalls: 5,
  retries: 0,
  iterations: 5,
  inputTokens: 1_200,
  outputTokens: 800,
  durationMs: 12_000,
  costUsd: 0.42,
});

function referenceTrace(executionId: string): readonly ExecutionEvent[] {
  const events: ExecutionEvent[] = [
    {
      id: "request",
      executionId,
      sequence: 1,
      type: "execution.started",
      occurredAt: "2026-08-21T00:00:00.000Z",
      actor: "runner",
      payload: Object.freeze({ phase: "request" }),
    },
    {
      id: "authorization",
      executionId,
      sequence: 2,
      type: "workflow.step.completed",
      occurredAt: "2026-08-21T00:00:01.000Z",
      actor: "policy",
      parentEventId: "request",
      payload: Object.freeze({ phase: "authorization" }),
    },
    {
      id: "normalize-plan-route",
      executionId,
      sequence: 3,
      type: "workflow.step.completed",
      occurredAt: "2026-08-21T00:00:03.000Z",
      actor: "runner",
      parentEventId: "authorization",
      payload: Object.freeze({ phase: "normalize-plan-route" }),
    },
    {
      id: "github-tool",
      executionId,
      sequence: 4,
      type: "tool.completed",
      occurredAt: "2026-08-21T00:00:06.000Z",
      actor: "github",
      parentEventId: "normalize-plan-route",
      payload: Object.freeze({ phase: "isolated-change-and-tests" }),
    },
    {
      id: "independent-verification",
      executionId,
      sequence: 5,
      type: "workflow.step.completed",
      occurredAt: "2026-08-21T00:00:09.000Z",
      actor: "verifier",
      parentEventId: "github-tool",
      payload: Object.freeze({ phase: "independent-verification" }),
    },
    {
      id: "complete",
      executionId,
      sequence: 6,
      type: "execution.completed",
      occurredAt: "2026-08-21T00:00:12.000Z",
      actor: "runner",
      parentEventId: "independent-verification",
      payload: Object.freeze({ phase: "release-publication" }),
    },
  ];
  return Object.freeze(events.map((event) => Object.freeze(event)));
}

function publisher(storage: InMemoryExecutionReleaseArtifactStorage): ExecutionReleasePublisher {
  return new ExecutionReleasePublisher(
    new ExecutionReleaseEvidenceService(
      new ExecutionReplayFixtureRepository(new InMemoryExecutionReplayFixtureStorage()),
    ),
    new ExecutionReleaseArtifactRepository(storage),
  );
}

describe("Day-7 governed repository-improvement reference workflow", () => {
  it("publishes one complete authoritative trace and runner-bound release artifact", async () => {
    const storage = new InMemoryExecutionReleaseArtifactStorage();
    const executionId = "day7-reference-execution";
    const tasks = {
      submit: async () => Object.freeze({
        status: "completed" as const,
        executionId,
        output: Object.freeze({
          repository: "UniversalStandards/atlantis-ai-enhanced",
          isolatedBranch: "reference/day7-improvement",
          tests: "passed",
          independentVerification: "passed",
          pullRequest: "prepared",
        }),
        trace: referenceTrace(executionId),
        accounting: Object.freeze({ budget, usage }),
      }),
    };
    const workflow = new GovernedReleaseWorkflow(tasks as never, publisher(storage));

    const result = await workflow.execute({
      task: { workflowId: "day7-repository-improvement" },
      artifactId: `day-7/${executionId}.json`,
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completion");

    expect(result.publication.evidence.executionId).toBe(executionId);
    expect(result.publication.evidence.summary.eventCount).toBe(6);
    expect(result.publication.evidence.summary.toolCalls).toBe(usage.toolCalls);
    expect(result.publication.evidence.summary.costUsd).toBe(usage.costUsd);
    expect(result.publication.evidence.summary.budget.costUsd.limit).toBe(budget.maxCostUsd);
    expect(result.publication.evidence.summary.topology.nodes).toHaveLength(6);
    expect(result.publication.evidence.summary.topology.edges).toHaveLength(5);
    expect(storage.get(`day-7/${executionId}.json`)).toBe(result.publication.serializedEvidence);
  });

  it("does not publish the reference artifact while the consequential GitHub action awaits approval", async () => {
    const storage = new InMemoryExecutionReleaseArtifactStorage();
    const tasks = {
      submit: async () => Object.freeze({
        status: "waiting_for_approval" as const,
        executionId: "day7-reference-pending",
        approval: Object.freeze({
          approvalId: "approval-day7-github",
          executionId: "day7-reference-pending",
          requestVersion: 1,
          stepId: "open-pull-request",
          action: "open pull request",
          reason: "consequential GitHub mutation",
          requestedBy: "runner",
          requestedAt: "2026-08-21T00:00:07.000Z",
          metadata: Object.freeze({ repository: "UniversalStandards/atlantis-ai-enhanced" }),
        }),
        trace: Object.freeze([]),
      }),
    };
    const workflow = new GovernedReleaseWorkflow(tasks as never, publisher(storage));

    const result = await workflow.execute({
      task: { workflowId: "day7-repository-improvement" },
      artifactId: "day-7/day7-reference-pending.json",
    });

    expect(result.status).toBe("waiting_for_approval");
    expect(storage.get("day-7/day7-reference-pending.json")).toBeNull();
  });
});

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
import {
  RepositoryImprovementTask,
  type RepositoryImprovementRequest,
  type RepositoryImprovementTool,
} from "../src/repository-improvement-tool.js";

const repository = "UniversalStandards/atlantis-ai-enhanced";
const branch = "reference/day7-governed-improvement";
const budget = Object.freeze({
  maxToolCalls: 8,
  maxRetries: 2,
  maxIterations: 6,
  maxTokens: 4_000,
  maxDurationMs: 60_000,
  maxCostUsd: 2,
});
const usage = Object.freeze({
  toolCalls: 1,
  retries: 0,
  iterations: 1,
  inputTokens: 500,
  outputTokens: 250,
  durationMs: 5_000,
  costUsd: 0.12,
});

function trace(executionId: string): readonly ExecutionEvent[] {
  return Object.freeze([
    Object.freeze({
      id: "request",
      executionId,
      sequence: 1,
      type: "execution.started",
      occurredAt: "2026-08-21T00:00:00.000Z",
      actor: "runner",
      payload: Object.freeze({ phase: "request" }),
    }),
    Object.freeze({
      id: "repository-improvement",
      executionId,
      sequence: 2,
      type: "tool.completed",
      occurredAt: "2026-08-21T00:00:04.000Z",
      actor: "repository-improvement",
      parentEventId: "request",
      payload: Object.freeze({ phase: "governed-tool" }),
    }),
    Object.freeze({
      id: "complete",
      executionId,
      sequence: 3,
      type: "execution.completed",
      occurredAt: "2026-08-21T00:00:05.000Z",
      actor: "runner",
      parentEventId: "repository-improvement",
      payload: Object.freeze({ phase: "release-publication" }),
    }),
  ] as ExecutionEvent[]);
}

function publisher(storage: InMemoryExecutionReleaseArtifactStorage): ExecutionReleasePublisher {
  return new ExecutionReleasePublisher(
    new ExecutionReleaseEvidenceService(
      new ExecutionReplayFixtureRepository(new InMemoryExecutionReplayFixtureStorage()),
    ),
    new ExecutionReleaseArtifactRepository(storage),
  );
}

describe("Day-7 governed repository-improvement integration", () => {
  it("binds repository tool evidence to the governed execution before release publication", async () => {
    const storage = new InMemoryExecutionReleaseArtifactStorage();
    const executionId = "day7-governed-repository-improvement";
    let observedRequest: Readonly<RepositoryImprovementRequest> | undefined;

    const tool: RepositoryImprovementTool = {
      execute: async (request, boundExecutionId) => {
        observedRequest = request;
        return Object.freeze({
          repository: request.repository,
          branch: request.branch,
          testsPassed: true,
          independentlyVerified: true,
          pullRequestNumber: 10,
          pullRequestUrl: "https://github.com/UniversalStandards/atlantis-ai-enhanced/pull/10",
          reportArtifactId: "day-7/repository-improvement-report.json",
          traceExecutionId: boundExecutionId,
          costUsd: usage.costUsd,
        });
      },
    };
    const improvement = new RepositoryImprovementTask(tool);
    const request = Object.freeze({
      repository,
      branch,
      objective: "Prepare, test, independently verify, and report a bounded repository improvement.",
    });

    const tasks = {
      submit: async () => {
        const output = await improvement.execute(request, executionId);
        return Object.freeze({
          status: "completed" as const,
          executionId,
          output,
          trace: trace(executionId),
          accounting: Object.freeze({ budget, usage }),
        });
      },
    };
    const workflow = new GovernedReleaseWorkflow(tasks as never, publisher(storage));
    const artifactId = `day-7/${executionId}.json`;

    const result = await workflow.execute({
      task: Object.freeze({ workflowId: "day7-repository-improvement", request }),
      artifactId,
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completion");

    expect(observedRequest).toEqual(request);
    expect(result.task.output).toMatchObject({
      repository,
      branch,
      testsPassed: true,
      independentlyVerified: true,
      pullRequestNumber: 10,
      traceExecutionId: executionId,
    });
    expect(result.publication.evidence.executionId).toBe(executionId);
    expect(result.publication.evidence.summary.toolCalls).toBe(usage.toolCalls);
    expect(result.publication.evidence.summary.costUsd).toBe(usage.costUsd);
    expect(storage.get(artifactId)).toBe(result.publication.serializedEvidence);
  });
});

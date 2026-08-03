import { describe, expect, it } from "vitest";
import { ApprovalRequiredError } from "@atlantis/contracts/approval-control";
import type { ResumableSequentialWorkflowRunner } from "@atlantis/contracts/resumable-runner";

import {
  GovernedResumableTaskEntrypoint,
  ResumableTaskEntrypoint,
  normalizeResumableTaskRequest,
} from "../src/resumable-task-entrypoint.js";
import { InvalidTaskRequestError, TaskAuthorizationError } from "../src/task-entrypoint.js";

const budget = {
  maxToolCalls: 10,
  maxRetries: 2,
  maxIterations: 10,
  maxTokens: 1000,
  maxDurationMs: 10_000,
  maxCostUsd: 1,
};

const workflow = {
  id: "deploy",
  version: "1",
  steps: [],
};

const approval = {
  approvalId: "approval-1",
  executionId: "execution-1",
  requestVersion: 1,
  stepId: "publish",
  action: "publish release",
  reason: "protected action",
  requestedBy: "runner",
  requestedAt: "2026-08-03T21:00:00.000Z",
  metadata: {},
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: "deploy",
    input: { release: "alpha" },
    userId: "user-1",
    budget,
    ...overrides,
  };
}

describe("GovernedResumableTaskEntrypoint", () => {
  it("pauses and resumes under the same execution identity", async () => {
    const traces = new Map<string, readonly never[]>();
    let allocated = 0;
    const runnerRequests: Array<{ executionId?: string }> = [];

    const entrypoint = new ResumableTaskEntrypoint({
      eventSink: {
        readExecution: (executionId: string) => traces.get(executionId) ?? [],
      } as never,
      resolveWorkflow: () => workflow,
      nextExecutionId: () => {
        allocated += 1;
        return "execution-1";
      },
      createRunner: (normalized) => {
        runnerRequests.push(
          normalized.executionId === undefined
            ? {}
            : { executionId: normalized.executionId },
        );
        return {
          run: async () => {
            if (normalized.approvalResolution === undefined) {
              throw new ApprovalRequiredError(approval);
            }
            return "published";
          },
        } as unknown as ResumableSequentialWorkflowRunner;
      },
    });

    const governed = new GovernedResumableTaskEntrypoint({
      taskEntrypoint: entrypoint,
      authorize: () => ({ allowed: true }),
    });

    const waiting = await governed.submit(request());
    expect(waiting.status).toBe("waiting_for_approval");
    expect(waiting.executionId).toBe("execution-1");

    const completed = await governed.submit(
      request({
        executionId: waiting.executionId,
        approvalResolution: {
          approvalId: "approval-1",
          executionId: waiting.executionId,
          requestVersion: 1,
          decision: "approved",
          resolvedBy: "operator",
          resolvedAt: "2026-08-03T21:01:00.000Z",
        },
      }),
    );

    expect(completed).toMatchObject({
      status: "completed",
      executionId: "execution-1",
      output: "published",
    });
    expect(allocated).toBe(1);
    expect(runnerRequests).toEqual([
      {},
      { executionId: "execution-1" },
    ]);
  });

  it("authorizes resume requests before runner creation", async () => {
    let runnerCreated = false;
    const entrypoint = new ResumableTaskEntrypoint({
      eventSink: { readExecution: () => [] } as never,
      resolveWorkflow: () => workflow,
      nextExecutionId: () => "unused",
      createRunner: () => {
        runnerCreated = true;
        throw new Error("must not run");
      },
    });
    const governed = new GovernedResumableTaskEntrypoint({
      taskEntrypoint: entrypoint,
      authorize: () => ({ allowed: false, reason: "resume denied" }),
    });

    await expect(
      governed.submit(request({ executionId: "execution-1" })),
    ).rejects.toEqual(new TaskAuthorizationError("resume denied"));
    expect(runnerCreated).toBe(false);
  });

  it("requires execution identity for approval resolution", () => {
    expect(() =>
      normalizeResumableTaskRequest(
        request({
          approvalResolution: {
            approvalId: "approval-1",
            executionId: "execution-1",
            requestVersion: 1,
            decision: "approved",
            resolvedBy: "operator",
            resolvedAt: "2026-08-03T21:01:00.000Z",
          },
        }),
      ),
    ).toThrow(InvalidTaskRequestError);
  });
});

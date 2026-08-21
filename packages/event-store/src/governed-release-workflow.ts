import {
  GovernedResumableTaskEntrypoint,
  type ResumableTaskResult,
} from "./resumable-task-entrypoint.js";
import {
  ExecutionReleasePublisher,
  type ExecutionReleasePublication,
} from "./execution-release-publisher.js";

export interface GovernedReleaseWorkflowRequest {
  readonly task: unknown;
  readonly artifactId: string;
  readonly replayFixtureId?: string;
}

export type GovernedReleaseWorkflowResult<O = unknown> =
  | Readonly<{
      status: "waiting_for_approval";
      task: Extract<ResumableTaskResult<O>, { status: "waiting_for_approval" }>;
    }>
  | Readonly<{
      status: "completed";
      task: Extract<ResumableTaskResult<O>, { status: "completed" }>;
      publication: ExecutionReleasePublication;
    }>;

/**
 * Provider-neutral Day-7 composition boundary. A governed resumable execution
 * must complete before its authoritative trace and runner-bound accounting can
 * be projected and persisted as release evidence. Approval waits never publish
 * partial evidence, and callers cannot substitute release accounting.
 */
export class GovernedReleaseWorkflow {
  public constructor(
    private readonly tasks: GovernedResumableTaskEntrypoint,
    private readonly releases: ExecutionReleasePublisher,
  ) {}

  public async execute<O = unknown>(
    request: Readonly<GovernedReleaseWorkflowRequest>,
  ): Promise<GovernedReleaseWorkflowResult<O>> {
    const task = await this.tasks.submit<O>(request.task);
    if (task.status === "waiting_for_approval") {
      return Object.freeze({ status: "waiting_for_approval", task });
    }

    const publication = this.releases.publish(request.artifactId, {
      events: task.trace,
      budget: task.accounting.budget,
      usage: task.accounting.usage,
      ...(request.replayFixtureId === undefined
        ? {}
        : { replayFixtureId: request.replayFixtureId }),
    });

    return Object.freeze({ status: "completed", task, publication });
  }
}

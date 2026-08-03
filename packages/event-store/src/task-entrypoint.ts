import type { ExecutionBudget, WorkflowContext } from "@atlantis/contracts";
import {
  SequentialWorkflowRunner,
  type SequentialWorkflow,
} from "@atlantis/contracts/sequential-runner";

import type { ExecutionEvent } from "@atlantis/contracts";
import { DurableExecutionEventSink } from "./execution-event-sink.js";

export interface TaskRequest<I = unknown> {
  readonly workflowId: string;
  readonly input: I;
  readonly userId: string;
  readonly budget: ExecutionBudget;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface TaskResult<O = unknown> {
  readonly executionId: string;
  readonly output: O;
  readonly trace: readonly ExecutionEvent[];
}

export interface TaskEntrypointOptions {
  readonly eventSink: DurableExecutionEventSink;
  readonly resolveWorkflow: (workflowId: string) => SequentialWorkflow<unknown, unknown> | undefined;
  readonly nextExecutionId: () => string;
  readonly nextEventId: () => string;
  readonly now?: () => string;
}

export class UnknownWorkflowError extends Error {
  public constructor(public readonly workflowId: string) {
    super(`Unknown workflow: ${workflowId}`);
    this.name = "UnknownWorkflowError";
  }
}

export class TaskEntrypoint {
  public constructor(private readonly options: TaskEntrypointOptions) {}

  public async submit<I, O>(request: TaskRequest<I>): Promise<TaskResult<O>> {
    const workflow = this.options.resolveWorkflow(request.workflowId) as
      | SequentialWorkflow<I, O>
      | undefined;
    if (workflow === undefined) {
      throw new UnknownWorkflowError(request.workflowId);
    }

    const executionId = this.options.nextExecutionId();
    const context: WorkflowContext = {
      executionId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      userId: request.userId,
      mode: "workflow",
      budget: request.budget,
      usage: {
        toolCalls: 0,
        retries: 0,
        iterations: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        costUsd: 0,
      },
      metadata: request.metadata ?? {},
    };

    const runner = new SequentialWorkflowRunner({
      eventSink: this.options.eventSink,
      nextEventId: this.options.nextEventId,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });

    const output = await runner.run(workflow, request.input, context);
    return Object.freeze({
      executionId,
      output,
      trace: this.options.eventSink.readExecution(executionId),
    });
  }
}

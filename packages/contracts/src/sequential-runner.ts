import {
  assertWithinBudget,
  BudgetExceededError,
  type EventSink,
  type ExecutionEvent,
  type WorkflowContext,
  type WorkflowStep,
} from "./index.js";

export interface SequentialWorkflow<I, O> {
  readonly id: string;
  readonly version: string;
  readonly steps: readonly WorkflowStep<unknown, unknown>[];
  readonly mapInput?: (input: I) => unknown;
  readonly mapOutput?: (value: unknown) => O;
}

export interface SequentialRunnerOptions {
  readonly eventSink: EventSink;
  readonly nextEventId: () => string;
  readonly actor?: string;
  readonly now?: () => string;
}

export class SequentialWorkflowRunner {
  private readonly actor: string;
  private readonly now: () => string;

  public constructor(private readonly options: SequentialRunnerOptions) {
    this.actor = options.actor ?? "sequential-workflow-runner";
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async run<I, O>(
    workflow: SequentialWorkflow<I, O>,
    input: I,
    context: WorkflowContext,
  ): Promise<O> {
    let sequence = 0;
    let parentEventId: string | undefined;

    const append = async <T>(
      type: ExecutionEvent<T>["type"],
      payload: T,
    ): Promise<string> => {
      const id = this.options.nextEventId();
      const event: ExecutionEvent<T> = {
        id,
        executionId: context.executionId,
        sequence: ++sequence,
        type,
        occurredAt: this.now(),
        actor: this.actor,
        ...(parentEventId === undefined ? {} : { parentEventId }),
        payload,
      };
      await this.options.eventSink.append(event);
      parentEventId = id;
      return id;
    };

    await append("execution.started", {
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      stepCount: workflow.steps.length,
    });

    try {
      try {
        assertWithinBudget(context);
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          await append("budget.exceeded", {
            dimension: error.dimension,
            limit: error.limit,
            observed: error.observed,
            phase: "preflight",
          });
        }
        throw error;
      }

      let value: unknown = workflow.mapInput?.(input) ?? input;

      for (const step of workflow.steps) {
        assertWithinBudget(context);
        await append("workflow.step.started", { stepId: step.id });

        try {
          value = await step.execute(value, context);
          context.usage.iterations += 1;
          assertWithinBudget(context);
          await append("workflow.step.completed", { stepId: step.id });
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            await append("budget.exceeded", {
              dimension: error.dimension,
              limit: error.limit,
              observed: error.observed,
              stepId: step.id,
            });
          } else {
            await append("workflow.step.failed", {
              stepId: step.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          throw error;
        }
      }

      assertWithinBudget(context);
      await append("execution.completed", {
        workflowId: workflow.id,
        completedSteps: workflow.steps.length,
      });
      return workflow.mapOutput ? workflow.mapOutput(value) : (value as O);
    } catch (error) {
      await append("execution.failed", {
        workflowId: workflow.id,
        reason: error instanceof BudgetExceededError ? "budget_exceeded" : "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

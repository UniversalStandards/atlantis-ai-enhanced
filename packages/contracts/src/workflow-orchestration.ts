import {
  BudgetExceededError,
  assertWithinBudget,
  type EventSink,
  type ExecutionEvent,
  type ExecutionMode,
  type SupervisorEscalation,
  type WorkflowContext,
  type WorkflowDefinition,
} from "./index.js";

export class WorkflowRegistrationConflictError extends Error {
  constructor(public readonly workflowId: string, public readonly workflowVersion: string) {
    super(`Workflow already registered: ${workflowId}@${workflowVersion}`);
    this.name = "WorkflowRegistrationConflictError";
  }
}

export class UnknownWorkflowError extends Error {
  constructor(public readonly workflowId: string, public readonly workflowVersion: string) {
    super(`Unknown workflow: ${workflowId}@${workflowVersion}`);
    this.name = "UnknownWorkflowError";
  }
}

export class SupervisorResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorResolutionError";
  }
}

export class WorkflowReturnMismatchError extends Error {
  constructor(
    public readonly expectedWorkflowId: string,
    public readonly expectedWorkflowVersion: string,
    public readonly returnedWorkflowId: string,
    public readonly returnedWorkflowVersion: string,
  ) {
    super(
      `Supervisor return mismatch: expected ${expectedWorkflowId}@${expectedWorkflowVersion}, received ${returnedWorkflowId}@${returnedWorkflowVersion}`,
    );
    this.name = "WorkflowReturnMismatchError";
  }
}

export class UnhandledWorkflowConditionError<I> extends Error {
  constructor(public readonly reason: string, public readonly input: I) {
    super(reason);
    this.name = "UnhandledWorkflowConditionError";
  }
}

export interface SupervisorResolution<O> {
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly output: O;
}

export type SupervisorFactory<I, O> = (
  condition: UnhandledWorkflowConditionError<I>,
) => SupervisorEscalation<I, SupervisorResolution<O>>;

export type ReturnToWorkflowHandler<O> = (
  supervisorOutput: O,
  context: WorkflowContext,
) => Promise<O>;

export interface WorkflowRouteDecision {
  readonly mode: ExecutionMode;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly route: "workflow" | "supervisor" | "hybrid";
}

export class VersionedWorkflowRegistry {
  private readonly workflows = new Map<string, WorkflowDefinition<unknown, unknown>>();

  register<I, O>(workflow: WorkflowDefinition<I, O>): void {
    const key = this.key(workflow.id, workflow.version);
    if (this.workflows.has(key)) {
      throw new WorkflowRegistrationConflictError(workflow.id, workflow.version);
    }
    this.workflows.set(key, workflow as WorkflowDefinition<unknown, unknown>);
  }

  get<I, O>(workflowId: string, workflowVersion: string): WorkflowDefinition<I, O> {
    const workflow = this.workflows.get(this.key(workflowId, workflowVersion));
    if (!workflow) {
      throw new UnknownWorkflowError(workflowId, workflowVersion);
    }
    return workflow as WorkflowDefinition<I, O>;
  }

  private key(workflowId: string, workflowVersion: string): string {
    return `${workflowId}\u0000${workflowVersion}`;
  }
}

export function decideWorkflowRoute(
  workflow: WorkflowDefinition<unknown, unknown>,
  requestedMode: ExecutionMode,
): WorkflowRouteDecision {
  if (requestedMode === "supervisor") {
    return {
      mode: requestedMode,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      route: "supervisor",
    };
  }

  return {
    mode: requestedMode,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    route: requestedMode === "hybrid" ? "hybrid" : "workflow",
  };
}

export interface OrchestrateWorkflowRequest<I, O> {
  readonly registry: VersionedWorkflowRegistry;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly input: I;
  readonly context: WorkflowContext;
  readonly events: EventSink;
  readonly supervisorFactory?: SupervisorFactory<I, O>;
  readonly returnToWorkflow?: ReturnToWorkflowHandler<O>;
  /** Injectable evidence clock. Defaults to wall clock; tests/harnesses should provide a deterministic clock. */
  readonly now?: () => Date;
}

export async function orchestrateWorkflow<I, O>(
  request: OrchestrateWorkflowRequest<I, O>,
): Promise<O> {
  const workflow = request.registry.get<I, O>(request.workflowId, request.workflowVersion);
  assertContextIdentity(workflow, request.context);

  let sequence = 0;
  let parentEventId: string | undefined;
  const now = request.now ?? (() => new Date());
  const append = async <T>(type: ExecutionEvent<T>["type"], payload: T): Promise<void> => {
    sequence += 1;
    const id = `${request.context.executionId}:${sequence}`;
    await request.events.append({
      id,
      executionId: request.context.executionId,
      sequence,
      type,
      occurredAt: now().toISOString(),
      actor: "workflow-orchestrator",
      ...(parentEventId ? { parentEventId } : {}),
      payload,
    });
    parentEventId = id;
  };

  const appendFailure = async (phase: string, error: unknown): Promise<void> => {
    const normalized = normalizeError(error);
    await append("execution.failed", {
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      phase,
      error: normalized,
    });
  };

  const assertBudget = async (phase: string): Promise<void> => {
    try {
      assertWithinBudget(request.context);
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        await append("budget.exceeded", {
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          phase,
          dimension: error.dimension,
          limit: error.limit,
          observed: error.observed,
        });
      }
      await appendFailure(phase, error);
      throw error;
    }
  };

  await assertBudget("preflight");

  const decision = decideWorkflowRoute(
    workflow as WorkflowDefinition<unknown, unknown>,
    request.context.mode,
  );
  await append("execution.started", { route: decision });

  if (decision.route === "supervisor") {
    const error = new SupervisorResolutionError(
      "Supervisor-only execution requires an explicit supervisor entry contract; implicit workflow bypass is prohibited",
    );
    await appendFailure("route", error);
    throw error;
  }

  let workflowOutput: O;
  try {
    workflowOutput = await workflow.run(request.input, request.context);
  } catch (error) {
    if (!(error instanceof UnhandledWorkflowConditionError) || decision.route !== "hybrid") {
      await appendFailure("workflow", error);
      throw error;
    }
    return handleHybridEscalation(error);
  }

  await assertBudget("workflow.completed");
  await append("execution.completed", {
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    returnedFromSupervisor: false,
  });
  return workflowOutput;

  async function handleHybridEscalation(
    condition: UnhandledWorkflowConditionError<I>,
  ): Promise<O> {
    const factory = request.supervisorFactory;
    const returnToWorkflow = request.returnToWorkflow;
    if (!factory) {
      const error = new SupervisorResolutionError(
        "Hybrid escalation requires an explicit supervisor factory",
      );
      await appendFailure("supervisor.configuration", error);
      throw error;
    }
    if (!returnToWorkflow) {
      const error = new SupervisorResolutionError(
        "Hybrid escalation requires an explicit return-to-workflow handler",
      );
      await appendFailure("supervisor.configuration", error);
      throw error;
    }

    await append("supervisor.escalated", {
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      reason: condition.reason,
    });

    await assertBudget("supervisor.preflight");

    let resolution: SupervisorResolution<O>;
    try {
      resolution = await factory(condition).resolve(request.context);
    } catch (error) {
      await appendFailure("supervisor.resolve", error);
      throw error;
    }

    await assertBudget("supervisor.resolved");

    if (
      resolution.workflowId !== workflow.id ||
      resolution.workflowVersion !== workflow.version
    ) {
      const error = new WorkflowReturnMismatchError(
        workflow.id,
        workflow.version,
        resolution.workflowId,
        resolution.workflowVersion,
      );
      await appendFailure("supervisor.return-validation", error);
      throw error;
    }

    // Persist the complete provider-neutral resolution before claiming a return-to-workflow boundary.
    // EventSink implementations provide the durable/replayable evidence contract; no parallel store is added here.
    await append("supervisor.returned", {
      workflowId: resolution.workflowId,
      workflowVersion: resolution.workflowVersion,
      resolution: resolution.output,
    });

    let output: O;
    try {
      output = await returnToWorkflow(resolution.output, request.context);
    } catch (error) {
      await appendFailure("workflow.return", error);
      throw error;
    }

    await assertBudget("workflow.returned");
    await append("execution.completed", {
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      returnedFromSupervisor: true,
    });
    return output;
  }
}

function assertContextIdentity<I, O>(
  workflow: WorkflowDefinition<I, O>,
  context: WorkflowContext,
): void {
  if (workflow.id !== context.workflowId || workflow.version !== context.workflowVersion) {
    throw new WorkflowReturnMismatchError(
      workflow.id,
      workflow.version,
      context.workflowId,
      context.workflowVersion,
    );
  }
}

function normalizeError(error: unknown): { readonly name: string; readonly message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

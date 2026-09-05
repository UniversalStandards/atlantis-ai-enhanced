import {
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
}

export async function orchestrateWorkflow<I, O>(
  request: OrchestrateWorkflowRequest<I, O>,
): Promise<O> {
  const workflow = request.registry.get<I, O>(request.workflowId, request.workflowVersion);
  assertContextIdentity(workflow, request.context);
  assertWithinBudget(request.context);

  let sequence = 0;
  let parentEventId: string | undefined;
  const append = async <T>(type: ExecutionEvent<T>["type"], payload: T): Promise<void> => {
    sequence += 1;
    const id = `${request.context.executionId}:${sequence}`;
    await request.events.append({
      id,
      executionId: request.context.executionId,
      sequence,
      type,
      occurredAt: new Date(0).toISOString(),
      actor: "workflow-orchestrator",
      ...(parentEventId ? { parentEventId } : {}),
      payload,
    });
    parentEventId = id;
  };

  const decision = decideWorkflowRoute(
    workflow as WorkflowDefinition<unknown, unknown>,
    request.context.mode,
  );
  await append("execution.started", { route: decision });

  if (decision.route === "supervisor") {
    throw new SupervisorResolutionError(
      "Supervisor-only execution requires an explicit supervisor entry contract; implicit workflow bypass is prohibited",
    );
  }

  try {
    const output = await workflow.run(request.input, request.context);
    assertWithinBudget(request.context);
    await append("execution.completed", {
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      returnedFromSupervisor: false,
    });
    return output;
  } catch (error) {
    if (!(error instanceof UnhandledWorkflowConditionError) || decision.route !== "hybrid") {
      throw error;
    }

    const factory = request.supervisorFactory;
    const returnToWorkflow = request.returnToWorkflow;
    if (!factory) {
      throw new SupervisorResolutionError("Hybrid escalation requires an explicit supervisor factory");
    }
    if (!returnToWorkflow) {
      throw new SupervisorResolutionError(
        "Hybrid escalation requires an explicit return-to-workflow handler",
      );
    }

    await append("supervisor.escalated", {
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      reason: error.reason,
    });

    assertWithinBudget(request.context);
    const resolution = await factory(error).resolve(request.context);
    assertWithinBudget(request.context);

    if (
      resolution.workflowId !== workflow.id ||
      resolution.workflowVersion !== workflow.version
    ) {
      throw new WorkflowReturnMismatchError(
        workflow.id,
        workflow.version,
        resolution.workflowId,
        resolution.workflowVersion,
      );
    }

    await append("supervisor.returned", {
      workflowId: resolution.workflowId,
      workflowVersion: resolution.workflowVersion,
    });

    const output = await returnToWorkflow(resolution.output, request.context);
    assertWithinBudget(request.context);
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

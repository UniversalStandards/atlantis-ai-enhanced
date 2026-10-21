import type { ExecutionEvent, ExecutionEventType } from "@atlantis/contracts";

import { InvalidEventError } from "./index.js";

export interface ExecutionTopologyNode {
  readonly eventId: string;
  readonly executionId: string;
  readonly sequence: number;
  readonly type: ExecutionEventType;
  readonly occurredAt: string;
  readonly actor: string;
}

export interface ExecutionTopologyEdge {
  readonly parentEventId: string;
  readonly childEventId: string;
}

export interface ExecutionTopology {
  readonly executionId: string;
  readonly roots: readonly string[];
  readonly nodes: readonly ExecutionTopologyNode[];
  readonly edges: readonly ExecutionTopologyEdge[];
}

/**
 * Projects an already-restored execution stream into a deterministic topology.
 *
 * The projection is deliberately persistence- and telemetry-provider-neutral.
 * It rejects incomplete or ambiguous causal graphs rather than inventing
 * missing parents, accepting duplicate identities, or reordering evidence.
 */
export function projectExecutionTopology(
  events: readonly ExecutionEvent[],
): ExecutionTopology {
  if (events.length === 0) {
    throw new InvalidEventError("execution topology requires at least one event.");
  }

  const executionId = events[0]!.executionId;
  const seen = new Set<string>();
  const nodes: ExecutionTopologyNode[] = [];
  const edges: ExecutionTopologyEdge[] = [];
  const roots: string[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const expectedSequence = index + 1;

    if (event.executionId !== executionId) {
      throw new InvalidEventError(
        "execution topology cannot combine multiple execution identities.",
      );
    }
    if (event.sequence !== expectedSequence) {
      throw new InvalidEventError(
        `execution topology expected sequence ${expectedSequence}, received ${event.sequence}.`,
      );
    }
    if (seen.has(event.id)) {
      throw new InvalidEventError(
        `execution topology contains duplicate event id ${event.id}.`,
      );
    }

    if (event.parentEventId === undefined) {
      roots.push(event.id);
    } else {
      if (!seen.has(event.parentEventId)) {
        throw new InvalidEventError(
          `execution topology parent ${event.parentEventId} must precede child ${event.id}.`,
        );
      }
      edges.push(
        Object.freeze({
          parentEventId: event.parentEventId,
          childEventId: event.id,
        }),
      );
    }

    seen.add(event.id);
    nodes.push(
      Object.freeze({
        eventId: event.id,
        executionId: event.executionId,
        sequence: event.sequence,
        type: event.type,
        occurredAt: event.occurredAt,
        actor: event.actor,
      }),
    );
  }

  return Object.freeze({
    executionId,
    roots: Object.freeze(roots),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  });
}

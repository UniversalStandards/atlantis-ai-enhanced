import { describe, expect, it } from "vitest";

import type { ExecutionEvent } from "@atlantis/contracts";

import { InvalidEventError } from "../src/index.js";
import { projectExecutionTopology } from "../src/execution-topology.js";

function event(
  id: string,
  sequence: number,
  parentEventId?: string,
  executionId = "execution-1",
): ExecutionEvent {
  return Object.freeze({
    id,
    executionId,
    sequence,
    type: sequence === 1 ? "execution.started" : "workflow.step.completed",
    occurredAt: `2026-08-21T00:00:0${sequence}.000Z`,
    actor: "test-runner",
    ...(parentEventId === undefined ? {} : { parentEventId }),
    payload: Object.freeze({}),
  });
}

describe("projectExecutionTopology", () => {
  it("projects deterministic roots, nodes, and causal edges", () => {
    const topology = projectExecutionTopology([
      event("root", 1),
      event("child-a", 2, "root"),
      event("child-b", 3, "root"),
      event("grandchild", 4, "child-a"),
    ]);

    expect(topology).toEqual({
      executionId: "execution-1",
      roots: ["root"],
      nodes: [
        expect.objectContaining({ eventId: "root", sequence: 1 }),
        expect.objectContaining({ eventId: "child-a", sequence: 2 }),
        expect.objectContaining({ eventId: "child-b", sequence: 3 }),
        expect.objectContaining({ eventId: "grandchild", sequence: 4 }),
      ],
      edges: [
        { parentEventId: "root", childEventId: "child-a" },
        { parentEventId: "root", childEventId: "child-b" },
        { parentEventId: "child-a", childEventId: "grandchild" },
      ],
    });
    expect(Object.isFrozen(topology)).toBe(true);
    expect(Object.isFrozen(topology.nodes)).toBe(true);
    expect(Object.isFrozen(topology.edges)).toBe(true);
  });

  it("fails closed on an empty stream", () => {
    expect(() => projectExecutionTopology([])).toThrow(InvalidEventError);
  });

  it("fails closed on mixed execution identities", () => {
    expect(() =>
      projectExecutionTopology([
        event("root", 1),
        event("child", 2, "root", "execution-2"),
      ]),
    ).toThrow(/multiple execution identities/);
  });

  it("fails closed on sequence gaps", () => {
    expect(() => projectExecutionTopology([event("root", 1), event("child", 3, "root")])).toThrow(
      /expected sequence 2/,
    );
  });

  it("fails closed on duplicate event identities", () => {
    expect(() => projectExecutionTopology([event("same", 1), event("same", 2, "same")])).toThrow(
      /duplicate event id/,
    );
  });

  it("fails closed when a parent is missing or appears after its child", () => {
    expect(() => projectExecutionTopology([event("child", 1, "parent")])).toThrow(
      /parent parent must precede child child/,
    );
  });
});

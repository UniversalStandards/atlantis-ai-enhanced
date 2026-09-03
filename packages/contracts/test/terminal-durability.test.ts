import { describe, expect, it } from "vitest";
import {
  DurabilityInvariantError,
  publishTerminalDurabilityTransition,
  recoverTerminalExecution,
  type CheckpointRetirement,
  type DurableExecutionCheckpoint,
  type ExecutionEvent,
  type TerminalDurabilityAuthority,
  type TerminalDurabilityTransition,
  type TerminalExecutionPayload,
} from "../src/index.js";

const checkpoint: DurableExecutionCheckpoint = {
  id: "checkpoint-1",
  executionId: "exec-1",
  nextSequence: 8,
  completedPrefix: 7,
  updatedAt: "2026-09-03T16:00:00.000Z",
};

function terminalEvent(
  overrides: Partial<ExecutionEvent<TerminalExecutionPayload>> = {},
): ExecutionEvent<TerminalExecutionPayload> {
  return {
    id: "event-terminal-1",
    executionId: "exec-1",
    sequence: 8,
    type: "execution.cancelled",
    occurredAt: "2026-09-03T16:01:00.000Z",
    actor: "policy",
    payload: {
      status: "cancelled",
      completedPrefix: 7,
    },
    ...overrides,
  };
}

function transition(
  terminalEventOverride: ExecutionEvent<TerminalExecutionPayload> = terminalEvent(),
): TerminalDurabilityTransition {
  return {
    checkpoint,
    terminalEvent: terminalEventOverride,
    retiredAt: "2026-09-03T16:02:00.000Z",
  };
}

class FailureInjectedAuthority implements TerminalDurabilityAuthority {
  terminal?: ExecutionEvent<TerminalExecutionPayload>;
  retirement?: CheckpointRetirement;
  checkpointActive = true;

  constructor(
    private readonly failAt:
      | "before-publication"
      | "after-publication-pre-ack"
      | "before-retirement"
      | "after-retirement-ack"
      | "none",
  ) {}

  async appendTerminalEvent(event: ExecutionEvent<TerminalExecutionPayload>): Promise<void> {
    if (this.failAt === "before-publication") {
      throw new Error("crash before terminal publication");
    }

    this.terminal = event;

    if (this.failAt === "after-publication-pre-ack") {
      throw new Error("crash after terminal publication before ack");
    }
  }

  async retireCheckpoint(retirement: CheckpointRetirement): Promise<void> {
    if (this.failAt === "before-retirement") {
      throw new Error("crash before checkpoint retirement");
    }

    this.retirement = retirement;
    this.checkpointActive = false;

    if (this.failAt === "after-retirement-ack") {
      throw new Error("crash after checkpoint retirement ack");
    }
  }

  recover() {
    if (this.terminal !== undefined) {
      if (this.checkpointActive) {
        return recoverTerminalExecution({
          checkpoint,
          terminalEvent: this.terminal,
        });
      }

      return recoverTerminalExecution({
        terminalEvent: this.terminal,
        checkpointRetired: true,
      });
    }

    return recoverTerminalExecution({
      checkpoint,
      checkpointRetired: false,
    });
  }
}

describe("terminal durability transitions", () => {
  it.each([
    ["execution.completed", "succeeded"],
    ["execution.failed", "failed"],
    ["execution.cancelled", "cancelled"],
    ["execution.timed_out", "timed_out"],
    ["execution.rejected", "rejected"],
    ["budget.exceeded", "budget_exceeded"],
  ] as const)("accepts %s as authoritative terminal evidence", async (type, status) => {
    const event = terminalEvent({
      type,
      payload: {
        status,
        completedPrefix: 7,
      },
    });
    const authority = new FailureInjectedAuthority("none");

    await publishTerminalDurabilityTransition(authority, transition(event));

    expect(authority.recover()).toMatchObject({
      kind: "terminal",
      outcome: {
        status,
        completedPrefix: 7,
      },
    });
  });

  it("publishes terminal evidence before retiring the checkpoint", async () => {
    const authority = new FailureInjectedAuthority("none");

    await publishTerminalDurabilityTransition(authority, transition());

    expect(authority.terminal).toEqual(terminalEvent());
    expect(authority.retirement).toEqual({
      checkpointId: "checkpoint-1",
      executionId: "exec-1",
      terminalEventId: "event-terminal-1",
      retiredAt: "2026-09-03T16:02:00.000Z",
    });
    expect(authority.checkpointActive).toBe(false);
  });

  it("resumes from the active checkpoint without re-executing the completed prefix when publication never happened", async () => {
    const authority = new FailureInjectedAuthority("before-publication");

    await expect(
      publishTerminalDurabilityTransition(authority, transition()),
    ).rejects.toThrow("crash before terminal publication");

    expect(authority.recover()).toEqual({
      kind: "resume",
      checkpoint,
      resumeFromSequence: 8,
    });
  });

  it.each([
    "after-publication-pre-ack",
    "before-retirement",
    "after-retirement-ack",
  ] as const)(
    "recovers the same terminal outcome and never resumes work after %s",
    async (failurePoint) => {
      const authority = new FailureInjectedAuthority(failurePoint);

      await expect(
        publishTerminalDurabilityTransition(authority, transition()),
      ).rejects.toThrow();

      const recovery = authority.recover();

      expect(recovery.kind).toBe("terminal");
      if (recovery.kind === "terminal") {
        expect(recovery.outcome).toEqual({
          status: "cancelled",
          completedPrefix: 7,
        });
      }
    },
  );

  it("rejects checkpoint retirement for non-terminal evidence", async () => {
    const nonTerminal = terminalEvent({
      type: "workflow.step.completed",
      payload: {
        status: "cancelled",
        completedPrefix: 7,
      },
    });

    await expect(
      publishTerminalDurabilityTransition(
        new FailureInjectedAuthority("none"),
        transition(nonTerminal),
      ),
    ).rejects.toThrow(DurabilityInvariantError);
  });

  it("rejects terminal evidence that drops the checkpoint completed prefix", async () => {
    await expect(
      publishTerminalDurabilityTransition(
        new FailureInjectedAuthority("none"),
        transition(
          terminalEvent({
            payload: {
              status: "cancelled",
              completedPrefix: 6,
            },
          }),
        ),
      ),
    ).rejects.toThrow(DurabilityInvariantError);
  });

  it("rejects retired checkpoints without terminal evidence as an invalid durability state", () => {
    expect(() =>
      recoverTerminalExecution({
        checkpointRetired: true,
      }),
    ).toThrow(DurabilityInvariantError);
  });
});

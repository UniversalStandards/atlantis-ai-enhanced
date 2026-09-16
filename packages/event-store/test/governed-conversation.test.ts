import { describe, expect, it } from "vitest";
import {
  ApprovalRejectedError,
  ApprovalRequiredError,
  InvalidApprovalError,
} from "../../contracts/src/approval-control.js";
import {
  ConversationAccessDeniedError,
  ConversationApprovalStateError,
  GovernedConversationService,
  InvalidConversationIdentityError,
} from "../src/governed-conversation.js";
import { InMemoryEventStore, type EventStore, type StoredEvent } from "../src/index.js";

const timestamps = ["2026-09-05T00:00:00.000Z","2026-09-05T00:00:01.000Z","2026-09-05T00:00:02.000Z","2026-09-05T00:00:03.000Z","2026-09-05T00:00:04.000Z","2026-09-05T00:00:05.000Z"];
function deterministicClock(): () => string { let index = 0; return () => timestamps[index++] ?? "2026-09-05T00:00:59.000Z"; }
const actor = Object.freeze({ tenantId: "tenant-a", userId: "user-a" });
const reviewerApproval = Object.freeze({
  approvalId: "approval-1",
  executionId: "conversation-1",
  requestVersion: 1,
  decision: "approved" as const,
  resolvedBy: "reviewer-a",
  resolvedAt: "2026-09-05T00:00:05.000Z",
});

class ConcurrentApprovalStore implements EventStore {
  private readonly store = new InMemoryEventStore();
  private injected = false;

  public append<TPayload>(
    event: {
      readonly streamId: string;
      readonly eventId: string;
      readonly eventType: string;
      readonly payload: TPayload;
      readonly occurredAt: string;
      readonly traceId: string;
      readonly correlationId?: string;
      readonly causationId?: string;
    },
    expectedVersion: number,
  ): StoredEvent<TPayload> {
    if (!this.injected && event.eventType === "conversation.tool.approved") {
      this.injected = true;
      const payload = event.payload as {
        readonly tenantId: string;
        readonly userId: string;
        readonly approvalId: string;
        readonly requestVersion: number;
        readonly toolName?: string;
        readonly requestedBy?: string;
      };
      this.store.append(
        {
          ...event,
          eventId: "event-race-approved",
          payload: Object.freeze({
            tenantId: payload.tenantId,
            userId: payload.userId,
            approvalId: payload.approvalId,
            requestVersion: payload.requestVersion,
            toolName: payload.toolName,
            requestedBy: payload.requestedBy,
            resolvedBy: "reviewer-race",
          }),
        },
        expectedVersion,
      );
    }
    return this.store.append(event, expectedVersion);
  }

  public readStream(streamId: string, afterVersion?: number): readonly StoredEvent[] {
    return this.store.readStream(streamId, afterVersion);
  }

  public readAll(afterSequence?: number): readonly StoredEvent[] {
    return this.store.readAll(afterSequence);
  }

  public getStreamVersion(streamId: string): number {
    return this.store.getStreamVersion(streamId);
  }
}

describe("governed conversation vertical slice", () => {
  it("persists state, streams mock output, gates a tool, audits, and deletes", async () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);
    expect((await service.sendMessage(actor, id, "hello atlantis")).join("")).toBe("mock:hello atlantis ");
    expect(service.readConversation(actor, id).messages[1]?.model).toEqual({ family: "mock", capability: "conversation" });
    const request = service.buildToolApproval(actor, id, "echo-status");
    expect(() => service.executeHarmlessTool(actor, request)).toThrow(ApprovalRequiredError);
    expect(service.executeHarmlessTool(actor, request, { ...reviewerApproval, approvalId: request.approvalId, executionId: request.executionId, requestVersion: request.requestVersion })).toBe("tool:echo-status:ok");
    const approvalEvent = service
      .readAuditEvents(actor, id)
      .find((event) => event.eventType === "conversation.tool.approved");
    expect(approvalEvent?.payload).toMatchObject({
      tenantId: actor.tenantId,
      userId: actor.userId,
      executionId: request.executionId,
      approvalId: request.approvalId,
      requestVersion: request.requestVersion,
      stepId: request.stepId,
      toolName: request.metadata.toolName,
      action: request.action,
      reason: request.reason,
      requestedBy: request.requestedBy,
      requestedAt: request.requestedAt,
      resolvedBy: reviewerApproval.resolvedBy,
      resolvedAt: reviewerApproval.resolvedAt,
      decision: "approved",
    });
    service.deleteConversation(actor, id);
    expect(service.readConversation(actor, id)).toMatchObject({ deleted: true, messages: [] });
    const redactedMessages = service
      .readAuditEvents(actor, id)
      .filter((event) => event.eventType === "conversation.message")
      .map((event) => (event.payload as { readonly message?: { readonly content: string } }).message?.content);
    expect(redactedMessages).toEqual(["[deleted]", "[deleted]"]);
  });

  it("fails closed for blank or wrong tenant and user identities", async () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);

    expect(() => service.readConversation({ tenantId: " ", userId: actor.userId }, id)).toThrow(
      InvalidConversationIdentityError,
    );
    expect(() =>
      service.readConversation({ tenantId: actor.tenantId, userId: "user-b" }, id),
    ).toThrow(ConversationAccessDeniedError);
    await expect(
      service.sendMessage({ tenantId: "tenant-b", userId: actor.userId }, id, "hello"),
    ).rejects.toThrow(ConversationAccessDeniedError);
    expect(() =>
      service.readAuditEvents({ tenantId: "tenant-b", userId: actor.userId }, id),
    ).toThrow(ConversationAccessDeniedError);
    expect(() => service.readConversation(actor, "missing-conversation")).toThrow(
      ConversationAccessDeniedError,
    );
  });

  it("binds approval execution to the exact tenant and user context", () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);
    const request = service.buildToolApproval(actor, id, "echo-status");

    expect(() =>
      service.executeHarmlessTool(
        { tenantId: "tenant-b", userId: actor.userId },
        request,
        { ...reviewerApproval, approvalId: request.approvalId, executionId: request.executionId },
      ),
    ).toThrow(ConversationAccessDeniedError);
    expect(() =>
      service.executeHarmlessTool(
        actor,
        request,
        {
          ...reviewerApproval,
          approvalId: request.approvalId,
          executionId: request.executionId,
          decision: "rejected",
        },
      ),
    ).toThrow(ApprovalRejectedError);
    expect(() =>
      service.executeHarmlessTool(actor, request, {
        ...reviewerApproval,
        approvalId: request.approvalId,
        executionId: request.executionId,
      }),
    ).toThrow(ConversationApprovalStateError);
  });

  it("rejects replayed approval executions for the same approval request", () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);
    const request = service.buildToolApproval(actor, id, "echo-status");
    const approval = {
      ...reviewerApproval,
      approvalId: request.approvalId,
      executionId: request.executionId,
    };

    expect(service.executeHarmlessTool(actor, request, approval)).toBe("tool:echo-status:ok");
    expect(() => service.executeHarmlessTool(actor, request, approval)).toThrow(
      ConversationApprovalStateError,
    );
  });

  it("rejects forged approval requests that were never recorded as pending", () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);

    expect(() =>
      service.executeHarmlessTool(
        actor,
        {
          approvalId: "approval-forged",
          executionId: id,
          requestVersion: 1,
          stepId: "tool:echo-status",
          action: "invoke harmless demonstration tool echo-status",
          reason: "demonstration tools require explicit approval",
          requestedBy: actor.userId,
          requestedAt: "2026-09-05T00:00:01.000Z",
          metadata: Object.freeze({
            tenantId: actor.tenantId,
            userId: actor.userId,
            toolName: "echo-status",
          }),
        },
        {
          approvalId: "approval-forged",
          executionId: id,
          requestVersion: 1,
          decision: "approved",
          resolvedBy: "reviewer-a",
          resolvedAt: "2026-09-05T00:00:05.000Z",
        },
      ),
    ).toThrow(ConversationApprovalStateError);
  });

  it("rejects approval requests whose step binding does not match the recorded pending request", () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);
    const request = service.buildToolApproval(actor, id, "echo-status");

    expect(() =>
      service.executeHarmlessTool(
        actor,
        { ...request, stepId: "tool:other-status" },
        {
          ...reviewerApproval,
          approvalId: request.approvalId,
          executionId: request.executionId,
        },
      ),
    ).toThrow(ConversationApprovalStateError);
  });

  it("rejects approval requests whose action, reason, or tool binding does not match the recorded pending request", () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);
    const request = service.buildToolApproval(actor, id, "echo-status");
    const resolution = {
      ...reviewerApproval,
      approvalId: request.approvalId,
      executionId: request.executionId,
      requestVersion: request.requestVersion,
    };

    expect(() =>
      service.executeHarmlessTool(
        actor,
        { ...request, action: "invoke harmless demonstration tool different-tool" },
        resolution,
      ),
    ).toThrow(ConversationApprovalStateError);
    expect(() =>
      service.executeHarmlessTool(
        actor,
        { ...request, reason: "different reason" },
        resolution,
      ),
    ).toThrow(ConversationApprovalStateError);
    expect(() =>
      service.executeHarmlessTool(
        actor,
        {
          ...request,
          metadata: Object.freeze({
            ...request.metadata,
            toolName: "different-tool",
          }),
        },
        resolution,
      ),
    ).toThrow(ConversationApprovalStateError);
  });

  it("persists rejected approval resolution evidence without dropping the exact request binding", () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);
    const request = service.buildToolApproval(actor, id, "echo-status");

    expect(() =>
      service.executeHarmlessTool(actor, request, {
        ...reviewerApproval,
        approvalId: request.approvalId,
        executionId: request.executionId,
        requestVersion: request.requestVersion,
        decision: "rejected",
        comment: "denied for test proof",
      }),
    ).toThrow(ApprovalRejectedError);
    const rejectionEvent = service
      .readAuditEvents(actor, id)
      .find((event) => event.eventType === "conversation.tool.rejected");
    expect(rejectionEvent?.payload).toMatchObject({
      tenantId: actor.tenantId,
      userId: actor.userId,
      executionId: request.executionId,
      approvalId: request.approvalId,
      requestVersion: request.requestVersion,
      stepId: request.stepId,
      toolName: request.metadata.toolName,
      action: request.action,
      reason: request.reason,
      requestedBy: request.requestedBy,
      requestedAt: request.requestedAt,
      resolvedBy: reviewerApproval.resolvedBy,
      resolvedAt: reviewerApproval.resolvedAt,
      decision: "rejected",
      comment: "denied for test proof",
    });
  });

  it("fails closed on malformed approval payloads before treating them as ownership errors", () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);
    const request = service.buildToolApproval(actor, id, "echo-status");

    expect(() =>
      service.executeHarmlessTool(actor, {
        ...request,
        requestVersion: 0,
      }),
    ).toThrow(InvalidApprovalError);
    expect(() =>
      service.executeHarmlessTool(actor, {
        ...request,
        requestedAt: "not-a-timestamp",
      }),
    ).toThrow(InvalidApprovalError);
    expect(() =>
      service.executeHarmlessTool(actor, request, {
        ...reviewerApproval,
        approvalId: request.approvalId,
        executionId: request.executionId,
        requestVersion: request.requestVersion,
        resolvedAt: "not-a-timestamp",
      }),
    ).toThrow(InvalidApprovalError);
    expect(() =>
      service.executeHarmlessTool(
        { tenantId: " ", userId: actor.userId },
        request,
      ),
    ).toThrow(InvalidConversationIdentityError);
  });

  it("requires governed streams to start with conversation.created", () => {
    const store = new InMemoryEventStore();
    store.append(
      {
        streamId: "conversation-1",
        eventId: "event-1",
        eventType: "unrelated.aggregate.created",
        payload: Object.freeze({ tenantId: actor.tenantId, userId: actor.userId }),
        occurredAt: "2026-09-05T00:00:00.000Z",
        traceId: "conversation-1",
      },
      0,
    );
    const service = new GovernedConversationService(store, undefined, deterministicClock());

    expect(() => service.readConversation(actor, "conversation-1")).toThrow(
      ConversationAccessDeniedError,
    );
  });

  it("translates concurrent approval races into the governed terminal-state error", () => {
    const service = new GovernedConversationService(
      new ConcurrentApprovalStore(),
      undefined,
      deterministicClock(),
    );
    const id = service.createConversation(actor.tenantId, actor.userId);
    const request = service.buildToolApproval(actor, id, "echo-status");

    expect(() =>
      service.executeHarmlessTool(actor, request, {
        ...reviewerApproval,
        approvalId: request.approvalId,
        executionId: request.executionId,
      }),
    ).toThrow(ConversationApprovalStateError);
  });
});

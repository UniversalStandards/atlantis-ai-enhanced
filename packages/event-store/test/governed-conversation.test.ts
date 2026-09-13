import { describe, expect, it } from "vitest";
import {
  ApprovalRejectedError,
  ApprovalRequiredError,
} from "../../contracts/src/approval-control.js";
import {
  ConversationAccessDeniedError,
  GovernedConversationService,
  InvalidConversationIdentityError,
} from "../src/governed-conversation.js";

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

describe("governed conversation vertical slice", () => {
  it("persists state, streams mock output, gates a tool, audits, and deletes", async () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation(actor.tenantId, actor.userId);
    expect((await service.sendMessage(actor, id, "hello atlantis")).join("")).toBe("mock:hello atlantis ");
    expect(service.readConversation(actor, id).messages[1]?.model).toEqual({ family: "mock", capability: "conversation" });
    const request = service.buildToolApproval(actor, id, "echo-status");
    expect(() => service.executeHarmlessTool(actor, request)).toThrow(ApprovalRequiredError);
    expect(service.executeHarmlessTool(actor, request, { ...reviewerApproval, approvalId: request.approvalId, executionId: request.executionId, requestVersion: request.requestVersion })).toBe("tool:echo-status:ok");
    expect(service.readAuditEvents(actor, id).some((event) => event.eventType === "conversation.tool.approved")).toBe(true);
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
  });
});

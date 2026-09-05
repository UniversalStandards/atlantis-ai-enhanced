import { describe, expect, it } from "vitest";
import { ApprovalRequiredError } from "../../../packages/contracts/src/approval-control.js";
import { ConversationService } from "../src/index.js";

const timestamps = [
  "2026-09-05T00:00:00.000Z",
  "2026-09-05T00:00:01.000Z",
  "2026-09-05T00:00:02.000Z",
  "2026-09-05T00:00:03.000Z",
  "2026-09-05T00:00:04.000Z",
  "2026-09-05T00:00:05.000Z",
];

function deterministicClock(): () => string {
  let index = 0;
  return () => timestamps[index++] ?? "2026-09-05T00:00:59.000Z";
}

describe("governed conversation vertical slice", () => {
  it("persists tenant/session state, streams mock output, gates a tool, audits, and deletes", async () => {
    const service = new ConversationService(undefined, undefined, deterministicClock());
    const conversationId = service.createConversation("tenant-a", "user-a");

    const chunks = await service.sendMessage(conversationId, "hello atlantis");
    expect(chunks.join("")).toBe("mock:hello atlantis ");

    const beforeTool = service.readConversation(conversationId);
    expect(beforeTool.messages).toHaveLength(2);
    expect(beforeTool.messages[1]?.model).toEqual({ family: "mock", capability: "conversation" });

    const request = service.buildToolApproval(conversationId, "echo-status");
    expect(() => service.executeHarmlessTool(request, undefined as never)).toThrow(ApprovalRequiredError);

    const result = service.executeHarmlessTool(request, {
      approvalId: request.approvalId,
      executionId: request.executionId,
      requestVersion: request.requestVersion,
      decision: "approved",
      resolvedBy: "reviewer-a",
      resolvedAt: "2026-09-05T00:00:05.000Z",
    });
    expect(result).toBe("tool:echo-status:ok");
    expect(service.readAuditEvents(conversationId).some((event) => event.eventType === "conversation.tool.approved")).toBe(true);

    service.deleteConversation(conversationId);
    const deleted = service.readConversation(conversationId);
    expect(deleted.deleted).toBe(true);
    expect(deleted.messages).toEqual([]);
  });
});

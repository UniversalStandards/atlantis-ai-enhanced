import { describe, expect, it } from "vitest";
import { ApprovalRequiredError } from "../../contracts/src/approval-control.js";
import { GovernedConversationService } from "../src/governed-conversation.js";

const timestamps = ["2026-09-05T00:00:00.000Z","2026-09-05T00:00:01.000Z","2026-09-05T00:00:02.000Z","2026-09-05T00:00:03.000Z","2026-09-05T00:00:04.000Z","2026-09-05T00:00:05.000Z"];
function deterministicClock(): () => string { let index = 0; return () => timestamps[index++] ?? "2026-09-05T00:00:59.000Z"; }

describe("governed conversation vertical slice", () => {
  it("persists state, streams mock output, gates a tool, audits, and deletes", async () => {
    const service = new GovernedConversationService(undefined, undefined, deterministicClock());
    const id = service.createConversation("tenant-a", "user-a");
    expect((await service.sendMessage(id, "hello atlantis")).join("")).toBe("mock:hello atlantis ");
    expect(service.readConversation(id).messages[1]?.model).toEqual({ family: "mock", capability: "conversation" });
    const request = service.buildToolApproval(id, "echo-status");
    expect(() => service.executeHarmlessTool(request)).toThrow(ApprovalRequiredError);
    expect(service.executeHarmlessTool(request, { approvalId: request.approvalId, executionId: request.executionId, requestVersion: request.requestVersion, decision: "approved", resolvedBy: "reviewer-a", resolvedAt: "2026-09-05T00:00:05.000Z" })).toBe("tool:echo-status:ok");
    expect(service.readAuditEvents(id).some((event) => event.eventType === "conversation.tool.approved")).toBe(true);
    service.deleteConversation(id);
    expect(service.readConversation(id)).toMatchObject({ deleted: true, messages: [] });
  });
});

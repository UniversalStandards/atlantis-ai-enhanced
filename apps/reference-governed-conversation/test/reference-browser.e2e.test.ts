import { describe, expect, it } from "vitest";
import {
  ApprovalRejectedError,
  ApprovalRequiredError,
} from "@atlantis/contracts/approval-control";
import {
  ConversationApprovalStateError,
  GovernedConversationService,
} from "@atlantis/event-store/governed-conversation";
import { InMemoryEventStore, type EventStore, type StoredEvent } from "@atlantis/event-store";

import { ReferenceConversationApp, renderReferenceAppShell } from "../src/reference-app.js";

function deterministicClock(): () => string {
  const timestamps = [
    "2026-09-05T00:00:00.000Z",
    "2026-09-05T00:00:01.000Z",
    "2026-09-05T00:00:02.000Z",
    "2026-09-05T00:00:03.000Z",
    "2026-09-05T00:00:04.000Z",
    "2026-09-05T00:00:05.000Z",
    "2026-09-05T00:00:06.000Z",
  ];
  let index = 0;
  return () => timestamps[index++] ?? "2026-09-05T00:00:59.000Z";
}

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

describe("reference browser governed conversation path", () => {
  it("supports sign-in, deterministic streaming, explicit approval, audit evidence, and bounded deletion", async () => {
    const app = new ReferenceConversationApp(
      new GovernedConversationService(undefined, undefined, deterministicClock()),
    );

    app.signIn({ tenantId: "tenant-a", userId: "user-a" });
    const conversationId = app.createConversation();

    expect(await app.sendMessage("hello atlantis")).toEqual(["mock:hello ", "atlantis "]);
    expect(app.readConversation().messages[1]?.content).toBe("mock:hello atlantis");

    const request = app.requestHarmlessTool("echo-status");
    expect(request.metadata).toMatchObject({ tenantId: "tenant-a", userId: "user-a" });
    expect(() => app.executePendingTool()).toThrow(ApprovalRequiredError);
    expect(app.approvePendingTool("reviewer-a", "2026-09-05T00:00:06.000Z")).toBe("tool:echo-status:ok");

    const evidenceTypes = app.readAuditEvents().map((event) => event.eventType);
    expect(evidenceTypes).toContain("conversation.tool.approved");
    expect(evidenceTypes).toContain("conversation.created");
    expect(evidenceTypes).toContain("conversation.message");

    const html = renderReferenceAppShell(app.view());
    expect(html).toContain("tenant=tenant-a;user=user-a");
    expect(html).toContain(`conversation'>${conversationId}<`);
    expect(html).toContain("user:hello atlantis|assistant:mock:hello atlantis");
    expect(html).toContain("conversation.tool.approved");

    app.deleteConversation();
    expect(() => app.readConversation()).toThrow("conversation not created");
    expect(app.view().conversationId).toBeNull();
    expect(renderReferenceAppShell(app.view())).toContain("conversation'>none<");
  });

  it("shows approval denial without fabricating successful audit evidence", () => {
    const app = new ReferenceConversationApp(
      new GovernedConversationService(undefined, undefined, deterministicClock()),
    );
    app.signIn({ tenantId: "tenant-a", userId: "user-a" });
    app.createConversation();
    const request = app.requestHarmlessTool("echo-status");

    expect(() =>
      app.executePendingTool({
        approvalId: request.approvalId,
        executionId: request.executionId,
        requestVersion: request.requestVersion,
        decision: "rejected",
        resolvedBy: "reviewer-a",
        resolvedAt: "2026-09-05T00:00:06.000Z",
      }),
    ).toThrow(ApprovalRejectedError);
    expect(app.view().pendingApproval).toBeNull();
    expect(
      app.readAuditEvents().some((event) => event.eventType === "conversation.tool.approved"),
    ).toBe(false);
    expect(
      app.readAuditEvents().some((event) => event.eventType === "conversation.tool.rejected"),
    ).toBe(true);
  });

  it("fails closed for missing or mismatched tenant/user identity context", () => {
    const app = new ReferenceConversationApp(
      new GovernedConversationService(undefined, undefined, deterministicClock()),
    );
    expect(() => app.createConversation()).toThrow("reference sign-in required");
    expect(() => app.signIn({ tenantId: " ", userId: "user-a" })).toThrow("tenantId must be non-empty");

    app.signIn({ tenantId: "tenant-a", userId: "user-a" });
    app.createConversation();
    app.signIn({ tenantId: "tenant-b", userId: "user-a" });

    expect(() => app.readConversation()).toThrow("conversation access denied for tenant/user context");
    expect(() => app.requestHarmlessTool("echo-status")).toThrow("conversation access denied for tenant/user context");
    expect(app.view().conversationId).toBeNull();
  });

  it("keeps deleted conversations unavailable across identity changes", () => {
    const app = new ReferenceConversationApp(
      new GovernedConversationService(undefined, undefined, deterministicClock()),
    );
    app.signIn({ tenantId: "tenant-a", userId: "user-a" });
    const deletedConversationId = app.createConversation();
    app.deleteConversation();

    app.signIn({ tenantId: "tenant-b", userId: "user-b" });
    app.openConversation(deletedConversationId);
    expect(() => app.readConversation()).toThrow("conversation access denied for tenant/user context");
    expect(app.view().conversationId).toBeNull();
    expect(renderReferenceAppShell(app.view())).toContain("conversation'>none<");
  });

  it("preserves only redacted audit evidence when the owner reopens a deleted conversation", async () => {
    const app = new ReferenceConversationApp(
      new GovernedConversationService(undefined, undefined, deterministicClock()),
    );
    app.signIn({ tenantId: "tenant-a", userId: "user-a" });
    const conversationId = app.createConversation();

    await expect(app.sendMessage("delete me")).resolves.toEqual(["mock:delete ", "me "]);
    app.deleteConversation();
    app.openConversation(conversationId);

    expect(() => app.readConversation()).toThrow("conversation not found");
    const redactedContents = app
      .readAuditEvents()
      .filter((event) => event.eventType === "conversation.message")
      .map((event) => (event.payload as { readonly message?: { readonly content: string } }).message?.content);
    expect(redactedContents).toEqual(["[deleted]", "[deleted]"]);
    expect(app.view()).toMatchObject({
      conversationId,
      messages: [],
    });
  });

  it("clears pending approval when a concurrent resolver already finalized the request", () => {
    const app = new ReferenceConversationApp(
      new GovernedConversationService(
        new ConcurrentApprovalStore(),
        undefined,
        deterministicClock(),
      ),
    );
    app.signIn({ tenantId: "tenant-a", userId: "user-a" });
    app.createConversation();
    const request = app.requestHarmlessTool("echo-status");

    expect(() =>
      app.executePendingTool({
        approvalId: request.approvalId,
        executionId: request.executionId,
        requestVersion: request.requestVersion,
        decision: "approved",
        resolvedBy: "reviewer-a",
        resolvedAt: "2026-09-05T00:00:06.000Z",
      }),
    ).toThrow(ConversationApprovalStateError);
    expect(app.view().pendingApproval).toBeNull();
  });

  it("escapes dynamic shell fields before rendering", () => {
    const html = renderReferenceAppShell({
      identity: Object.freeze({ tenantId: "tenant-<x>", userId: "user-&-y" }),
      conversationId: "conversation-1",
      messages: Object.freeze([
        Object.freeze({ id: "message-1", role: "user" as const, content: "<script>" }),
      ]),
      pendingApproval: null,
      auditEvents: Object.freeze([]),
    });
    expect(html).toContain("tenant=tenant-&lt;x&gt;");
    expect(html).toContain("user-&amp;-y");
    expect(html).toContain("user:&lt;script&gt;");
  });
});

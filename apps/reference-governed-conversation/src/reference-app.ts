import {
  ConversationAccessDeniedError,
  ConversationApprovalStateError,
  GovernedConversationService,
  type ConversationSnapshot,
} from "@atlantis/event-store/governed-conversation";
import {
  ApprovalRejectedError,
  type ApprovalRequest,
  type ApprovalResolution,
} from "@atlantis/contracts/approval-control";
import type { StoredEvent } from "@atlantis/event-store";

export interface ReferenceIdentity {
  readonly tenantId: string;
  readonly userId: string;
}

export interface ReferenceBrowserView {
  readonly identity: ReferenceIdentity | null;
  readonly conversationId: string | null;
  readonly messages: ConversationSnapshot["messages"];
  readonly pendingApproval: ApprovalRequest | null;
  readonly auditEvents: readonly StoredEvent[];
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${field} must be non-empty`);
  return trimmed;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function copyIdentity(identity: ReferenceIdentity): ReferenceIdentity {
  return Object.freeze({
    tenantId: requireNonEmpty(identity.tenantId, "tenantId"),
    userId: requireNonEmpty(identity.userId, "userId"),
  });
}

export class ReferenceConversationApp {
  private currentIdentity: ReferenceIdentity | null = null;
  private currentConversationId: string | null = null;
  private pendingApproval: ApprovalRequest | null = null;

  public constructor(
    private readonly service: GovernedConversationService = new GovernedConversationService(),
  ) {}

  public signIn(identity: ReferenceIdentity): ReferenceIdentity {
    this.currentIdentity = copyIdentity(identity);
    return this.currentIdentity;
  }

  public signOut(): void {
    this.currentIdentity = null;
    this.currentConversationId = null;
    this.pendingApproval = null;
  }

  public createConversation(): string {
    const identity = this.requireSignedInIdentity();
    this.currentConversationId = this.service.createConversation(identity.tenantId, identity.userId);
    this.pendingApproval = null;
    return this.currentConversationId;
  }

  public openConversation(conversationId: string): void {
    this.currentConversationId = requireNonEmpty(conversationId, "conversationId");
    this.pendingApproval = null;
  }

  public async sendMessage(content: string): Promise<readonly string[]> {
    const { identity, conversationId } = this.requireSession();
    this.ensureOwnedConversation(identity, conversationId);
    return this.service.sendMessage(identity, conversationId, requireNonEmpty(content, "content"));
  }

  public requestHarmlessTool(toolName: string): ApprovalRequest {
    const { identity, conversationId } = this.requireSession();
    this.ensureOwnedConversation(identity, conversationId);
    const request = this.service.buildToolApproval(
      identity,
      conversationId,
      requireNonEmpty(toolName, "toolName"),
    );
    this.pendingApproval = request;
    return request;
  }

  public executePendingTool(resolution?: ApprovalResolution): string {
    const { identity, conversationId } = this.requireSession();
    const request = this.pendingApproval;
    if (request === null) throw new Error("no pending approval request");
    if (request.executionId !== conversationId) throw new Error("pending approval does not match active conversation");
    this.ensureOwnedConversation(identity, conversationId);
    try {
      const result = this.service.executeHarmlessTool(identity, request, resolution);
      this.pendingApproval = null;
      return result;
    } catch (error) {
      if (
        error instanceof ApprovalRejectedError ||
        error instanceof ConversationApprovalStateError
      ) {
        this.pendingApproval = null;
      }
      throw error;
    }
  }

  public approvePendingTool(resolvedBy: string, resolvedAt: string): string {
    const request = this.pendingApproval;
    if (request === null) throw new Error("no pending approval request");
    const resolution: ApprovalResolution = Object.freeze({
      approvalId: request.approvalId,
      executionId: request.executionId,
      requestVersion: request.requestVersion,
      decision: "approved",
      resolvedBy: requireNonEmpty(resolvedBy, "resolvedBy"),
      resolvedAt: requireNonEmpty(resolvedAt, "resolvedAt"),
    });
    const result = this.executePendingTool(resolution);
    this.pendingApproval = null;
    return result;
  }

  public deleteConversation(): void {
    const { identity, conversationId } = this.requireSession();
    this.ensureOwnedConversation(identity, conversationId);
    this.service.deleteConversation(identity, conversationId);
    this.currentConversationId = null;
    this.pendingApproval = null;
  }

  public readConversation(): ConversationSnapshot {
    const { identity, conversationId } = this.requireSession();
    return this.ensureOwnedConversation(identity, conversationId);
  }

  public readAuditEvents(): readonly StoredEvent[] {
    const { identity, conversationId } = this.requireSession();
    return this.service.readAuditEvents(identity, conversationId);
  }

  public view(): ReferenceBrowserView {
    const identity = this.currentIdentity;
    const conversationId = this.currentConversationId;
    if (identity === null || conversationId === null) {
      return Object.freeze({
        identity,
        conversationId: null,
        messages: Object.freeze([]),
        pendingApproval: null,
        auditEvents: Object.freeze([]),
      });
    }
    try {
      const snapshot = this.service.readConversation(identity, conversationId);
      return Object.freeze({
        identity,
        conversationId,
        messages: snapshot.messages,
        pendingApproval: snapshot.deleted ? null : this.pendingApproval,
        auditEvents: this.service.readAuditEvents(identity, conversationId),
      });
    } catch (error) {
      if (!(error instanceof ConversationAccessDeniedError)) {
        throw error;
      }
      return Object.freeze({
        identity,
        conversationId: null,
        messages: Object.freeze([]),
        pendingApproval: null,
        auditEvents: Object.freeze([]),
      });
    }
  }

  private requireSignedInIdentity(): ReferenceIdentity {
    if (this.currentIdentity === null) throw new Error("reference sign-in required");
    return this.currentIdentity;
  }

  private requireSession(): { readonly identity: ReferenceIdentity; readonly conversationId: string } {
    const identity = this.requireSignedInIdentity();
    const conversationId = this.currentConversationId;
    if (conversationId === null) throw new Error("conversation not created");
    return Object.freeze({ identity, conversationId });
  }

  private ensureOwnedConversation(identity: ReferenceIdentity, conversationId: string): ConversationSnapshot {
    const snapshot = this.service.readConversation(identity, conversationId);
    if (snapshot.deleted) throw new Error("conversation not found");
    return snapshot;
  }
}

export function renderReferenceAppShell(view: ReferenceBrowserView): string {
  const identityLine = view.identity === null
    ? "signed-out"
    : `tenant=${view.identity.tenantId};user=${view.identity.userId}`;
  const approvalLine = view.pendingApproval === null
    ? "none"
    : `${view.pendingApproval.approvalId}:${view.pendingApproval.stepId}`;
  const messageLines = view.messages.map((message) => `${message.role}:${message.content}`);
  const auditLines = view.auditEvents.map((event) => event.eventType);
  return [
    "<main data-app='reference-governed-conversation'>",
    `<section data-context='identity'>${escapeHtml(identityLine)}</section>`,
    `<section data-context='conversation'>${escapeHtml(view.conversationId ?? "none")}</section>`,
    `<section data-context='messages'>${escapeHtml(messageLines.join("|"))}</section>`,
    `<section data-context='pending-approval'>${escapeHtml(approvalLine)}</section>`,
    `<section data-context='audit'>${escapeHtml(auditLines.join("|"))}</section>`,
    "</main>",
  ].join("");
}

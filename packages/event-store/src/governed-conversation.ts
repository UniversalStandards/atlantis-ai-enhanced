import { requireApproved, type ApprovalRequest, type ApprovalResolution } from "../../contracts/src/approval-control.js";
import { InMemoryEventStore, type EventStore, type StoredEvent } from "./index.js";

export interface ConversationIdentity {
  readonly tenantId: string;
  readonly userId: string;
}

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly model?: Readonly<{ family: string; capability: string }>;
}

export interface ConversationSnapshot {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly messages: readonly ConversationMessage[];
  readonly deleted: boolean;
}

export interface DeterministicConversationProvider {
  stream(prompt: string): AsyncIterable<string>;
}

export class EchoMockConversationProvider implements DeterministicConversationProvider {
  public async *stream(prompt: string): AsyncIterable<string> {
    for (const token of `mock:${prompt.trim()}`.split(" ")) yield `${token} `;
  }
}

export class InvalidConversationIdentityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidConversationIdentityError";
  }
}

export class ConversationAccessDeniedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConversationAccessDeniedError";
  }
}

interface ConversationEventPayload {
  readonly tenantId: string;
  readonly userId: string;
  readonly message?: ConversationMessage;
  readonly approvalId?: string;
  readonly toolName?: string;
}

function requireNonEmpty(field: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidConversationIdentityError(`${field} must be non-empty`);
  }
  return normalized;
}

function normalizeIdentity(identity: ConversationIdentity): ConversationIdentity {
  return Object.freeze({
    tenantId: requireNonEmpty("tenantId", identity.tenantId),
    userId: requireNonEmpty("userId", identity.userId),
  });
}

function redactAuditEvent(
  event: StoredEvent<ConversationEventPayload>,
): StoredEvent<ConversationEventPayload> {
  if (event.payload.message === undefined) {
    return event;
  }
  return Object.freeze({
    ...event,
    payload: Object.freeze({
      ...event.payload,
      message: Object.freeze({
        ...event.payload.message,
        content: "[deleted]",
      }),
    }),
  });
}

export class GovernedConversationService {
  private counter = 0;
  public constructor(
    private readonly store: EventStore = new InMemoryEventStore(),
    private readonly provider: DeterministicConversationProvider = new EchoMockConversationProvider(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  private nextId(prefix: string): string { this.counter += 1; return `${prefix}-${this.counter}`; }
  private append(id: string, eventType: string, payload: ConversationEventPayload): void {
    this.store.append({ streamId: id, eventId: this.nextId("event"), eventType, payload, occurredAt: this.now(), traceId: id, correlationId: id }, this.store.getStreamVersion(id));
  }
  public createConversation(tenantId: string, userId: string): string {
   const identity = normalizeIdentity({ tenantId, userId });
   const id = this.nextId("conversation"); this.append(id, "conversation.created", identity); return id;
  }
  public async sendMessage(identity: ConversationIdentity, id: string, content: string): Promise<readonly string[]> {
   const snapshot = this.requireActiveConversation(identity, id);
   this.append(id, "conversation.message", { tenantId: snapshot.tenantId, userId: snapshot.userId, message: Object.freeze({ id: this.nextId("message"), role: "user", content: requireNonEmpty("content", content) }) });
   const chunks: string[] = []; for await (const chunk of this.provider.stream(content)) chunks.push(chunk);
   this.append(id, "conversation.message", { tenantId: snapshot.tenantId, userId: snapshot.userId, message: Object.freeze({ id: this.nextId("message"), role: "assistant", content: chunks.join("").trimEnd(), model: Object.freeze({ family: "mock", capability: "conversation" }) }) });
   return Object.freeze(chunks);
  }
  public buildToolApproval(identity: ConversationIdentity, id: string, toolName: string): ApprovalRequest {
   const normalizedToolName = requireNonEmpty("toolName", toolName);
   const s = this.requireActiveConversation(identity, id); return Object.freeze({ approvalId: this.nextId("approval"), executionId: id, requestVersion: 1, stepId: `tool:${normalizedToolName}`, action: `invoke harmless demonstration tool ${normalizedToolName}`, reason: "demonstration tools require explicit approval", requestedBy: s.userId, requestedAt: this.now(), metadata: Object.freeze({ tenantId: s.tenantId, userId: s.userId, toolName: normalizedToolName }) });
  }
  public executeHarmlessTool(identity: ConversationIdentity, request: ApprovalRequest, resolution?: ApprovalResolution): string {
   const actor = normalizeIdentity(identity);
   if (
     request.metadata.tenantId !== actor.tenantId ||
     request.metadata.userId !== actor.userId ||
     request.requestedBy !== actor.userId
   ) {
     throw new ConversationAccessDeniedError(
       "approval request does not match tenant/user context",
     );
   }
   const approval = requireApproved(request, resolution); const s = this.requireActiveConversation(actor, request.executionId); const toolName = request.metadata.toolName ?? "unknown";
   this.append(request.executionId, "conversation.tool.approved", { tenantId: s.tenantId, userId: s.userId, approvalId: approval.request.approvalId, toolName }); return `tool:${toolName}:ok`;
  }
  public deleteConversation(identity: ConversationIdentity, id: string): void { const s = this.requireOwnedConversation(identity, id); if (!s.deleted) this.append(id, "conversation.deleted", { tenantId: s.tenantId, userId: s.userId }); }
  public readConversation(identity: ConversationIdentity, id: string): ConversationSnapshot {
   return this.requireOwnedConversation(identity, id);
  }
  public readAuditEvents(identity: ConversationIdentity, id: string): readonly StoredEvent[] {
   const snapshot = this.requireOwnedConversation(identity, id);
   const events = this.store.readStream(id) as readonly StoredEvent<ConversationEventPayload>[];
   return snapshot.deleted ? Object.freeze(events.map(redactAuditEvent)) : events;
  }
  private requireOwnedConversation(identity: ConversationIdentity, id: string): ConversationSnapshot {
   const actor = normalizeIdentity(identity);
   const snapshot = this.readConversationSnapshot(id);
   if (snapshot.tenantId !== actor.tenantId || snapshot.userId !== actor.userId) {
     throw new ConversationAccessDeniedError("conversation access denied for tenant/user context");
   }
   return snapshot;
  }
  private requireActiveConversation(identity: ConversationIdentity, id: string): ConversationSnapshot {
   const snapshot = this.requireOwnedConversation(identity, id);
   if (snapshot.deleted) {
     throw new Error("conversation is deleted");
   }
   return snapshot;
  }
  private readConversationSnapshot(id: string): ConversationSnapshot {
   const events = this.store.readStream(id) as readonly StoredEvent<ConversationEventPayload>[]; const first = events[0]; if (first === undefined) throw new Error("conversation not found");
   const messages: ConversationMessage[] = []; let deleted = false; for (const event of events) { if (event.eventType === "conversation.message" && event.payload.message !== undefined) messages.push(event.payload.message); if (event.eventType === "conversation.deleted") deleted = true; }
   return Object.freeze({ conversationId: id, tenantId: first.payload.tenantId, userId: first.payload.userId, messages: deleted ? Object.freeze([]) : Object.freeze(messages), deleted });
  }
}

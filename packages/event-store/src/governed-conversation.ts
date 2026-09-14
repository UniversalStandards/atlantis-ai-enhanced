import { requireApproved, type ApprovalRequest, type ApprovalResolution } from "../../contracts/src/approval-control.js";
import { InMemoryEventStore, type EventStore, type StoredEvent } from "./index.js";

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

interface ConversationEventPayload {
  readonly tenantId: string;
  readonly userId: string;
  readonly message?: ConversationMessage;
  readonly approvalId?: string;
  readonly toolName?: string;
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
    const id = this.nextId("conversation"); this.append(id, "conversation.created", { tenantId, userId }); return id;
  }
  public async sendMessage(id: string, content: string): Promise<readonly string[]> {
    const snapshot = this.readConversation(id); if (snapshot.deleted) throw new Error("conversation is deleted");
    this.append(id, "conversation.message", { tenantId: snapshot.tenantId, userId: snapshot.userId, message: Object.freeze({ id: this.nextId("message"), role: "user", content }) });
    const chunks: string[] = []; for await (const chunk of this.provider.stream(content)) chunks.push(chunk);
    this.append(id, "conversation.message", { tenantId: snapshot.tenantId, userId: snapshot.userId, message: Object.freeze({ id: this.nextId("message"), role: "assistant", content: chunks.join("").trimEnd(), model: Object.freeze({ family: "mock", capability: "conversation" }) }) });
    return Object.freeze(chunks);
  }
  public buildToolApproval(id: string, toolName: string): ApprovalRequest {
    const s = this.readConversation(id); return Object.freeze({ approvalId: this.nextId("approval"), executionId: id, requestVersion: 1, stepId: `tool:${toolName}`, action: `invoke harmless demonstration tool ${toolName}`, reason: "demonstration tools require explicit approval", requestedBy: s.userId, requestedAt: this.now(), metadata: Object.freeze({ tenantId: s.tenantId, toolName }) });
  }
  public executeHarmlessTool(request: ApprovalRequest, resolution?: ApprovalResolution): string {
    const approval = requireApproved(request, resolution); const s = this.readConversation(request.executionId); const toolName = request.metadata.toolName ?? "unknown";
    this.append(request.executionId, "conversation.tool.approved", { tenantId: s.tenantId, userId: s.userId, approvalId: approval.request.approvalId, toolName }); return `tool:${toolName}:ok`;
  }
  public deleteConversation(id: string): void { const s = this.readConversation(id); if (!s.deleted) this.append(id, "conversation.deleted", { tenantId: s.tenantId, userId: s.userId }); }
  public readConversation(id: string): ConversationSnapshot {
    const events = this.store.readStream(id) as readonly StoredEvent<ConversationEventPayload>[]; const first = events[0]; if (first === undefined) throw new Error("conversation not found");
    const messages: ConversationMessage[] = []; let deleted = false; for (const event of events) { if (event.eventType === "conversation.message" && event.payload.message !== undefined) messages.push(event.payload.message); if (event.eventType === "conversation.deleted") deleted = true; }
    return Object.freeze({ conversationId: id, tenantId: first.payload.tenantId, userId: first.payload.userId, messages: deleted ? Object.freeze([]) : Object.freeze(messages), deleted });
  }
  public readAuditEvents(id: string): readonly StoredEvent[] { return this.store.readStream(id); }
}

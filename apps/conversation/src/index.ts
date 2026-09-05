import { requireApproved, type ApprovalRequest, type ApprovalResolution } from "../../../packages/contracts/src/approval-control.js";
import { InMemoryEventStore, type EventStore, type StoredEvent } from "../../../packages/event-store/src/index.js";

export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  readonly id: string;
  readonly role: ConversationRole;
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

export interface DeterministicMockProvider {
  stream(prompt: string): AsyncIterable<string>;
}

export class EchoMockProvider implements DeterministicMockProvider {
  public async *stream(prompt: string): AsyncIterable<string> {
    const response = `mock:${prompt.trim()}`;
    for (const token of response.split(" ")) yield `${token} `;
  }
}

interface ConversationEventPayload {
  readonly tenantId: string;
  readonly userId: string;
  readonly message?: ConversationMessage;
  readonly approvalId?: string;
  readonly toolName?: string;
}

export class ConversationService {
  private counter = 0;

  public constructor(
    private readonly store: EventStore = new InMemoryEventStore(),
    private readonly provider: DeterministicMockProvider = new EchoMockProvider(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  private append(conversationId: string, eventType: string, payload: ConversationEventPayload): StoredEvent<ConversationEventPayload> {
    const version = this.store.getStreamVersion(conversationId);
    return this.store.append(
      {
        streamId: conversationId,
        eventId: this.nextId("event"),
        eventType,
        payload,
        occurredAt: this.now(),
        traceId: conversationId,
        correlationId: conversationId,
      },
      version,
    );
  }

  public createConversation(tenantId: string, userId: string): string {
    const conversationId = this.nextId("conversation");
    this.append(conversationId, "conversation.created", { tenantId, userId });
    return conversationId;
  }

  public async sendMessage(conversationId: string, content: string): Promise<readonly string[]> {
    const snapshot = this.readConversation(conversationId);
    if (snapshot.deleted) throw new Error("conversation is deleted");
    const userMessage: ConversationMessage = Object.freeze({ id: this.nextId("message"), role: "user", content });
    this.append(conversationId, "conversation.message", {
      tenantId: snapshot.tenantId,
      userId: snapshot.userId,
      message: userMessage,
    });

    const chunks: string[] = [];
    for await (const chunk of this.provider.stream(content)) chunks.push(chunk);
    const assistantMessage: ConversationMessage = Object.freeze({
      id: this.nextId("message"),
      role: "assistant",
      content: chunks.join("").trimEnd(),
      model: Object.freeze({ family: "mock", capability: "conversation" }),
    });
    this.append(conversationId, "conversation.message", {
      tenantId: snapshot.tenantId,
      userId: snapshot.userId,
      message: assistantMessage,
    });
    return Object.freeze(chunks);
  }

  public buildToolApproval(conversationId: string, toolName: string): ApprovalRequest {
    const snapshot = this.readConversation(conversationId);
    return Object.freeze({
      approvalId: this.nextId("approval"),
      executionId: conversationId,
      requestVersion: 1,
      stepId: `tool:${toolName}`,
      action: `invoke harmless demonstration tool ${toolName}`,
      reason: "demonstration tools require explicit approval",
      requestedBy: snapshot.userId,
      requestedAt: this.now(),
      metadata: Object.freeze({ tenantId: snapshot.tenantId, toolName }),
    });
  }

  public executeHarmlessTool(request: ApprovalRequest, resolution: ApprovalResolution): string {
    const approval = requireApproved(request, resolution);
    const snapshot = this.readConversation(request.executionId);
    const toolName = request.metadata.toolName ?? "unknown";
    this.append(request.executionId, "conversation.tool.approved", {
      tenantId: snapshot.tenantId,
      userId: snapshot.userId,
      approvalId: approval.request.approvalId,
      toolName,
    });
    return `tool:${toolName}:ok`;
  }

  public deleteConversation(conversationId: string): void {
    const snapshot = this.readConversation(conversationId);
    if (snapshot.deleted) return;
    this.append(conversationId, "conversation.deleted", { tenantId: snapshot.tenantId, userId: snapshot.userId });
  }

  public readConversation(conversationId: string): ConversationSnapshot {
    const events = this.store.readStream(conversationId) as readonly StoredEvent<ConversationEventPayload>[];
    if (events.length === 0) throw new Error("conversation not found");
    const first = events[0];
    if (first === undefined) throw new Error("conversation not found");
    const messages: ConversationMessage[] = [];
    let deleted = false;
    for (const event of events) {
      if (event.eventType === "conversation.message" && event.payload.message !== undefined) messages.push(event.payload.message);
      if (event.eventType === "conversation.deleted") deleted = true;
    }
    return Object.freeze({
      conversationId,
      tenantId: first.payload.tenantId,
      userId: first.payload.userId,
      messages: deleted ? Object.freeze([]) : Object.freeze(messages),
      deleted,
    });
  }

  public readAuditEvents(conversationId: string): readonly StoredEvent[] {
    return this.store.readStream(conversationId);
  }
}

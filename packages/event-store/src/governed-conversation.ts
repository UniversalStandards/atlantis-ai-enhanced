import {
  ApprovalRejectedError,
  requireApproved,
  type ApprovalRequest,
  type ApprovalResolution,
} from "../../contracts/src/approval-control.js";
import {
  ConcurrencyConflictError,
  InMemoryEventStore,
  type EventStore,
  type StoredEvent,
} from "./index.js";

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

export class ConversationApprovalStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConversationApprovalStateError";
  }
}

interface ConversationEventPayload {
  readonly tenantId: string;
  readonly userId: string;
  readonly message?: ConversationMessage;
  readonly approvalId?: string;
  readonly requestVersion?: number;
  readonly toolName?: string;
  readonly action?: string;
  readonly reason?: string;
  readonly requestedBy?: string;
  readonly resolvedBy?: string;
}

interface ConversationRecord {
  readonly snapshot: ConversationSnapshot;
  readonly events: readonly StoredEvent<ConversationEventPayload>[];
  readonly streamVersion: number;
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
  private append(
   id: string,
   eventType: string,
   payload: ConversationEventPayload,
   expectedVersion: number,
  ): StoredEvent<ConversationEventPayload> {
   return this.store.append({ streamId: id, eventId: this.nextId("event"), eventType, payload, occurredAt: this.now(), traceId: id, correlationId: id }, expectedVersion);
  }
  public createConversation(tenantId: string, userId: string): string {
   const identity = normalizeIdentity({ tenantId, userId });
   const id = this.nextId("conversation"); this.append(id, "conversation.created", identity, 0); return id;
  }
  public async sendMessage(identity: ConversationIdentity, id: string, content: string): Promise<readonly string[]> {
   const record = this.requireActiveConversation(identity, id);
   const normalizedContent = requireNonEmpty("content", content);
   const userMessage = this.append(id, "conversation.message", { tenantId: record.snapshot.tenantId, userId: record.snapshot.userId, message: Object.freeze({ id: this.nextId("message"), role: "user", content: normalizedContent }) }, record.streamVersion);
   const chunks: string[] = []; for await (const chunk of this.provider.stream(normalizedContent)) chunks.push(chunk);
   this.append(id, "conversation.message", { tenantId: record.snapshot.tenantId, userId: record.snapshot.userId, message: Object.freeze({ id: this.nextId("message"), role: "assistant", content: chunks.join("").trimEnd(), model: Object.freeze({ family: "mock", capability: "conversation" }) }) }, userMessage.streamVersion);
   return Object.freeze(chunks);
  }
  public buildToolApproval(identity: ConversationIdentity, id: string, toolName: string): ApprovalRequest {
   const normalizedToolName = requireNonEmpty("toolName", toolName);
   const record = this.requireActiveConversation(identity, id);
   const request = Object.freeze({
     approvalId: this.nextId("approval"),
     executionId: id,
     requestVersion: 1,
     stepId: `tool:${normalizedToolName}`,
     action: `invoke harmless demonstration tool ${normalizedToolName}`,
     reason: "demonstration tools require explicit approval",
     requestedBy: record.snapshot.userId,
     requestedAt: this.now(),
     metadata: Object.freeze({
       tenantId: record.snapshot.tenantId,
       userId: record.snapshot.userId,
       toolName: normalizedToolName,
     }),
   });
   this.append(id, "conversation.tool.requested", {
     tenantId: record.snapshot.tenantId,
     userId: record.snapshot.userId,
     approvalId: request.approvalId,
     requestVersion: request.requestVersion,
     toolName: normalizedToolName,
     action: request.action,
     reason: request.reason,
     requestedBy: request.requestedBy,
   }, record.streamVersion);
   return request;
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
   const record = this.requireActiveConversation(actor, request.executionId);
   const toolName = request.metadata.toolName ?? "unknown";
   this.requirePendingToolApproval(record, request);
   try {
     const approval = requireApproved(request, resolution);
     this.appendTerminalToolApproval(record, request, "conversation.tool.approved", {
       tenantId: record.snapshot.tenantId,
       userId: record.snapshot.userId,
       approvalId: approval.request.approvalId,
       requestVersion: approval.request.requestVersion,
       toolName,
       requestedBy: approval.request.requestedBy,
       resolvedBy: approval.resolution.resolvedBy,
     });
     return `tool:${toolName}:ok`;
   } catch (error) {
     if (error instanceof ApprovalRejectedError) {
       this.appendTerminalToolApproval(record, request, "conversation.tool.rejected", {
         tenantId: record.snapshot.tenantId,
         userId: record.snapshot.userId,
         approvalId: error.approval.request.approvalId,
         requestVersion: error.approval.request.requestVersion,
         toolName,
         requestedBy: error.approval.request.requestedBy,
         resolvedBy: error.approval.resolution.resolvedBy,
       });
     }
     throw error;
   }
  }
  public deleteConversation(identity: ConversationIdentity, id: string): void {
   const record = this.requireOwnedConversation(identity, id);
   if (!record.snapshot.deleted) {
     this.append(id, "conversation.deleted", {
       tenantId: record.snapshot.tenantId,
       userId: record.snapshot.userId,
     }, record.streamVersion);
   }
  }
  public readConversation(identity: ConversationIdentity, id: string): ConversationSnapshot {
   return this.requireOwnedConversation(identity, id).snapshot;
  }
  public readAuditEvents(identity: ConversationIdentity, id: string): readonly StoredEvent[] {
   const record = this.requireOwnedConversation(identity, id);
   return record.snapshot.deleted ? Object.freeze(record.events.map(redactAuditEvent)) : record.events;
  }
  private requireOwnedConversation(identity: ConversationIdentity, id: string): ConversationRecord {
   const actor = normalizeIdentity(identity);
   let record: ConversationRecord;
   try {
     record = this.readConversationRecord(id);
   } catch (error) {
     if (error instanceof Error && error.message === "conversation not found") {
       throw new ConversationAccessDeniedError("conversation access denied for tenant/user context");
     }
     throw error;
   }
   if (
     record.snapshot.tenantId !== actor.tenantId ||
     record.snapshot.userId !== actor.userId
   ) {
     throw new ConversationAccessDeniedError("conversation access denied for tenant/user context");
   }
   return record;
  }
  private requireActiveConversation(identity: ConversationIdentity, id: string): ConversationRecord {
   const record = this.requireOwnedConversation(identity, id);
   if (record.snapshot.deleted) {
     throw new Error("conversation is deleted");
   }
   return record;
  }
  private requirePendingToolApproval(
   record: ConversationRecord,
   request: ApprovalRequest,
  ): void {
   const matchingRequest = record.events.find((event) =>
     event.eventType === "conversation.tool.requested" &&
     event.payload.approvalId === request.approvalId &&
     event.payload.requestVersion === request.requestVersion,
   );
   if (
     matchingRequest === undefined ||
     matchingRequest.payload.tenantId !== record.snapshot.tenantId ||
     matchingRequest.payload.userId !== record.snapshot.userId ||
     matchingRequest.payload.toolName !== request.metadata.toolName ||
     matchingRequest.payload.requestedBy !== request.requestedBy ||
     matchingRequest.payload.action !== request.action ||
     matchingRequest.payload.reason !== request.reason
   ) {
     throw new ConversationApprovalStateError(
       "approval request does not match a pending governed tool request",
     );
   }
   if (
     record.events.some((event) =>
       event.payload.approvalId === request.approvalId &&
       event.payload.requestVersion === request.requestVersion &&
       (event.eventType === "conversation.tool.approved" ||
         event.eventType === "conversation.tool.rejected"),
     )
   ) {
     throw new ConversationApprovalStateError("approval request is already resolved");
   }
  }
  private appendTerminalToolApproval(
   record: ConversationRecord,
   request: ApprovalRequest,
   eventType: "conversation.tool.approved" | "conversation.tool.rejected",
   payload: ConversationEventPayload,
  ): void {
   try {
     this.append(request.executionId, eventType, payload, record.streamVersion);
   } catch (error) {
     if (!(error instanceof ConcurrencyConflictError)) {
       throw error;
     }
     const refreshedRecord = this.requireActiveConversation(
       {
         tenantId: record.snapshot.tenantId,
         userId: record.snapshot.userId,
       },
       request.executionId,
     );
     this.requirePendingToolApproval(refreshedRecord, request);
     this.append(request.executionId, eventType, payload, refreshedRecord.streamVersion);
   }
  }
  private readConversationRecord(id: string): ConversationRecord {
   for (let attempt = 0; attempt < 3; attempt += 1) {
     const events = this.store.readStream(id) as readonly StoredEvent<ConversationEventPayload>[];
     const first = events[0];
     if (first === undefined) {
       throw new Error("conversation not found");
     }
     const messages: ConversationMessage[] = [];
     let deleted = false;
     for (const event of events) {
       if (event.eventType === "conversation.message" && event.payload.message !== undefined) {
         messages.push(event.payload.message);
       }
       if (event.eventType === "conversation.deleted") {
         deleted = true;
       }
     }
     const streamVersion = events.at(-1)?.streamVersion ?? 0;
     if (this.store.getStreamVersion(id) !== streamVersion) {
       continue;
     }
     return Object.freeze({
       snapshot: Object.freeze({
         conversationId: id,
         tenantId: first.payload.tenantId,
         userId: first.payload.userId,
         messages: deleted ? Object.freeze([]) : Object.freeze(messages),
         deleted,
       }),
       events,
       streamVersion,
     });
   }
   throw new ConversationApprovalStateError("conversation state changed during read");
  }
}

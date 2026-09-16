import {
  ApprovalRejectedError,
  InvalidApprovalError,
  requireApproved,
  type ResolvedApproval,
  type ApprovalRequest,
  type ApprovalResolution,
  normalizeApprovalRequest,
} from "../../contracts/src/approval-control.js";
import {
  ConcurrencyConflictError,
  InMemoryEventStore,
  type EventStore,
  type StoredEvent,
} from "./event-store-core.js";

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

export class ConversationNotFoundError extends Error {
  public constructor() {
    super("conversation not found");
    this.name = "ConversationNotFoundError";
  }
}

interface ConversationEventPayload {
  readonly tenantId: string;
  readonly userId: string;
  readonly executionId?: string;
  readonly message?: ConversationMessage;
  readonly approvalId?: string;
  readonly requestVersion?: number;
  readonly stepId?: string;
  readonly toolName?: string;
  readonly action?: string;
  readonly reason?: string;
  readonly requestedBy?: string;
  readonly requestedAt?: string;
  readonly resolvedBy?: string;
  readonly resolvedAt?: string;
  readonly decision?: "approved" | "rejected";
  readonly comment?: string;
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

function requireApprovalMetadataField(
  key: string,
  metadata: Readonly<Record<string, string>>,
  field = `metadata.${key}`,
): string {
  const value = (metadata as Readonly<Record<string, string | undefined>>)[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidApprovalError(`${field} must be a non-blank string`);
  }
  return value.trim();
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
     executionId: request.executionId,
     approvalId: request.approvalId,
     requestVersion: request.requestVersion,
     stepId: request.stepId,
     toolName: normalizedToolName,
     action: request.action,
     reason: request.reason,
     requestedBy: request.requestedBy,
     requestedAt: request.requestedAt,
   }, record.streamVersion);
   return request;
  }
  public executeHarmlessTool(identity: ConversationIdentity, request: ApprovalRequest, resolution?: ApprovalResolution): string {
   const actor = normalizeIdentity(identity);
   const normalizedRequest = normalizeApprovalRequest(request);
   const boundRequest = Object.freeze({
     ...normalizedRequest,
     metadata: Object.freeze({
       ...normalizedRequest.metadata,
       tenantId: requireApprovalMetadataField("tenantId", normalizedRequest.metadata),
       userId: requireApprovalMetadataField("userId", normalizedRequest.metadata),
       toolName: requireApprovalMetadataField("toolName", normalizedRequest.metadata),
     }),
   });
   const record = this.requireActiveConversation(actor, boundRequest.executionId);
   const pendingRequest = this.requirePendingToolApproval(record, boundRequest);
   const toolName = pendingRequest.payload.toolName ?? "unknown";
   try {
     const approval = requireApproved(boundRequest, resolution);
     this.appendTerminalToolApproval(record, approval, "conversation.tool.approved");
     return `tool:${toolName}:ok`;
   } catch (error) {
     if (error instanceof ApprovalRejectedError) {
       this.appendTerminalToolApproval(record, error.approval, "conversation.tool.rejected");
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
     if (error instanceof ConversationNotFoundError) {
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
  ): StoredEvent<ConversationEventPayload> {
   const matchingRequest = record.events.find((event) =>
     event.eventType === "conversation.tool.requested" &&
     event.streamId === request.executionId &&
     event.payload.approvalId === request.approvalId &&
     event.payload.requestVersion === request.requestVersion,
   );
   if (
     matchingRequest === undefined ||
     request.executionId !== record.snapshot.conversationId ||
     request.metadata.tenantId !== record.snapshot.tenantId ||
     request.metadata.userId !== record.snapshot.userId ||
     request.requestedBy !== record.snapshot.userId ||
     matchingRequest.payload.tenantId !== record.snapshot.tenantId ||
     matchingRequest.payload.userId !== record.snapshot.userId ||
     matchingRequest.payload.executionId !== request.executionId ||
     matchingRequest.payload.stepId !== request.stepId ||
     matchingRequest.payload.toolName !== request.metadata.toolName ||
     matchingRequest.payload.requestedBy !== request.requestedBy ||
     matchingRequest.payload.requestedAt !== request.requestedAt ||
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
   return matchingRequest;
  }
  private appendTerminalToolApproval(
   record: ConversationRecord,
   approval: ResolvedApproval,
   eventType: "conversation.tool.approved" | "conversation.tool.rejected",
  ): void {
   const toolName = requireApprovalMetadataField("toolName", approval.request.metadata);
   const payload = Object.freeze({
     tenantId: record.snapshot.tenantId,
     userId: record.snapshot.userId,
     executionId: approval.request.executionId,
     approvalId: approval.request.approvalId,
     requestVersion: approval.request.requestVersion,
     stepId: approval.request.stepId,
     toolName,
     action: approval.request.action,
     reason: approval.request.reason,
     requestedBy: approval.request.requestedBy,
     requestedAt: approval.request.requestedAt,
     resolvedBy: approval.resolution.resolvedBy,
     resolvedAt: approval.resolution.resolvedAt,
     decision: approval.resolution.decision,
     ...(approval.resolution.comment === undefined
       ? {}
       : { comment: approval.resolution.comment }),
   });
   let currentRecord = record;
   for (let attempt = 0; attempt < 3; attempt += 1) {
     try {
       this.append(approval.request.executionId, eventType, payload, currentRecord.streamVersion);
       return;
     } catch (error) {
       if (!(error instanceof ConcurrencyConflictError)) {
         throw error;
       }
       currentRecord = this.requireActiveConversation(
         {
           tenantId: currentRecord.snapshot.tenantId,
           userId: currentRecord.snapshot.userId,
         },
         approval.request.executionId,
       );
       this.requirePendingToolApproval(currentRecord, approval.request);
     }
   }
   throw new ConversationApprovalStateError(
     "approval request could not be finalized before concurrent state changes",
   );
  }
  private readConversationRecord(id: string): ConversationRecord {
   for (let attempt = 0; attempt < 3; attempt += 1) {
     const events = this.store.readStream(id) as readonly StoredEvent<ConversationEventPayload>[];
     const first = events[0];
     if (first === undefined || first.eventType !== "conversation.created") {
       throw new ConversationNotFoundError();
     }
     const tenantId = first.payload.tenantId;
     const userId = first.payload.userId;
     if (typeof tenantId !== "string" || tenantId.trim().length === 0 || typeof userId !== "string" || userId.trim().length === 0) {
       throw new ConversationApprovalStateError("conversation.created payload is invalid");
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
         tenantId,
         userId,
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

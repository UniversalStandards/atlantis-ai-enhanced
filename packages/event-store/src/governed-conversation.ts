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
  type RedactableEventStore,
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

export class ConversationPolicyDeniedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConversationPolicyDeniedError";
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
  readonly policyDecision?: "allowed" | "denied";
  readonly policyReason?: string;
}

interface ConversationRecord {
  readonly snapshot: ConversationSnapshot;
  readonly events: readonly StoredEvent<ConversationEventPayload>[];
  readonly streamVersion: number;
}

export interface ConversationToolPolicyDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export type ConversationToolPolicyEvaluator = (
  identity: ConversationIdentity,
  request: ApprovalRequest,
) => ConversationToolPolicyDecision;

const INVALID_CONVERSATION_STREAM_MESSAGE =
  "conversation stream must start with conversation.created";
const INVALID_CONVERSATION_PAYLOAD_MESSAGE =
  "conversation.created payload is invalid";

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

function readConversationCreatedIdentityPayload(
  payload: unknown,
): Readonly<{ tenantId: string; userId: string }> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ConversationApprovalStateError(INVALID_CONVERSATION_PAYLOAD_MESSAGE);
  }
  const identityPayload = payload as Readonly<Record<string, unknown>>;
  const tenantId = identityPayload.tenantId;
  const userId = identityPayload.userId;
  if (
    typeof tenantId !== "string" ||
    tenantId.trim().length === 0 ||
    typeof userId !== "string" ||
    userId.trim().length === 0
  ) {
    throw new ConversationApprovalStateError(INVALID_CONVERSATION_PAYLOAD_MESSAGE);
  }
  return Object.freeze({ tenantId, userId });
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

function supportsContentRedaction(store: EventStore): store is RedactableEventStore {
  return typeof (store as Partial<RedactableEventStore>).redactStream === "function";
}

function redactPersistedConversationPayload(
  event: StoredEvent,
): ConversationEventPayload {
  const payload = event.payload as ConversationEventPayload;
  if (event.eventType !== "conversation.message" || payload.message === undefined) {
    return payload;
  }
  return Object.freeze({
    ...payload,
    message: Object.freeze({
      ...payload.message,
      content: "[deleted]",
    }),
  });
}

function normalizePolicyDecision(
  decision: ConversationToolPolicyDecision,
): Readonly<{ allowed: boolean; reason: string }> {
  return Object.freeze({
    allowed: decision.allowed,
    reason: requireNonEmpty("policyReason", decision.reason),
  });
}

function pendingApprovalFromRecord(
  record: ConversationRecord,
): ApprovalRequest | null {
  const resolvedApprovals = new Set(
    record.events
      .filter((event) =>
        event.eventType === "conversation.tool.approved" ||
        event.eventType === "conversation.tool.rejected" ||
        event.eventType === "conversation.tool.denied",
      )
      .map((event) => `${event.payload.approvalId}:${event.payload.requestVersion}`),
  );
  const pendingEvent = [...record.events].reverse().find((event) =>
    event.eventType === "conversation.tool.requested" &&
    !resolvedApprovals.has(`${event.payload.approvalId}:${event.payload.requestVersion}`),
  );
  if (pendingEvent === undefined) {
    return null;
  }
  return normalizeApprovalRequest(Object.freeze({
    approvalId: pendingEvent.payload.approvalId ?? "",
    executionId: pendingEvent.payload.executionId ?? "",
    requestVersion: pendingEvent.payload.requestVersion ?? 0,
    stepId: pendingEvent.payload.stepId ?? "",
    action: pendingEvent.payload.action ?? "",
    reason: pendingEvent.payload.reason ?? "",
    requestedBy: pendingEvent.payload.requestedBy ?? "",
    requestedAt: pendingEvent.payload.requestedAt ?? "",
    metadata: Object.freeze({
      tenantId: pendingEvent.payload.tenantId,
      userId: pendingEvent.payload.userId,
      toolName: pendingEvent.payload.toolName ?? "unknown",
    }),
  }));
}

export class GovernedConversationService {
  private counter = 0;
  public constructor(
    private readonly store: EventStore = new InMemoryEventStore(),
    private readonly provider: DeterministicConversationProvider = new EchoMockConversationProvider(),
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly evaluatePolicy: ConversationToolPolicyEvaluator = () =>
      Object.freeze({
        allowed: true,
        reason: "reference conversation policy permits harmless demonstration tools",
      }),
  ) {}
  private nextId(prefix: string): string {
    this.syncCounterWithStore();
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }
  private syncCounterWithStore(): void {
    for (const event of this.store.readAll()) {
      this.counter = Math.max(
        this.counter,
        this.readNumericSuffix(event.streamId),
        this.readNumericSuffix(event.eventId),
        this.readNumericSuffix(event.traceId),
        this.readNumericSuffix(event.correlationId),
        this.readNumericSuffix(event.causationId),
        this.readNumericSuffix((event.payload as { readonly executionId?: string }).executionId),
        this.readNumericSuffix((event.payload as { readonly approvalId?: string }).approvalId),
        this.readNumericSuffix(
          (event.payload as { readonly message?: { readonly id?: string } }).message?.id,
        ),
      );
    }
  }
  private readNumericSuffix(value: string | undefined): number {
    if (typeof value !== "string") {
      return 0;
    }
    const match = /-(\d+)$/.exec(value);
    if (match === null) {
      return 0;
    }
    const suffix = match[1];
    if (suffix === undefined) {
      return 0;
    }
    const parsed = Number.parseInt(suffix, 10);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }
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
     const policyDecision = normalizePolicyDecision(this.evaluatePolicy(actor, boundRequest));
     if (!policyDecision.allowed) {
       this.appendTerminalToolApproval(record, approval, "conversation.tool.denied", policyDecision);
       throw new ConversationPolicyDeniedError(policyDecision.reason);
     }
     this.appendTerminalToolApproval(record, approval, "conversation.tool.approved", policyDecision);
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
   if (supportsContentRedaction(this.store)) {
     if (!record.snapshot.deleted) {
       this.store.appendRedacted({
         streamId: id,
         eventId: this.nextId("event"),
         eventType: "conversation.deleted",
         payload: {
           tenantId: record.snapshot.tenantId,
           userId: record.snapshot.userId,
         },
         occurredAt: this.now(),
         traceId: id,
         correlationId: id,
       }, record.streamVersion, redactPersistedConversationPayload);
       return;
     }
     this.store.redactStream(id, redactPersistedConversationPayload);
     return;
   }
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
  public readPendingToolApproval(identity: ConversationIdentity, id: string): ApprovalRequest | null {
   const record = this.requireOwnedConversation(identity, id);
   if (record.snapshot.deleted) {
     return null;
   }
   return pendingApprovalFromRecord(record);
  }
  private requireOwnedConversation(identity: ConversationIdentity, id: string): ConversationRecord {
   const actor = normalizeIdentity(identity);
   let record: ConversationRecord;
   try {
     record = this.readConversationRecord(id);
   } catch (error) {
     if (
       error instanceof ConversationNotFoundError ||
       (error instanceof ConversationApprovalStateError &&
         (error.message === INVALID_CONVERSATION_STREAM_MESSAGE ||
           error.message === INVALID_CONVERSATION_PAYLOAD_MESSAGE))
     ) {
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
         event.eventType === "conversation.tool.rejected" ||
         event.eventType === "conversation.tool.denied"),
     )
   ) {
     throw new ConversationApprovalStateError("approval request is already resolved");
   }
   return matchingRequest;
  }
  private appendTerminalToolApproval(
   record: ConversationRecord,
   approval: ResolvedApproval,
   eventType:
     | "conversation.tool.approved"
     | "conversation.tool.rejected"
     | "conversation.tool.denied",
   policyDecision?: Readonly<{ allowed: boolean; reason: string }>,
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
     ...(policyDecision === undefined
       ? {}
       : {
         policyDecision: policyDecision.allowed ? "allowed" : "denied",
         policyReason: policyDecision.reason,
       }),
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
     if (first === undefined) {
       throw new ConversationNotFoundError();
     }
     if (first.eventType !== "conversation.created") {
       throw new ConversationApprovalStateError(INVALID_CONVERSATION_STREAM_MESSAGE);
     }
     const { tenantId, userId } = readConversationCreatedIdentityPayload(first.payload);
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

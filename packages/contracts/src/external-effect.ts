export interface ExternalEffectIdentity {
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly stepId: string;
  readonly effectType: string;
}

export interface ExternalEffectReceipt extends ExternalEffectIdentity {
  readonly providerReference: string;
  readonly committedAt: string;
  readonly payloadDigest: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export type ExternalEffectReconciliation =
  | Readonly<{
      status: "not_committed";
      identity: ExternalEffectIdentity;
    }>
  | Readonly<{
      status: "committed";
      identity: ExternalEffectIdentity;
      receipt: ExternalEffectReceipt;
    }>;

export class InvalidExternalEffectError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidExternalEffectError";
  }
}

export class ExternalEffectConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExternalEffectConflictError";
  }
}

function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidExternalEffectError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function requireCanonicalTimestamp(field: string, value: unknown): string {
  const timestamp = requireNonBlank(field, value);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new InvalidExternalEffectError(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function requirePayloadDigest(value: unknown): string {
  const digest = requireNonBlank("payloadDigest", value).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new InvalidExternalEffectError(
      "payloadDigest must use the sha256:<64 lowercase hexadecimal characters> format",
    );
  }
  return digest;
}

function normalizeMetadata(
  metadata: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new InvalidExternalEffectError("metadata must be a string record");
  }

  const prototype = Object.getPrototypeOf(metadata);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidExternalEffectError("metadata must be a plain string record");
  }

  const normalized: Record<string, string> = {};
  for (const key of Reflect.ownKeys(metadata)) {
    if (typeof key !== "string") {
      throw new InvalidExternalEffectError("metadata must not contain symbol keys");
    }

    const descriptor = Object.getOwnPropertyDescriptor(metadata, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new InvalidExternalEffectError(
        `metadata.${key} must be an enumerable data property`,
      );
    }

    const normalizedKey = requireNonBlank("metadata key", key);
    if (Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) {
      throw new InvalidExternalEffectError(
        `metadata contains duplicate normalized key ${normalizedKey}`,
      );
    }
    normalized[normalizedKey] = requireNonBlank(
      `metadata.${normalizedKey}`,
      descriptor.value,
    );
  }
  return Object.freeze(normalized);
}

export function normalizeExternalEffectIdentity(
  identity: ExternalEffectIdentity,
): ExternalEffectIdentity {
  return Object.freeze({
    idempotencyKey: requireNonBlank("idempotencyKey", identity.idempotencyKey),
    executionId: requireNonBlank("executionId", identity.executionId),
    stepId: requireNonBlank("stepId", identity.stepId),
    effectType: requireNonBlank("effectType", identity.effectType),
  });
}

export function normalizeExternalEffectReceipt(
  receipt: ExternalEffectReceipt,
): ExternalEffectReceipt {
  const identity = normalizeExternalEffectIdentity(receipt);
  return Object.freeze({
    ...identity,
    providerReference: requireNonBlank("providerReference", receipt.providerReference),
    committedAt: requireCanonicalTimestamp("committedAt", receipt.committedAt),
    payloadDigest: requirePayloadDigest(receipt.payloadDigest),
    metadata: normalizeMetadata(receipt.metadata),
  });
}

function assertIdentityMatch(
  expected: ExternalEffectIdentity,
  observed: ExternalEffectIdentity,
): void {
  const fields: readonly (keyof ExternalEffectIdentity)[] = [
    "idempotencyKey",
    "executionId",
    "stepId",
    "effectType",
  ];
  for (const field of fields) {
    if (expected[field] !== observed[field]) {
      throw new ExternalEffectConflictError(
        `External effect receipt ${field} does not match the expected identity`,
      );
    }
  }
}

export function reconcileExternalEffect(
  expectedIdentity: ExternalEffectIdentity,
  receipt?: ExternalEffectReceipt,
): ExternalEffectReconciliation {
  const identity = normalizeExternalEffectIdentity(expectedIdentity);
  if (receipt === undefined) {
    return Object.freeze({ status: "not_committed", identity });
  }

  const normalizedReceipt = normalizeExternalEffectReceipt(receipt);
  assertIdentityMatch(identity, normalizedReceipt);
  return Object.freeze({
    status: "committed",
    identity,
    receipt: normalizedReceipt,
  });
}

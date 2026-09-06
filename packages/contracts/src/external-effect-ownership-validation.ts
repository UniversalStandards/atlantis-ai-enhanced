import {
  normalizeExactDataRecord,
  requireExactDataFields,
  type ExactDataRecord,
} from "./exact-data-record.js";
import {
  InvalidExternalEffectOwnershipError,
  type ExternalEffectClaim,
  type ExternalEffectOwnershipRequest,
  type ExternalEffectRenewalRequest,
} from "./external-effect-ownership.js";
import {
  normalizeExternalEffectIdentity,
  type ExternalEffectIdentity,
} from "./external-effect.js";

function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidExternalEffectOwnershipError(
      `${field} must be a non-blank string`,
    );
  }
  return value.trim();
}

function requirePositiveSafeInteger(field: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new InvalidExternalEffectOwnershipError(
      `${field} must be a positive safe integer`,
    );
  }
  return value as number;
}

function requireCanonicalTimestamp(field: string, value: unknown): string {
  const timestamp = requireNonBlank(field, value);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new InvalidExternalEffectOwnershipError(
      `${field} must be a canonical ISO timestamp`,
    );
  }
  return timestamp;
}

function normalizeStringMetadata(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidExternalEffectOwnershipError(
      "ownership request metadata must be a plain string record",
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidExternalEffectOwnershipError(
      "ownership request metadata must be a plain string record",
    );
  }

  const normalized: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new InvalidExternalEffectOwnershipError(
        "ownership request metadata must not contain symbol fields",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new InvalidExternalEffectOwnershipError(
        `ownership request metadata.${key} must be an enumerable data property`,
      );
    }
    const normalizedKey = requireNonBlank("ownership request metadata key", key);
    if (Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) {
      throw new InvalidExternalEffectOwnershipError(
        `ownership request metadata contains duplicate normalized key ${normalizedKey}`,
      );
    }
    normalized[normalizedKey] = requireNonBlank(
      `ownership request metadata.${normalizedKey}`,
      descriptor.value,
    );
  }
  return Object.freeze(normalized);
}

function optionalOwnField(record: ExactDataRecord, field: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, field)
    ? record[field]
    : undefined;
}

export function normalizeExternalEffectOwnershipRequest(
  value: unknown,
): ExternalEffectOwnershipRequest {
  const record = normalizeExactDataRecord("ownership request", value, [
    "ownerId",
    "leaseDurationMs",
    "metadata",
  ]);
  requireExactDataFields("ownership request", record, [
    "ownerId",
    "leaseDurationMs",
  ]);

  const ownerId = requireNonBlank("ownerId", record.ownerId);
  const leaseDurationMs = requirePositiveSafeInteger(
    "leaseDurationMs",
    record.leaseDurationMs,
  );
  const metadataValue = optionalOwnField(record, "metadata");
  if (metadataValue === undefined) {
    return Object.freeze({ ownerId, leaseDurationMs });
  }
  return Object.freeze({
    ownerId,
    leaseDurationMs,
    metadata: normalizeStringMetadata(metadataValue),
  });
}

export function normalizeExternalEffectRenewalRequest(
  value: unknown,
): ExternalEffectRenewalRequest {
  const record = normalizeExactDataRecord("ownership renewal request", value, [
    "leaseDurationMs",
  ]);
  requireExactDataFields("ownership renewal request", record, [
    "leaseDurationMs",
  ]);
  return Object.freeze({
    leaseDurationMs: requirePositiveSafeInteger(
      "leaseDurationMs",
      record.leaseDurationMs,
    ),
  });
}

export function normalizeExternalEffectClaim(value: unknown): ExternalEffectClaim {
  const record = normalizeExactDataRecord("external-effect claim", value, [
    "idempotencyKey",
    "executionId",
    "stepId",
    "effectType",
    "claimToken",
    "ownerId",
    "acquiredAt",
    "expiresAt",
    "generation",
  ]);
  requireExactDataFields("external-effect claim", record, [
    "idempotencyKey",
    "executionId",
    "stepId",
    "effectType",
    "claimToken",
    "ownerId",
    "acquiredAt",
    "expiresAt",
    "generation",
  ]);

  const identity = normalizeExternalEffectIdentity(
    record as unknown as ExternalEffectIdentity,
  );
  const acquiredAt = requireCanonicalTimestamp(
    "claim.acquiredAt",
    record.acquiredAt,
  );
  const expiresAt = requireCanonicalTimestamp(
    "claim.expiresAt",
    record.expiresAt,
  );
  if (Date.parse(expiresAt) <= Date.parse(acquiredAt)) {
    throw new InvalidExternalEffectOwnershipError(
      "claim.expiresAt must be later than claim.acquiredAt",
    );
  }

  return Object.freeze({
    ...identity,
    claimToken: requireNonBlank("claim.claimToken", record.claimToken),
    ownerId: requireNonBlank("claim.ownerId", record.ownerId),
    acquiredAt,
    expiresAt,
    generation: requirePositiveSafeInteger("claim.generation", record.generation),
  });
}

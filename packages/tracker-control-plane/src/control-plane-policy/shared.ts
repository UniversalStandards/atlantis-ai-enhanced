export const trackerControlPlanePolicyVersion = "tracker-control-plane/v1" as const;

export type TrackerControlPlanePolicyVersion = typeof trackerControlPlanePolicyVersion;

export class InvalidTrackerControlPlanePolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidTrackerControlPlanePolicyError";
  }
}

export function requireObject(
  field: string,
  value: unknown,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidTrackerControlPlanePolicyError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidTrackerControlPlanePolicyError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

export function requireCanonicalTimestamp(field: string, value: unknown): string {
  const timestamp = requireNonBlank(field, value);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new InvalidTrackerControlPlanePolicyError(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

export function requireStringRecord(
  field: string,
  value: unknown,
): Readonly<Record<string, string>> {
  const record = requireObject(field, value);
  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    normalized[requireNonBlank(`${field} key`, key)] = requireNonBlank(
      `${field}.${key}`,
      entry,
    );
  }
  return Object.freeze(normalized);
}

export function requireStringArray(
  field: string,
  value: unknown,
  options: Readonly<{
    allowEmpty?: boolean;
    allowDuplicates?: boolean;
  }> = {},
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InvalidTrackerControlPlanePolicyError(`${field} must be an array`);
  }
  if (value.length === 0 && options.allowEmpty !== true) {
    throw new InvalidTrackerControlPlanePolicyError(`${field} must not be empty`);
  }

  const normalized = value.map((entry, index) =>
    requireNonBlank(`${field}[${index}]`, entry)
  );
  if (options.allowDuplicates !== true) {
    const unique = new Set(normalized);
    if (unique.size !== normalized.length) {
      throw new InvalidTrackerControlPlanePolicyError(`${field} must not contain duplicates`);
    }
  }
  return Object.freeze(normalized);
}

export function requireEnumValue<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new InvalidTrackerControlPlanePolicyError(
      `${field} must be one of: ${allowed.join(", ")}`,
    );
  }
  return value as T;
}

export function requirePolicyVersion(value: unknown): TrackerControlPlanePolicyVersion {
  if (value !== trackerControlPlanePolicyVersion) {
    throw new InvalidTrackerControlPlanePolicyError("policyVersion must be tracker-control-plane/v1");
  }
  return trackerControlPlanePolicyVersion;
}

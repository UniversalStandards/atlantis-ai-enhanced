export class InvalidExactDataRecordError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidExactDataRecordError";
  }
}

export type ExactDataRecord = Readonly<Record<string, unknown>>;

/**
 * Copies an untrusted object without invoking accessors and rejects structural
 * ambiguity before authorization-bearing fields are read.
 */
export function normalizeExactDataRecord(
  subject: string,
  value: unknown,
  allowedFields: readonly string[],
): ExactDataRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidExactDataRecordError(`${subject} must be a plain data record`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidExactDataRecordError(`${subject} must be a plain data record`);
  }

  const allowed = new Set(allowedFields);
  const normalized: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new InvalidExactDataRecordError(
        `${subject} must not contain symbol fields`,
      );
    }
    if (!allowed.has(key)) {
      throw new InvalidExactDataRecordError(
        `${subject} contains unexpected field ${key}`,
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new InvalidExactDataRecordError(
        `${subject}.${key} must be an enumerable data property`,
      );
    }
    normalized[key] = descriptor.value;
  }

  return Object.freeze(normalized);
}

export function requireExactDataFields(
  subject: string,
  record: ExactDataRecord,
  requiredFields: readonly string[],
): void {
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new InvalidExactDataRecordError(
        `${subject} is missing required field ${field}`,
      );
    }
  }
}

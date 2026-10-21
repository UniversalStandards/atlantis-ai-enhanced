export type BrowserContentKind = "text" | "html" | "accessibility-tree";

export interface UntrustedBrowserContentObservation {
  readonly sourceUrl: string;
  readonly kind: BrowserContentKind;
  readonly content: string;
  readonly observedAt: string;
}

export interface AdmittedUntrustedBrowserContent {
  readonly trust: "untrusted-browser-content";
  readonly sourceUrl: string;
  readonly kind: BrowserContentKind;
  readonly content: string;
  readonly observedAt: string;
}

export class InvalidUntrustedBrowserContentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidUntrustedBrowserContentError";
  }
}

function requireOwnEnumerableDataString(
  input: object,
  field: keyof UntrustedBrowserContentObservation,
): string {
  const descriptor = Object.getOwnPropertyDescriptor(input, field);
  if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
    throw new InvalidUntrustedBrowserContentError(`${field} must be an enumerable data property.`);
  }
  if (typeof descriptor.value !== "string") {
    throw new InvalidUntrustedBrowserContentError(`${field} must be a string.`);
  }
  return descriptor.value;
}

/**
 * Admits browser-originated content as data only. This boundary deliberately
 * exposes no approval, credential, execution-identity, repository/branch,
 * tool-authority, or human-review fields. A concrete browser driver may feed
 * observations into this contract without gaining authority from page content.
 */
export function admitUntrustedBrowserContent(
  input: Readonly<UntrustedBrowserContentObservation>,
): Readonly<AdmittedUntrustedBrowserContent> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidUntrustedBrowserContentError("browser observation must be a record.");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidUntrustedBrowserContentError("browser observation must use a plain prototype.");
  }
  if (Object.getOwnPropertySymbols(input).length !== 0) {
    throw new InvalidUntrustedBrowserContentError("browser observation must not contain symbol-keyed data.");
  }

  const allowed = new Set(["sourceUrl", "kind", "content", "observedAt"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new InvalidUntrustedBrowserContentError(`browser observation contains unsupported field ${key}.`);
    }
  }

  const sourceUrl = requireOwnEnumerableDataString(input, "sourceUrl").trim();
  const kind = requireOwnEnumerableDataString(input, "kind") as BrowserContentKind;
  const content = requireOwnEnumerableDataString(input, "content");
  const observedAt = requireOwnEnumerableDataString(input, "observedAt");

  if (sourceUrl.length === 0) {
    throw new InvalidUntrustedBrowserContentError("sourceUrl must be non-empty.");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new InvalidUntrustedBrowserContentError("sourceUrl must be an absolute URL.");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new InvalidUntrustedBrowserContentError("sourceUrl must use http or https.");
  }
  if (kind !== "text" && kind !== "html" && kind !== "accessibility-tree") {
    throw new InvalidUntrustedBrowserContentError("kind is unsupported.");
  }
  const parsedTimestamp = Date.parse(observedAt);
  if (!Number.isFinite(parsedTimestamp) || new Date(parsedTimestamp).toISOString() !== observedAt) {
    throw new InvalidUntrustedBrowserContentError("observedAt must be a canonical ISO-8601 UTC timestamp.");
  }

  return Object.freeze({
    trust: "untrusted-browser-content" as const,
    sourceUrl,
    kind,
    content,
    observedAt,
  });
}

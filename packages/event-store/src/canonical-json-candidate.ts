export class CanonicalJsonCandidateError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CanonicalJsonCandidateError";
  }
}

export interface CanonicalJsonCandidate<T> {
  readonly serialized: string;
  readonly restored: T;
}

/**
 * Produces an immutable storage handoff string only after proving that the
 * serialized representation can be parsed, restored through the caller's
 * exact validator, and serialized back to the identical byte sequence.
 *
 * This keeps provider-neutral repositories from treating a lossy, accessor-
 * influenced, or otherwise non-canonical JSON representation as a durable
 * commit candidate.
 */
export function createCanonicalJsonCandidate<T>(
  value: unknown,
  restore: (parsed: unknown) => T,
): CanonicalJsonCandidate<T> {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (cause) {
    throw new CanonicalJsonCandidateError(
      "candidate state must serialize as JSON.",
      { cause },
    );
  }

  if (serialized === undefined) {
    throw new CanonicalJsonCandidateError(
      "candidate state must serialize to a JSON string.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new CanonicalJsonCandidateError(
      "serialized candidate state must parse as JSON.",
      { cause },
    );
  }

  const restored = restore(parsed);

  let canonical: string | undefined;
  try {
    canonical = JSON.stringify(restored);
  } catch (cause) {
    throw new CanonicalJsonCandidateError(
      "restored candidate state must serialize as JSON.",
      { cause },
    );
  }

  if (canonical === undefined || canonical !== serialized) {
    throw new CanonicalJsonCandidateError(
      "candidate state must round-trip to an identical canonical JSON representation.",
    );
  }

  return Object.freeze({ serialized, restored });
}

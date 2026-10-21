export interface MonotonicAppendObservation {
  readonly revision: number;
  readonly value: string | null;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function parseEventArray(value: string | null): readonly unknown[] | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Returns true only when a current authoritative snapshot still contains an
 * exact append candidate at its original position.
 *
 * This is deliberately a containment primitive, not immutable commit evidence:
 * it can prove that a candidate remains present in a later append-only snapshot,
 * but it does not replace an adapter-level commit receipt or version-addressable
 * committed read.
 */
export function isMonotonicAppendCandidateObserved(
  expectedRevision: number,
  candidate: string,
  observation: MonotonicAppendObservation,
): boolean {
  if (
    !isNonNegativeSafeInteger(expectedRevision)
    || !isNonNegativeSafeInteger(observation.revision)
    || observation.revision < expectedRevision + 1
  ) {
    return false;
  }

  if (observation.revision === expectedRevision + 1) {
    return observation.value === candidate;
  }

  const candidateEvents = parseEventArray(candidate);
  const observedEvents = parseEventArray(observation.value);
  if (candidateEvents === null || observedEvents === null) {
    return false;
  }

  const revisionAdvance = observation.revision - (expectedRevision + 1);
  const eventAdvance = observedEvents.length - candidateEvents.length;
  if (revisionAdvance !== eventAdvance || eventAdvance < 1) {
    return false;
  }

  return JSON.stringify(observedEvents.slice(0, candidateEvents.length)) === candidate;
}

import {
  ExternalEffectOwnershipLostError,
} from "@atlantis/contracts/external-effect-execution";
import {
  withExternalEffectOwnershipLossEvidence,
  type ExternalEffectOwnershipLossEvidenceContext,
  type ExternalEffectOwnershipLossExecutionEvent,
} from "@atlantis/contracts/external-effect-ownership-loss-evidence";

import { DurableExecutionEventSink } from "./execution-event-sink.js";

const DEFAULT_EVIDENCE_TIMEOUT_MS = 1_000;

type OwnershipLossEvidenceAppend = (
  event: ExternalEffectOwnershipLossExecutionEvent,
) => void | Promise<void>;

export interface DurableOwnershipLossEvidenceContextOptions {
  readonly eventSink: DurableExecutionEventSink;
  readonly executionId: string;
  readonly actor: string;
  readonly createEventId: () => string;
  readonly now: () => string;
  readonly onEvidenceError?: (error: unknown) => void | Promise<void>;
  readonly evidenceTimeoutMs?: number;
}

export class OwnershipLossEvidenceTimeoutError extends Error {
  public constructor(
    public readonly operation: "append" | "report",
    public readonly timeoutMs: number,
  ) {
    super(`Ownership-loss evidence ${operation} exceeded ${timeoutMs}ms.`);
    this.name = "OwnershipLossEvidenceTimeoutError";
  }
}

function requireTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_EVIDENCE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("evidenceTimeoutMs must be a positive safe integer");
  }
  return timeoutMs;
}

async function withinDeadline<T>(
  operation: "append" | "report",
  timeoutMs: number,
  work: () => T | Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new OwnershipLossEvidenceTimeoutError(operation, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Binds ownership-loss evidence to the current durable execution-stream tail.
 *
 * The optional append capability allows the high-level wrapper to inject the
 * sink-owned governed append boundary while preserving this factory for direct
 * compatibility callers.
 */
export function createDurableOwnershipLossEvidenceContext(
  options: DurableOwnershipLossEvidenceContextOptions,
  appendEvidence: OwnershipLossEvidenceAppend = (event) =>
    options.eventSink.append(event),
): ExternalEffectOwnershipLossEvidenceContext {
  const timeoutMs = requireTimeout(options.evidenceTimeoutMs);
  const events = options.eventSink.readExecution(options.executionId);
  const tail = events.at(-1);

  return Object.freeze({
    eventSink: Object.freeze({
      append: (event: ExternalEffectOwnershipLossExecutionEvent) =>
        withinDeadline("append", timeoutMs, () => appendEvidence(event)),
    }),
    executionId: options.executionId,
    actor: options.actor,
    sequence: events.length + 1,
    createEventId: options.createEventId,
    now: options.now,
    ...(tail === undefined ? {} : { parentEventId: tail.id }),
    ...(options.onEvidenceError === undefined
      ? {}
      : {
          onEvidenceError: (error: unknown) =>
            withinDeadline("report", timeoutMs, () =>
              options.onEvidenceError?.(error),
            ),
        }),
  });
}

/**
 * Allocates sequence and parent linkage only after ownership loss occurs, so
 * normal runner events emitted during the operation cannot stale the cursor.
 * Evidence recording uses the sink-owned governed queue and its identity-bound,
 * revocable append capability. Evidence and reporter delivery remain bounded
 * and non-authoritative.
 */
export async function withDurableOwnershipLossEvidence<T>(
  options: DurableOwnershipLossEvidenceContextOptions,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ExternalEffectOwnershipLostError)) throw error;

    return await options.eventSink.enqueueExecutionAppend(
      options.executionId,
      ({ append }) =>
        withExternalEffectOwnershipLossEvidence(
          createDurableOwnershipLossEvidenceContext(options, append),
          async () => {
            throw error;
          },
        ),
    ).result;
  }
}

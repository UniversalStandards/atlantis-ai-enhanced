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

const ownershipLossEvidenceQueues = new WeakMap<
  DurableExecutionEventSink,
  Map<string, Promise<void>>
>();

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

async function serializeOwnershipLossEvidence<T>(
  eventSink: DurableExecutionEventSink,
  executionId: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  let executionQueues = ownershipLossEvidenceQueues.get(eventSink);
  if (executionQueues === undefined) {
    executionQueues = new Map<string, Promise<void>>();
    ownershipLossEvidenceQueues.set(eventSink, executionQueues);
  }

  const predecessor = executionQueues.get(executionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = predecessor.catch(() => undefined).then(() => gate);
  executionQueues.set(executionId, tail);

  await predecessor.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (executionQueues.get(executionId) === tail) {
      executionQueues.delete(executionId);
      if (executionQueues.size === 0) {
        ownershipLossEvidenceQueues.delete(eventSink);
      }
    }
  }
}

/**
 * Binds ownership-loss evidence to the current durable execution-stream tail.
 *
 * Call this immediately before append. The returned sequence and parent are
 * derived from the authoritative stream rather than supplied by a caller. A
 * concurrent append after this read remains fail-closed through optimistic
 * sequence validation.
 */
export function createDurableOwnershipLossEvidenceContext(
  options: DurableOwnershipLossEvidenceContextOptions,
): ExternalEffectOwnershipLossEvidenceContext {
  const timeoutMs = requireTimeout(options.evidenceTimeoutMs);
  const events = options.eventSink.readExecution(options.executionId);
  const tail = events.at(-1);

  return Object.freeze({
    eventSink: Object.freeze({
      append: (event: ExternalEffectOwnershipLossExecutionEvent) =>
        withinDeadline("append", timeoutMs, () => options.eventSink.append(event)),
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
 * Evidence recording is serialized per durable sink and execution, preventing
 * concurrent ownership-loss handlers from allocating the same stream position.
 * Evidence and reporter delivery are bounded and remain non-authoritative.
 */
export async function withDurableOwnershipLossEvidence<T>(
  options: DurableOwnershipLossEvidenceContextOptions,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ExternalEffectOwnershipLostError)) throw error;

    return serializeOwnershipLossEvidence(
      options.eventSink,
      options.executionId,
      () =>
        withExternalEffectOwnershipLossEvidence(
          createDurableOwnershipLossEvidenceContext(options),
          async () => {
            throw error;
          },
        ),
    );
  }
}

import type { ExecutionReleaseEvidence } from "./execution-release-evidence.js";

export interface ExecutionReleaseTelemetryRecord {
  readonly executionId: string;
  readonly eventCount: number;
  readonly elapsedMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly toolCalls: number;
  readonly retries: number;
  readonly iterations: number;
  readonly replayVerified: boolean;
  readonly budgetExceeded: boolean;
}

export interface ExecutionReleaseTelemetryExporter {
  export(record: ExecutionReleaseTelemetryRecord): void | Promise<void>;
}

export interface ExecutionReleaseTelemetryResult {
  readonly exported: boolean;
  readonly record: ExecutionReleaseTelemetryRecord;
  readonly error?: unknown;
}

/**
 * Projects non-authoritative observability data from already-governed release
 * evidence. Telemetry is intentionally downstream of correctness evidence:
 * exporter failure is reported to the caller but never rewrites, substitutes,
 * or invalidates the authoritative release evidence.
 */
export function projectExecutionReleaseTelemetry(
  evidence: ExecutionReleaseEvidence,
): ExecutionReleaseTelemetryRecord {
  const { summary } = evidence;
  const budgetExceeded = Object.values(summary.budget).some((dimension) => dimension.exceeded);

  return Object.freeze({
    executionId: evidence.executionId,
    eventCount: summary.eventCount,
    elapsedMs: summary.elapsedMs,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    totalTokens: summary.totalTokens,
    costUsd: summary.costUsd,
    toolCalls: summary.toolCalls,
    retries: summary.retries,
    iterations: summary.iterations,
    replayVerified: evidence.replay !== undefined,
    budgetExceeded,
  });
}

/**
 * Best-effort telemetry export boundary suitable for an OpenTelemetry adapter.
 * Correctness never depends on exporter availability or acknowledgement.
 */
export async function exportExecutionReleaseTelemetry(
  evidence: ExecutionReleaseEvidence,
  exporter: ExecutionReleaseTelemetryExporter,
): Promise<ExecutionReleaseTelemetryResult> {
  const record = projectExecutionReleaseTelemetry(evidence);

  try {
    await exporter.export(record);
    return Object.freeze({ exported: true, record });
  } catch (error: unknown) {
    return Object.freeze({ exported: false, record, error });
  }
}

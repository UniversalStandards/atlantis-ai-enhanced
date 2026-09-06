import type {
  ExecutionReleaseTelemetryExporter,
  ExecutionReleaseTelemetryRecord,
} from "./execution-release-telemetry.js";

export interface OpenTelemetryReleaseSpan {
  readonly name: "atlantis.execution.release";
  readonly attributes: Readonly<{
    "atlantis.execution.id": string;
    "atlantis.execution.event_count": number;
    "atlantis.execution.elapsed_ms": number;
    "atlantis.execution.input_tokens": number;
    "atlantis.execution.output_tokens": number;
    "atlantis.execution.total_tokens": number;
    "atlantis.execution.cost_usd": number;
    "atlantis.execution.tool_calls": number;
    "atlantis.execution.retries": number;
    "atlantis.execution.iterations": number;
    "atlantis.execution.replay_verified": boolean;
    "atlantis.execution.budget_exceeded": boolean;
  }>;
}

/**
 * Minimal provider-neutral sink for an OpenTelemetry-shaped release span.
 * A production SDK/collector binding can implement this interface without
 * making telemetry part of the correctness or release-evidence boundary.
 */
export interface OpenTelemetryReleaseSpanSink {
  emit(span: OpenTelemetryReleaseSpan): void | Promise<void>;
}

export function projectOpenTelemetryReleaseSpan(
  record: ExecutionReleaseTelemetryRecord,
): OpenTelemetryReleaseSpan {
  return Object.freeze({
    name: "atlantis.execution.release" as const,
    attributes: Object.freeze({
      "atlantis.execution.id": record.executionId,
      "atlantis.execution.event_count": record.eventCount,
      "atlantis.execution.elapsed_ms": record.elapsedMs,
      "atlantis.execution.input_tokens": record.inputTokens,
      "atlantis.execution.output_tokens": record.outputTokens,
      "atlantis.execution.total_tokens": record.totalTokens,
      "atlantis.execution.cost_usd": record.costUsd,
      "atlantis.execution.tool_calls": record.toolCalls,
      "atlantis.execution.retries": record.retries,
      "atlantis.execution.iterations": record.iterations,
      "atlantis.execution.replay_verified": record.replayVerified,
      "atlantis.execution.budget_exceeded": record.budgetExceeded,
    }),
  });
}

/**
 * Adapts governed release telemetry to an OpenTelemetry-shaped sink. The
 * upstream export boundary contains sink failures, so this adapter does not
 * acknowledge, mutate, or otherwise participate in authoritative evidence.
 */
export class OpenTelemetryExecutionReleaseExporter implements ExecutionReleaseTelemetryExporter {
  public constructor(private readonly sink: OpenTelemetryReleaseSpanSink) {}

  public async export(record: ExecutionReleaseTelemetryRecord): Promise<void> {
    await this.sink.emit(projectOpenTelemetryReleaseSpan(record));
  }
}

import {
  assertWithinBudget,
  type EvaluationResult,
  type Evaluator,
  type WorkflowContext,
} from "@atlantis/contracts";

export type BenchmarkWorkflowKind = "coding" | "conversation";

export interface BenchmarkCase<TInput> {
  readonly id: string;
  readonly version: string;
  readonly workflowKind: BenchmarkWorkflowKind;
  readonly input: TInput;
  readonly passThreshold: number;
}

export interface BenchmarkMeasurement {
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

export interface BenchmarkScorecard {
  readonly score: number;
  readonly passed: boolean;
  readonly threshold: number;
  readonly reasons: readonly string[];
  readonly metrics: Readonly<Record<string, number>>;
}

export interface BenchmarkAttempt<TOutput> {
  readonly iteration: number;
  readonly output: TOutput;
  readonly scorecard: BenchmarkScorecard;
}

export interface BoundedBenchmarkResult<TOutput> {
  readonly caseId: string;
  readonly caseVersion: string;
  readonly workflowKind: BenchmarkWorkflowKind;
  readonly attempts: readonly BenchmarkAttempt<TOutput>[];
  readonly final: BenchmarkAttempt<TOutput>;
  readonly passed: boolean;
  readonly exhausted: boolean;
}

export interface BenchmarkGenerator<TInput, TOutput> {
  generate(input: TInput, context: WorkflowContext): Promise<TOutput>;
}

export interface BenchmarkRefiner<TInput, TOutput> {
  refine(
    input: TInput,
    priorOutput: TOutput,
    evaluation: EvaluationResult,
    context: WorkflowContext,
  ): Promise<TOutput>;
}

export type ProviderBenchmarkEvidenceState = "executed" | "gated-not-executed";

export interface ProviderBenchmarkRecord {
  readonly providerId: string;
  readonly providerKind: "mock" | "real";
  readonly evidenceState: ProviderBenchmarkEvidenceState;
  readonly modelId?: string;
  readonly caseId: string;
  readonly caseVersion: string;
  readonly workflowKind: BenchmarkWorkflowKind;
  readonly scorecard?: BenchmarkScorecard;
  readonly measurement?: BenchmarkMeasurement;
  readonly gateReason?: string;
}

export interface ProviderComparisonReport {
  readonly caseId: string;
  readonly caseVersion: string;
  readonly workflowKind: BenchmarkWorkflowKind;
  readonly mock: ProviderBenchmarkRecord;
  readonly real: ProviderBenchmarkRecord;
  readonly status: "complete" | "real-provider-gated";
  readonly acceptanceSatisfied: boolean;
  readonly scoreDelta?: number;
}

export class InvalidBenchmarkEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidBenchmarkEvidenceError";
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new InvalidBenchmarkEvidenceError(`${field} must be non-empty.`);
  }
}

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidBenchmarkEvidenceError(`${field} must be finite and non-negative.`);
  }
}

function requireProbability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidBenchmarkEvidenceError(`${field} must be between 0 and 1.`);
  }
}

function validateCase<TInput>(benchmarkCase: BenchmarkCase<TInput>): void {
  requireNonEmpty(benchmarkCase.id, "case.id");
  requireNonEmpty(benchmarkCase.version, "case.version");
  requireProbability(benchmarkCase.passThreshold, "case.passThreshold");
}

export function normalizeBenchmarkScorecard(
  evaluation: EvaluationResult,
  threshold: number,
): BenchmarkScorecard {
  requireProbability(threshold, "threshold");
  requireProbability(evaluation.score, "evaluation.score");
  for (const [name, value] of Object.entries(evaluation.metrics)) {
    requireNonEmpty(name, "evaluation metric name");
    requireFiniteNonNegative(value, `evaluation.metrics.${name}`);
  }

  return Object.freeze({
    score: evaluation.score,
    passed: evaluation.passed && evaluation.score >= threshold,
    threshold,
    reasons: Object.freeze([...evaluation.reasons]),
    metrics: Object.freeze({ ...evaluation.metrics }),
  });
}

function reserveIteration(context: WorkflowContext): void {
  if (context.usage.iterations >= context.budget.maxIterations) {
    throw new InvalidBenchmarkEvidenceError("no benchmark iteration budget remains.");
  }
  context.usage.iterations += 1;
  assertWithinBudget(context);
}

export async function runBoundedBenchmark<TInput, TOutput>(
  benchmarkCase: BenchmarkCase<TInput>,
  context: WorkflowContext,
  generator: BenchmarkGenerator<TInput, TOutput>,
  evaluator: Evaluator<TOutput>,
  refiner?: BenchmarkRefiner<TInput, TOutput>,
): Promise<BoundedBenchmarkResult<TOutput>> {
  validateCase(benchmarkCase);
  assertWithinBudget(context);

  if (!Number.isSafeInteger(context.budget.maxIterations) || context.budget.maxIterations < 1) {
    throw new InvalidBenchmarkEvidenceError("context.budget.maxIterations must allow at least one attempt.");
  }

  const maxAttempts = context.budget.maxIterations - context.usage.iterations;
  if (maxAttempts < 1) {
    throw new InvalidBenchmarkEvidenceError("no benchmark iteration budget remains.");
  }

  const attempts: BenchmarkAttempt<TOutput>[] = [];
  reserveIteration(context);
  let output = await generator.generate(benchmarkCase.input, context);

  for (let iteration = 1; iteration <= maxAttempts; iteration += 1) {
    const evaluation = await evaluator.evaluate(output, context);
    const scorecard = normalizeBenchmarkScorecard(evaluation, benchmarkCase.passThreshold);
    const attempt = Object.freeze({ iteration, output, scorecard });
    attempts.push(attempt);

    if (scorecard.passed) {
      return Object.freeze({
        caseId: benchmarkCase.id,
        caseVersion: benchmarkCase.version,
        workflowKind: benchmarkCase.workflowKind,
        attempts: Object.freeze([...attempts]),
        final: attempt,
        passed: true,
        exhausted: false,
      });
    }

    if (iteration === maxAttempts || refiner === undefined) {
      return Object.freeze({
        caseId: benchmarkCase.id,
        caseVersion: benchmarkCase.version,
        workflowKind: benchmarkCase.workflowKind,
        attempts: Object.freeze([...attempts]),
        final: attempt,
        passed: false,
        exhausted: iteration === maxAttempts,
      });
    }

    reserveIteration(context);
    output = await refiner.refine(benchmarkCase.input, output, evaluation, context);
  }

  throw new InvalidBenchmarkEvidenceError("bounded benchmark terminated without a final attempt.");
}

function validateExecutedRecord(record: ProviderBenchmarkRecord): void {
  if (record.scorecard === undefined || record.measurement === undefined) {
    throw new InvalidBenchmarkEvidenceError("executed provider evidence requires scorecard and measurement.");
  }
  requireFiniteNonNegative(record.measurement.latencyMs, "measurement.latencyMs");
  if (record.measurement.inputTokens !== undefined) {
    requireFiniteNonNegative(record.measurement.inputTokens, "measurement.inputTokens");
  }
  if (record.measurement.outputTokens !== undefined) {
    requireFiniteNonNegative(record.measurement.outputTokens, "measurement.outputTokens");
  }
  if (record.measurement.costUsd !== undefined) {
    requireFiniteNonNegative(record.measurement.costUsd, "measurement.costUsd");
  }
}

function validateProviderRecord(record: ProviderBenchmarkRecord): void {
  requireNonEmpty(record.providerId, "providerId");
  requireNonEmpty(record.caseId, "caseId");
  requireNonEmpty(record.caseVersion, "caseVersion");
  if (record.evidenceState === "executed") {
    validateExecutedRecord(record);
    return;
  }
  if (record.providerKind !== "real") {
    throw new InvalidBenchmarkEvidenceError("only a real-provider record may be gated-not-executed.");
  }
  if (record.scorecard !== undefined || record.measurement !== undefined) {
    throw new InvalidBenchmarkEvidenceError("gated real-provider evidence must not fabricate scorecard or measurement data.");
  }
  if (record.gateReason === undefined || record.gateReason.trim().length === 0) {
    throw new InvalidBenchmarkEvidenceError("gated real-provider evidence requires a gateReason.");
  }
}

export function compareProviderBenchmarkRecords(
  mock: ProviderBenchmarkRecord,
  real: ProviderBenchmarkRecord,
): ProviderComparisonReport {
  validateProviderRecord(mock);
  validateProviderRecord(real);

  if (mock.providerKind !== "mock" || mock.evidenceState !== "executed") {
    throw new InvalidBenchmarkEvidenceError("mock benchmark evidence must be an executed mock-provider record.");
  }
  if (real.providerKind !== "real") {
    throw new InvalidBenchmarkEvidenceError("real benchmark evidence must identify a real provider.");
  }
  if (
    mock.caseId !== real.caseId ||
    mock.caseVersion !== real.caseVersion ||
    mock.workflowKind !== real.workflowKind
  ) {
    throw new InvalidBenchmarkEvidenceError("provider benchmark records must describe the same versioned case.");
  }

  if (real.evidenceState === "gated-not-executed") {
    return Object.freeze({
      caseId: mock.caseId,
      caseVersion: mock.caseVersion,
      workflowKind: mock.workflowKind,
      mock,
      real,
      status: "real-provider-gated",
      acceptanceSatisfied: false,
    });
  }

  const mockScore = mock.scorecard?.score;
  const realScore = real.scorecard?.score;
  if (mockScore === undefined || realScore === undefined) {
    throw new InvalidBenchmarkEvidenceError("executed provider records require scorecards.");
  }

  return Object.freeze({
    caseId: mock.caseId,
    caseVersion: mock.caseVersion,
    workflowKind: mock.workflowKind,
    mock,
    real,
    status: "complete",
    acceptanceSatisfied: mock.scorecard?.passed === true && real.scorecard?.passed === true,
    scoreDelta: realScore - mockScore,
  });
}

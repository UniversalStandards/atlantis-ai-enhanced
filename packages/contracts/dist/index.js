export class BudgetExceededError extends Error {
    dimension;
    limit;
    observed;
    constructor(dimension, limit, observed) {
        super(`Execution budget exceeded for ${dimension}: ${observed} > ${limit}`);
        this.dimension = dimension;
        this.limit = limit;
        this.observed = observed;
        this.name = "BudgetExceededError";
    }
}
/**
 * Raised when a budget or usage record contains a value that cannot be
 * compared safely (NaN, Infinity, negative). Budget enforcement fails closed:
 * an unreadable counter is treated as a violation, never as "within budget".
 */
export class InvalidBudgetStateError extends Error {
    field;
    value;
    constructor(field, value) {
        super(`Execution budget state is invalid: ${field} must be a finite, non-negative number (received ${String(value)})`);
        this.field = field;
        this.value = value;
        this.name = "InvalidBudgetStateError";
    }
}
const BUDGET_FIELDS = [
    "maxToolCalls",
    "maxRetries",
    "maxIterations",
    "maxTokens",
    "maxDurationMs",
    "maxCostUsd",
];
const USAGE_FIELDS = [
    "toolCalls",
    "retries",
    "iterations",
    "inputTokens",
    "outputTokens",
    "durationMs",
    "costUsd",
];
function assertCounter(field, value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new InvalidBudgetStateError(field, value);
    }
}
/** A zeroed usage record. Always start an execution from this. */
export function createUsage() {
    return {
        toolCalls: 0,
        retries: 0,
        iterations: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        costUsd: 0,
    };
}
/** Validates every limit in a budget. Throws {@link InvalidBudgetStateError}. */
export function assertValidBudget(budget) {
    for (const field of BUDGET_FIELDS) {
        assertCounter(`budget.${field}`, budget[field]);
    }
}
/** Validates every counter in a usage record. Throws {@link InvalidBudgetStateError}. */
export function assertValidUsage(usage) {
    for (const field of USAGE_FIELDS) {
        assertCounter(`usage.${field}`, usage[field]);
    }
}
/**
 * Throws if any usage counter exceeds its limit, or if any limit or counter is
 * not a finite, non-negative number. Usage exactly at a limit is allowed.
 */
export function assertWithinBudget(context) {
    const { budget, usage } = context;
    assertValidBudget(budget);
    assertValidUsage(usage);
    const checks = [
        ["maxToolCalls", budget.maxToolCalls, usage.toolCalls],
        ["maxRetries", budget.maxRetries, usage.retries],
        ["maxIterations", budget.maxIterations, usage.iterations],
        ["maxTokens", budget.maxTokens, usage.inputTokens + usage.outputTokens],
        ["maxDurationMs", budget.maxDurationMs, usage.durationMs],
        ["maxCostUsd", budget.maxCostUsd, usage.costUsd],
    ];
    for (const [dimension, limit, observed] of checks) {
        if (observed > limit) {
            throw new BudgetExceededError(dimension, limit, observed);
        }
    }
}
//# sourceMappingURL=index.js.map
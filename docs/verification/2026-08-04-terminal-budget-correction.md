# Terminal budget correction verification

## Corrected defect

`ResumableSequentialWorkflowRunner` previously emitted a terminal `execution.failed` event for `BudgetExceededError` while retaining the durable checkpoint. That left terminally failed work resumable and could retain protected-step authorization.

The terminal budget path now clears the current checkpoint revision and removes the in-memory checkpoint reference before appending `execution.failed`.

## Corrective commits

- `782651cf80f0cb92c98efd306186478ba4287f73` — clear checkpoint on terminal budget exhaustion.
- `5491b0c80a03688605c910addf60e68eae37d116` — add the focused terminal-budget regression.

## Exact-head evidence

- Head: `5491b0c80a03688605c910addf60e68eae37d116`
- GitHub Actions run: `30872997450`
- Frozen pnpm installation: passed.
- Contracts typecheck: passed.
- Event-store typecheck: passed.
- Contracts tests: 92 passed.
- Event-store tests: 50 passed.
- Total: 142 tests passed.
- GitHub Actions token permissions: contents read, metadata read.

## Verified invariant

After protected work exceeds a terminal budget:

1. `budget.exceeded` is recorded exactly once.
2. `execution.failed` with `reason: budget_exceeded` is recorded exactly once.
3. No contradictory completion, cancellation, timeout, or interruption outcome is recorded.
4. The checkpoint and retained protected-step approval are removed.

## Remaining limitation

Checkpoint clearing and terminal event append are still separate operations. A durable transaction or outbox decision is required before claiming cross-store atomic terminalization.

The governed entrypoint also needs a durable terminal-execution identity guard so a caller cannot intentionally submit the same terminal execution identity as a fresh run after its checkpoint has been cleared.

## Next integration action

Add the provider-neutral terminal execution lookup/claim boundary at the governed composition root, fail closed when an execution identity already has a terminal outcome, and prove a second invocation cannot execute or append another terminal trace. Then resume external-effect reconciliation integration.

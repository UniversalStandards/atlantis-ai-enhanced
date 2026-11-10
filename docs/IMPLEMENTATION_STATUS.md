# ATLANTIS AI Implementation Status

## 2026-07-30

### Completed

- Initialized the pnpm workspace.
- Added the first provider-neutral TypeScript contracts package.
- Defined workflow, execution, event, evaluation, escalation, usage, and budget contracts.
- Added fail-closed execution budget enforcement.
- Added unit tests for boundary and over-budget behavior.
- Added GitHub Actions validation for type checking and tests.

### Repository Audit Finding

The previous README described a Python package structure and `pyproject.toml`, but that package manifest was not present when implementation began. The repository should therefore be treated as a documented foundation under active construction, not as an already production-ready implementation.

## 2026-11-10

### Completed

- `@atlantis/events`: in-memory `EventStore` with contiguous per-execution sequencing, duplicate-id rejection, immutable stored copies, and a SHA-256 hash chain with `verify`; `EventRecorder` with injectable clock and id generator for deterministic replay fixtures.
- `@atlantis/orchestration`: deterministic sequential workflow runner with typed step chaining, bounded retries, duration limits with step abandonment, cancellation, bounded evaluate→revise refinement, and supervisor escalation with return-to-workflow (hybrid and supervisor modes only).
- `@atlantis/contracts`: `EventStore` contract, `execution.cancelled` event type, optional `WorkflowContext.signal`, `createUsage`, and budget/usage validation.
- Fixed: `assertWithinBudget` treated `NaN` counters and limits as within budget. It now fails closed on any non-finite or negative value.
- Tooling: committed lockfile with frozen installs, strict type-aware ESLint, shared TypeScript base config, build step, coverage thresholds, Node 22/24 CI matrix, dependency audit, SHA-pinned actions, Dependabot.
- Fixed: the CodeQL workflow had an empty language matrix and could not run.
- Documentation: README now describes what exists; the previous README is preserved as `docs/VISION.md`. Added `SECURITY.md` and `CONTRIBUTING.md`.

### Known gaps

- No durable event store. `InMemoryEventStore` loses history on process exit; a PostgreSQL implementation of the same contract is required before any deployment.
- No model provider adapters, policy engine, identity, API, or UI. None of the acceptance criteria in ADR 0001 (modernization foundation) are met yet.
- Workflows are sequential only; no parallel stages, no execution-graph visualization, no replay driver.
- Approval gating (`waiting_for_approval`, `approval.*` events) is defined in the contracts but not implemented by the runner.
- Two documents are both numbered ADR-0001 (`docs/ADR-0001-WORKFLOW-FIRST-ORCHESTRATION.md` and `docs/decisions/0001-modernization-foundation.md`), and issue #44 refers to an ADR-0002 that is not in the repository.

### Next Implementation Slice

1. PostgreSQL-backed `EventStore` with the same ordering and hash-chain guarantees.
2. Policy evaluation and approval gating in the runner.
3. Provider-neutral conversation contracts with a mock adapter.
4. Replay driver that re-executes a recorded history against deterministic fixtures.
5. Connect the governed conversation vertical slice to these contracts.

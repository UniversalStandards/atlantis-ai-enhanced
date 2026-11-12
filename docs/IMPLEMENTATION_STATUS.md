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

## 2026-11-12

### Decisions

- [ADR 0004](decisions/0004-consensus-federation-core.md): Consensus Federation is the core; workflows are the decomposition layer. Reveal rounds are gated on corpus evidence.
- ADR numbering fixed: workflow-first orchestration is now ADR 0003; 0002 is reserved for the Agent Harness Runtime (issue #44).

### Completed

- Review findings on PR #63 fixed: evaluator reasons and metrics no longer reach the event history; the step signal is aborted on every exit; `accept_best` is recorded on the step completion event.
- Policy and approval gating in the runner. A step that declares an `action` is denied unless a policy allows it, and waits for explicit approval when the policy requires it. Retries and supervisor escalation cannot bypass a denial.
- `@atlantis/events-postgres`: durable `EventStore` with the same ordering and hash-chain guarantees, plus triggers that reject UPDATE, DELETE, and TRUNCATE. Tested against PGlite (PostgreSQL compiled to WebAssembly, in-process).
- `@atlantis/deliberation`: provenance schema 1.0.0, Mode C verification with blind round 0, family-diversity minimums, divergence-as-finding, partial emission under a discrepancy header, blocking for binding instruments, known-answer corpus scoring, a scripted panelist for fixtures, and an OpenAI-compatible panelist adapter for bring-your-own-key use.
- The advanced CodeQL workflow was removed: the repository uses GitHub's default CodeQL setup, and the two cannot run together.
- Prettier added; formatting is checked in CI.

### Known gaps

- `@atlantis/events-postgres` has not been run against a server PostgreSQL through the `pg` driver, or against Supabase. PGlite is single-connection, so the concurrent-writer test exercises the INSERT guard and primary key but not true multi-connection contention.
- The OpenAI-compatible adapter is tested against an injected `fetch`, not a live provider. It has no retry, rate-limit handling, or streaming.
- Deliberation is not yet wired into the runner as a step type, and panelist token usage is not charged to the execution budget.
- Modes A, B, D, and E, reveal rounds, the arbiter, and the depth-assignment rules are not implemented. No validation corpus exists yet; `scoreKnownAnswers` is the harness for one.
- No identity, API, UI, or deployment. None of ADR 0001's success criteria are met.
- Workflows are sequential only; there is no replay driver.

### Next Implementation Slice

1. Deliberation as a workflow step, with panelist usage charged to the budget.
2. Validation corpus: known-answer set, correlated-error probe, sycophancy probe.
3. Run `@atlantis/events-postgres` against PostgreSQL 17 with `pg` in CI.
4. Replay driver that re-executes a recorded history against deterministic fixtures.
5. Identity and tenant context, then the governed conversation vertical slice.

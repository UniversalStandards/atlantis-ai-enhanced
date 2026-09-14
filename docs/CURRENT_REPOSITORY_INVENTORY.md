# ATLANTIS Current Repository Inventory

## Scope and evidence baseline

This inventory closes the stale foundational classification requirement from Issue #1 against canonical sprint ancestry `605ed1a47782214f4513b1232fb4136c180f384b`. It is intentionally documentation/evidence only. It does not select a provider, credential, deployment target, repository setting, security-sensitive permission, persistence backend, or irreversible architecture decision.

The current root is a small pnpm/TypeScript workspace. Root `package.json` pins `pnpm@10.14.0`, exposes recursive `typecheck` and `test` commands, and defines release-control evidence/enforcement scripts. The implementation is concentrated in two packages: `packages/contracts` and `packages/event-store`, with governance, architecture records, runbooks, CI, and operational evidence under `.github`, `docs`, and `scripts`.

## Current-state architecture map

| Surface | Current paths | Current role | Classification |
| --- | --- | --- | --- |
| Cross-system contracts | `packages/contracts/src/**`, `packages/contracts/test/**` | Provider-neutral schemas, approval/control boundaries, execution/event contracts, benchmark/authorization evidence contracts | **Retain** |
| Durable execution and evidence | `packages/event-store/src/**`, `packages/event-store/src/__tests__/**` | Resumable execution, event-store semantics, recovery/fencing, release-readiness evidence, conformance adapters | **Retain** |
| Workspace/package control | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json` | Reproducible TypeScript workspace and frozen dependency graph | **Retain** |
| Repository AI operating rules | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/**`, `.github/prompts/**` | Cross-agent rules, bounded work-packet delegation, blocker escalation, safety/governance constraints | **Retain** |
| CI and conformance | `.github/workflows/contracts.yml`, `.github/workflows/universal-standards-conformance.yml`, `scripts/**` | Frozen-lockfile/typecheck/test/security/release-control and upstream-standard evidence | **Retain** |
| Architecture decisions/evidence | `docs/architecture/**`, `docs/decisions/**`, `docs/runbooks/**` | Candidate records, authorization boundaries, durability/release-control decisions, operating procedures | **Retain; reconcile stale status references** |
| Sprint status prose | `docs/IMPLEMENTATION_STATUS.md` and mutable readiness prose | Historical narrative and human-readable roll-up | **Refactor** into current-head-safe summaries; do not use as mutable runtime proof |
| Provider/runtime candidates | authorization/candidate records under `docs/architecture/**` and corresponding contracts | Fail-closed decision preparation without silent provider/runtime selection | **Retain gated** |
| Real-provider benchmark execution | Issue #6 + integrated benchmark contracts/harness | One authorized non-production comparison still required | **Retain gated / unfinished** |
| Operational self-improvement run | Issue #7 + integrated admission/conformance gate | One authorized isolated-development run ending at `awaiting-human-review` still required | **Retain gated / unfinished** |
| `main` governance enforcement | Issue #13, `docs/MAIN_RELEASE_CONTROL.md`, release-control scripts | Repository-side policy/evidence is prepared; live server-side protection is not yet proven active | **Retain plan; unfinished enforcement** |
| Legacy/superseded focused PR ancestry | closed historical PRs/branches referenced by sprint records | Evidence/reference only after current-head replacement landed | **Archive as historical evidence; do not reactivate without fresh regression** |

## What the repository actually contains today

### Contracts layer

`packages/contracts/src` contains the provider-neutral and governance-facing boundaries that application/runtime implementations consume. Current source paths include approval control, durable append outcomes, execution control/event types, external-effect execution/ownership evidence, candidate-authorization contracts, Day-7 evidence, and related validation surfaces. These are the correct stable boundary layer and should remain the primary location for public cross-package semantics.

**Decision: RETAIN.** Do not fork provider-specific or persistence-specific public contracts beside these interfaces. Extend them only when a new independently verified invariant cannot be represented by the existing contracts.

### Event-store / execution layer

`packages/event-store/src` contains the concrete governed execution/evidence machinery: abortable execution writing, browser/content observer conformance, canonical evidence helpers, Day-7 operational/release-readiness evidence, execution commit guards, durability/recovery machinery, benchmark and self-improvement support, plus a substantial first-party test suite under `src/__tests__`.

**Decision: RETAIN.** This package is the current authoritative execution/durability integration surface. New persistence, retry, timeout, terminal, or external-effect work must reuse its existing consistency/fencing/recovery contracts rather than creating parallel stores or authority paths.

### Applications and entry points

There is no separate user-facing application directory at the canonical root. The current sprint is therefore primarily a governed platform/runtime and evidence baseline rather than a completed standalone product UI.

**Decision: REFACTOR/BUILD ON TOP, not replace.** Future app surfaces should consume the contracts/runtime packages rather than moving their semantics into UI code. Issue #3 remains the natural vertical-slice boundary for a complete sign-in → conversation → streamed response → policy-gated tool → audit/deletion experience.

### Provider adapters

The repository contains provider-neutral authorization/evidence contracts and benchmark preparation, but the remaining Issue #6 acceptance criterion explicitly requires one authorized non-production real-provider comparison. No real-provider choice is made by this inventory.

**Decision: RETAIN GATED.** Keep adapter-specific objects behind provider boundaries and execute the real-provider comparison only after explicit credential/network/spend/timeout/retry/retention/teardown authorization.

### Memory, persistence, and artifacts

Durability and event-store semantics are strongly represented in `packages/event-store` and architecture evidence under `docs/architecture`. Concrete external persistence/artifact-provider choices remain separately approval-bound.

**Decision: RETAIN contracts and reference implementations; keep concrete external backends gated.** Do not treat in-memory/reference evidence as proof of external operational durability.

### Tool, MCP, browser, and external-effect surfaces

The current tree contains browser candidate/evidence material, external-effect execution/ownership contracts, and conformance helpers. These establish authorization and fail-closed boundaries but do not imply universal exactly-once behavior or production browser/tool authority.

**Decision: RETAIN GATED.** Operational adapters must prove idempotency/fencing/reconciliation appropriate to their actual external effect before promotion.

### Identity, authorization, approval, and policy

Approval and execution-control contracts are first-class in `packages/contracts`; repository AI rules in `AGENTS.md` and `.github/copilot-instructions.md` further prohibit silent authority expansion, self-approval, bypass, and uncontrolled provider/deployment choice.

**Decision: RETAIN.** These are architectural invariants, not optional implementation details.

### Tests, evaluations, and conformance

The repo uses Vitest, recursive package tests/typechecks, exact-head CI, Universal Standards conformance, CodeQL, Socket, and repository release-control evidence. Existing sprint evidence has repeatedly validated these surfaces.

**Decision: RETAIN AND EXPAND ONLY AT BEHAVIORAL BOUNDARIES.** Reuse existing validators/failure-injection harnesses instead of manufacturing duplicate containment-only tests.

### Deployment and release control

Repository-side release-control evidence and documentation exist, but live `main` protection remains a distinct server-side governance gate tracked by Issue #13. Deployment/rollback and burn-in evidence remain separately operational rather than being inferred from documentation.

**Decision: RETAIN PLAN; COMPLETE AUTHORITY-GATED ENFORCEMENT.** Documentation is not equivalent to repository settings or a successful deployment rehearsal.

## Dependency, version, security, and secret-handling assessment

1. **Dependency surface is intentionally small.** Root development dependencies are TypeScript `^5.9.0` and Vitest `^3.2.0`, with pnpm `10.14.0` pinned and a committed lockfile. This is favorable for auditability and should not be widened without operational value.
2. **Frozen-lockfile CI is a release invariant.** Keep dependency changes isolated and evidence-backed; do not regenerate the lockfile incidentally during unrelated work.
3. **Security scanning is already part of the delivery contract.** CodeQL, Socket, SEC-20/source-integrity checks, typecheck, tests, and Universal Standards conformance should remain exact-head evidence for integration.
4. **Secrets are explicitly prohibited from prompts, logs, source, browser bundles, fixtures, and snapshots by repository instructions.** Concrete provider/runtime credentials remain an authority gate and must not be introduced by documentation or test fixtures.
5. **Primary governance risk is not missing prose; it is live enforcement.** `main` server-side protection must be independently proven active before release claims are upgraded.
6. **Primary operational evidence risk is over-claiming reference/conformance results.** Real provider, external persistence/artifact, browser/runtime, deployment/rollback, and burn-in evidence must remain distinguishable from deterministic/reference harness results.

## Retain / refactor / replace / archive summary

### Retain
- `packages/contracts/**`
- `packages/event-store/**`
- root pnpm/TypeScript workspace and frozen lockfile
- exact-head CI/security/conformance workflows
- `AGENTS.md` and Copilot/repository instruction surfaces
- current ADRs, architecture candidate records, runbooks, failure-injection and release evidence harnesses

### Refactor
- stale human-readable implementation/status documents so they cannot be mistaken for current-head proof
- any future application layer to consume stable contracts/runtime packages rather than duplicate their semantics
- older architecture prose when a newer accepted ADR supersedes it; retain history but clearly mark supersession

### Replace
No current canonical runtime component is identified for immediate replacement solely by this inventory. Replacement should be issue-driven and supported by a demonstrated defect, obsolete dependency, security failure, or accepted ADR—not by age alone.

### Archive
- superseded candidate PRs/branches and obsolete implementation paths once equivalent or stronger behavior is proven on current canonical ancestry
- stale SWARM-era classification material that does not describe the current ATLANTIS tree
- duplicated status/proposal prose after its durable rule has been promoted to canonical instructions/ADR/runbook/test/policy evidence

## Already completed versus genuinely unfinished

### Completed / do not recreate
- completed-step replay/stale-checkpoint recovery
- timeout late-consequential-effect fencing
- terminal/checkpoint crash consistency and terminal result restoration
- retry-consumption crash consistency
- provider-neutral benchmark cases/scorecards/bounded refinement/comparison-report infrastructure
- provider-neutral operational-adapter admission/conformance gate for self-improvement
- current-ancestry repository-side `main` release-control plan/evidence probe
- bounded-work-packet and aggressive safe coding-agent delegation rules

### Unfinished / real remaining boundaries
- Issue #13: live bypass-resistant server-side `main` protection/enforcement proof
- Issue #6: one explicitly authorized non-production real-provider/model comparison
- Issue #7: one explicitly authorized isolated-development operational run ending at mandatory human review
- concrete external persistence/artifact/browser/runtime evidence where separately approval-bound
- governed deployment reproduction, rollback rehearsal, and non-vacuous burn-in before claiming operational release completeness
- Issue #3 user-facing governed conversation vertical slice if Day-7 scope still requires a complete product path rather than platform-only readiness

## Shortest safe migration / closure sequence

1. **Close this inventory packet and reconcile Issue #1** if independent review confirms the path-grounded classification is truthful.
2. **Do not reopen already-completed durability P1s** absent a current-head regression.
3. **Complete Governance #13** through an authorized repository-settings-capable path; independently prove PR-only integration, distinct approval, exact `validate`, and no applicable bypass.
4. **Execute Issue #6 once** under explicitly approved non-production provider/network/credential/spend/retention/teardown bounds; preserve immutable benchmark evidence.
5. **Execute Issue #7 once** against an explicitly approved immutable base/runtime/network/credential posture and stop at `awaiting-human-review`.
6. **Reconcile product-surface scope.** If the Day-7 contract requires a user-facing vertical slice, decompose Issue #3 into bounded app/auth/conversation/tool/audit work packets that consume the existing contracts/runtime rather than duplicating them.
7. **Only then perform authority-gated deployment/rollback/burn-in evidence** and release through the protected `main` gate.

## Issue #1 closure recommendation

**Recommend CLOSE after this focused PR is independently verified and integrated.** The repository inventory, classification matrix, security/dependency assessment, and shortest-safe closure sequence are then satisfied against current canonical ancestry. Remaining work belongs to its dedicated issues/gates and should not keep the inventory issue artificially open.

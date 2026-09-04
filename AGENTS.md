# AGENTS.md

## Upstream reusable standard

This repository adopts `UniversalStandards/UniversalStandards` as the canonical upstream reusable AI engineering standard. Local ATLANTIS rules may strengthen that standard but must not silently weaken it. The adopted upstream commit is recorded in `.universal-standards.json`.

## Purpose

This repository contains ATLANTIS AI, a civilian-first, provider-independent AI operating platform. All automated contributors must preserve user agency, explicit authorization, provenance, auditability, and reversibility.

## Source of truth

1. GitHub issues define implementation scope and acceptance criteria.
2. `docs/ATLANTIS_MODERNIZATION_PLAN.md` defines the modernization direction.
3. Architecture decision records under `docs/decisions/` define binding technical decisions.
4. Machine-readable schemas and tests override descriptive prose when they disagree.

## Non-negotiable architectural rules

1. No provider-specific object may cross a provider-adapter boundary.
2. Every consequential tool invocation must pass through policy evaluation.
3. Every persistent memory must include provenance, scope, retention, and deletion behavior.
4. Every long-running task must have durable identity, state, retry, cancellation, and audit semantics.
5. Model output and retrieved content are untrusted until validated.
6. Secrets must never appear in prompts, logs, source files, browser bundles, fixtures, or snapshots.
7. Irreversible or externally consequential actions require explicit approval unless a narrowly scoped standing authorization exists.
8. A specialist-agent failure must not corrupt parent task state.
9. All AI behavior changes require evaluation coverage.
10. Civilian accessibility is the default; regulated and government profiles are separate deployment layers.

## Surgical work-unit and Copilot delegation model

1. Default to issue-first decomposition. Break large objectives into independently reviewable issues with one bounded outcome, explicit acceptance criteria, dependencies, rollback notes, and evidence requirements.
2. Use GitHub Copilot/coding agents aggressively for implementation-heavy work that can be delegated safely. Give the agent the same concrete instructions an expert maintainer would follow: canonical repo/ref, exact objective, invariants, files/contracts to reuse, prohibited shortcuts, required tests, and completion evidence.
3. Parent/meta issues coordinate dependency order and release readiness; child issues are the primary progress units. Close child issues as soon as their acceptance criteria are independently verified so project progress reflects actual completed work rather than waiting for a monolithic PR.
4. Prefer one issue → one focused branch → one focused PR. A PR may close a small tightly coupled issue set only when separating them would create artificial sequencing or duplicate validation.
5. Keep PRs intentionally small. Target <= 10 logical commits and <= 25 changed files. Treat > 20 logical commits or > 50 changed files as a decomposition trigger unless an explicit documented exception explains why splitting would be riskier. Generated lockfiles, vendored/generated artifacts, and mechanical migrations may be counted separately but still require bounded review evidence.
6. Do not use a long-lived mega-PR as the primary accumulation branch. Integrate verified surgical PRs into the canonical sprint branch in dependency order, preserving a clear rollback boundary for each completed issue.
7. Before adding work to an existing PR, ask whether the work has independent acceptance criteria. If yes, create/link a separate issue and PR instead of widening the current PR.
8. If a PR becomes materially oversized or diverges, stop widening it. Freeze it as evidence/reference, create fresh surgical issues from current canonical HEAD, and transplant only the proven focused deltas.
9. Agent-generated work is never self-validating. Another execution/review path must inspect diff, ancestry, tests, CI, security evidence, and issue acceptance criteria before integration or closure.
10. Progress reporting should emphasize closed verified issues, integrated focused PRs, remaining dependency edges, and exact release blockers—not raw commit count.

## Capability escalation and blocker handling

1. A limitation of the current connector/tool/API is not automatically a project blocker.
2. Before escalating to a human, search reasonable authorized execution paths: current connector, another authorized connector, GitHub-native agent delegation, workflows/Actions/Apps, CLI/MCP, authorized remote execution, or a reversible automation operating with proper authority.
3. When GitHub-native coding agents may have an execution context unavailable to the initiating connector, create a tightly scoped issue with objective, acceptance evidence, prohibited shortcuts, rollback constraints, and fail-closed instructions; delegate it to the agent and independently verify the result.
4. Prefer delegation before repeated status-only comments when implementation can proceed through an authorized coding agent.
5. Never weaken security, review, approval, identity, audit, policy, or release controls to get around a capability boundary.
6. Never claim alternate authority that has not been verified. If all reasonable authorized paths fail, record the exact missing permission/capability as the blocker.

## Continuous learning propagation

1. Reusable lessons from defects, blocked workflows, incorrect assumptions, or better execution patterns must be promoted from transient conversation context into durable project guidance.
2. Cross-agent standing rules belong in `AGENTS.md`; Copilot-wide repository behavior belongs in `.github/copilot-instructions.md`; specialized rules belong in path-specific instructions; architectural rationale belongs in ADRs; operational procedures belong in runbooks; repeatable work belongs in issue/PR templates, skills, prompts, tests, or automation as appropriate.
3. Prefer one canonical rule with references over multiple drifting copies.
4. A lesson is not considered propagated until future automated contributors can discover it without access to the conversation in which it was learned.
5. Periodically reconcile instructions, ADRs, runbooks, templates, and automation to remove obsolete or contradictory guidance.
6. Portfolio-level lessons must be reviewed for promotion to `UniversalStandards/UniversalStandards`; machine-verifiable lessons should become tests/evaluations/CI/policy-as-code whenever practical.

## Implementation direction

- Preserve the existing Python engine where it provides real value.
- Build the primary application and provider-neutral orchestration contracts in TypeScript.
- Use Python for specialized workers, scientific computing, ML, document processing, or existing validated modules.
- Introduce dependencies only when their operational value exceeds their maintenance cost.
- Do not introduce Kubernetes before workload evidence justifies it.

## Required checks

Before proposing a merge, run the checks supported by the affected workspace, including linting, type checking, unit tests, integration tests, browser tests, security checks, and AI evaluations.

## Change discipline

- Keep changes scoped to the issue being implemented.
- Add or update tests with behavior changes.
- Update architecture documentation when contracts or boundaries change.
- Do not silently preserve obsolete code for compatibility; classify it as retain, refactor, replace, or archive.
- Never weaken policy, approval, identity, or audit controls to make a test pass.
- Prefer surgical PRs and frequent verified issue closure over cumulative mega-PRs.

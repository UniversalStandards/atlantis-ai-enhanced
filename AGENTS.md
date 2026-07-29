# AGENTS.md

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

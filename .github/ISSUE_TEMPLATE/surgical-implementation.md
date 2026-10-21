---
name: Focused implementation work packet
description: Create one coherent bounded implementation packet suitable for focused Copilot/coding-agent execution
title: "IMPLEMENT: "
labels: []
assignees: []
---

## Parent / canonical context
Parent issue:
Canonical repository: `UniversalStandards/atlantis-ai-enhanced`
Canonical branch:
Current verified canonical head:
Related issue/PR dependencies:

## Coherent bounded objective
State one independently verifiable outcome. Keep tightly coupled code, tests, migrations, and documentation together when they share one validation and rollback boundary.

## Why this is a separate work packet
Explain the independent acceptance/rollback boundary and why this work should not widen an existing PR.

## Dependencies
List prerequisites and ordering constraints. Write `None` when independent.

## Non-goals
State what this work packet must not implement.

## Existing contracts / validators / harnesses to reuse
Name existing interfaces, validators, fixtures, tests, conformance harnesses, or failure-injection utilities that should be reused rather than duplicated.

## Required invariants
- Preserve existing security, policy, identity, approval, audit, and release controls.
- Preserve current canonical behavior outside this bounded objective.
- Do not create a parallel authority/persistence path merely to satisfy tests.
- Do not silently select providers, credentials, irreversible semantics, security-sensitive permissions, or deployment authority.

## Acceptance criteria
- [ ] Live canonical state inspected before implementation.
- [ ] Implementation starts from current canonical ancestry.
- [ ] Smallest coherent safe reversible implementation completed.
- [ ] Existing contracts/validators/harnesses reused where applicable.
- [ ] Behavior change covered by focused tests/failure injection as applicable.
- [ ] Required lint/typecheck/unit/integration/conformance/security checks pass.
- [ ] Focused PR links this work packet and contains no unrelated objective.
- [ ] Diff and ancestry are independently reviewed.
- [ ] Parent sprint/meta issue is updated with evidence.
- [ ] Work packet closes only after acceptance evidence is verified on intended integration ancestry.

## PR reviewability budget
Planning target: roughly <=10 logical commits and <=25 changed files.
Decomposition review trigger: roughly >20 logical commits or >50 changed files. This is not an automatic rejection. If the PR remains larger, document why splitting would increase coupling, invalidate meaningful testing, or make rollback less safe.

## Copilot / coding-agent execution instructions
Inspect live canonical state first. Implement only this coherent bounded objective. Use the current canonical branch/head rather than stale candidate ancestry. Reuse the named existing contracts and validators. Keep the PR focused, but do not create artificial micro-PRs that weaken validation or rollback. Run and report the required evidence. If the task reaches an unresolved architecture, credential, provider, permission, deployment, or irreversible-decision boundary, stop only that dependent mutation, record the exact decision required, and continue any safe independent preparation within this work packet. Do not merge or self-approve.

## Evidence
Commit(s):
PR:
Tests/checks:
Security evidence:
Canonical-head verification:

## Rollback
Describe the smallest reliable rollback boundary for this work packet.

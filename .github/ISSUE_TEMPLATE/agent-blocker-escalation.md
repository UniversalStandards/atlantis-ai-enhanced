---
name: Agent blocker escalation
description: Delegate an authorized blocker to a platform coding agent without weakening controls
title: "BLOCKER: "
labels: []
assignees: []
---

## Canonical context
Repository:
Branch:
Parent issue/project:
Related PR:
Current verified head:

## Coherent bounded objective
State one independently verifiable outcome blocked through the initiating execution path. If the blocker contains multiple independent outcomes, create separate bounded work packets instead of widening this issue.

## Current execution-path limitation
Describe the connector/tool/API limitation. Do not equate this limitation with an objective-level blocker until alternate authorized paths are checked.

## Required target state
Define the exact resulting state.

## Existing contracts / validators / harnesses to reuse
Name existing interfaces, validators, fixtures, tests, conformance harnesses, or failure-injection utilities. Avoid duplicate containment-only machinery.

## Dependencies and non-goals
List prerequisites, ordering constraints, and what must not be changed.

## Acceptance evidence
- [ ] Live canonical state inspected before modification.
- [ ] Work starts from current canonical ancestry.
- [ ] Smallest coherent safe reversible implementation used.
- [ ] Existing contracts/validators/harnesses reused where applicable.
- [ ] Required tests/checks are green.
- [ ] Security/policy/review controls are not weakened.
- [ ] Focused PR produced rather than widening an unrelated mega-PR.
- [ ] Resulting code/state independently verifiable.
- [ ] Canonical project records reconciled.

## PR reviewability
Aim for a focused reviewable PR. Rough planning target: <=10 logical commits and <=25 changed files. Crossing roughly 20 logical commits or 50 changed files triggers decomposition review, not automatic rejection; document why splitting would be less safe when keeping a larger change intact.

## Prohibited shortcuts
Do not bypass approval, review, identity, security, audit, release, or policy controls. Do not fabricate authority or evidence. Do not create parallel authority/persistence mechanisms merely to make tests pass. Do not mark complete based only on an agent statement.

## Alternate authorized paths to consider
Current connector → other authorized connector → platform-native Copilot/coding agent → workflows/Actions/Apps → CLI/MCP → authorized remote execution → reversible automation with proper credentials → human escalation.

## Agent execution request
Inspect current canonical state first. Prefer GitHub Copilot/coding-agent execution for implementation-heavy work that is safe to delegate. Implement only this bounded objective using the safest authorized path available, produce a focused linked PR, and report exact verification evidence. If required authority is unavailable, stop only the dependent mutation, fail closed on that boundary, report the exact missing permission/capability, and continue safe independent preparation. Do not merge or self-approve.

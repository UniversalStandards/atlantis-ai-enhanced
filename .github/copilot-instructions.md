# ATLANTIS Repository-Wide AI Instructions

## Upstream reusable standard

This repository adopts `UniversalStandards/UniversalStandards` as the canonical upstream reusable AI engineering standard. The pinned upstream commit is recorded in `.universal-standards.json`. Local ATLANTIS requirements may strengthen upstream controls but must not silently weaken them.

## Default execution model: decompose, delegate, verify

For implementation-heavy work, do not accumulate unrelated changes into a large long-lived PR. Start by decomposing the objective into surgical GitHub issues that can be completed and verified independently.

Default flow:

1. inspect live canonical state and dependency order;
2. create/link a bounded issue for each independently verifiable outcome;
3. delegate safe implementation-heavy issues to GitHub Copilot/coding agents when available and useful;
4. give each agent exact canonical ref, objective, acceptance criteria, invariants, prohibited shortcuts, contracts/validators to reuse, and required evidence;
5. prefer one issue → one focused branch → one focused PR;
6. independently review agent output, ancestry, tests, CI, security evidence, and acceptance criteria;
7. integrate verified focused PRs in dependency order;
8. close verified child issues promptly so progress is visible continuously;
9. keep parent/meta issues as coordination and release-readiness views, not as containers for hundreds of implementation commits.

### PR size discipline

Target <= 10 logical commits and <= 25 changed files per focused PR. More than 20 logical commits or more than 50 changed files is a decomposition trigger unless a documented exception shows splitting would increase risk. Generated artifacts and mechanical migrations may be counted separately but still require bounded review evidence.

If an existing PR becomes oversized, highly divergent, or contains multiple independently testable objectives, stop widening it. Preserve it as reference/evidence, create fresh surgical issues from current canonical HEAD, and transplant only focused proven deltas. Do not keep stacking fixes onto a mega-PR merely because it already exists.

## Capability-escalation rule

A limitation of the currently selected connector, API wrapper, tool, or execution surface is not automatically a project blocker.

When an authorized task cannot be completed through the current execution path, automated contributors MUST search the available authorized execution surface before escalating to a human. Evaluate, as applicable:

1. direct repository/API actions exposed by the current connector;
2. another already-authorized connector or GitHub-native capability;
3. a tightly scoped GitHub issue delegated to Copilot/coding agent when the agent may have an execution context unavailable to the initiating connector;
4. repository workflows, Actions, GitHub Apps, CLI, MCP, or an authorized remote execution environment;
5. a reversible repository-side automation or script that can perform the operation under appropriate credentials;
6. human intervention only after reasonable authorized paths have been tested or shown incapable.

Prefer a concrete delegated implementation issue over repeated status-only comments when Copilot/coding agents can perform the heavy lifting safely.

Never weaken security, policy, approval, review, identity, audit, or release controls merely to bypass a capability limitation. Never fabricate authority. If an alternate path lacks permission, fail closed and record the exact missing capability.

## Agent-delegation pattern

For work delegated through an issue:

- define one bounded objective and canonical repository/branch/parent-issue context;
- identify dependencies and the exact current canonical head to start from;
- state exact acceptance criteria and evidence required;
- state architectural/security invariants that must remain unchanged;
- name existing contracts, validators, harnesses, fixtures, or tests to reuse;
- state prohibited shortcuts, including creating parallel authority/persistence paths merely to make tests pass;
- require the agent to inspect current state before changing anything;
- require the smallest safe reversible change;
- require tests/CI/security/release evidence appropriate to the change;
- require a focused PR linked to the issue rather than adding unrelated work to an existing mega-PR;
- require reconciliation of the canonical project/sprint records;
- require fail-closed reporting when authority is insufficient;
- independently verify the agent's result before considering the issue resolved.

An issue assignment, agent statement, commit count, or passing candidate-branch check is not completion evidence by itself. Completion requires verified acceptance criteria on the intended integration ancestry.

## Progress accounting

Use issue closure as the primary unit of visible delivery progress. Parent sprint issues should track child issues and dependency edges so completed work is reflected immediately. Report integrated focused PRs, closed child issues, exact CI/security evidence, and remaining blockers. Raw commit count is not a useful progress metric.

## Learning propagation

When a project uncovers a reusable process failure or a materially better execution pattern, treat the lesson as a reusable engineering control rather than one-off chat context. Update the appropriate durable instruction/decision/runbook/template sources so future agents inherit it automatically.

Portfolio-level lessons must be reviewed for promotion to `UniversalStandards/UniversalStandards`. Machine-verifiable lessons should become tests, evaluations, CI, policy evidence, or bootstrap conformance checks whenever practical.

The canonical operational procedure and propagation matrix are in `docs/runbooks/CAPABILITY_ESCALATION_AND_LEARNING_PROPAGATION.md`. The architectural rationale for surgical work units is in `docs/decisions/ADR-SURGICAL-WORK-UNITS-AND-AGENT-DELEGATION.md`. Use `.github/ISSUE_TEMPLATE/agent-blocker-escalation.md` for blocked delegated handoffs and `.github/ISSUE_TEMPLATE/surgical-implementation.md` for ordinary implementation slices.

Avoid duplicating contradictory copies. Maintain one canonical operational rule and reference it from narrower documents when practical.

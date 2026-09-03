# ATLANTIS Repository-Wide AI Instructions

## Capability-escalation rule

A limitation of the currently selected connector, API wrapper, tool, or execution surface is not automatically a project blocker.

When an authorized task cannot be completed through the current execution path, automated contributors MUST search the available authorized execution surface before escalating to a human. Evaluate, as applicable:

1. direct repository/API actions exposed by the current connector;
2. another already-authorized connector or GitHub-native capability;
3. a tightly scoped GitHub issue delegated to Copilot/coding agent when the agent may have an execution context unavailable to the initiating connector;
4. repository workflows, Actions, GitHub Apps, CLI, MCP, or an authorized remote execution environment;
5. a reversible repository-side automation or script that can perform the operation under appropriate credentials;
6. human intervention only after reasonable authorized paths have been tested or shown incapable.

Never weaken security, policy, approval, review, identity, audit, or release controls merely to bypass a capability limitation. Never fabricate authority. If an alternate path lacks permission, fail closed and record the exact missing capability.

## Agent-delegation pattern

For work delegated through an issue:

- define the objective and canonical repository/branch/PR context;
- state exact acceptance criteria and evidence required;
- state prohibited shortcuts and security invariants;
- require the agent to inspect current state before changing anything;
- require the smallest safe reversible change;
- require tests/CI/security/release evidence appropriate to the change;
- require reconciliation of the canonical project/sprint records;
- require fail-closed reporting when authority is insufficient;
- independently verify the agent's result before considering the blocker resolved.

An issue assignment or agent claim is not completion evidence by itself.

## Learning propagation

When a project uncovers a reusable process failure or a materially better execution pattern, treat the lesson as a reusable engineering control rather than one-off chat context. Update the appropriate durable instruction/decision/runbook/template sources so future agents inherit it automatically. Prefer shared instructions for cross-agent rules, repository instructions for repository-specific rules, path-specific instructions for specialized areas, and ADR/runbook documentation for rationale and operational procedure.

Avoid duplicating contradictory copies. Maintain one canonical rule and reference it from narrower documents when practical.

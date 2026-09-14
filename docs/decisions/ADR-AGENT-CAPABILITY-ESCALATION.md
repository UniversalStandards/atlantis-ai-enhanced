# ADR: Authorized Capability Escalation Before Declaring a Blocker

## Status
Accepted

## Context
An automated contributor may encounter a connector or API surface that exposes only part of the authority needed to complete an otherwise authorized objective. Treating the current interface boundary as the project boundary creates unnecessary human escalation and repeated rediscovery.

## Decision
ATLANTIS contributors must distinguish an execution-path limitation from an objective-level blocker. Before declaring an objective blocked, they must inspect reasonable alternate authorized execution paths. These can include other connectors, platform-native coding agents delegated through scoped issues, workflows/Actions/Apps, CLI/MCP, authorized remote environments, and reversible automation operating with legitimate credentials.

Alternate execution must preserve authorization and fail-closed behavior. No alternate path may weaken security, approval, review, identity, audit, policy, or release controls.

Agent delegation is a handoff mechanism, not completion evidence. Results require independent verification.

Reusable lessons discovered during execution must be propagated into durable instructions, ADRs, runbooks, templates, tests/evaluations, or enforceable automation according to scope.

## Consequences
- Fewer false blockers caused by individual tool limitations.
- Less repeated manual problem solving across projects.
- Better use of heterogeneous agent/tool capabilities.
- Additional responsibility to verify alternate authority and resulting evidence.
- Durable guidance must be maintained to prevent contradictory instructions.

## Implementation references
- `AGENTS.md`
- `.github/copilot-instructions.md`
- `docs/runbooks/CAPABILITY_ESCALATION_AND_LEARNING_PROPAGATION.md`
- `.github/ISSUE_TEMPLATE/agent-blocker-escalation.md`

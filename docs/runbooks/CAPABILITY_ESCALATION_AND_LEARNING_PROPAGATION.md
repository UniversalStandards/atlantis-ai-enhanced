# Capability Escalation and Learning Propagation Runbook

## Purpose
Prevent projects from repeatedly rediscovering solutions when a connector, agent, API, or execution surface cannot directly complete an authorized task.

## Core rule
A blocked execution path is not automatically a blocked objective. Search the authorized capability graph before escalating to a human.

## Escalation ladder
1. Reverify the current connector and permissions.
2. Inspect other already-authorized connectors/tools.
3. Inspect native platform capabilities, including GitHub coding-agent delegation through a scoped issue.
4. Inspect workflows, Actions, Apps, CLI, MCP, and authorized remote execution.
5. Consider a small reversible automation/script using legitimate credentials.
6. Escalate to a human only when the remaining gap is a real permission, approval, credential, physical, legal, or policy boundary.

## GitHub issue-to-agent handoff
A delegated issue must contain:
- canonical repo/branch/issue/PR context;
- one bounded objective;
- exact acceptance criteria;
- required tests/security/evidence;
- prohibited shortcuts;
- rollback/reversibility requirements;
- instruction to inspect live state first;
- instruction to fail closed on insufficient authority;
- instruction to reconcile canonical records.

Assignment is not proof. Independently verify resulting commits, settings, CI, security checks, reviews, traces, and repository state before closing the blocker.

## Learning propagation decision
After any meaningful shortfall or improvement, classify the lesson:

| Lesson scope | Durable destination |
| --- | --- |
| Cross-agent/project behavior | `AGENTS.md` or shared standards repo |
| Copilot repository-wide behavior | `.github/copilot-instructions.md` |
| File/path-specific behavior | `.github/instructions/*.instructions.md` |
| Architecture invariant/rationale | `docs/decisions/` ADR |
| Operational procedure | `docs/runbooks/` |
| Repeatable task invocation | prompt/skill/template |
| Regression-preventable behavior | automated test/evaluation |
| Enforceable policy | CI/ruleset/policy-as-code |
| Sprint-specific evidence | canonical issue/PR/readiness record |

## Promotion rule
A lesson should move upward in durability when it is reusable. Chat history is evidence of discovery, not the final storage location.

## New-project bootstrap
Every new ATLANTIS-connected repository should bootstrap, at minimum:
1. `AGENTS.md` with shared agent rules.
2. `.github/copilot-instructions.md` with repository-wide Copilot behavior.
3. architecture decisions directory.
4. operational runbooks directory.
5. issue/PR templates that require acceptance evidence and blocker escalation.
6. CI checks that enforce machine-verifiable invariants.
7. a project status/readiness record identifying canonical sources of truth.

## Review cadence
At sprint boundaries and after material incidents, reconcile durable guidance. Remove contradictions, retire obsolete instructions, promote repeated manual checks into automation, and ensure the canonical rule is referenced by narrower guidance rather than copied inconsistently.

## Completion test
Propagation is complete only when a newly launched agent/project can discover the lesson from durable sources without needing the original conversation.

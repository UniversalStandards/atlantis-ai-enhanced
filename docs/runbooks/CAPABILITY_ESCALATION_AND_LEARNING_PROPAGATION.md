# Capability Escalation and Learning Propagation Runbook

## Purpose
Prevent projects from repeatedly rediscovering solutions when a connector, agent, API, or execution surface cannot directly complete an authorized task, while keeping implementation sliced into bounded independently verifiable work packets.

## Core rule
A blocked execution path is not automatically a blocked objective. Search the authorized capability graph before escalating to a human. When implementation can proceed safely, prefer a delegated bounded work packet over repeated status-only commentary.

## Default work decomposition procedure
1. Inspect current canonical branch/head, open issues, PRs, CI, reviews, and dependency edges.
2. Identify outcomes that have independent acceptance and rollback boundaries.
3. Create one bounded child issue/work packet per independently verifiable outcome. Do not split tightly coupled changes into artificial micro-issues when that would make testing or rollback less reliable.
4. Link each work packet to the parent sprint/meta issue and record dependencies explicitly; do not serialize independent work unnecessarily.
5. For implementation-heavy work packets, delegate to GitHub Copilot/coding agents when an authorized agent can perform the work safely.
6. Require delegated work to start from current canonical ancestry rather than a stale candidate branch.
7. Prefer one coherent work packet → one focused branch → one focused PR. A focused PR may close a small tightly coupled issue set when it shares one validation/rollback boundary.
8. Independently verify diff, ancestry, tests, CI/security, and acceptance criteria.
9. Integrate verified focused PRs into `sprint/7-day-operational-alpha` in dependency order and close child issues/work packets promptly after evidence is complete.
10. Treat PR #10 as the release/integration PR toward `main`, not as the default accumulation point for unrelated implementation work.
11. Update parent sprint progress from closed verified work packets and remaining dependency edges.

## PR reviewability guardrails
- Planning heuristic: aim for roughly <=10 logical commits and <=25 changed files in a focused PR.
- Decomposition review trigger: roughly >20 logical commits or >50 changed files. This is not an automatic rejection; document why a larger PR remains safer when keeping the change intact.
- Generated artifacts, lockfiles, vendored files, or mechanical migrations may be counted separately, but their generated/mechanical nature must be stated and review evidence must remain bounded.
- Never widen an existing PR merely because it is already open. New independent acceptance/rollback boundaries normally mean a new work packet and focused PR.
- If a PR becomes a mega-PR or badly diverges, freeze it as reference evidence, derive fresh bounded work packets from current canonical HEAD, and transplant only proven focused deltas.
- Do not use raw commit count as progress. Use closed verified issues/work packets and integrated focused PRs.

## Escalation ladder
1. Reverify the current connector and permissions.
2. Inspect other already-authorized connectors/tools.
3. Inspect native platform capabilities, including GitHub coding-agent delegation through a scoped issue.
4. Inspect workflows, Actions, Apps, CLI, MCP, and authorized remote execution.
5. Consider a small reversible automation/script using legitimate credentials.
6. Escalate to a human only when the remaining gap is a real permission, approval, credential, physical, legal, or policy boundary.

## GitHub issue-to-agent handoff
A delegated issue must contain:
- canonical repo/branch/parent issue context;
- current verified canonical head and instruction to refresh/rebase from it before implementation;
- one coherent bounded objective;
- dependencies and explicit non-goals;
- exact acceptance criteria;
- existing contracts/validators/tests/harnesses to reuse;
- required tests/security/evidence;
- architectural/security invariants that must not change;
- prohibited shortcuts;
- rollback/reversibility requirements;
- instruction to inspect live state first;
- instruction to produce a focused linked PR;
- instruction to fail closed on insufficient authority;
- instruction to reconcile canonical records.

Assignment is not proof. Independently verify resulting commits, ancestry, settings, CI, security checks, reviews, traces, and repository state before closing the child issue/work packet.

## Parallelism rule
Independent bounded work packets may be delegated concurrently when they do not mutate the same authority boundary or create unsafe merge ordering. Use dependency links and canonical-head refresh instructions to prevent stale ancestry. Integrate one verified slice at a time and require later candidates to refresh onto the new canonical head before integration.

## Architecture-gate handling
A major architecture decision blocks only the mutation that depends on that unresolved choice. Continue provider-neutral contracts, deterministic conformance/failure-injection harnesses, reference/in-memory implementations for contract verification, ADR alternatives, reversible feature-gated scaffolding, CI/review/docs work, and independent bounded work packets. Do not silently select providers, credentials, irreversible semantics, security-sensitive permissions, or deployment authority.

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
5. issue/PR templates that require acceptance evidence, bounded scope, and blocker escalation.
6. CI checks that enforce machine-verifiable invariants.
7. a project status/readiness record identifying canonical sources of truth and child-work progress.

## Review cadence
At sprint boundaries and after material incidents, reconcile durable guidance. Remove contradictions, retire obsolete instructions, promote repeated manual checks into automation, ensure oversized open PRs are decomposed where practical, and ensure the canonical rule is referenced by narrower guidance rather than copied inconsistently.

## Completion test
Propagation is complete only when a newly launched agent/project can discover the lesson from durable sources without needing the original conversation.

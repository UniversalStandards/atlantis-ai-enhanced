# New Project AI Bootstrap Standard

Every new ATLANTIS-connected project should inherit the following baseline before substantive implementation begins.

## Required durable context
1. `AGENTS.md` — cross-agent non-negotiables, capability escalation, learning propagation.
2. `.github/copilot-instructions.md` — repository-wide Copilot instructions.
3. `.github/instructions/` — path-specific instructions where specialized behavior is needed.
4. `docs/decisions/` — architectural decision records.
5. `docs/runbooks/` — operational procedures and recovery/escalation flows.
6. issue/PR templates — objective, acceptance evidence, security constraints, rollback, and canonical record reconciliation.
7. tests/evaluations/CI — machine enforcement for rules that can be verified automatically.
8. canonical status/readiness record — current evidence, blockers, decisions, and next action.

## Required blocker behavior
A tool limitation must trigger capability discovery rather than immediate human escalation. The project must follow `docs/runbooks/CAPABILITY_ESCALATION_AND_LEARNING_PROPAGATION.md`.

## Required learning loop
Discover → classify → correct → verify → propagate → enforce where possible → reconcile canonical records.

A reusable lesson must not remain only in chat history. Promote it to the narrowest durable source that reliably reaches future contributors, and promote repeated manual safeguards into tests, CI, policy-as-code, templates, or automation when practical.

## Drift control
Prefer references to canonical guidance rather than copying full rules into many files. Review the bootstrap set at project initialization, sprint boundaries, and after material incidents or process failures.

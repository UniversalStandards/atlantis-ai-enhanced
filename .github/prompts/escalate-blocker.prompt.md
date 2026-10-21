# Escalate an execution-path blocker

Inspect the live project state and distinguish the current execution-path limitation from an objective-level blocker.

1. Reverify the initiating tool/connector permissions.
2. Search reasonable alternate authorized execution paths described in `docs/runbooks/CAPABILITY_ESCALATION_AND_LEARNING_PROPAGATION.md`.
3. If GitHub coding-agent delegation is appropriate, prepare/use `.github/ISSUE_TEMPLATE/agent-blocker-escalation.md` with exact acceptance evidence and prohibited shortcuts.
4. Never weaken security, policy, approval, review, identity, audit, or release controls.
5. Make the smallest safe reversible correction available.
6. Independently verify the resulting code/settings/CI/security state.
7. Reconcile the canonical project records.
8. If still blocked, report only the exact remaining permission/capability boundary and the authorized path needed to clear it.

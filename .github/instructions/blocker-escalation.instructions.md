---
applyTo: "**"
---

# Blocker escalation

Before describing an authorized objective as blocked because one connector/tool/API cannot perform it, inspect reasonable alternate authorized execution paths. Consider GitHub-native coding-agent issue delegation, workflows/Actions/Apps, other connected tools, CLI/MCP, authorized remote execution, and reversible automation with legitimate credentials.

Do not weaken security, approval, review, identity, audit, policy, or release controls. Do not fabricate authority. If alternate paths cannot perform the operation, identify the exact missing permission/capability.

For delegated blockers, use `.github/ISSUE_TEMPLATE/agent-blocker-escalation.md` and independently verify the result. For the full procedure, follow `docs/runbooks/CAPABILITY_ESCALATION_AND_LEARNING_PROPAGATION.md`.

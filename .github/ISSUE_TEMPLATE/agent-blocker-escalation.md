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

## Objective
State one bounded outcome that is blocked through the initiating execution path.

## Current execution-path limitation
Describe the connector/tool/API limitation. Do not equate this limitation with an objective-level blocker until alternate authorized paths are checked.

## Required target state
Define the exact resulting state.

## Acceptance evidence
- [ ] Live state inspected before modification.
- [ ] Smallest safe reversible implementation used.
- [ ] Required tests/checks are green.
- [ ] Security/policy/review controls are not weakened.
- [ ] Resulting settings/code/state independently verifiable.
- [ ] Canonical project records reconciled.

## Prohibited shortcuts
Do not bypass approval, review, identity, security, audit, release, or policy controls. Do not fabricate authority or evidence. Do not mark complete based only on an agent statement.

## Alternate authorized paths to consider
Current connector → other authorized connector → platform-native coding agent → workflows/Actions/Apps → CLI/MCP → authorized remote execution → reversible automation with proper credentials → human escalation.

## Agent execution request
Inspect current state first. Implement the objective using the safest authorized path available. If required authority is unavailable, stop fail-closed and report the exact missing permission/capability. Record exact verification evidence before requesting closure.

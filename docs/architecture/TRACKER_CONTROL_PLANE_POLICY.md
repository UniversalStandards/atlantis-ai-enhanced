# Tracker Control Plane Policy

## Status

Provider-neutral control-plane policy contract for issue #50. This packet defines typed authority, projection classification, drift routing, and incident metadata rules without selecting credentials, external persistence, notification delivery, deployment authority, GitHub settings authority, or merge authority.

## Goal

Make Tracker Sync authority boundaries and drift handling explicit so control-plane records cannot be projected as ordinary program work and drift outcomes fail closed when authority or classification is ambiguous.

## Policy surface

This packet is intentionally limited to:

1. typed role descriptors for Tracker Sync, Coding Agent, Release, Deployment, and Repository Admin;
2. executable projection classification rules for `program-work`, `release-control`, `automation-control`, `security-incident`, and `excluded`;
3. executable drift routing rules for safe reconciliation, human review, and blocked outcomes;
4. incident metadata validation for severity, owner, SLA, escalation state, identity, classification, and provenance;
5. ports only for incident recording, notification, remediation, and review escalation.

It does not implement credential issuance, external notifications, row mutation, GitHub settings changes, repository permissions, or operational persistence.

## Authority model

- Each authority class has its own token kind and descriptor shape.
- A descriptor is invalid unless its token kind exactly matches its declared authority class.
- Policy records retain a non-secret token identity only; bearer token values are rejected.
- Callers must select exactly one descriptor for a required authority class; missing or duplicate matches fail closed.
- A descriptor validated for one role cannot satisfy another role's authority requirement.

## Projection classification policy

- The policy recognizes `program-work`, `release-control`, `automation-control`, `security-incident`, and `excluded`.
- System-control labels are limited to `tracker-drift`, `automation-health`, `sync-internal`, and `sync-dlq`.
- Any request to project `program-work` with one or more system-control labels is reclassified to `excluded`.
- Control-plane classifications remain eligible for control-plane handling, but never for ordinary program-work projection.
- Unknown labels or unsupported classifications are rejected.

## Incident policy

- Control-plane incidents must retain `severity`, `owner`, `sla`, `escalationState`, `sourceIdentity`, `targetIdentity`, `classification`, and `provenance`.
- Approved SLA targets are fixed by class:
  - `P0`: immediate
  - `P1`: within 4 hours
  - `P2`: within 1 business day
  - `P3`: next maintenance cycle
- Incident classification is limited to control-plane classes (`release-control`, `automation-control`, `security-incident`, `excluded`) so incident records cannot be normalized as `program-work`.
- Malformed owner, SLA, provenance, or policy-version data is rejected.

## Drift routing matrix

| Drift classification | Outcome | Notes |
| --- | --- | --- |
| `safe-stale-mirror` | `automatic-remediation` | Reconcile stale mirror only |
| `missing-unambiguous-row` | `automatic-remediation` | Create the missing unambiguous row |
| `duplicate-rows` | `human-review` | Duplicate rows are never auto-deleted |
| `conflicting-authoritative-state` | `human-review` | Preserve incident data for investigation |
| `ambiguous-mapping` | `blocked` | Fail closed pending review |
| `schema-incompatibility` | `blocked` | Fail closed pending policy/schema alignment |
| `unverifiable-write` | `blocked` | Fail closed when the write cannot be trusted |

Human-review and blocked outcomes require a validated control-plane incident whose source and target identities match the drift request by authority class, authority id, and non-secret token identity. Automatic remediation does not synthesize operational side effects; it only returns machine-readable policy decisions for a caller-controlled port.

## Rollback boundary

Reverting this packet removes the standalone control-plane policy contract, tests, and documentation only. It does not change projection wiring, idempotency logic, Notion integration, external persistence, or other sprint packet write sets.

## Deferred operational enforcement

Parent issue #46 owns shared wiring. Any future integration that consumes this policy must keep the same role separation, control-plane exclusion, incident metadata retention, and fail-closed drift semantics.

## Parent-owned workspace wiring handoff

This packet's exclusive write set does not include `packages/tracker-control-plane/package.json` or a package `tsconfig.json`, so root `pnpm --recursive typecheck` and `pnpm --recursive test` cannot yet discover these sources as a workspace package on their own. Parent issue #46 must wire the package root into the shared workspace validation path, or perform the equivalent parent-owned integration, before recursive package automation can count this policy as natively covered.

Until that integration lands, verification for this packet is limited to direct targeted `pnpm exec tsc` and `pnpm exec vitest run` commands against `packages/tracker-control-plane/src/control-plane-policy/*` and `packages/tracker-control-plane/test/control-plane-policy/*`, plus the existing root frozen-lockfile, standards, and security checks.

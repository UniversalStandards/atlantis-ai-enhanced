# ADR-0004: Unified identity and trust contracts

> Renumbered from ADR-0003 when ported from PR #57 onto `sprint/7-day-operational-alpha`; ADR-0003 is the tracker projection contract.

Status: Accepted

## Decision

ATLANTIS uses a provider-neutral `PrincipalContext`, `Authenticator`, and
`Authorizer` contract. Authentication establishes who or what is acting;
authorization independently decides whether that principal may invoke a
capability for a tenant and resource.

Authentication results are a discriminated union: successful authentication
requires a `PrincipalContext`, while failed authentication requires a typed
failure reason and cannot carry a principal. This prevents malformed adapter
responses from reaching authorization.

The normative field set is maintained in the Universal Standards control plane:

- `standards/identity-trust/principal-context.schema.json`
- `manifests/IDENTITY_TRUST_CONTROLS.json`

This repository exports the TypeScript contract from
`packages/contracts/src/identity.ts` so workflows, provider adapters, SWARM,
and MCP integrations can share the same boundary without importing provider
objects into the core.

## Existing work reconciled

- ATLANTIS issue #2 remains the implementation owner for the provider-neutral
  platform contracts; this ADR does not create a duplicate identity backlog.
- SWARM issue #31 and PROJECT-SWARM issue #123/PR #147 remain the canonical
  per-user OAuth implementation records for SWARM.
- HITMAN is an absorbed ATLANTIS capability, not a separate identity runtime.

## Security and operational consequences

- Missing, malformed, expired, or unverifiable credentials must fail closed.
- Delegation must be explicit, bounded, auditable, and non-escalating.
- API-key material is issued once and stored only as a non-recoverable digest.
- Secrets and signing material remain in a managed secret store, never source,
  prompts, issue bodies, or logs.
- The contract is necessary but not sufficient for production readiness; each
  adapter must provide tests, audit evidence, and release-gate linkage through
  the shared control manifest.

## Verification

The contract package includes compile-time and runtime shape tests in
`packages/contracts/test/identity.test.ts`.

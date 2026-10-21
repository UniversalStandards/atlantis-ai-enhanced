# ADR-0004: Unified identity and trust contracts

> Renumbered from ADR-0003 when ported from PR #57 onto `sprint/7-day-operational-alpha`; ADR-0003 is the tracker projection contract.

Status: Accepted

## Decision

ATLANTIS uses a provider-neutral `PrincipalContext`, `Authenticator`, and
`Authorizer` contract. Authentication establishes who or what is acting;
authorization independently decides whether that principal may invoke a
capability for a tenant and resource.

Authentication results are a discriminated union: successful authentication
requires an authenticated principal, while failed authentication requires a
typed failure reason and cannot carry a principal. `Authenticator` returns
untrusted `unknown`; callers must pass its result through
`validateAuthenticationResult` before using it. Principal validation rejects
unknown fields and unsafe object shapes, then returns a frozen snapshot.

Delegation is either absent or contains the delegator, delegation identifier,
non-empty delegated scopes that are a subset of the principal's scopes, and
canonical expiration timestamp. Runtime validation rejects incomplete,
escalating, or expired delegation grants. Adapter-specific release controls
must link to their actual validation and audit evidence.

The canonical field set and runtime validators for this packet are maintained
together in this repository:

- `packages/contracts/src/identity.ts`
- `packages/contracts/test/identity.test.ts`

The adopted UniversalStandards commit (`8d309029`) does not contain an
identity-specific schema or control manifest. This ADR therefore does not
claim an upstream schema or release-gate linkage through such a manifest.

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
  the applicable repository release controls.

## Verification

The contract package includes compile-time tests and runtime validation tests
in `packages/contracts/test/identity.test.ts`.

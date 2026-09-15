# ADR 0003 — Tracker Projection Contract

- Status: Accepted
- Date: 2026-09-15
- Decision owners: ATLANTIS AI program

## Context

Tracker Control Plane reconciliation needs one provider-neutral contract for webhook delivery and scheduled anti-entropy. Both paths must derive the same semantic engineering projection and the same deterministic `source-revision` without depending on volatile transport or actor metadata.

## Decision

ATLANTIS defines one versioned tracker projection contract in `packages/contracts/src/tracker-projection.ts`.

The contract covers two entity classes:

1. issue projections
2. pull-request projections

Each projection carries:

- `projectionVersion.major`
- `projectionVersion.minor`
- `entityType`
- repository identity
- stable entity identity
- normalized semantic fields
- `sourceRevision`

`sourceRevision` is the lowercase hex SHA-256 digest of the canonical JSON rendering of:

- the projection version
- the entity type
- the repository
- the stable entity identity
- the normalized semantic fields

## Canonical semantic allowlist

### Issues

The issue projection includes only:

- repository
- issue number
- title
- body
- state
- relevant labels
- assignees
- linked pull-request summaries

### Pull requests

The pull-request projection includes only:

- repository
- pull-request number
- title
- body
- state
- draft status
- relevant labels
- assignees
- linked issue summaries
- check summaries
- changed-file summaries
- commit summaries

## Normalization rules

1. Plain-object records only. Arrays, class instances, symbols, accessors, and inherited fields are rejected.
2. Text fields normalize line endings to `\n`, trim surrounding whitespace, and reject blank required values. Optional blank text becomes `null`.
3. Numeric identifiers and counts must be safe integers. Entity identifiers are positive; file diff counts are non-negative.
4. Enumerated states must already be canonical supported literals.
5. Unordered semantic collections are normalized by sorting their canonical representations and rejecting duplicate semantic identities:
   - labels by label text
   - assignees by assignee identity
   - linked issue / pull-request references by linked entity number
   - checks by check context
   - changed files by path
   - commits by canonical lowercase 40-character SHA
6. Canonical JSON sorts object keys recursively and preserves only the declared normalized array order.
7. Unsupported scalar types (`undefined`, `bigint`, `symbol`, functions, non-finite numbers, `-0`) and cyclic values fail closed.

## Compatibility policy

- Major version compatibility is strict. A different major version returns `unsupported-major` and must stop mutation.
- Minor version compatibility is explicit and bounded by the exported supported range. Versions outside the supported minor range are malformed for this packet and must stop mutation.
- Malformed projections fail closed before any downstream mutation.

## Excluded volatile fields and non-goals

The contract intentionally excludes fields that must never affect semantic revision identity, including:

- webhook delivery IDs
- event IDs
- transport metadata
- actor or session identifiers
- timestamps such as `updated_at`
- any unprojected payload keys

This packet does not define idempotency keys, persistence, Notion API mutation, GitHub API calls, deployment behavior, credential selection, or reconciliation policy. Those remain separate packets.

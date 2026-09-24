# ADR 0002: Tracker control-plane contract

## Status

Accepted

## Context

Sprint A requires one provider-neutral reconciliation contract for projecting authoritative GitHub engineering state into Notion implementation-task records without overwriting Notion-owned planning context.

## Decision

- Canonical `sourceRevision` is computed from normalized projected fields only, using a SHA-256 hash over stable object key ordering, normalized array ordering, and NFC-normalized strings.
- Webhook and scheduled anti-entropy use the same idempotency identity: source system, repository, entity type, entity ID, canonical source revision, target system, and projection version.
- Reconciliation is fail-closed unless the caller has the `tracker-sync` role, the target schema is compatible, the target mapping is unambiguous, and post-write readback verifies the projected state.
- Control-plane incidents labeled `tracker-drift`, `automation-health`, `sync-internal`, or `sync-dlq` are excluded from ordinary `program-work` projection.
- Duplicate target rows are never auto-deleted. Instead, reconciliation returns an owned incident that preserves severity, owner, SLA class, and escalation state.

## Consequences

- Providers can implement a Notion adapter against one shared reconciliation contract while preserving local planning fields.
- Webhook retries and anti-entropy replays converge on the same semantic revision and idempotency key.
- Unsafe drift remains visible and owned rather than being silently mutated.

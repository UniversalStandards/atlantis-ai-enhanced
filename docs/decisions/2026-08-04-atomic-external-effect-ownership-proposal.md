# Atomic external-effect ownership proposal

## Status

Proposed. This document defines the architecture decision that must be approved before the runtime claim or lease boundary is implemented.

## Context

`executeExternalEffectWithReconciliation` currently provides durable receipt lookup, provider reconciliation, receipt validation, receipt persistence, and evidence emission. It does not atomically establish ownership before invoking `provider.execute`.

Two concurrent callers can therefore both observe a durable-store miss and a provider-reconciliation miss, then both invoke the provider for the same external-effect identity. Provider-side idempotency can reduce the consequence for some integrations, but the current provider-neutral contract does not require or prove it.

This decision must remain provider-neutral and must not select a production database, queue, cloud lock service, or provider SDK.

## Required invariants

1. At most one active owner may execute a given external-effect identity at a time.
2. Ownership acquisition must be atomic for one normalized identity.
3. Every acquired claim must return an opaque owner token suitable for fencing stale owners.
4. A non-owner must never call `provider.execute`.
5. A committed receipt must become the durable result returned to all later callers.
6. Expired ownership must be recoverable after an explicit lease interval.
7. A stale owner must be unable to publish a committed transition after a newer owner has acquired the identity.
8. Receipt identity validation must remain fail closed.
9. Approval waits and cancellations must not silently retain indefinite execution ownership.
10. Provider commitment, receipt persistence, checkpoint persistence, and event append must not be represented as one atomic transaction unless a later persistence decision actually provides that guarantee.

## Proposed provider-neutral boundary

```ts
export interface ExternalEffectOwnershipStore {
  acquire(
    identity: ExternalEffectIdentity,
    request: ExternalEffectOwnershipRequest,
  ): ExternalEffectOwnershipResult | Promise<ExternalEffectOwnershipResult>;

  renew(
    claim: ExternalEffectClaim,
    request: ExternalEffectRenewalRequest,
  ): ExternalEffectClaim | Promise<ExternalEffectClaim>;

  commit(
    claim: ExternalEffectClaim,
    receipt: ExternalEffectReceipt,
  ): ExternalEffectReceipt | Promise<ExternalEffectReceipt>;

  release(
    claim: ExternalEffectClaim,
    reason: ExternalEffectReleaseReason,
  ): void | Promise<void>;

  observe(
    identity: ExternalEffectIdentity,
  ): ExternalEffectOwnershipObservation | Promise<ExternalEffectOwnershipObservation>;
}
```

The concrete types must carry normalized identity, opaque claim token, owner ID, acquired time, expiry time, and an immutable generation or fencing value.

## Acquisition outcomes

`acquire` should return exactly one of:

- `acquired`: the caller owns a new or recovered lease and may continue toward provider execution;
- `committed`: a durable committed receipt already exists and must be returned without provider execution;
- `owned`: another unexpired owner exists; the caller must wait, observe, reconcile, or fail closed according to the entrypoint policy;
- `rejected`: the request is invalid or conflicts with durable identity state.

## Recommended default policy

For the operational alpha, use a bounded lease with opaque fencing token and fail-closed non-owner behavior.

- Lease duration is configuration supplied by the composition root, not hard-coded in contracts.
- Non-owners do not execute and return a typed ownership-conflict result to the workflow runner.
- The workflow runner may checkpoint and retry after a bounded delay under its existing retry and deadline budgets.
- Recovery after expiry requires a new atomic acquisition with a higher fencing generation.
- The provider adapter should use the canonical idempotency key whenever supported, but provider idempotency remains defense in depth rather than the ownership guarantee.
- `commit` must verify claim token, generation, identity, and receipt before publishing the durable committed result.
- `release` is best-effort for failed pre-commit attempts; expiry remains the crash-recovery mechanism.

## Explicit non-goals

- Selecting Postgres, Redis, SQLite, a cloud lock service, or another production persistence technology.
- Claiming exactly-once behavior across the external provider and local stores.
- Holding a lease across an unbounded approval wait.
- Weakening authorization, budget, cancellation, deadline, or evidence controls.
- Expanding GitHub Actions or repository permissions.

## Acceptance tests required before integration

1. Two concurrent callers for one identity result in exactly one successful acquisition.
2. `provider.execute` is called at most once while one unexpired claim exists.
3. The non-owner does not execute and receives the defined bounded behavior.
4. A committed receipt is returned to both callers after publication.
5. An expired claim can be recovered by a new owner.
6. A stale owner cannot commit after recovery by a newer owner.
7. A mismatched receipt, token, identity, or generation fails closed.
8. A provider commit followed by receipt-store failure can still recover through provider reconciliation without duplicate execution.
9. Approval wait, cancellation, timeout, and terminal budget paths do not retain indefinite ownership.
10. Evidence records distinguish acquisition, contention, recovery, execution, reconciliation, commit, and release without overstating cross-store atomicity.

## Decision required

Approve, revise, or reject the recommended bounded-lease and fencing policy. Runtime implementation should not begin until the ownership outcomes, non-owner behavior, expiry policy, and stale-owner fencing semantics are accepted.

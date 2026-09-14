# Recovery Ownership Durable Adapter Design

## Status

Provider-neutral implementation design for the first durable `RecoveryOwnershipStore` adapter. This document is intentionally reversible: it does not select PostgreSQL, Cosmos DB, SQLite, a production topology, credentials, network permissions, or deployment authority.

## Durable record mapping

A durable ownership aggregate is keyed by `(recoveryId, executionId)` and separates permanent fencing history from ephemeral live authority.

| Logical field | Durable requirement |
| --- | --- |
| `recoveryId` | immutable aggregate key component |
| `executionId` | immutable aggregate key component |
| `claimId` | nullable when no live owner; fresh for each distinct acquisition epoch |
| `ownerId` | nullable when no live owner; diagnostic identity only, never sufficient authority |
| `ownershipTokenDigest` | nullable when no live owner; one-way digest of opaque caller authority; raw token is never persisted in diagnostic/event projections |
| `fence` | durable monotonically increasing integer; never reset by release, expiry, restart, retention, or compaction |
| `acquiredAtEpochMs` | immutable within one ownership epoch; preserved across renewal/restart so continuation budget cannot reset |
| `expiresAtEpochMs` | live lease expiry; renewal may advance it only within the bounded-continuation policy |
| `version` | durable compare-and-swap/row-version value used to reject stale mutation |

Released/expired live claim material may be compacted only if the aggregate retains the latest fence (or equivalent monotonic allocator state). Maintenance must never make an old authority valid again.

## Authority-storage rules

1. Generate `claimId` and the raw ownership token with a cryptographically secure random source outside diagnostic/logging paths.
2. Return the raw token only to the successful acquiring caller.
3. Persist only a cryptographic digest suitable for constant-time equality verification; include domain separation and aggregate identity in the digest input.
4. Never place the raw token in traces, events, exceptions, metrics, structured logs, PR/CI output, or general diagnostic evidence.
5. Treat `ownerId` as descriptive identity, not authority. Mutation requires exact claim identity, fence, and token proof against the current live durable record.
6. Token rotation occurs on every distinct acquisition/reacquisition. Renewal preserves the current authority token unless a future contract explicitly defines rotation.

## Atomic operations

The pseudocode below describes required semantics, not provider syntax. `BEGIN ATOMIC` means one provider-supported transaction/conditional-write correctness boundary.

### Acquire

```text
acquire(key, ownerId, now, leaseMs):
  BEGIN ATOMIC
    record = read-for-update(key)

    if record has live claim and now < record.expiresAtEpochMs:
      return NOT_ACQUIRED(observe(record))

    nextFence = (record?.fence ?? 0) + 1
    claimId = freshClaimId()
    rawToken = freshOpaqueToken()
    tokenDigest = digestAuthority(key, claimId, nextFence, rawToken)

    write(key, {
      claimId, ownerId, ownershipTokenDigest: tokenDigest,
      fence: nextFence,
      acquiredAtEpochMs: now,
      expiresAtEpochMs: now + leaseMs,
      version: nextVersion(record)
    })
  COMMIT
  return ACQUIRED(claim evidence + rawToken)
```

Exactly one contender may commit for the same expired/unowned aggregate state. Provider adapters may use row locks, uniqueness constraints, ETags, or compare-and-swap, but must expose the same observable result.

### Renew

```text
renew(expectedLease, rawToken, now, requestedExpiry):
  BEGIN ATOMIC
    record = read-for-update(key)
    require exact live claimId + ownerId + fence + acquiredAtEpochMs + expiresAtEpochMs
    require now < record.expiresAtEpochMs
    require constantTimeEqual(record.ownershipTokenDigest,
                              digestAuthority(key, record.claimId, record.fence, rawToken))
    require requestedExpiry > record.expiresAtEpochMs
    require requestedExpiry <= record.acquiredAtEpochMs + maxContinuousOwnershipMs

    conditional-update expiresAtEpochMs and version only
  COMMIT
  return renewed lease evidence
```

A denied renewal must not mutate claim, token digest, fence, acquisition time, expiry, or version.

### Release

```text
release(expectedLease, rawToken, now):
  BEGIN ATOMIC
    record = read-for-update(key)
    require exact current authority and token digest
    clear claimId, ownerId, ownershipTokenDigest, acquiredAtEpochMs, expiresAtEpochMs
    preserve fence
    advance version
  COMMIT
  return RELEASED
```

A stale/non-owner release is a no-op/fail-closed result and cannot disturb a successor.

### Observe

```text
observe(key, now):
  record = authoritative-read(key)
  return token-free immutable diagnostic projection
```

Observation never returns raw token or token digest. Expired authority is reported as non-live according to the existing contract; adapters must not manufacture a new claim during observation.

### Expiry takeover

Expiry takeover is `acquire` against a record whose `expiresAtEpochMs <= now`. The new claim must atomically install fresh claim/token authority and `fence = priorFence + 1`. The predecessor remains permanently fenced even if its raw token is replayed.

## Acknowledgement-loss reconciliation

A transport/process failure after commit but before the caller receives acknowledgement is an uncertain outcome, not permission to retry blindly.

```text
on acquire/renew/release acknowledgement loss:
  authoritative = observe/readback(key)
  classify using operation identity + expected pre-state + durable post-state

  if durable post-state proves this operation committed:
    return reconciled committed result
  if durable state proves operation did not commit:
    retry only under the normal operation preconditions
  otherwise:
    quarantine/fail closed; do not create competing authority
```

For acquisition, an implementation needs an operation-attempt identity or equivalent durable idempotency evidence sufficient to distinguish "our commit succeeded" from "another contender acquired after our pre-commit failure". The real adapter must prove this in the existing acknowledgement-loss conformance scenarios.

## Deterministic failure-injection boundary

Every durable adapter factory used by acceptance tests must support test-only hooks at these semantic boundaries:

- `before-acquire-commit`
- `after-acquire-commit-before-ack`
- `before-renew-commit`
- `after-renew-commit-before-ack`
- `before-release-commit`
- `after-release-commit-before-ack`
- restart/reconnect after committed and uncommitted attempts
- maintenance/compaction before restart

Hooks must be unavailable or inert in production composition unless explicitly compiled/configured for testing. They must not require production credentials in pull-request CI.

## Durable adapter registration

A real adapter is not eligible for production binding until the same factory is registered against all provider-neutral suites:

1. baseline ownership conformance;
2. restart/durability and independent-adapter conformance;
3. acknowledgement-loss/pre-commit/replay failure injection;
4. retention/compaction fencing conformance;
5. bounded-continuation/fairness conformance.

The process-local `InMemoryRecoveryOwnershipStore` remains a contract/reference implementation and is not durability evidence.

## Atomicity boundary with immutable writer evidence

The preferred correctness boundary is one durable transaction/conditional aggregate operation that can prove both ownership authority and the corresponding writer/event commitment when a recovery mutation makes an externally meaningful durable transition.

### Operations that should be co-atomic when the selected provider permits it

- verify the current ownership claim/token/fence;
- append immutable writer commit evidence for the recovery mutation;
- advance the durable recovery/checkpoint/event cursor that declares the mutation committed;
- preserve the fence/claim version used to authorize that writer transition.

This prevents a durable event/checkpoint from claiming success under authority that was lost before the writer commitment became durable.

### When co-atomic storage is impossible

Do not weaken the ownership contract. Use a durable reconciliation protocol with an immutable operation identity and explicit states such as `prepared`, `committed`, and `quarantined`. External effects and writer evidence must be reconciled by authoritative readback; ambiguous outcomes fail closed. Blind retry is prohibited.

The architecture review for a concrete provider must state whether ownership and immutable writer evidence share one transaction boundary. If not, it must supply a proven reconciliation state machine and failure-injection evidence for every gap between the stores.

## Provider translation constraints

- PostgreSQL may implement `BEGIN ATOMIC` with transactions plus row locking/conditional updates; exact isolation and SQL remain adapter decisions.
- Cosmos DB may implement it with ETag conditional replacement/transactional batch only when all correctness-critical state fits one logical partition.
- SQLite may implement it with explicit write transactions for a single durable database topology; this does not establish multi-host ownership.

No provider-specific optimization may weaken the provider-neutral observable semantics.

## Migration and rollback invariants

Any future schema migration must preserve aggregate identity, current live authority, fence monotonicity, acquisition time, expiry, and version. Rollback is permitted only to a schema/version that can represent the current fence and reject all previously issued stale authority. Destructive rollback that can reset fencing is prohibited.

## Architecture approval packet

Before a concrete adapter is authorized, review must identify:

1. provider and deployment topology;
2. exact schema/partition key and version mechanism;
3. atomicity/isolation boundary;
4. authority digest algorithm and key-management implications, if any;
5. acknowledgement-loss operation identity/reconciliation mechanism;
6. migration/rollback plan;
7. retention/compaction policy;
8. least-privilege credential/network inventory;
9. CI strategy that avoids production secrets;
10. registration of all conformance suites and exact-head evidence.

## Exit criteria

This design package is complete when it can be translated to any candidate adapter without changing the `RecoveryOwnershipStore` contract or weakening its conformance suites. Production binding remains prohibited until a concrete adapter passes all suites and its security/deployment architecture is explicitly approved.

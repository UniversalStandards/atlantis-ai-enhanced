# Recovery Ownership Durability Acceptance Gate

## Purpose

Define the provider-neutral evidence a durable `RecoveryOwnershipStore` adapter must produce before production persistence can be bound. This document deliberately does not select a database, deployment topology, credential model, or transaction mechanism.

## Mandatory adapter-neutral scenarios

A durable adapter must run the existing baseline recovery-ownership conformance suite unchanged and add restart/crash acceptance scenarios over a fresh adapter instance attached to the same durable state.

1. A live lease survives adapter/process restart and excludes a competing owner until expiry or explicit release.
2. At the exact expiry boundary, a competing owner may acquire and must receive a strictly higher fence plus fresh claim authority.
3. Pre-restart stale authority cannot renew, release, or otherwise disturb a post-restart successor.
4. Explicit release survives restart and preserves fencing history; reacquisition must advance the fence rather than resetting it.
5. Concurrent acquisition from independent adapter instances has exactly one winner for a recovery/execution identity.
6. Acknowledgement loss after durable acquisition must reconcile to the authoritative stored claim without issuing duplicate authority.
7. Failure before durable commit must not create observable ownership.
8. Restart revalidation must reject replayed or identity-substituted claim material.
9. Retention or compaction must never erase fencing history needed to reject stale owners.

## Harness contract

The durable test harness must expose a deterministic clock, a current adapter instance, and a `restart` operation that constructs a fresh adapter/process view over the same durable state. A process-local map is not acceptable evidence for this gate.

The harness must distinguish simulated process restart from simple object recreation. Tests must fail if fencing history or a live claim disappears merely because an adapter object is reconstructed.

## Bounded continuation and fairness decision boundary

The store currently permits renewal while exact live authority remains valid. Production binding requires an explicit bounded-continuation policy before release. The policy must define at least: maximum continuous ownership interval, whether renewal count is capped, whether waiting contenders affect renewal eligibility, and what evidence demonstrates that a continuously healthy owner cannot starve a contender forever.

Those values are policy semantics, not storage-provider details. They must be fixed and tested before a durable adapter is promoted, but this gate does not silently choose them.

## Candidate mechanism evaluation

Any proposed persistence mechanism must be evaluated against the same acceptance criteria: atomic conditional acquisition, atomic renewal, monotonic fencing, durable release/expiry state, independent-process contention, authoritative read-after-uncertain-write reconciliation, restart recovery, replay rejection, retention safety, deterministic testability, and least-privilege operation.

A candidate that cannot demonstrate all mandatory scenarios is rejected regardless of vendor or implementation convenience.

## Promotion rule

Production persistence remains blocked until one real durable adapter passes the baseline conformance suite, the durable restart/crash suite, and the bounded-continuation/fairness suite. Passing the process-local reference implementation alone is insufficient.
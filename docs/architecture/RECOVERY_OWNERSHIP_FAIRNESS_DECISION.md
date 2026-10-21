# Recovery Ownership Fairness Decision Gate

## Status

Proposed acceptance policy. Provider-neutral and deliberately not a production persistence selection.

## Problem

Exclusive leases and monotonic fencing prevent concurrent authority, but an owner that can renew forever can starve waiting contenders. A correct durable adapter therefore needs a bounded-continuation rule in addition to atomic acquisition, renewal, expiry, and fencing.

## Required invariants

1. Exclusivity and fencing remain stronger than fairness: fairness must never create two live authorities.
2. A single ownership epoch has a finite maximum continuous lifetime measured from `acquiredAtEpochMs`; renewal must not move authority beyond that bound.
3. Renewal remains atomic and is accepted only for the exact live lease.
4. Once the continuous-lifetime bound is reached, the current authority cannot renew. It may finish before expiry or release early, but continuation requires a new acquisition and a strictly higher fence.
5. Expiry and handoff use the same authoritative clock/transaction boundary as ownership mutation; clients do not decide eligibility locally.
6. A stale or superseded owner remains fenced even if it was previously denied renewal for fairness.
7. Fairness must be deterministic under sustained contention and testable without sleeps or wall-clock races.

## Decision boundary

### Safe default now: bounded continuation

Add a configurable `maxContinuousOwnershipMs` policy to real adapters. The value is deployment policy, not embedded in the provider-neutral evidence format. An adapter must reject a renewal whose resulting expiry would exceed `acquiredAtEpochMs + maxContinuousOwnershipMs` (or clamp only if the contract explicitly returns the clamped expiry; silent clamping is prohibited).

This closes infinite-renewal starvation without selecting a database, topology, or lock primitive.

### Deferred architecture choice: contender-aware ordering

Strict FIFO, ticket ordering, randomized backoff, and database-native waiter ordering each impose different persistence/topology requirements. The current `RecoveryOwnershipStore` API intentionally has no durable waiter-registration primitive. Adding one would be a major contract change and must not be smuggled into the reference implementation.

Until a durable waiter model is selected, release/expiry acquisition remains competitive. Day-7 acceptance therefore requires bounded continuation and starvation evidence over a bounded contention window, but does not claim strict FIFO ordering.

## Executable acceptance requirements

Every real durable adapter must demonstrate:

1. repeated renewals cannot extend one claim beyond the configured continuous-lifetime bound;
2. denial at the bound does not mutate claim ID, token, fence, or durable expiry;
3. after expiry/release, a successor acquires with fresh authority and a strictly greater fence;
4. the predecessor cannot renew or release the successor after handoff;
5. under a deterministic bounded contention schedule, at least one waiting contender acquires after the incumbent reaches its continuation bound;
6. restart before the bound does not reset `acquiredAtEpochMs` or the continuation budget;
7. acknowledgement loss cannot reset the continuation budget or mint duplicate authority.

## Alternatives considered

### Unlimited renewal

Rejected for production acceptance because it permits starvation indefinitely.

### Fixed renewal-count cap

Not preferred because lease durations can vary; count is not a stable measure of continuous ownership time.

### Strict FIFO waiter queue

Potentially stronger fairness, but deferred because it requires durable waiter identity, cancellation, cleanup, ordering, and crash semantics not present in the current contract.

### Randomized backoff only

Insufficient as the primary guarantee because probability is not deterministic starvation prevention.

## Implementation sequence

1. Keep the existing provider-neutral ownership evidence and fencing model unchanged.
2. Add adapter policy/configuration for maximum continuous ownership.
3. Add a reusable fairness conformance harness implementing the executable requirements above.
4. Register baseline, durability, retention, and fairness suites against the first real durable adapter.
5. Select contender-aware ordering only if Day-7 evidence shows bounded continuation alone is insufficient for the operational workload.

## Non-decisions

This document does not authorize a production database, cloud service, transaction primitive, credential, network permission, deployment, strict FIFO queue, or production timeout value.
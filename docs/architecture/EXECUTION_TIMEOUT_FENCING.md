# Execution Timeout Fencing

Status: accepted
Scope: `packages/contracts/src/execution-control.ts`

## Problem

`executeWithControl` bounds an attempt with `Promise.race([operation, timeout])`.
When the deadline won the race, the attempt rejected but the operation kept
running with unrestricted authority. A runner could publish a terminal timeout
and retire recovery state while the operation later completed and mutated
external state.

## Decision

An attempt is fenced, not merely abandoned.

1. **Attempt-scoped fence.** Every attempt receives a fresh fence that owns a
   provider-neutral cancellation token (`context.cancellation`) and a revocable
   commit authority (`context.commitAuthority`). No provider object crosses the
   boundary; adapters bind their own abort primitive through
   `cancellation.onCancellationRequested(listener)`.
2. **Mediated external effects.** Externally consequential work must run through
   `commitAuthority.commit(effect)`. `commit` fails closed with
   `CommitAuthorityRevokedError` once the fence is revoked, so a late completion
   cannot start a new external commit.
3. **Revoke before finalization.** When the deadline fires, the fence is revoked
   *before* the `onTimedOut` publication hook and before the terminal error is
   thrown.
4. **Bounded acknowledgement.** Terminal finalization then waits, within
   `fencing.acknowledgementTimeoutMs` (default
   `DEFAULT_FENCE_ACKNOWLEDGEMENT_TIMEOUT_MS`), for in-flight commits to drain
   and, when `fencing.requireAcknowledgement` is set, for the operation to call
   `commitAuthority.acknowledgeRevocation()`. The wait is always bounded; no
   indefinite wait is reintroduced.
5. **Fail closed on unacknowledged fences.** If acknowledgement is not obtained
   inside the bound, finalization still publishes `onTimedOut` with
   `fence.acknowledged === false` and rejects with
   `ExecutionFenceNotAcknowledgedError` instead of `ExecutionTimedOutError`. The
   outcome is terminal and never retried, and the runner must treat the effect
   as uncertain rather than retiring recovery state.
6. **Fenced outcome wins.** If the operation settles while finalization is still
   running, the fenced terminal outcome is returned; a revoked attempt can never
   report success.
7. **Late settlement is absorbed.** A resolution or rejection arriving after the
   fence closes is reported through `hooks.onLateSettlement` for audit only and
   cannot alter authoritative workflow progress.
8. **No authority leaks past an attempt.** The fence is also revoked when the
   attempt settles normally, so a retained `CommitAuthority` reference cannot be
   used later.

## Non-claims

This does not provide universal exactly-once external effects. It guarantees
only that commit authority is revoked before terminal finalization, that
unacknowledged fences fail closed, and that late settlements cannot change
authoritative progress. Adapters whose external effects cannot be proven fenced
by commit mediation must set `fencing.requireAcknowledgement` so that missing
cancellation support fails closed instead of being silently assumed.

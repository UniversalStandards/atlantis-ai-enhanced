# Production Persistence and Uncertain-Outcome Architecture Gate

## Status

Proposed implementation gate for the ATLANTIS operational-alpha sprint.

This document does not select a storage provider or authorize deployment. It defines the minimum provider-neutral contract, failure model, and verification evidence required before a production persistence adapter or uncertain-outcome recovery mechanism can be accepted.

## Scope

The gate applies to every production implementation of the execution event store, execution cursor, governed append path, ownership lifecycle evidence, and ownership-loss evidence.

The existing in-memory and atomic-snapshot implementations remain reference infrastructure and test fixtures. They are not represented as production persistence.

## Non-negotiable invariants

1. An append and its execution-stream cursor advancement are one atomic durable transition.
2. A rejected, aborted, timed-out, conflicted, or uncommitted append consumes no stream version or global sequence.
3. A committed event is immutable and appears exactly once in its execution stream.
4. Stream versions and global sequences remain contiguous after process restart.
5. Event identity, execution identity, trace identity, causation identity, timestamp, actor, type, and payload validation occur before durable mutation.
6. Governed append authority is execution-bound and cannot mutate another execution stream.
7. Abort acknowledgement closes final mutation authority before the execution queue slot is released.
8. A late callback cannot commit after its authority has been closed.
9. Ownership lifecycle and ownership-loss evidence use the governed append path and cannot fall back to the public compatibility append path.
10. Claim tokens and other designated secrets never enter durable evidence.
11. Recovery never silently guesses whether an ambiguous write committed.
12. Workflow and runtime permissions remain least-privilege and do not expand merely to support persistence.

## Required persistence contract

A candidate adapter must provide a single atomic operation equivalent to:

```text
append_if_version(
  execution_id,
  expected_stream_version,
  event_id,
  immutable_event_record
) -> committed | conflict | known_failure | uncertain
```

The operation must atomically enforce:

- uniqueness of `event_id`;
- equality of the current stream version and `expected_stream_version`;
- insertion of the immutable event record;
- increment of the execution-stream version;
- allocation of the next global sequence, when a global sequence is retained.

A provider implementation may use a transaction, compare-and-swap, conditional write, stored procedure, or another primitive only when its atomicity and restart behavior are demonstrated by executable tests.

## Outcome classification

Every append attempt must end in one of four explicit outcomes.

### Committed

Durable readback proves the event exists with the expected identity, stream version, sequence, and immutable content.

### Conflict

The provider proves the expected stream version was not current or the event identity already exists. No mutation from the rejected attempt is permitted.

### Known failure

The provider proves the transition did not commit. Retrying is permitted only under the bounded retry policy.

### Uncertain

The caller cannot prove whether the transition committed. Examples include connection loss after request transmission, timeout after provider acceptance, or an indeterminate transaction result.

An uncertain outcome must never be treated as either success or failure without durable reconciliation.

## Durable uncertainty record

Before releasing an execution for further mutation after an uncertain result, the system must durably record or reconstruct an uncertainty item containing at least:

- operation ID;
- execution ID;
- event ID;
- expected stream version;
- content digest of the immutable event;
- first-attempt timestamp;
- last-attempt timestamp;
- provider operation or transaction identifier when available;
- reconciliation state;
- bounded retry count;
- last observed evidence;
- quarantine reason when manual review is required.

The uncertainty record must not contain secrets excluded from execution evidence.

## Reconciliation rules

Reconciliation must use authoritative durable reads and follow this order:

1. Read by event ID or provider operation ID.
2. If an exact immutable match exists at the expected stream position, classify as committed.
3. If a different event occupies the expected position, classify as conflict and quarantine the discrepancy.
4. If the event is absent and the provider proves the original transaction did not commit, classify as known failure and permit a bounded retry.
5. If neither commit nor non-commit can be proven, retain the uncertain state and block further mutation for that execution.

Reconciliation must be idempotent and restart-safe.

## Quarantine behavior

Quarantine is required when:

- durable state conflicts with the expected event digest;
- the same event ID resolves to different content;
- stream or global sequence continuity is violated;
- provider evidence remains ambiguous after the bounded reconciliation policy;
- ownership or fencing evidence indicates a superseded writer may have committed;
- persisted records fail canonical restoration validation.

A quarantined execution must be readable for diagnosis but must not accept new governed mutations until an explicit recovery decision is recorded.

## Required failure-injection evidence

A production adapter is not acceptable until automated tests prove all of the following against the real adapter boundary:

1. Failure before request transmission consumes no cursor.
2. Failure during transaction execution consumes no cursor.
3. Connection loss after commit is reconciled as committed without duplication.
4. Connection loss before commit is reconciled as non-committed before retry.
5. Provider timeout with unknown outcome enters durable uncertainty rather than retrying blindly.
6. Process termination between provider commit and caller acknowledgement recovers correctly after restart.
7. Process termination after uncertainty recording resumes reconciliation after restart.
8. Duplicate delivery of the same operation remains idempotent.
9. Concurrent writers produce one commit and deterministic conflicts without gaps.
10. Ownership loss before commit prevents mutation.
11. Ownership loss after an uncertain result cannot authorize a blind retry.
12. Late settlement after acknowledged abort cannot mutate or advance the cursor.
13. Corrupted, aliased, accessor-bearing, or non-canonical persisted records fail closed.
14. Quarantined executions reject further writes while preserving diagnostic read access.
15. Recovery preserves contiguous execution versions and global sequences.

## Observability requirements

The adapter and reconciler must emit structured, secret-safe evidence for:

- append admitted;
- append committed;
- append conflict;
- append known failure;
- append uncertain;
- reconciliation started;
- reconciliation committed;
- reconciliation retry permitted;
- execution quarantined;
- quarantine released;
- recovery resumed after restart.

Metrics must include bounded queue depth, append latency, conflict count, uncertain-outcome count, reconciliation age, quarantine count, and recovery success or failure. Metrics and logs must not contain claim tokens, provider credentials, or raw secret payload fields.

## Security and permission gate

Any candidate requiring new credentials, network access, workflow permissions, production data-plane access, or secret distribution must receive an explicit security review before those permissions are added.

Tests must run with read-only repository permissions unless a test specifically requires otherwise. Production credentials must never be introduced into pull-request workflows.

## Acceptance evidence required in the implementation PR

The implementation PR must include:

- provider and atomicity rationale;
- schema or durable record definition;
- migration and rollback plan;
- failure-mode matrix;
- exact-head CI evidence;
- real-adapter integration-test evidence;
- restart and failure-injection evidence;
- permission and secret inventory;
- operational runbook for uncertainty and quarantine;
- proof that existing governed evidence producers cannot reach an ungoverned append path.

## Explicitly deferred decisions

This gate intentionally does not choose:

- database or cloud provider;
- transaction or conditional-write primitive;
- deployment topology;
- high-availability model;
- retention duration;
- quarantine operator interface;
- cross-store transaction strategy.

Those choices are architecture decisions and require approval after candidate designs are compared against this gate.

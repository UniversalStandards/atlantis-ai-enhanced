# Durable Persistence PostgreSQL Approval Proposal

## Status

**PROPOSED / NOT SELECTED / NOT AUTHORIZED FOR IMPLEMENTATION.**

This document converts the current engineering recommendation for Candidate A into an approval-ready, non-secret configuration proposal. It does not change `DURABLE_PERSISTENCE_ADAPTER_CANDIDATE_RECORD.md`, does not constitute architecture or operations approval, does not grant credentials or network access, and does not authorize provider-specific code, infrastructure provisioning, deployment, or production use.

## Proposed candidate identity

| Field | Proposed value |
| --- | --- |
| Candidate ID | `postgresql18-nonprod-conformance-v1` |
| Product / substrate | PostgreSQL |
| Version / service mode | PostgreSQL 18.6, isolated non-production primary + synchronous standby topology |
| Driver / SDK | `pg` 8.23.0 for Node.js 22 |
| Authoritative topology | One PostgreSQL primary is the sole mutation authority; one synchronous physical standby receives WAL; clients connect through an explicitly controlled non-production endpoint whose active-primary identity is evidence-bound |
| Consistency / isolation | `SERIALIZABLE` for authority-changing transactions; authoritative readback from the current primary; no eventual replica reads for settlement |
| Transaction primitive | SQL transaction + row mutation/locking + unique constraints + `INSERT ... ON CONFLICT` where appropriate + `RETURNING` |
| Independent-client topology | At least two separately instantiated Node.js client processes/pools communicate with the same authoritative PostgreSQL service |
| Restart boundary | Terminate and recreate client process; separately restart primary/standby service processes during durability/failover gates |
| Credential class | Dedicated least-privilege non-production database role; secret value external to repository/evidence |
| Network boundary | Isolated non-production network; database port reachable only by conformance clients and failover controller approved for the test environment |
| Feature gate | Explicit PostgreSQL durable-adapter registration/configuration flag |
| Feature-gate default | `disabled` |
| Rollback / disable | Disable adapter registration and return composition root to provider-neutral/process-local reference implementation; destroy isolated non-production database resources after evidence retention requirements are met |

Current upstream evidence: PostgreSQL 18.6 was released 2026-08-13. The proposed Node driver is `pg` 8.23.0. Exact versions remain proposal inputs until frozen-lockfile admission and architecture/operations approval occur.

## Required durability posture

The proposed candidate MUST use a durability configuration that preserves ATLANTIS acknowledgement semantics:

1. `fsync = on`.
2. `full_page_writes = on` unless a separately evidenced storage architecture proves an equivalent or stronger crash-safety posture.
3. `synchronous_commit` MUST NOT be `off` or `local` for governed authority-changing commits.
4. When the synchronous standby is part of the admitted topology, governed authority-changing commits SHOULD use `synchronous_commit = on` at minimum so commit acknowledgement waits for the synchronous standby to flush WAL to durable storage.
5. `remote_apply` may be used by specific failover/read-after-failover scenarios if the acceptance test requires immediate query visibility on the standby before acknowledgement; it is not required as a blanket setting unless operational review chooses that stronger latency/durability tradeoff.
6. `synchronous_standby_names` must bind the exact admitted standby identity; an unbound or absent synchronous standby cannot be presented as synchronous-failover evidence.
7. Settlement after ambiguous client outcome reads from the authoritative current primary. Standby reads are non-authoritative unless the failover transition has completed and the standby has become the evidence-bound primary.

## Proposed authority data model

The schema below is a design proposal, not an implementation migration.

### Recovery ownership row

One row per protected recovery/authority key:

- `authority_key` — primary key;
- `owner_id` — current owner identity;
- `fence_token BIGINT` — monotonically increasing fencing value;
- `lease_expires_at` — authoritative expiry timestamp;
- `revision BIGINT` — monotonically increasing row revision;
- evidence-safe timestamps/metadata required by existing ATLANTIS contracts.

Acquisition/reacquisition occurs in one transaction by locking/mutating the authority row and incrementing `fence_token` and `revision`. The transition succeeds only when the current state satisfies the exact existing ownership preconditions. Renewal and release include the expected `owner_id` and `fence_token` in their mutation predicates. A stale owner therefore cannot renew or release a successor's lease.

PostgreSQL row locks are not themselves the durable fence. The persisted monotonic `fence_token` is the authority evidence.

### Stream authority row

One row per durable event stream:

- `stream_id` — primary key;
- `current_version BIGINT NOT NULL`;
- `revision BIGINT NOT NULL`.

Append transactions lock/mutate this row and require `current_version = expected_version` before advancing to the successor version.

### Immutable event row

One immutable row per committed event:

- `operation_id` — unique;
- `execution_id`;
- `event_id`;
- `stream_id`;
- `stream_version`;
- immutable-content digest;
- canonical serialized event bytes or approved immutable representation;
- committed timestamp/evidence fields.

Required uniqueness includes at least:

- `UNIQUE(operation_id)`;
- `UNIQUE(execution_id, event_id)`;
- `UNIQUE(stream_id, stream_version)`.

No `ON CONFLICT DO UPDATE` path may mutate already-committed immutable event bytes. Idempotent replay of the same operation may return the authoritative existing row only after exact identity/version/digest equality is proven; divergent content is a conflict/quarantine condition.

## Proposed atomic append algorithm

One `SERIALIZABLE` transaction performs the governed append:

1. Lock/read the stream-authority row for `stream_id`.
2. Verify `current_version == expected_version`.
3. Check whether `operation_id` already exists.
   - If it exists with exact execution/event identity, expected successor version, and immutable digest, treat it as authoritative idempotent readback, not a second mutation.
   - If any identity/version/digest differs, fail closed as conflict/quarantine.
4. Insert the immutable event row for `expected_version + 1`.
5. Update the stream-authority row to the successor version in the same transaction.
6. Commit.
7. Return committed evidence only after PostgreSQL reports transaction commit success under the admitted durability settings.

A serialization failure or uniqueness/expected-version rejection maps to canonical conflict/known-failure only when authoritative semantics prove non-commit. Connection loss, timeout, process termination, failover, or cancellation around commit maps to `uncertain` until authoritative readback settles the exact operation identity and digest.

## Proposed ownership acquisition algorithm

One `SERIALIZABLE` transaction:

1. Read/lock the authority row.
2. Evaluate the existing ATLANTIS acquisition preconditions against authoritative state.
3. If acquisition is permitted, update owner, increment the persisted fencing token, set expiry, and increment revision using one mutation with `RETURNING`.
4. Commit under admitted synchronous durability settings.
5. Emit authority evidence from returned persisted state.

Reacquisition after expiry must advance the fencing token even if the same logical owner reacquires. A previously issued token never becomes authoritative again.

## Proposed provider error mapping

| PostgreSQL / driver condition | ATLANTIS outcome |
| --- | --- |
| Successful commit acknowledgement with exact returned/readback identity | `committed` |
| `40001` serialization failure before successful commit | `conflict` / bounded transaction retry only when the higher-level operation has not entered ambiguous commit state |
| `23505` unique violation proving competing authoritative identity/version | `conflict` |
| Predicate/expected-version miss proven before commit | `conflict` or `known-failure` according to existing contract |
| Deterministic SQL/validation rejection before commit | `known-failure` |
| Connection loss / timeout / client termination / failover while commit result is unknown | `uncertain` |
| Driver/server error whose commit state cannot be authoritatively proven | `uncertain` |
| Readback shows exact operation identity + successor version + digest | settle `uncertain` as `committed` |
| Readback proves operation absent after the admitted authoritative settlement procedure | settle as non-commit according to existing contract |
| Readback identity/version/digest differs | quarantine / fail closed |

Transaction-level retry for `40001` must be strictly bounded and may occur only before an acknowledged or ambiguous external commit outcome exists. ATLANTIS must never blindly retry an operation after commit acknowledgement is lost.

## Proposed failure-injection plan

The non-production candidate must prove at least:

1. Kill a client before `COMMIT`; authoritative readback proves no append.
2. Drop/terminate the client connection at or immediately after server commit acknowledgement boundary; operation becomes `uncertain` and is settled only by readback.
3. Run two independent clients against the same expected stream version; exactly one successor version can commit.
4. Run contended acquisition; stale owner/fence cannot renew or release after successor acquisition.
5. Kill/recreate a client process and prove ownership/event state survives.
6. Restart the PostgreSQL primary and prove committed state survives.
7. Exercise synchronous standby promotion/failover in the admitted test topology and prove the authoritative transition rule.
8. Force serialization conflicts and verify bounded conflict handling without duplicate append.
9. Make authoritative readback temporarily unavailable while an append remains `uncertain`; record stays unresolved rather than being replayed.
10. Attempt operation/execution/event/digest substitution and prove quarantine/fail-closed behavior.

Failure injection must be implemented outside canonical ATLANTIS correctness contracts. Tests may control non-production process/network state, but must not weaken validators or mutation rules.

## Proposed failover authority rule

Failover evidence must have one explicit authority transition:

1. Prior to transition, only the admitted primary is authoritative for mutations and uncertainty settlement.
2. During an unresolved failover, new governed mutations pause/fail closed; the system must not permit two writable primaries to be treated as authoritative.
3. The standby becomes authoritative only after the test environment's promotion mechanism produces a new evidence-bound primary identity and the old primary is fenced from governed writes.
4. Uncertain pre-failover operations are reconciled against the new authoritative primary after promotion.
5. Any divergence in operation identity, stream version, or immutable digest quarantines the execution rather than selecting a convenient replica result.

This proposal does not choose a production HA manager, cloud service, load balancer, DNS mechanism, or cluster orchestrator. The Day-7 non-production harness may use an isolated deterministic promotion controller solely to prove the existing provider-neutral failover contract; production topology remains a separate decision.

## Security and least privilege proposal

The database role used by the adapter should receive only the schema/table/sequence privileges required by the approved adapter. It must not be a PostgreSQL superuser and must not hold cluster administration, replication administration, filesystem, extension-installation, or unrelated database privileges.

Connection strings, passwords, certificates, tokens, private endpoints, and secret material remain outside Git history, traces, fixtures, and release evidence. Evidence may identify credential *class* and endpoint/topology identity without containing secret values.

## Dependency admission proposal

If Candidate A is selected, `pg` 8.23.0 is the proposed initial driver version. Before implementation it must:

1. enter the frozen workspace lockfile through the normal package-manager path;
2. pass SEC-20 source/integrity validation;
3. pass the structured vulnerability audit at the existing threshold;
4. be represented in the dependency inventory;
5. introduce no install-script or native-binding requirement that silently expands the trusted execution surface. The pure-JavaScript driver path is preferred for the first bounded candidate unless separately justified.

## Conformance mapping

No existing ATLANTIS conformance assertion may be weakened. A selected implementation must register behind the existing provider-neutral durable ownership/append ports and pass unchanged:

- recovery ownership baseline;
- independent-client durable ownership;
- restart durability;
- failure injection;
- fairness;
- applicable retention/compaction;
- immutable writer/event evidence;
- durable append uncertainty and authoritative settlement;
- ownership/writer atomicity;
- SEC-20 dependency admission;
- secret-safety gates;
- release evidence identity binding.

## Proposed approval record values

If architecture and operations decide to select Candidate A, the canonical candidate record can be populated from this proposal with the following evidence-safe values, subject to reviewer amendments:

- `candidateId`: `postgresql18-nonprod-conformance-v1`
- `executionEnvironment`: `non-production`
- `productSubstrate`: `PostgreSQL`
- `versionServiceMode`: `PostgreSQL 18.6; isolated primary + synchronous standby conformance topology`
- `driverSdk`: `pg 8.23.0; frozen-lockfile and SEC-20 admitted`
- `authoritativeTopology`: `single writable primary with evidence-bound synchronous standby and fail-closed promotion boundary`
- `consistencyMode`: `SERIALIZABLE authority-changing transactions; authoritative settlement reads from current primary`
- `transactionPrimitive`: `PostgreSQL transaction + persisted monotonic fencing + row mutation/locking + unique constraints + immutable insert + RETURNING`
- `independentClientTopology`: `two or more independent Node.js client processes/pools sharing one authoritative PostgreSQL service`
- `restartBoundary`: `client process recreation plus PostgreSQL primary/standby restart and promotion scenarios`
- `credentialClass`: `dedicated least-privilege non-production database role`
- `networkBoundary`: `isolated non-production database network reachable only by admitted conformance clients/controller`
- `featureGate`: `explicit PostgreSQL durable-adapter registration control`
- `featureGateDefault`: `disabled`
- `rollbackDisable`: `disable adapter registration; revert composition to provider-neutral reference adapter; teardown isolated PostgreSQL resources after evidence retention requirements`
- `semanticMappingEvidence`: this document + `DURABLE_PERSISTENCE_CANDIDATE_EVIDENCE_MATRIX.md`
- `errorMappingEvidence`: this document, Provider error mapping section
- `failureInjectionPlan`: this document, Failure-injection plan section
- `decisionEvidence`: remains `PENDING` until an authorized selection record exists
- `approvals`: remains empty/pending until exactly one architecture and one operations approval cover the same candidate/configuration revision

## Authoritative documentation used

- PostgreSQL 18.6 documentation: https://www.postgresql.org/docs/18/
- PostgreSQL transaction/application consistency and explicit locking: https://www.postgresql.org/docs/18/applevel-consistency.html
- PostgreSQL `INSERT ... ON CONFLICT`: https://www.postgresql.org/docs/18/sql-insert.html
- PostgreSQL constraints/uniqueness: https://www.postgresql.org/docs/18/ddl-constraints.html
- PostgreSQL WAL / `synchronous_commit`: https://www.postgresql.org/docs/18/runtime-config-wal.html
- PostgreSQL replication / `synchronous_standby_names`: https://www.postgresql.org/docs/18/runtime-config-replication.html
- Node PostgreSQL driver package (`pg`): https://www.npmjs.com/package/pg

## Decision boundary

This proposal intentionally stops before selection. The next state transition remains one of exactly:

- `SELECT Candidate A` — then copy/review the proposed values into the canonical candidate record and obtain matching architecture + operations approvals;
- `SELECT Candidate B` — prepare the equivalent exact Cosmos DB candidate proposal/record;
- `NO SELECTION — request additional evidence/candidate`.

No provider-specific adapter code should be committed solely because this proposal is complete.
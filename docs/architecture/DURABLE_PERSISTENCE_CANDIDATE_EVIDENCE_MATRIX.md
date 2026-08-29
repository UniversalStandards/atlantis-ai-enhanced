# Durable Persistence Candidate Evidence Matrix

## Status

Decision support for the ATLANTIS seven-day operational-alpha sprint. **NO CANDIDATE SELECTED. NO IMPLEMENTATION AUTHORIZED.**

This record narrows the pending durable-persistence architecture decision using authoritative documentation while preserving `DURABLE_PERSISTENCE_ADAPTER_CANDIDATE_RECORD.md` as the approval boundary. It does not grant credentials, network access, infrastructure provisioning, deployment authority, or production enablement.

## Evaluation rule

Documentation is admission evidence only. A selected non-production candidate must still populate the canonical candidate record and pass the existing executable ownership, restart/durability, failure-injection, provider-failover, fairness, retention, immutable-writer, append-uncertainty, ownership/writer atomicity, SEC-20, and secret-safety gates unchanged.

Unknown or undocumented semantics remain unresolved; they must not be inferred from product category or marketing language.

## Candidate A — PostgreSQL 18-class transactional relational deployment

Authoritative documentation reviewed:

- PostgreSQL current transaction-processing documentation: https://www.postgresql.org/docs/current/transactions.html
- PostgreSQL transaction isolation / serializable semantics: https://www.postgresql.org/docs/current/transaction-iso.html
- PostgreSQL explicit locking: https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL synchronous standby behavior: https://www.postgresql.org/docs/current/warm-standby.html
- PostgreSQL non-durable settings and durability caveats: https://www.postgresql.org/docs/current/non-durability.html

Evidence-supported observations:

| ATLANTIS concern | Documentation-supported capability | Admission consequence |
| --- | --- | --- |
| Atomic ownership/append mutation | Transactions plus row/table locking and serializable isolation are documented | Plausible; exact schema and conditional mutation algorithm still require approval and conformance |
| Concurrency isolation | Serializable isolation is documented to reject executions inconsistent with a serial ordering | Plausible; serialization-failure mapping must preserve ATLANTIS `conflict`/`uncertain` rules |
| Fencing | Application-defined fencing can be represented transactionally, but PostgreSQL advisory locks are advisory and application-enforced | Do not treat advisory locks alone as fencing proof; durable monotonic fence state must be authoritative data |
| Commit durability | Durable commit depends on WAL/durability configuration; disabling `synchronous_commit` can lose recently reported commits after crash | Candidate configuration must explicitly prohibit durability-weakening settings used by the adapter |
| Replica/failover durability | Synchronous replication can wait for a standby to durably write commit WAL | Topology-specific failover semantics remain to be demonstrated by the existing provider-failover gate |
| Ambiguous client outcome | Network/acknowledgement ambiguity is not eliminated by transactional semantics | Must map unknown completion to ATLANTIS `uncertain` and settle by authoritative readback, never blind retry |

Open evidence before selection: exact deployment/service mode, driver/SDK and version, authoritative failover topology, transaction/isolation choice, schema/uniqueness strategy, failure-injection mechanism, credential/network class, and teardown path.

## Candidate B — Azure Cosmos DB for NoSQL transactional-partition deployment

Authoritative documentation reviewed:

- Transactional batch: https://learn.microsoft.com/azure/cosmos-db/transactional-batch
- Database transactions and optimistic concurrency control: https://learn.microsoft.com/azure/cosmos-db/database-transactions-optimistic-concurrency
- Consistency levels: https://learn.microsoft.com/azure/cosmos-db/consistency-levels

Evidence-supported observations:

| ATLANTIS concern | Documentation-supported capability | Admission consequence |
| --- | --- | --- |
| Atomic ownership/append mutation | Transactional batch is ACID with snapshot isolation for operations sharing one logical partition key | Plausible only if every atomic ownership/writer mutation can be intentionally colocated in the required partition scope |
| Conditional concurrency | Optimistic concurrency uses item `_etag` version checks; conflicting updates can be rejected | Plausible conditional primitive; exact error mapping and monotonic-fence algorithm still require conformance |
| Consistency | Five consistency levels are documented; strong consistency provides linearizability | Candidate must explicitly select and justify the read/write consistency relied on for authoritative settlement |
| Multi-region behavior | Multi-region writes can commit in secondary regions and later undergo conflict resolution | This is a material design constraint; no multi-region-write topology may be assumed safe without explicit conflict/failover proof |
| Transaction scope | Multi-item ACID scope is bounded to a logical partition | Partition-key design becomes part of the architecture decision and must not be silently chosen in adapter code |
| Ambiguous client outcome | Transactional execution does not by itself prove what a disconnected client observed | Unknown completion must remain ATLANTIS `uncertain` until authoritative readback settles it |

Open evidence before selection: exact account/API mode, single- versus multi-region write topology, partition-key design, consistency level, SDK/version, transactional-batch/OCC mapping, failover behavior, failure-injection mechanism, credential/network class, and teardown path.

## Candidate C — SQLite WAL embedded durable deployment

Authoritative documentation reviewed:

- WAL mode: https://www.sqlite.org/wal.html
- Transaction isolation: https://www.sqlite.org/isolation.html
- Transactional guarantees: https://www.sqlite.org/transactional.html
- Synchronous pragma: https://www.sqlite.org/pragma.html#pragma_synchronous

Evidence-supported observations:

| ATLANTIS concern | Documentation-supported capability | Admission consequence |
| --- | --- | --- |
| Atomic local transactions | SQLite documents serializable transactions and serialized writes | Plausible for a single-host authoritative store |
| Concurrent clients | Multiple connections may share a database, but writes are serialized | Independent-client proof is possible only inside the topology SQLite actually supports |
| WAL topology | WAL requires participating processes to be on the same host and does not work over a network filesystem | A multi-host provider-failover claim is not supported by WAL itself; external coordination/replication would become a separate architecture choice |
| Commit durability | WAL durability depends on `synchronous`; NORMAL can lose committed transactions after power loss while FULL syncs WAL on each commit | Candidate configuration would need an explicit durability policy and crash/power-loss acceptance analysis |
| Failover | Native WAL documentation does not establish a remote replica/failover mechanism | This is a major gap against the sprint's provider-failover threshold unless another approved durable/failover layer is introduced |
| Ambiguous client outcome | Local transactional semantics do not remove process/crash ambiguity at the adapter boundary | Unknown completion must still settle through authoritative readback without blind retry |

Open evidence before selection: whether a single-host topology can satisfy the required provider-failover threshold at all, exact SQLite version/driver, journal/synchronous settings, host-storage durability, fencing representation, failure injection, restart boundary, and any separately approved replication/failover layer.

## Comparative decision matrix

| Criterion | PostgreSQL 18-class | Azure Cosmos DB for NoSQL | SQLite WAL |
| --- | --- | --- | --- |
| Documented atomic transaction primitive | Yes | Yes, within one logical partition | Yes, local database |
| Documented concurrency primitive usable for conditional authority | Transactions/locks/serializable behavior | `_etag` OCC + transactional batch | Serialized writer + transactions |
| Native topology compatible with genuinely independent clients | Yes | Yes | Same-host processes/connections |
| Native remote/provider failover evidence available in reviewed docs | Replication mechanisms documented; exact topology still pending | Regional replication/consistency documented; exact write/failover semantics still pending | No native remote WAL failover proof |
| Architecture-sensitive partition/schema choice | Schema/constraints/transaction design | Logical partition key is transaction boundary | File/host topology and schema |
| Durability configuration can materially weaken guarantees | Yes | Consistency/topology choices materially affect guarantees | Yes (`synchronous`, journal/checkpoint/storage choices) |
| ATLANTIS uncertainty reconciliation still required | Yes | Yes | Yes |
| Ready to implement without approval | **No** | **No** | **No** |

## Deterministic selection acceptance criteria

Architecture/operations may select a candidate only when every item below is answered in the canonical candidate record with non-secret, reviewable evidence. A missing or ambiguous answer is a **no-select** result, not permission for adapter code to invent the answer.

1. **Atomic authority mutation:** identify the exact transaction/conditional primitive that can atomically preserve ownership, monotonic fencing, and append authority for the approved data model.
2. **Authoritative settlement:** identify the exact read path used after an ambiguous client outcome and demonstrate that settlement never requires blind replay of the mutation.
3. **Durability posture:** name the exact durability/consistency settings relied upon and explicitly prohibit weaker settings that would invalidate ATLANTIS acknowledgement semantics.
4. **Independent-client topology:** define how at least two genuinely independent clients reach the same authoritative state and what restart boundary the durability gate will cross.
5. **Failover topology:** define the concrete alternate replica/provider/failover path, the authoritative-state rule during transition, and the failure injection that proves it. A topology with no credible path to the existing provider-failover gate is not selectable for Day-7.
6. **Conflict/error mapping:** map serialization, conditional-write, timeout, disconnect, and unknown-completion outcomes into the existing ATLANTIS success/conflict/uncertain contract without weakening it.
7. **Credential/network class:** identify classes and boundaries only; do not place credential values, tokens, connection strings, or permission grants in the record.
8. **Reversibility:** document disabled-by-default registration, teardown, rollback, and removal without changing production authority.
9. **Conformance feasibility:** show how the unchanged ownership, durability, failure-injection, failover, fairness, retention/compaction, immutable-writer, and append-uncertainty harnesses will execute against the candidate.
10. **Approval identity:** exactly one architecture approval and one operations approval must cover the same candidate identity/configuration revision admitted by the machine validator.

## Explicit disqualifiers for this sprint

A candidate is not selectable for the Day-7 durable adapter when any of the following remains true:

- atomic ownership/fence/append authority would require a second unapproved coordination system;
- acknowledged writes can be lost under the proposed normal configuration without ATLANTIS receiving an `uncertain` outcome;
- ambiguous completion can only be handled by retrying the original mutation rather than authoritative readback;
- the proposed topology cannot exercise the already-required genuine failover gate;
- required transaction scope depends on an unresolved schema/partition decision;
- the candidate requires production credentials, production networking, protected deployment authority, or irreversible infrastructure mutation merely to run non-production conformance;
- the adapter would need to weaken an existing ATLANTIS contract or validator to pass.

## Decision handoff

The architecture/operations decision should be recorded as one of exactly four outcomes: `SELECT Candidate A`, `SELECT Candidate B`, `SELECT Candidate C`, or `NO SELECTION — request additional evidence/candidate`. A selection is valid only when the exact deployment mode/configuration revision is simultaneously captured in `DURABLE_PERSISTENCE_ADAPTER_CANDIDATE_RECORD.md` and passes the existing candidate-authorization validator. The selection authorizes only disabled-by-default non-production adapter implementation and conformance execution.

This handoff deliberately does not rank or choose a provider. It makes the next human architecture decision bounded, auditable, and directly convertible into the already-landed machine admission path.

## Decision blockers that remain

1. Architecture/operations must select exactly one non-production candidate or explicitly request another candidate for evidence review.
2. The selected candidate's exact service/deployment mode, version, driver/SDK, topology, transaction/conditional primitive, consistency/durability settings, credential class, network boundary, failure-injection method, and reversible teardown path must populate `DURABLE_PERSISTENCE_ADAPTER_CANDIDATE_RECORD.md`.
3. Any topology relying on failover must document what constitutes authoritative state before, during, and after failover and how an ambiguous append is settled without replaying the mutation.
4. Selection authorizes only disabled-by-default non-production adapter implementation and conformance execution. It does not authorize production deployment.

## Current conclusion

The evidence is sufficient to make the next architecture review concrete but **not** to select a winner automatically. PostgreSQL and Cosmos DB each expose documented primitives that could plausibly support the ATLANTIS invariants with different topology/semantic tradeoffs. SQLite provides strong local transactional properties but its documented WAL topology leaves the sprint's remote/provider-failover requirement unresolved without an additional architecture layer.

Until an explicit selection is recorded, continue independent browser, telemetry, self-improvement, external-artifact, governed-run, deployment/rollback, and burn-in workstreams.
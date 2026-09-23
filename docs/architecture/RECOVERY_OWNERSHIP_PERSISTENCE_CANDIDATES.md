# Recovery Ownership Persistence Candidate Decision Package

## Status

Decision package for the ATLANTIS operational-alpha sprint. This document compares concrete implementation candidates against the already-landed `RecoveryOwnershipStore` contract and conformance suites. It does **not** select a production provider, authorize credentials, expand network access, authorize deployment, or weaken any existing acceptance gate.

## Decision to make

Select the first durable adapter mechanism that will implement `RecoveryOwnershipStore` and run the existing baseline, durability, retention/compaction, and fairness suites against real durable state.

The selected mechanism must also remain compatible with the production persistence and uncertain-outcome gate. Production binding is prohibited until the adapter evidence is green.

## Required invariants

Every candidate must demonstrate all of the following at the real adapter boundary:

1. Exactly one acquisition winner for the same `(recoveryId, executionId)` under independent-process contention.
2. Atomic claim creation, renewal, release, expiry takeover, and fence advancement.
3. A durable monotonically increasing fence that is never reset by release, restart, retention, or compaction.
4. Opaque claim/token authority that is never exposed through non-owner observation or diagnostic evidence.
5. Exact-live-lease renewal and stale-authority rejection.
6. Restart-surviving ownership and preservation of `acquiredAtEpochMs` so the bounded-continuation budget cannot reset after restart.
7. Acknowledgement-loss reconciliation without duplicate authority.
8. Pre-commit failure invisibility: failed acquisition must not become observable after restart.
9. Replay and identity-substitution rejection.
10. Retention/compaction safety: maintenance cannot erase fencing history required to reject stale owners.
11. Transactional behavior sufficient to integrate immutable writer evidence without blind retry after an uncertain outcome.
12. Least-privilege operation without production credentials in pull-request CI.

## Candidate A — PostgreSQL transactional adapter

### Atomicity model

Use a durable ownership row keyed by `(recovery_id, execution_id)` and a transaction that locks or conditionally updates that row. Acquisition/expiry takeover advances the persisted fence in the same transaction that installs fresh claim authority. Renewal conditionally updates only when claim identity, authority digest, fence, and current expiry match the live row. Release removes live authority while retaining the fence/history required for stale-owner rejection.

### Strengths

- Strong transactional semantics map directly to acquisition, renewal, release, fencing, and immutable writer requirements.
- Row-level locking and conditional `UPDATE ... WHERE ...` permit deterministic single-winner contention.
- A single relational transaction can potentially cover ownership state plus writer/event metadata when co-located, reducing cross-store atomicity risk.
- Durable readback supports acknowledgement-loss reconciliation and uncertain-outcome classification.
- Mature migration, backup, recovery, observability, and local integration-test tooling.

### Risks / proof obligations

- Connection loss after transaction commit must be reconciled by authoritative readback; the adapter must not blindly retry.
- Isolation level and transaction boundaries must be explicit and tested under concurrent independent connections.
- Authority tokens should be stored as one-way digests where equality proof is sufficient; raw authority must not enter logs or diagnostics.
- Retention jobs must preserve fence/history state even when expired/released claim material is compacted.
- Production deployment introduces database credentials and network/data-plane access and therefore requires the separate security gate.

### Evidence needed before selection becomes binding

- Schema and migration/rollback design.
- Transaction pseudocode for acquire/renew/release/observe.
- Independent-connection contention test design.
- Failure injection at pre-commit and post-commit/pre-ack boundaries.
- Confirmation of how ownership and immutable-writer state share or coordinate transaction boundaries.

## Candidate B — Azure Cosmos DB conditional-write adapter

### Atomicity model

Use a single logical partition for each recovery ownership aggregate and conditional writes based on item ETag/version. Fence advancement and fresh authority installation must occur in one conditional replacement/transactional-batch operation. Renewal/release must condition on the exact current durable version and authority identity.

### Strengths

- Native optimistic concurrency and conditional writes can express single-winner acquisition.
- Managed durability and horizontal distribution reduce database operational burden.
- Transactional batch can provide atomic operations within a logical partition when the data model is deliberately co-partitioned.
- Durable item readback can support acknowledgement-loss reconciliation.

### Risks / proof obligations

- Atomicity is partition-scoped; partition-key design becomes part of the correctness proof.
- Cross-store/cross-partition composition with immutable writer evidence can reintroduce unresolved atomicity.
- Consistency configuration affects authoritative observation and takeover semantics and must be fixed by architecture, not inherited accidentally from deployment defaults.
- Emulator/test parity and failure injection must be demonstrated rather than assumed.
- Production use requires cloud credentials/network permissions and therefore cannot be silently enabled from this sprint branch.

### Evidence needed before selection becomes binding

- Exact partition-key and item schema.
- ETag/transactional-batch algorithms for acquire/renew/release/observe.
- Consistency-level rationale tied to ownership correctness.
- Cross-partition/cross-store atomicity analysis.
- Emulator versus production acceptance-test parity plan.

## Candidate C — SQLite transactional adapter

### Atomicity model

Use a durable local database with explicit transactions and a uniqueness key on `(recovery_id, execution_id)`. Acquisition and fence advancement occur in one write transaction; renewal/release condition on exact durable authority. WAL mode may improve concurrency but is not itself the correctness mechanism.

### Strengths

- Minimal operational surface and excellent deterministic local/test reproducibility.
- Strong transactional semantics for a single database file.
- Very low setup cost for a single-node operational alpha or reference durable adapter.
- Useful as a durable conformance implementation even if a distributed production mechanism is later selected.

### Risks / proof obligations

- A local database file does not by itself provide multi-host distributed ownership.
- Shared/network filesystem use is not accepted as a substitute for demonstrated database semantics.
- Process-level concurrency can be tested, but multi-node failover/HA requires a different topology or mechanism.
- A SQLite adapter must not be described as the production distributed solution unless the deployment topology intentionally constrains ownership to one durable host.

### Evidence needed before selection becomes binding

- Explicit topology statement: single durable host versus distributed workers.
- Transaction and busy/locking policy.
- Independent-process contention and process-kill/restart evidence.
- Filesystem durability/backup/restore assumptions.

## Comparative decision matrix

| Criterion | PostgreSQL | Cosmos DB | SQLite |
| --- | --- | --- | --- |
| Single-row/aggregate atomic ownership | Strong fit | Strong within partition | Strong on one DB file |
| Independent-process contention | Strong | Strong with conditional writes | Strong on same host/file; topology-limited |
| Monotonic durable fencing | Strong fit | Strong fit | Strong fit |
| Ack-loss authoritative readback | Strong fit | Strong fit | Strong fit |
| Co-transaction with relational event/writer state | Strongest candidate | Partition/model dependent | Strong on one local DB |
| Cross-store atomicity risk | Low if co-located | Medium/high unless co-partitioned/co-modeled | Low locally; topology-limited |
| Distributed/multi-host production topology | Strong | Strong | Weak without additional architecture |
| Local deterministic integration testing | Strong | Emulator/service dependent | Strongest |
| Operational complexity | Medium | Medium/service-managed | Low |
| New production credentials/network gate | Yes | Yes | Potentially no for local-only topology |
| Best role | Production/default candidate | Cloud-native alternative | Durable reference/single-node candidate |

## Provisional engineering recommendation — non-binding

Use **PostgreSQL as the first production-candidate design to prototype**, while keeping the provider-neutral contract authoritative. This is a recommendation for the next architecture review, not authorization to provision or bind production persistence.

Reasoning: the sprint needs both durable recovery ownership and immutable writer/event-store evidence. A relational transaction boundary offers the clearest path to proving those invariants together and minimizing the unresolved cross-store atomicity problem. Cosmos DB remains viable if partitioning and consistency can place the required atomic state inside one correctness boundary. SQLite is valuable as a durable local conformance adapter but should not silently define a distributed production topology.

## Reversible work allowed before provider approval

The following work can proceed without selecting or provisioning a provider:

1. Define a provider-neutral durable-record mapping from `RecoveryOwnershipStore` fields to persisted claim/fence state.
2. Define transaction/CAS pseudocode for acquire, renew, release, observe, expiry takeover, and acknowledgement-loss reconciliation.
3. Extend adapter factories so the same baseline, durability, retention/compaction, and fairness suites can be registered by any durable adapter.
4. Define deterministic failure-injection hooks around `before-commit` and `after-commit-before-ack` without implementing provider-specific transport.
5. Define secret-safe storage requirements for ownership authority and diagnostic projections.
6. Define the integration boundary with immutable writer evidence and enumerate which operations require one atomic transaction versus durable reconciliation.
7. Prepare schema/migration tests as provider-neutral fixtures where possible.

## Approval boundary

Explicit architecture approval is required before any of the following:

- declaring one candidate the production persistence mechanism;
- adding production database/cloud credentials;
- expanding network or workflow permissions;
- provisioning a production data plane;
- choosing a topology that changes availability or consistency guarantees;
- weakening any conformance requirement because a provider cannot satisfy it;
- binding production execution to the new adapter.

## Exit criteria

The persistence decision gate can close only when the selected candidate has:

1. an approved schema and atomicity rationale;
2. migration and rollback procedures;
3. baseline + durability + retention/compaction + fairness suites green against the real adapter;
4. independent-process contention evidence;
5. restart/crash and acknowledgement-loss evidence;
6. immutable-writer integration evidence or an explicit proven reconciliation boundary;
7. secret/permission inventory and security review;
8. CI evidence tied to the exact tested revision;
9. operator recovery/quarantine procedures.

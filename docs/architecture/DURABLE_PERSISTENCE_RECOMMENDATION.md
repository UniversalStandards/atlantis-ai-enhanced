# Durable Persistence Candidate Recommendation

## Status

**RECOMMEND CANDIDATE A — POSTGRESQL 18-CLASS FOR THE FIRST BOUNDED DAY-7 NON-PRODUCTION CONFORMANCE IMPLEMENTATION. NOT SELECTED. IMPLEMENTATION NOT YET AUTHORIZED.**

This recommendation narrows the architecture decision. It does not replace the required architecture/operations approval, does not populate approval identities, does not grant credentials/network access, and does not authorize production use.

The canonical selection remains governed by:

- `DURABLE_PERSISTENCE_ADAPTER_DECISION.md`;
- `DURABLE_PERSISTENCE_CANDIDATE_EVIDENCE_MATRIX.md`;
- `DURABLE_PERSISTENCE_ADAPTER_CANDIDATE_RECORD.md`;
- `DURABLE_PROGRAM_MODEL.md`.

## Recommendation

For the first ATLANTIS durable recovery-ownership + immutable-append adapter, use **Candidate A: a PostgreSQL 18-class transactional deployment** as the preferred candidate for architecture/operations approval.

Candidate B, Azure Cosmos DB for NoSQL, remains a viable alternative and is not rejected. Candidate C, SQLite WAL, retains its existing Day-7 non-selectable disposition because its reviewed native topology does not establish the required remote/failover path without an additional architecture layer.

## Why Candidate A is the stronger first fit

### 1. ATLANTIS invariants map directly to general transactions

ATLANTIS needs ownership acquisition, monotonic fencing, stale-owner rejection, immutable append, expected-version checks, exact committed readback, and uncertainty settlement.

A relational transactional model allows these identities and conditions to be represented as authoritative rows/constraints and mutated together under one explicit transaction boundary. That is a closer semantic match to the existing provider-neutral contracts than a store whose multi-item ACID semantics depend on a separately chosen logical partition key.

This does not make PostgreSQL automatically correct. The schema, transaction algorithm, isolation level, unique constraints, retry/error mapping, and failover configuration still require explicit approval and conformance.

### 2. It minimizes new architecture decisions inside the adapter

Cosmos DB's transactional batch scope is intentionally bounded to a logical partition. That makes partition-key design part of the authority model. For ATLANTIS, choosing that key incorrectly could split ownership, fencing, append identity, or settlement state across transaction boundaries.

PostgreSQL still requires schema design, but the transaction boundary is not constrained by an application partition key chosen for the service. This reduces the risk that provider topology becomes hidden canonical workflow semantics.

### 3. Authoritative readback after acknowledgement ambiguity is straightforward to model

ATLANTIS already requires ambiguous post-commit/pre-ack outcomes to become `uncertain`, followed by authoritative readback rather than blind mutation replay.

A relational record keyed by immutable operation/execution/event identities plus expected/successor stream versions and digest can provide a direct settlement target. Provider/driver errors must still be classified conservatively; unknown outcomes remain `uncertain`.

### 4. Fencing can remain durable data rather than an advisory lock

PostgreSQL advisory locks MUST NOT be treated as the fencing proof. The recommended implementation should store a monotonic fencing token as authoritative transactional data and use conditions/constraints to reject stale owners.

This matches ATLANTIS's existing rule that authority must survive process loss and must be independently verifiable from durable state.

### 5. It aligns with the durable-program separation without making a workflow vendor canonical

The newly ingested Vercel workflow architecture evidence describes a swappable runtime `World` and notes a first-party Postgres-backed implementation inspired by DBOS. That is useful evidence that a programming-language-first durable runtime can place Postgres beneath workflow semantics rather than inside workflow source code.

This is supporting architectural evidence only. Vercel Workflow SDK and DBOS are **not** selected by this recommendation, and ATLANTIS must not adopt their history, control-plane, hook, compiler, or execution semantics without independent contract mapping and approval.

### 6. It leaves future runtime/provider substitution open

The first adapter should implement existing provider-neutral ATLANTIS ports behind a disabled-by-default registration boundary. Nothing in workflow source should depend on SQL, a Postgres-specific workflow API, or a vendor-specific history representation.

If Candidate A later fails conformance, Candidate B or another approved substrate can replace it without redefining ATLANTIS workflow semantics.

## Why Candidate B is not the first recommendation

Azure Cosmos DB for NoSQL has documented strengths that remain relevant:

- transactional batch inside one logical partition;
- optimistic concurrency through `_etag`;
- selectable consistency levels;
- managed multi-region capabilities.

It is not the first recommendation because its correctness depends on more topology-specific choices before ATLANTIS can prove the same invariants:

1. the logical partition key becomes part of the atomicity architecture;
2. exact consistency level must be selected and justified;
3. single-region versus multi-region write topology materially changes conflict/failover behavior;
4. multi-region conflict semantics must be reconciled with ATLANTIS's single authoritative ownership/fencing model;
5. transactional scope and settlement design therefore require more provider-specific architecture before the first conformance adapter can remain small and reversible.

These are tradeoffs, not defects. Candidate B remains appropriate if architecture/operations prefer its managed topology and explicitly approve the required partition/consistency/failover design.

## Candidate A configuration fields still required before selection

The recommendation cannot become `SELECT Candidate A` until every required field below is populated in `DURABLE_PERSISTENCE_ADAPTER_CANDIDATE_RECORD.md` with non-secret values.

| Field | Required decision |
| --- | --- |
| Candidate ID | Immutable candidate/configuration identity |
| Deployment/service mode | Exact PostgreSQL deployment used for non-production conformance |
| Server version | Exact supported 18-class version/revision |
| Driver | Exact Node/TypeScript PostgreSQL driver and version |
| Authoritative topology | Primary/standby or other exact topology |
| Transaction isolation | Exact isolation level(s) used by each authority mutation |
| Durability settings | Exact WAL/commit settings; settings that weaken required acknowledgement durability must be prohibited |
| Schema | Ownership/fence, append/event, operation identity, uncertainty settlement, and uniqueness model |
| Acquire algorithm | Exact conditional transaction producing the next monotonic fence |
| Renew/release algorithms | Exact authoritative owner/fence predicates |
| Append algorithm | Exact expected-version + immutable identity/digest transaction |
| Error mapping | Driver/server error → committed/conflict/known-failure/uncertain |
| Settlement read | Exact authoritative query after an uncertain outcome |
| Independent-client proof | How at least two separate clients/processes reach the same store |
| Restart proof | What process/service is terminated/recreated |
| Failover proof | Exact alternate path, authoritative-state rule, and failure injection |
| Credential class | Identity type only; no secret value |
| Network boundary | Approved non-production network/endpoint class |
| Feature gate | Disabled-by-default adapter registration |
| Rollback/teardown | Exact reversible disable/removal process |

## Required implementation shape after approval

If Candidate A is selected, implementation should remain deliberately narrow:

1. add one provider-specific adapter package/module behind existing provider-neutral interfaces;
2. keep registration disabled by default;
3. do not change canonical workflow contracts to match SQL/provider behavior;
4. do not introduce a new workflow control plane;
5. do not grant production credentials or deployment authority;
6. run existing conformance suites unchanged;
7. add provider-specific failure injection only where needed to prove already-required semantics;
8. emit candidate-bound evidence with configuration digests excluding secrets;
9. classify ambiguous failures as `uncertain` unless authoritative evidence proves a narrower state;
10. remove or disable the adapter cleanly if any required gate fails.

## Minimum proof before Day-7 promotion

Candidate A must not be described as the durable adapter until it passes real, candidate-bound evidence for:

- independent-client shared authority;
- genuine restart persistence;
- acquire/renew/release/expiry/reacquisition;
- monotonic fencing and stale-owner rejection;
- contention/fairness;
- immutable append and expected-version conflict;
- pre-commit known failure;
- post-commit/pre-ack uncertainty;
- authoritative uncertainty settlement without blind replay;
- ownership/writer atomicity;
- failure during/around failover;
- retention/cleanup safety where applicable;
- SEC-20 frozen dependency admission;
- secret-safety;
- exact evidence/readback identity.

Green process-local tests are not substitutes for these proofs.

## Decision options after this recommendation

The authorized architecture/operations decision remains exactly one of:

1. `SELECT Candidate A — PostgreSQL 18-class`, with the complete candidate record and matching approvals;
2. `SELECT Candidate B — Azure Cosmos DB for NoSQL`, with the complete candidate record and matching approvals;
3. `NO SELECTION — request additional evidence/candidate`.

## Current disposition

**RECOMMEND Candidate A. HOLD implementation until the canonical candidate record is fully populated and matching architecture/operations approval is recorded.**

This recommendation advances the decision without crossing the established governance boundary.
# Durable Persistence Adapter Candidate Record

## Status

**ENGINEERING SELECTION AUTHORIZED BY STANDING PROGRAM INTENT.** This record governs the first production-ready, disabled-by-default persistence implementation and its non-production conformance execution. It does not by itself authorize production deployment, production credentials, or irreversible external mutation.

`PRODUCTION_READINESS_AND_EXECUTION_AUTHORITY.md` is controlling for the distinction between production-ready engineering and production deployment authority.

## Selected engineering candidate

**Candidate A — PostgreSQL 18-class**, using the exact production-ready proposal in `DURABLE_PERSISTENCE_POSTGRESQL_APPROVAL_PROPOSAL.md` and the rationale in `DURABLE_PERSISTENCE_RECOMMENDATION.md`.

The selection is based on the existing ATLANTIS invariants: transactional ownership/fencing, immutable append, deterministic expected-version conflicts, authoritative uncertainty reconciliation, independent-client durability, restart/failover proof, and provider-neutral contracts.

Candidate B — Azure Cosmos DB for NoSQL — remains an evaluated alternative, not the selected first implementation.

## Authority boundary

Engineering may proceed without another human approval cycle to:

1. implement the PostgreSQL adapter behind existing provider-neutral ports;
2. add the pinned driver/dependencies after frozen-lockfile and SEC-20 admission;
3. add schemas/migrations and production-ready configuration surfaces;
4. run local/CI/containerized non-production PostgreSQL, including restart/failover and deterministic failure injection;
5. execute all existing ownership, writer, uncertainty, fairness, retention, restart, and conformance gates;
6. produce immutable candidate-bound evidence and rollback/disable procedures.

This selection does **not** lower the quality bar because execution is non-production. The implementation must be production-ready.

Human intervention remains required only for boundaries identified by `PRODUCTION_READINESS_AND_EXECUTION_AUTHORITY.md`, such as unavailable credentials/account-owner actions, materially irreversible external effects, or production privilege/deployment expansion not otherwise authorized.

## Candidate identity

| Field | Selected value |
| --- | --- |
| Candidate ID | `postgresql-18-day7-durable-v1` |
| Product / substrate | PostgreSQL 18-class |
| Version / service mode | Exact pinned 18.x patch version from the PostgreSQL proposal/build evidence |
| Driver / SDK | Exact pinned `pg` 8.x version admitted by frozen-lockfile and SEC-20 gates |
| Authoritative topology | Isolated non-production primary with synchronous standby for failover proof; exact topology captured in run evidence |
| Consistency mode | Transactional PostgreSQL semantics; authority-changing operations use the proposal's explicit isolation/locking rules |
| Transaction primitive | Explicit transactions plus constraints/locking/conditional mutation as specified by the proposal |
| Independent-client topology | Genuinely independent ATLANTIS clients connect to the same authoritative PostgreSQL state |
| Restart boundary | Client process recreation plus authoritative database restart/failover scenarios |
| Credential class | Least-privilege non-production database role; no secret values in repository/evidence |
| Network boundary | Isolated local/CI/container test network unless a separately authorized real-provider environment is used |
| Feature gate | Explicit PostgreSQL durability adapter registration/configuration |
| Feature gate default | Disabled |
| Rollback / disable | Disable adapter registration and revert to prior configured provider; schema/state retained for evidence unless approved cleanup occurs |

Exact runtime patch/build/configuration identities must be captured from execution evidence rather than silently inferred.

## Semantic mapping required for acceptance

Executable conformance remains authoritative.

1. **Acquire:** one atomic/conditional operation establishes ownership and the next monotonic fencing token.
2. **Renew:** only the current unexpired owner/fence may renew; stale owners cannot regain authority by renewal.
3. **Release:** only the authoritative owner/fence may release; stale release cannot affect a successor.
4. **Expiry/reacquisition:** reacquisition after expiry advances fencing monotonically and preserves stale-owner rejection evidence.
5. **Fairness:** the algorithm satisfies the existing fairness contract under contention; PostgreSQL scheduling behavior may not redefine fairness.
6. **Immutable append:** one transaction binds operation ID, execution ID, event ID, expected stream version, immutable-content digest, and successor version.
7. **Conflict:** failed expected-version/uniqueness conditions map deterministically to the existing conflict outcome.
8. **Known failure:** authoritative proof that no commit occurred maps to known failure.
9. **Acknowledgement loss:** post-commit/pre-ack ambiguity maps to uncertain until authoritative readback proves exact commit or non-commit.
10. **Uncertain reconciliation:** reconciliation uses `DurableAppendUncertaintyRecord` and authoritative readback; never blind mutation retry.
11. **Quarantine:** identity, version, or immutable-content disagreement remains fail-closed/quarantined.
12. **Ownership/writer atomicity:** no reachable state permits two writers to possess valid authority for the same protected mutation.
13. **Retention:** cleanup cannot destroy evidence required for fencing, stale-owner rejection, append settlement, or release evidence.

## Provider error mapping

| Provider condition | Canonical outcome | Required authoritative follow-up |
| --- | --- | --- |
| Constraint/version rejection with authoritative non-commit | `conflict` | Read current authoritative version/identity as required by contract |
| Deterministic pre-commit rejection/failure | `known-failure` | Prove no mutation became visible |
| Success with authoritative commit acknowledgement | `committed` | Exact committed identity/version/digest evidence |
| Timeout, disconnect, cancellation, failover, or acknowledgement loss where commit is unknown | `uncertain` | Readback-only reconciliation; no blind retry |
| Readback identity/version/digest discrepancy | quarantine/fail closed | No mutation retry or evidence substitution |

Unknown driver/provider errors default to `uncertain` unless authoritative semantics prove a narrower result.

## Failure-injection plan

The implementation must provide deterministic, repeatable injection for at least:

- pre-commit failure before authoritative mutation;
- post-commit/pre-acknowledgement loss;
- concurrent ownership acquisition;
- stale renew/release after successor acquisition;
- client termination and recreation;
- authoritative-store restart/failover;
- append expected-version conflict;
- readback timeout/unavailability while append remains uncertain;
- substituted operation/execution/event identity;
- substituted immutable-content digest or successor stream version.

## Executable admission matrix

| Gate | Required proof |
| --- | --- |
| Recovery ownership baseline | acquire/renew/release/expiry/reacquisition and stale-owner isolation |
| Durable ownership | genuinely independent clients and genuine restart persistence |
| Failure injection | pre-commit and post-commit/pre-ack behavior |
| Fairness | existing contention/fairness assertions unchanged |
| Retention | existing applicable retention assertions unchanged |
| Immutable writer | exact fencing/writer/event commit evidence |
| Durable append uncertainty | committed/conflict/known-failure/uncertain plus authoritative settlement |
| Ownership/writer atomicity | no double-valid-writer state under contention/failure |
| SEC-20 | frozen dependency integrity/source, inventory, vulnerability admission |
| Secret safety | no secrets in traces, fixtures, logs, repository, or release artifacts |

Process-local object replacement is not restart durability evidence.

## Evidence manifest

Each conformance execution must emit immutable candidate-bound identities sufficient to reproduce and audit the result: candidate ID; adapter version; PostgreSQL version; driver version; non-secret configuration digest; topology identifier; source commit; test-suite identity/version; run ID; start/end timestamps; disposition; evidence artifact IDs; and restart/failover/failure-injection scenario IDs.

Evidence from another candidate, configuration, topology, commit, or run may not be substituted.

## Production readiness vs production deployment

Successful implementation and conformance may establish that this adapter is **production-ready**. It does not automatically establish that it is **production-deployed**, **production-tested against a live production environment**, or **production-authorized**. Those claims require their own evidence.

## Rejection triggers

Reject or correct the implementation if it requires blind retry after ambiguity, wall-clock-only ownership without fencing, process-local authoritative state, eventual observation incapable of exact settlement, destructive reconciliation, secret-bearing evidence, hidden provider-specific semantics in canonical contracts, or weakening any existing conformance assertion.

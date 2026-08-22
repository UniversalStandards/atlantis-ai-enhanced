# Durable Persistence Adapter Candidate Record

## Status

Architecture/operations decision record for the ATLANTIS seven-day operational-alpha sprint. **UNSELECTED / BLOCKED FOR IMPLEMENTATION.** This record intentionally does not select a database, cloud service, credential model, network path, deployment topology, or production authority.

It operationalizes `DURABLE_PERSISTENCE_ADAPTER_DECISION.md` so an authorized candidate can be evaluated without changing the provider-neutral contracts or weakening their conformance gates.

## Candidate identity — required before authorization

The approving decision must fill every field below with non-secret, reproducible values:

| Field | Required value |
| --- | --- |
| Candidate ID | Stable evidence-safe identifier |
| Product / substrate | Exact implementation substrate |
| Version / service mode | Exact version or managed-service mode |
| Driver / SDK | Exact package and version, admitted by frozen-lockfile and SEC-20 gates |
| Authoritative topology | Where authoritative ownership and append state reside |
| Consistency mode | Exact documented consistency/isolation semantics relied upon |
| Transaction primitive | Exact transaction or conditional-write primitive |
| Independent-client topology | How genuinely independent clients reach one authoritative store |
| Restart boundary | What process/service state is terminated and recreated during proof |
| Credential class | Non-secret identity/credential type only |
| Network boundary | Non-secret endpoint/network policy description |
| Feature gate | Disabled-by-default registration/configuration control |
| Rollback / disable | Exact reversible disable path |

No credential value, token, connection string, private endpoint, or other secret belongs in this record or its evidence.

## Semantic mapping required for approval

The candidate supplement must map its documented semantics to each invariant below. Documentation claims are admission evidence only; executable conformance remains authoritative.

1. **Acquire:** one atomic/conditional operation establishes ownership and the next monotonic fencing token.
2. **Renew:** only the current unexpired owner/fence may renew; stale owners cannot regain authority by renewal.
3. **Release:** only the authoritative owner/fence may release; stale release cannot affect a successor.
4. **Expiry/reacquisition:** reacquisition after expiry advances fencing monotonically and preserves stale-owner rejection evidence.
5. **Fairness:** the chosen algorithm must satisfy the existing fairness contract under contention; provider scheduling behavior may not silently redefine fairness.
6. **Immutable append:** one operation binds operation ID, execution ID, event ID, expected stream version, immutable-content digest, and successor version.
7. **Conflict:** a failed expected-version/uniqueness condition maps deterministically to the existing conflict outcome.
8. **Known failure:** authoritative proof that no commit occurred maps to known failure.
9. **Acknowledgement loss:** any post-commit/pre-ack path maps to uncertain until authoritative readback proves exact commit or non-commit.
10. **Uncertain reconciliation:** reconciliation uses `DurableAppendUncertaintyRecord` and authoritative readback; it never blindly repeats the mutation.
11. **Quarantine:** identity, version, or immutable-content disagreement remains fail-closed/quarantined.
12. **Ownership/writer atomicity:** no reachable state may allow two writers to possess valid authority for the same protected mutation.
13. **Retention:** compaction/TTL/cleanup cannot destroy evidence required for fencing, stale-owner rejection, append settlement, or release evidence.

## Provider error mapping

Before implementation, the candidate supplement must enumerate the actual provider/driver error classes and map each to exactly one canonical outcome:

| Provider condition | Canonical outcome | Required authoritative follow-up |
| --- | --- | --- |
| Conditional/version rejection with authoritative non-commit | `conflict` | Read current authoritative version/identity as required by existing contract |
| Deterministic pre-commit rejection/failure | `known-failure` | Prove no mutation became visible |
| Success with authoritative commit acknowledgement | `committed` | Exact committed identity/version/digest evidence |
| Timeout, disconnect, cancellation, failover, or acknowledgement loss where commit is not known | `uncertain` | Readback-only reconciliation; no blind retry |
| Readback identity/version/digest discrepancy | quarantine/fail closed | No mutation retry or evidence substitution |

Unknown provider errors default to `uncertain` unless authoritative semantics prove a narrower outcome.

## Failure-injection plan

The authorized environment must provide deterministic, repeatable injection for at least:

- pre-commit failure before any authoritative mutation;
- post-commit/pre-acknowledgement loss;
- concurrent ownership acquisition;
- stale renew and stale release after successor acquisition;
- client termination and recreation;
- authoritative-store restart/failover when applicable to the selected topology;
- append expected-version conflict;
- readback timeout/unavailability while an append remains uncertain;
- substituted operation/execution/event identity;
- substituted immutable-content digest or successor stream version.

Failure injection must not require weakening assertions or granting production mutation authority.

## Executable admission matrix

Authorization to implement means only that the adapter may be registered, disabled by default, into the already-landed gates. Release evidence requires all applicable rows to pass unchanged:

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
| SEC-20 | frozen dependency integrity/source, inventory, and vulnerability admission |
| Secret safety | no secrets in traces, fixtures, logs, repository, or release artifacts |

Process-local object replacement is not restart durability evidence.

## Evidence manifest required after execution

Each conformance execution must emit immutable, candidate-bound identities sufficient to reproduce and audit the result: candidate ID; adapter version; driver/SDK version; configuration digest with secrets excluded; topology identifier; source commit; test-suite identity/version; run ID; start/end timestamps; disposition; evidence artifact IDs; and authoritative-store/restart/failure-injection scenario IDs.

Evidence from another candidate, configuration, topology, commit, or run may not be substituted.

## Architecture/operations decision

**Decision: PENDING.**

An authorized reviewer must select exactly one candidate and approve its non-production execution environment before provider-specific implementation begins. The selection must cite the candidate's authoritative consistency/transaction documentation and fill the identity, semantic mapping, error mapping, failure-injection, credential/network, and rollback fields above.

Selection is not production authorization and is not Day-7 release proof. Production enablement remains separately approval gated.

## Rejection triggers

Reject the candidate if it requires blind retry after ambiguity, wall-clock-only ownership without fencing, process-local authoritative state, eventual observation incapable of exact settlement, destructive reconciliation, secret-bearing evidence, privileged workflow permissions not separately approved, hidden provider-specific semantics in canonical contracts, or weakening any existing conformance assertion.

## Safe parallel work while pending

While this decision remains pending, continue the independent browser-runtime, telemetry-binding, self-improvement operational-adapter, external release-artifact durability, governed Day-7 execution, and deployment/rollback/burn-in workstreams. This pending decision must not disable the build cycle.

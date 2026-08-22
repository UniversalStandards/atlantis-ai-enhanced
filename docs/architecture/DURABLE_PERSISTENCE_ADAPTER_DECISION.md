# Durable Persistence Adapter Decision Gate

## Status

Decision-preparation artifact for the ATLANTIS seven-day operational-alpha sprint. This document does **not** select a provider, database, cloud service, credential model, network path, deployment topology, transaction primitive, or production authority.

## Decision required

The next concrete durable recovery-ownership / append adapter must select an implementation substrate capable of satisfying the already-landed provider-neutral contracts. That production choice is architecture-gated because it affects durability semantics, atomicity, failure modes, credentials, network permissions, operations, and deployment.

The decision is not whether ATLANTIS needs durability; that requirement is already fixed. The decision is which approved substrate can prove the required semantics with the least additional trusted surface.

## Mandatory acceptance criteria

A candidate implementation is admissible only if it can demonstrate all of the following through the existing executable gates rather than documentation claims:

1. Independent clients observe one authoritative recovery-ownership state.
2. Ownership survives genuine process termination and restart.
3. Acquire, renew, release, expiry, and reacquisition preserve monotonic fencing and reject stale owners.
4. Contended acquisition satisfies the existing fairness contract.
5. Applicable retention/compaction behavior preserves evidence required for stale-owner rejection and reconciliation.
6. Durable append binds operation ID, execution ID, event ID, expected stream version, and immutable content digest.
7. Pre-commit failure is distinguishable from post-commit/pre-acknowledgement uncertainty.
8. Uncertain append outcomes settle only from authoritative readback through `DurableAppendUncertaintyRecord`; the mutation is not blindly retried.
9. Exact committed readback proves the expected successor stream version and immutable content digest; mismatches quarantine.
10. Recovery ownership, fencing evidence, immutable writer/event evidence, and append settlement cannot produce a state in which two writers both possess valid authority for the same protected mutation.
11. Restart and independent-client tests use genuinely separate adapter/client lifetimes, not process-local object replacement presented as external durability.
12. Secret values never enter release evidence, traces, test fixtures, or repository history.
13. The adapter can run the existing baseline, durability/failure-injection, fairness, applicable retention, immutable-writer, and append-uncertainty suites without weakening their assertions.
14. Production enablement is feature/approval gated and can remain disabled while conformance executes in an approved non-production environment.

## Alternatives to evaluate

The implementation review may consider, but is not limited to:

| Alternative | Principal question before approval | Typical strength | Principal risk to prove away |
| --- | --- | --- | --- |
| Transactional relational database | Can one transaction/conditional-write model bind ownership fencing and immutable append evidence cleanly? | Mature transactions and conditional updates | Provider/schema coupling and operational dependency |
| Cloud-native transactional/conditional store | Do conditional operations and consistency guarantees satisfy exact fencing/readback semantics under the selected topology? | Managed durability and availability | Consistency/configuration semantics may vary by mode |
| Embedded durable database with OS/process coordination | Can genuinely independent processes and restart state share one authoritative store safely in the deployment topology? | Small trusted surface and simple local operations | Multi-process/network topology limitations |
| Purpose-built durable service behind the provider-neutral port | Can the service expose exact semantics without merely moving ambiguity behind an API? | Strong isolation and evolvable implementation | Larger operational/security/network surface |

No alternative receives preference from this document.

## Evidence required for selection

Before a candidate can be called the first durable adapter, the decision record must identify:

- exact product/substrate and version or service mode;
- authoritative consistency/transaction guarantees relied upon;
- ownership and fencing transaction/conditional-write algorithm;
- immutable append commit algorithm;
- authoritative readback algorithm for acknowledgement loss;
- mapping of provider errors into committed/conflict/known-failure/uncertain outcomes;
- failure-injection mechanism for pre-commit and post-commit/pre-ack paths;
- independent-client and genuine restart test topology;
- retention/compaction behavior;
- credential and network requirements;
- rollback/disable path;
- evidence identities for every executed existing conformance suite.

## Rejection conditions

Reject a candidate if correctness depends on blind retry after ambiguous writes, wall-clock-only ownership without fencing, process-local memory for authoritative state, eventual observation that cannot prove exact settlement within the required operation model, destructive reconciliation, secret-bearing evidence, privileged workflow permissions not separately approved, or weakening an existing conformance assertion to make the adapter pass.

## Reversible integration shape

Provider-specific code should implement the existing provider-neutral ports behind an explicit disabled-by-default registration boundary. Provider selection must not alter the canonical contracts. Tests should register the concrete adapter into the existing conformance suites. A provider-specific supplement may contain configuration names and non-secret topology, while credentials remain outside the repository.

## Decision exit criterion

This architecture gate is resolved only when an authorized candidate is selected with the guarantees above mapped to its documented semantics and an approved environment is available to execute genuine independent-client/restart conformance. Selection alone is not release proof; the adapter must still pass the executable gates and produce candidate-bound evidence.

## Parallel work while unresolved

The sprint must continue on independent safe workstreams while this choice remains open: live browser-adapter conformance, Issue #7 isolated-development adapter proof, external release-artifact storage decision/preparation, telemetry SDK/collector binding preparation, governed Day-7 execution preparation, and exact-candidate deployment/rollback/burn-in evidence composition. The architecture gate must not disable the build cycle.

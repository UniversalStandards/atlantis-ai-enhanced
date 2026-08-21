# External Release-Artifact Adapter Gate

## Status

Provider-neutral implementation gate for the first external durable `ExecutionReleaseArtifactStorage` adapter.

This document does **not** select a storage provider, provision infrastructure, authorize credentials or network access, expand workflow permissions, or approve deployment. It defines the evidence a concrete adapter must produce before ATLANTIS may count release-artifact persistence as durable Day-7 evidence.

## Existing contract

The existing `ExecutionReleaseArtifactRepository` is authoritative for repository-level settlement semantics:

- `save()` requires a positive persistence acknowledgement and exact authoritative byte-for-byte readback.
- `reconcile()` never retries an uncertain write; it settles only when authoritative readback already contains the exact canonical governed bytes expected for the artifact identity.
- missing or divergent authoritative bytes fail closed.
- `load()` is an authoritative read by artifact identity.

The existing `registerExecutionReleaseArtifactDurableConformance` suite is the minimum reusable acceptance suite for concrete external adapters. The process-local shared-state fixture is only a harness self-test and must not be counted as external durability evidence.

## Required external-adapter semantics

A concrete adapter MUST provide the existing provider-neutral interface without weakening it:

```text
put(artifact_id, serialized_evidence) -> acknowledged | not_acknowledged
get(artifact_id) -> exact_bytes | absent
```

The adapter MUST preserve these invariants:

1. Artifact identity is stable and maps to exactly one authoritative object/version under the adapter's documented namespace.
2. A positive `put` acknowledgement means a subsequent authoritative `get` can return the exact bytes supplied to that `put`.
3. `get` must read authoritative provider state, not a process-local cache that can outlive or mask a failed provider write.
4. An uncertain or negative acknowledgement must not be converted into success by the adapter. Repository-level `reconcile()` performs settlement from authoritative readback.
5. The adapter must not perform an implicit retry after an uncertain outcome unless the provider primitive itself proves idempotence for the same immutable artifact identity and bytes. The initial Day-7 adapter should prefer no implicit retry.
6. Existing bytes under an artifact identity must never be silently replaced with divergent bytes. A provider primitive that permits overwrite must be constrained by conditional-create/version semantics or exact-byte comparison before acceptance.
7. Adapter restart or process replacement must not alter artifact identity, authoritative bytes, or settlement behavior.
8. Provider credentials, claim tokens, approval receipts, and other secrets must never be embedded in the governed release artifact or adapter diagnostics.

## Failure classification

Concrete adapters must distinguish these observable cases at their boundary:

### Known pre-commit failure

The provider proves no durable object/version was created. `put` returns `false`; after process restart, `get` returns `null`.

### Committed and acknowledged

The provider confirms commit. `put` returns `true`; exact authoritative readback is available immediately under the documented consistency contract.

### Commit may have occurred but acknowledgement was lost

`put` returns `false` or throws according to the adapter's existing interface integration, and the caller treats the save as failed. After process restart, repository-level `reconcile()` must settle only from authoritative `get` readback. The adapter must not rewrite the artifact merely to discover the outcome.

### Divergent existing object

If authoritative storage contains bytes that differ from the governed bytes expected for the same artifact identity, the adapter/repository path fails closed. No overwrite, merge, or last-writer-wins repair is permitted by default.

## Required real-adapter conformance evidence

The first approved external adapter must register against `registerExecutionReleaseArtifactDurableConformance` and execute the suite against real external durable state. Evidence must prove:

1. exact canonical governed bytes survive destruction/replacement of the adapter process and are returned by a fresh process;
2. injected failure before provider commit leaves no observable artifact after process restart;
3. injected acknowledgement loss after provider commit is settled by `ExecutionReleaseArtifactRepository.reconcile()` through exact authoritative readback without rewriting;
4. substituted/divergent expected evidence is rejected during reconciliation;
5. repeated authoritative reads after restart remain byte-identical;
6. a second independent process observes the same authoritative bytes for the same artifact identity;
7. divergent concurrent creation for one artifact identity cannot silently overwrite or supersede the accepted governed bytes.

Items 5-7 extend the reusable minimum suite and should be added as adapter-specific tests until the generic harness exposes those process/provider hooks.

## Provider capability matrix

A candidate may be accepted only if its documented primitive can satisfy all required semantics.

| Capability | Required evidence |
| --- | --- |
| Durable object creation | survives process/adapter restart |
| Authoritative exact readback | byte-identical governed serialization |
| Immutable or conditional create | divergent same-ID writes fail closed |
| Failure injection | deterministic pre-commit and post-commit/pre-ack scenarios |
| Cross-process visibility | independent process observes authoritative object |
| Identity/version evidence | provider object/version identifier available for diagnostics when safe |
| Least privilege | write/read limited to the release-artifact namespace |
| Secret safety | no credentials or secret authority material in release evidence/logs |

## Candidate decision criteria

When selecting the first provider, compare at least:

- ability to create immutable/conditional objects without last-writer-wins ambiguity;
- strength and latency of authoritative read-after-write behavior;
- deterministic testability of pre-commit and acknowledgement-loss failure modes;
- local/CI test strategy that does not expose production credentials to pull-request workflows;
- operational rollback and object-version recovery;
- least-privilege credential scope;
- cost and deployment complexity for the seven-day alpha;
- compatibility with the required File/Google Drive artifact integration without forcing correctness to depend on a UI/API that lacks the required atomic/immutable semantics.

A user-facing file/Drive integration may consume or mirror an already-authoritative release artifact; it does not automatically qualify as the authoritative durability adapter unless it passes this gate.

## Security gate

Any concrete adapter requiring new credentials, network/data-plane access, secret distribution, workflow permission expansion, or production resource creation requires explicit security/architecture approval before those capabilities are added.

Pull-request CI must remain read-only with respect to production resources. Real-adapter conformance should run in an isolated non-production environment with narrowly scoped credentials and explicit teardown/retention rules.

## Registration package

Before a provider is counted as Day-7 durable artifact evidence, the implementation PR must contain:

- concrete adapter implementation behind `ExecutionReleaseArtifactStorage`;
- provider/primitive rationale and namespace/identity mapping;
- registration against `registerExecutionReleaseArtifactDurableConformance`;
- adapter-specific cross-process and divergent-concurrent-create tests;
- failure-injection evidence for pre-commit and post-commit/pre-ack outcomes;
- exact authoritative readback evidence after real process restart;
- permission/credential inventory with least-privilege rationale;
- migration/rollback or disable/fallback procedure;
- operational evidence identifying the exact tested revision and external test environment.

## Next authorized implementation step

After a provider is explicitly approved, implement only the thin concrete adapter and its isolated test environment. Do not change `ExecutionReleaseArtifactRepository` settlement semantics to accommodate a weaker provider. If a candidate cannot satisfy exact authoritative readback, immutable/conditional identity behavior, and failure-injection evidence, reject the candidate rather than weakening the Day-7 gate.

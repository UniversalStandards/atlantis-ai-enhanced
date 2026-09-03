# Release Artifact Provider Candidate Mappings

Status: architecture-neutral decision support; **not** a production provider selection, credential grant, network authorization, or deployment approval.

## Purpose

Map plausible external storage mechanisms onto the already-approved `ExecutionReleaseArtifactStorage` and `ExecutionReleaseArtifactRepository` semantics so the eventual provider decision is narrow, evidence-backed, and does not weaken the external-adapter gate.

The authoritative requirements remain:

- exact canonical byte persistence under a stable artifact identity;
- authoritative byte-for-byte readback before `save()` settles successfully;
- immutable or conditional same-ID creation so divergent bytes cannot silently overwrite prior evidence;
- uncertain post-commit/pre-ack outcomes settle through `reconcile()` and authoritative readback, never blind rewrite;
- pre-commit failure leaves no observable artifact;
- cross-process visibility and real process-restart durability;
- deterministic failure-injection evidence;
- least-privilege credentials and secret-safe diagnostics.

## Candidate A — Filesystem / mounted durable volume

### Mapping

- `artifactId` maps to a normalized, non-traversable object/file key below one configured root.
- `write()` uses create-if-absent semantics to a temporary sibling followed by an atomic publish/rename only where the underlying filesystem documents that guarantee for the same volume.
- `read()` returns exact bytes from the authoritative published path.
- Existing same-ID content is read and compared; identical bytes may be treated idempotently, divergent bytes fail closed.

### Strengths

- Small adapter surface and no application-level cloud SDK requirement.
- Straightforward exact-byte readback and isolated local conformance environment.
- Good candidate for proving the adapter contract independently of a cloud API.

### Risks / required proof

- A local process filesystem is **not** sufficient; the backing volume must survive process/container/host replacement according to the intended deployment topology.
- Atomic rename guarantees must be proven for the actual mounted storage, not assumed from a developer workstation.
- Multi-host visibility, caching, stale reads, and concurrent create behavior require explicit tests.
- Permissions must restrict the adapter to the configured artifact root.

### Isolated conformance plan

1. Run writer and reader in independent processes against the same non-production mounted volume.
2. Persist canonical bytes, terminate the writer process, start a fresh reader process, and prove exact readback.
3. Race two independent creators with the same ID and different bytes; exactly one canonical value may become authoritative and divergence must be surfaced.
4. Inject failure before publish; prove no authoritative object exists after process restart.
5. Inject acknowledgement loss after publish; prove `reconcile()` settles by readback without a second write.
6. Repeat reads from independent processes and require byte identity.

## Candidate B — Azure Blob Storage

### Mapping

- `artifactId` maps to a normalized blob name beneath one dedicated container/prefix.
- Creation uses conditional create semantics (for example, an absent-object precondition) rather than unconditional overwrite.
- `read()` downloads the authoritative blob bytes; settlement compares those bytes exactly with canonical evidence.
- Same-ID retry is not used to resolve uncertainty; `reconcile()` performs authoritative readback.

### Strengths

- Durable external object storage with natural cross-process visibility.
- Conditional request primitives are a good conceptual fit for immutable same-ID creation.
- Can be isolated behind a dedicated container/prefix and narrowly scoped identity.

### Risks / required proof

- Exact SDK/API precondition and consistency behavior must be verified against the selected service configuration before implementation is accepted.
- Credential selection, managed identity/service principal use, network path, private endpoints/firewall rules, retention, encryption, and lifecycle policies are security/deployment decisions and remain approval-bound.
- Provider error classes must be normalized into pre-commit, committed/readable, or unresolved outcomes without leaking secrets.

### Isolated conformance plan

1. Use a dedicated non-production container/prefix and least-privilege identity.
2. Execute the reusable durable artifact conformance suite across independent processes.
3. Prove conditional same-ID divergent creation cannot overwrite authoritative bytes.
4. Inject client-visible failure before request commitment and prove no object exists.
5. Simulate/induce lost acknowledgement after committed creation and settle solely by authoritative download plus `reconcile()`.
6. Restart all adapter processes and repeat exact readback.
7. Verify logs/errors contain artifact identity and classification only, never credentials or governed artifact bytes unless explicitly safe.

## Candidate C — Google Drive

### Mapping

- `artifactId` would require a stable metadata/indexing scheme that resolves exactly one authoritative Drive file/object identity.
- `write()` must prevent ambiguous duplicate same-ID files and must not rely on filename uniqueness alone.
- `read()` must resolve the authoritative object deterministically and return exact bytes for repository comparison.

### Strengths

- Satisfies the sprint's required File/Google Drive integration naturally as a distribution/consumption surface.
- Human-accessible release evidence and report sharing are operationally useful.

### Risks / required proof

- Filename-based storage does not by itself provide immutable conditional same-ID creation.
- Duplicate objects, metadata search/index lag, permission inheritance, shared-drive semantics, and update/version behavior can make authoritative identity ambiguous.
- OAuth/service-account scopes and sharing permissions are security-sensitive.
- Because of these semantics, Drive should **not** automatically be promoted to ATLANTIS's correctness-critical authoritative store merely because it is a required integration.

### Isolated conformance plan

1. Define an unambiguous authoritative object-ID/index scheme before adapter code is accepted.
2. Prove two independent writers cannot create divergent authoritative evidence for one ATLANTIS `artifactId`.
3. Prove exact byte readback after fresh-process restart and from an independent reader.
4. Prove acknowledgement-loss settlement does not create a duplicate file.
5. Prove least-privilege scopes and no unintended public/domain sharing.
6. If any gate cannot be met cleanly, retain Drive as a downstream mirror/consumer rather than the authoritative artifact store.

## Decision matrix

| Criterion | Durable mounted volume | Azure Blob Storage | Google Drive |
| --- | --- | --- | --- |
| Exact byte readback | Strong if mount semantics are proven | Strong candidate | Possible, but identity resolution must be designed |
| Conditional immutable same-ID create | Filesystem/topology dependent | Strong candidate via conditional object creation | Weak/complex without an additional authoritative index |
| Cross-process visibility | Deployment dependent | Natural | Natural, subject to API/index behavior |
| Restart durability | Backing-volume dependent | Natural | Natural |
| Ack-loss reconcile without rewrite | Straightforward after atomic publish | Strong candidate via authoritative readback | Must prove duplicate avoidance |
| Divergent concurrent-create rejection | Must be proven on actual mount | Strong candidate | Complex |
| Required sprint integration fit | File integration | File/object integration; Drive still separately required if interpreted literally | Directly satisfies Google Drive option |
| Security/deployment decisions required | Mount/topology/permissions | Identity/network/container policy | OAuth scopes/sharing/index scheme |

## Non-binding engineering recommendation

For the **authoritative** release-artifact adapter, prototype the durable mounted-volume mapping first only if the intended deployment already supplies a genuinely durable, shared, atomic-publish-capable volume. Otherwise Azure Blob Storage is the cleaner first external candidate because conditional object creation and authoritative object readback align closely with the existing repository semantics.

Treat Google Drive primarily as the required human-facing artifact integration/mirror unless an isolated prototype proves the full authoritative-store gate without adding an ambiguous indexing authority.

This recommendation is deliberately non-binding. It does not authorize provisioning, SDK/dependency changes, credentials, network access, workflow permissions, or production deployment.

## Provider-selection acceptance checklist

A provider may be selected only when the implementation plan can answer all of the following without weakening repository semantics:

1. What operation makes same-ID creation conditional and prevents divergent overwrite?
2. What read is authoritative for exact-byte reconciliation?
3. How are pre-commit failure and post-commit/pre-ack uncertainty distinguished or safely reconciled?
4. How is cross-process visibility proven?
5. How is real restart durability proven?
6. How are concurrent divergent creates tested?
7. What is the least-privilege credential/identity scope?
8. What network and deployment changes are required?
9. How are secrets and governed artifact bytes excluded from unsafe diagnostics?
10. How is the adapter registered against `registerExecutionReleaseArtifactDurableConformance` plus provider-specific concurrency/restart tests?

Until those answers are approved and proven in an isolated environment, the production provider remains undecided.
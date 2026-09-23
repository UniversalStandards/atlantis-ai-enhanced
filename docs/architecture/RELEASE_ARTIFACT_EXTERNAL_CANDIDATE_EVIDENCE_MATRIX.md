# External Release-Artifact Candidate Evidence Matrix

## Status

Decision support for the ATLANTIS seven-day operational-alpha sprint. **NO CANDIDATE SELECTED. NO IMPLEMENTATION AUTHORIZED.**

This record narrows the pending external `ExecutionReleaseArtifactStorage` decision using authoritative provider documentation while preserving `RELEASE_ARTIFACT_EXTERNAL_ADAPTER_CANDIDATE_RECORD.md` as the approval boundary. It does not grant credentials, network access, infrastructure provisioning, deployment authority, or production enablement.

## Evaluation rule

Documentation is admission evidence only. A selected non-production candidate must still populate the canonical candidate record and execute `registerExecutionReleaseArtifactExternalConformance` unchanged against genuine shared external state. Unknown or undocumented semantics remain unresolved.

The required provider-neutral behavior is immutable candidate-bound publication plus exact authoritative readback. A transport error or lost acknowledgement must not manufacture success; reconciliation remains readback-only.

## Candidate A — Amazon S3 general-purpose bucket

Authoritative documentation reviewed:

- S3 consistency model: https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel
- Conditional writes: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
- Conditional reads: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-reads.html
- Enforcing conditional writes: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html

Evidence-supported observations:

| ATLANTIS concern | Documentation-supported capability | Admission consequence |
| --- | --- | --- |
| Read-after-write | S3 documents strong read-after-write consistency for object PUT/DELETE and metadata reads | Plausible authoritative readback primitive; exact SDK behavior and endpoint/topology still require candidate approval |
| Immutable create | `If-None-Match: *` prevents overwrite when the key already exists and returns precondition failure | Strong candidate mapping for create-if-absent artifact identity |
| Conditional enforcement | Bucket policy can require conditional-write headers | Useful defense in depth, but policy mutation/authority is a separate security/operations approval |
| Exact version diagnostics | Object ETag/version metadata can support diagnostics; versioning behavior changes current-version semantics | Versioning mode must be explicit; ATLANTIS correctness must compare exact governed bytes, not assume ETag is a universal content digest |
| Ambiguous completion | HTTP/network failure can still obscure whether a PUT committed | Must map unknown completion to unacknowledged/uncertain and settle through authoritative GET without blind overwrite |

Open evidence before selection: exact region/bucket/versioning mode, SDK/version, encryption mode, conditional PUT mapping, retry configuration, deterministic acknowledgement-loss injection, credential class, network boundary, retention/teardown, and whether conditional-write enforcement is authorized.

## Candidate B — Google Cloud Storage bucket

Authoritative documentation reviewed:

- Request preconditions: https://cloud.google.com/storage/docs/request-preconditions
- JSON object operations and generation preconditions: https://cloud.google.com/storage/docs/json_api/v1/objects

Evidence-supported observations:

| ATLANTIS concern | Documentation-supported capability | Admission consequence |
| --- | --- | --- |
| Immutable create | `ifGenerationMatch=0` makes object mutation succeed only when no live object exists | Strong candidate mapping for create-if-absent identity |
| Version identity | Object generation is an immutable version identifier usable in preconditions | Useful diagnostic/evidence identity; adapter must still validate exact governed bytes |
| Conditional failure | Generation mismatch produces a failed precondition rather than overwriting state | Plausible divergent-publication containment |
| Exact readback | JSON object APIs can address a specific generation | Candidate record must specify whether authoritative reconciliation reads the current live object or a captured generation and why |
| Ambiguous completion | Preconditions do not eliminate disconnected-client acknowledgement ambiguity | Must settle unknown completion by authoritative readback and never replay blindly |

Open evidence before selection: exact bucket location/storage class/versioning/retention configuration, SDK/version, upload primitive, retry behavior with generation preconditions, deterministic failure injection, credential/network class, and teardown path.

## Candidate C — Azure Blob Storage block blob

Authoritative documentation reviewed:

- Conditional headers for Blob service operations: https://learn.microsoft.com/rest/api/storageservices/specifying-conditional-headers-for-blob-service-operations
- Azure CLI blob precondition behavior: https://learn.microsoft.com/cli/azure/storage/blob

Evidence-supported observations:

| ATLANTIS concern | Documentation-supported capability | Admission consequence |
| --- | --- | --- |
| Immutable create | `If-None-Match: *` performs the operation only if the blob does not exist | Strong candidate mapping for create-if-absent identity |
| Conditional identity | Blob operations support ETag-based `If-Match` / `If-None-Match` conditions | Useful for immutable publication and diagnostics; exact SDK/API mapping remains to be approved |
| Authoritative read | Get Blob/Get Blob Properties support conditional headers | Plausible readback primitive; cache/endpoint behavior and byte preservation require real-adapter conformance |
| Divergent publication | Existing-resource precondition failure can prevent silent replacement | Adapter must distinguish expected same-byte readback from divergent bytes using canonical ATLANTIS evidence |
| Ambiguous completion | Conditional writes do not eliminate transport/acknowledgement ambiguity | Unknown completion must remain unsettled until authoritative GET establishes exact bytes |

Open evidence before selection: exact account/region/redundancy class, blob/container configuration, SDK/version, block-blob upload primitive, retry behavior, deterministic acknowledgement-loss injection, credential/network class, retention/versioning settings, and teardown path.

## Comparative decision matrix

| Criterion | Amazon S3 | Google Cloud Storage | Azure Blob Storage |
| --- | --- | --- | --- |
| Documented create-if-absent primitive | `If-None-Match: *` | `ifGenerationMatch=0` | `If-None-Match: *` |
| Provider object/version diagnostic identity | ETag/version metadata | Generation/metageneration | ETag/version metadata |
| Conditional mutation failure without overwrite | Yes | Yes | Yes |
| Candidate can plausibly support independent clients/restart | Yes | Yes | Yes |
| Ambiguous acknowledgement still requires ATLANTIS reconciliation | Yes | Yes | Yes |
| Exact bytes remain canonical correctness evidence | Yes | Yes | Yes |
| Ready to implement without approval | **No** | **No** | **No** |

## Decision blockers that remain

1. Architecture/operations/security must select exactly one non-production candidate or explicitly request another candidate for evidence review.
2. The selected candidate's exact service mode, region/topology, SDK/version, object primitive, consistency/versioning/retention settings, conditional-create mapping, credential class, network boundary, deterministic failure-injection method, retry configuration, and reversible teardown path must populate `RELEASE_ARTIFACT_EXTERNAL_ADAPTER_CANDIDATE_RECORD.md`.
3. SDK automatic retries must be inspected. They may not convert an ambiguous first write into an unobservable second mutation unless same-identity idempotence and exact-byte safety are proven by the provider primitive and existing ATLANTIS reconciliation rules.
4. Selection authorizes only disabled-by-default non-production adapter implementation and conformance execution. It does not authorize production deployment or external-state mutation from pull-request CI.
5. File/Google Drive may remain a user-facing mirror/consumer. It is authoritative only if its selected primitive independently passes the complete external-adapter gate.

## Current conclusion

All three candidates expose documented conditional-create primitives that are plausibly compatible with the immutable artifact contract, but exact SDK retry behavior, failure injection, credentials/network scope, retention/versioning, and operational topology remain material approval inputs. No provider is selected automatically.

Until explicit selection is recorded, continue independent browser, telemetry, self-improvement, governed-run, deployment/rollback, and burn-in workstreams.
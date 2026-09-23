# External Artifact Storage Recommendation

## Status

RECOMMENDATION ONLY — NOT SELECTED / NOT AUTHORIZED / NOT OPERATIONAL PROOF.

This document narrows the Day-7 external-artifact durability decision defined by `EXTERNAL_ARTIFACT_STORAGE_CANDIDATE_EVIDENCE_MATRIX.md` without selecting a production provider, granting credentials, widening network permissions, installing an SDK, choosing retention/destruction policy, or authorizing deployment.

## Recommendation

For the first bounded non-production external-artifact conformance run, the engineering recommendation is:

**Candidate A — S3-compatible object API, using Amazon S3 semantics as the reference protocol behavior.**

If separately selected and approved, the first implementation should remain behind the existing provider-neutral external-artifact contract and use a pinned AWS SDK for JavaScript v3 `@aws-sdk/client-s3` revision only after the existing dependency/SEC-20 gates approve that exact revision.

As of 2026-08-30, npm lists `@aws-sdk/client-s3` 3.1121.0 as the current release. Version freshness is decision evidence only and does not authorize installation.

## Why Candidate A is currently the strongest first conformance target

The existing ATLANTIS contract requires immutable identity conflict detection, fresh-client readback after writer exit, digest verification, bounded failure handling, and no elevation of artifact availability into execution/release authority.

Amazon S3's documented conditional-write semantics map directly onto the most important immutable-identity invariant: `If-None-Match: *` prevents creation when the key already exists, with existing-object conflicts returning `412 Precondition Failed`. AWS also documents `409 Conflict` as a possible concurrent-request outcome, which gives the ATLANTIS harness a concrete uncertain/conflict class to exercise rather than assuming every acknowledgement or transport result proves a final durable state.

S3 also documents conditional `GET`/`HEAD` behavior, allowing a fresh independent client to retrieve and inspect the committed object after the writer process is discarded. ATLANTIS must still verify its own committed content digest; an ETag is not promoted into the canonical ATLANTIS content digest.

This fit is narrower than a provider selection. Candidate B and Candidate C remain valid alternatives until an authorized decision is recorded.

## Proposed bounded non-production shape

If Candidate A is selected, populate `EXTERNAL_ARTIFACT_STORAGE_CANDIDATE_RECORD.md` before implementation with exact approved values. The intended evaluation shape is:

1. one isolated non-production bucket/namespace dedicated to the conformance run;
2. no production data and no production execution/release authority;
3. least-privilege object operations required by the existing harness only;
4. immutable object identity mapped deterministically from the existing ATLANTIS artifact identity;
5. conditional create semantics (`If-None-Match: *`) for first write;
6. same-identity/same-content handled only according to the existing ATLANTIS idempotency contract after independent readback and digest verification;
7. same-identity/different-content rejected fail-closed;
8. fresh-client `GET`/`HEAD` after writer disposal, followed by ATLANTIS digest verification;
9. bounded timeout/retry behavior with `409`, `412`, authentication rejection, unavailable endpoint, payload rejection, and interrupted-write outcomes preserved as explicit evidence classes;
10. disabled-by-default feature gate and explicit teardown/disable path;
11. credentials/endpoints supplied externally and prohibited from committed fixtures, traces, reports, comments, or release artifacts; and
12. exact SDK/configuration/release-candidate/test-run identities attached to immutable evidence.

## Required failure semantics

The adapter must not treat a successful transport acknowledgement as permission to replay a protected action. On timeout, connection loss, `409`, or any result where durable commit state is not established by the existing contract, the outcome remains uncertain until reconciled by a fresh read using canonical artifact identity and digest semantics.

A pre-existing key is never overwritten merely to make a retry succeed. If the key exists, the adapter must independently read it and compare the canonical ATLANTIS digest. Matching content may satisfy the existing idempotent outcome; divergent content is a hard immutable-identity conflict.

## Authoritative references inspected

- AWS conditional writes: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
- AWS conditional requests: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-requests.html
- AWS conditional reads: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-reads.html
- AWS enforcement of conditional writes: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html
- Current SDK package evidence: https://www.npmjs.com/package/@aws-sdk/client-s3

These references support recommendation/admission analysis only. They are not ATLANTIS operational evidence.

## Decision boundary

This recommendation does **not** change `EXTERNAL_ARTIFACT_STORAGE_CANDIDATE_RECORD.md`, which remains `UNSELECTED / BLOCKED FOR IMPLEMENTATION` until an authorized decision fully populates the exact non-secret candidate identity and matching approvals.

The required decision remains exactly one of:

- `SELECT Candidate A — S3-compatible object API`
- `SELECT Candidate B — Azure-compatible blob API`
- `SELECT Candidate C — GCS-compatible object API`
- `NO SELECTION — request additional evidence/candidate`

Selection of Candidate A would still require architecture + operations approval and any required security/network/credential and retention/destruction approval before SDK installation, network access, credential use, or real-service execution.

## Safe work that may continue before selection

Provider-neutral conformance-harness work, deterministic failure classification, immutable identity/digest invariants, feature-gate scaffolding, CI/review inspection, and evidence-manifest preparation may continue. Existing validators/contracts remain authoritative and must be reused rather than duplicated.

## Exit criterion

This recommendation has done its job when the external-artifact gate records one bounded candidate outcome. It never satisfies the Day-7 durability gate by itself; PASS still requires a real isolated service path, fresh-client durability, all required failure scenarios, immutable-conflict behavior, digest verification, secret-safety inspection, teardown, and candidate-bound CI/run evidence.
# External Artifact Storage Candidate Evidence Matrix

## Status

NO CANDIDATE SELECTED. NO IMPLEMENTATION AUTHORIZED.

This matrix prepares the Day-7 external-artifact durability decision without selecting a production provider, credential model, endpoint, network permission, retention policy, deployment authority, or irreversible storage semantic. It is decision support only.

## Invariants

Any candidate MUST preserve the existing release/evidence contracts and remain non-authoritative for execution decisions. The authoritative ATLANTIS record continues to determine whether work occurred and whether release gates passed; external artifact storage only persists immutable referenced artifacts.

A conforming candidate MUST:

1. accept an immutable artifact identity plus bytes/content digest and metadata already permitted by existing contracts;
2. return a stable external reference that can be independently read by a fresh client after the writer process exits;
3. reject or detect identity/content conflicts rather than silently overwriting immutable evidence;
4. verify retrieved bytes against the committed digest before evidence is accepted;
5. expose bounded timeout/error outcomes without converting storage availability into permission to replay protected actions;
6. keep credentials, signed URLs, tokens, and secret endpoint material out of committed fixtures, traces, release artifacts, and sprint comments;
7. support disabled/no-op integration without changing authoritative release state;
8. provide an explicit teardown/disable path for the non-production evaluation;
9. require separate approval for any new dependency, credential, outbound network permission, retention/destruction policy, or production deployment authority.

## Candidate families

| Candidate | Bounded non-production topology | Evidence it can establish | Explicitly not selected here |
| --- | --- | --- | --- |
| A — S3-compatible object API | Isolated non-production bucket/container accessed through a provider-neutral object adapter | fresh-client read-after-writer-exit, immutable-key conflict behavior, digest verification, restart independence, bounded unavailable/timeout/rejection behavior | vendor, SDK, endpoint, credential source, region, bucket, retention policy |
| B — Azure-compatible blob API | Isolated non-production container accessed through the same provider-neutral artifact contract | fresh-client durability, immutable/version conflict behavior, digest verification, restart independence, bounded transport failures | account, SDK, endpoint, identity, region, container, retention policy |
| C — GCS-compatible object API | Isolated non-production bucket accessed through the same provider-neutral artifact contract | fresh-client durability, generation/precondition conflict behavior, digest verification, restart independence, bounded transport failures | project, SDK, endpoint, identity, region, bucket, retention policy |

The family labels identify protocol/evidence shapes only. They do not authorize a vendor or deployment.

## Deterministic conformance harness

The selected candidate must run through one shared provider-neutral harness. A candidate cannot receive PASS from documentation or mocked transport alone.

Required scenarios:

1. write one artifact with immutable identity and expected digest;
2. terminate/discard the writer instance;
3. create a fresh independent client and retrieve the artifact by the committed external reference;
4. verify byte-for-byte digest equality;
5. attempt same identity/same content and record the contract-defined idempotent outcome;
6. attempt same identity/different content and prove fail-closed conflict behavior;
7. inject unavailable endpoint, timeout, authentication rejection, payload rejection, and interrupted write;
8. prove failed/uncertain writes do not fabricate a durable reference or authorize protected-action replay;
9. restore connectivity and prove reconciliation distinguishes committed, absent, and uncertain outcomes using existing evidence semantics;
10. disable the adapter and prove authoritative execution/release state is unchanged;
11. inspect emitted traces/logs/artifacts for secret leakage;
12. record exact candidate/configuration/release-candidate/test-run identities as immutable evidence.

## Acceptance criteria

A candidate is eligible for architecture/operations approval only if all required scenarios pass against a real isolated external service path, the fresh client has no dependency on writer-process memory or local filesystem state, immutable conflicts fail closed, digest verification is mandatory, failure behavior is bounded and deterministic, secret-safety inspection passes, existing security/dependency gates remain green, and teardown is demonstrated.

## Disqualification criteria

Reject a candidate if it requires weakening existing contracts/tests; silently overwrites immutable identities; treats an acknowledgement as proof when commit state is uncertain; cannot be independently read after writer exit; requires protected repository/deployment authority; leaks credentials or signed access material; couples artifact availability to authorization; or cannot be disabled/reversed without changing authoritative state.

## Decision record required before implementation

Record exactly one outcome:

- `SELECT Candidate A — S3-compatible object API`
- `SELECT Candidate B — Azure-compatible blob API`
- `SELECT Candidate C — GCS-compatible object API`
- `NO SELECTION — request additional evidence/candidate`

A selection is incomplete until a companion candidate record identifies the exact non-production service, adapter/SDK revision, endpoint class, authentication class, network boundary, configuration digest, teardown mechanism, authoritative protocol/security references, and matching architecture + operations approvals. Security/network/credential approval is additionally required whenever the concrete candidate needs those capabilities.

## Architecture gate

Do not begin provider-specific implementation from this matrix alone. Safe provider-neutral harness work may continue, and existing artifact validators/contracts must be reused rather than duplicated. No production provider, credential, permission, retention/destruction policy, or deployment authority is implied by this document.

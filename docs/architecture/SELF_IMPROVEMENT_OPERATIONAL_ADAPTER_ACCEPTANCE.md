# Self-Improvement Operational Adapter Acceptance Gate

## Status

Provider-neutral operational acceptance gate for Issue #7 and the Day-7 operational-alpha release. This document does **not** authorize a development runtime, shell/process executor, hosted coding agent, credential, network path, merge capability, deployment capability, or production mutation.

## Existing boundary reused unchanged

Operational execution MUST use the existing `EvidenceBackedSelfImprovementPatchGenerator` and its four injected ports:

- `IsolatedSelfImprovementPatchWorkspace`
- `SelfImprovementPatchTestRunner`
- `SelfImprovementPatchEvaluator`
- `SelfImprovementPatchSecurityReviewer`

The generator remains the composition boundary. An operational adapter MUST NOT bypass its identity binding, isolated-branch namespace check, ordered test/evaluation/security gates, unique evidence identities, or the downstream immutable `awaiting-human-review` proposal stop.

## Release claim

Issue #7 may be considered operationally demonstrated only when one real failing evaluation produces a real isolated patch, executes the required verification against that patch, emits immutable evidence, and terminates at human review without exposing or exercising merge, deployment, credential, infrastructure, policy, or production-mutation authority.

Mocks and process-local fixtures remain component evidence only.

## Mandatory adapter invariants

A candidate operational bundle is admissible only if it proves all of the following without weakening existing tests or contracts:

1. **Workspace isolation.** `prepare()` creates or uses a development-only `proposal/` or `sprint/` branch/workspace that is distinct from the protected release branch and production state.
2. **Exact trigger binding.** `executionId`, `observedProblem`, and `objective` remain byte-for-byte bound to the triggering failed evaluation request.
3. **Patch evidence.** `patchArtifactId` identifies immutable, reviewable patch/diff evidence sufficient to reconstruct exactly what was proposed.
4. **Test execution.** `run()` executes the repository's applicable existing test/typecheck/security gates against the isolated patch rather than accepting caller-supplied PASS text.
5. **Follow-up evaluation.** `evaluate()` re-runs the relevant failed evaluation or its canonical acceptance equivalent against the isolated patch and binds the result to the same proposal/execution identity.
6. **Security review.** `review()` executes the applicable repository security gate/review against the isolated patch and returns independent evidence identity.
7. **Evidence uniqueness.** Patch, test, evaluation, and security evidence use distinct immutable artifact identities.
8. **Human-review stop.** Successful adapter execution can create only the existing immutable proposal that terminates at `awaiting-human-review`; it cannot merge or deploy the patch.
9. **Authority minimization.** The operational bundle exposes no API for direct protected-branch writes, merge, deployment, credential mutation, infrastructure mutation, policy mutation, or production runtime mutation.
10. **Failure containment.** Workspace creation, patch generation, test, evaluation, security-review, evidence-publication, timeout, cancellation, and teardown failures fail closed and cannot convert into approval or production mutation.
11. **Candidate identity.** Evidence records the repository, base commit, isolated branch, patch/diff digest, adapter/runtime versions, applicable configuration digest, and verification artifact identities needed to reproduce the run.
12. **Secret safety.** Credentials, tokens, environment secrets, and sensitive process state are excluded from committed artifacts, traces, comments, and release evidence.
13. **Reversibility.** The candidate can be disabled and its isolated branch/workspace abandoned without changing protected branches or production state.

## Operational evidence sequence

The acceptance run MUST preserve this sequence:

`failed evaluation → isolated workspace/branch → patch → tests → follow-up evaluation → security review → immutable proposal → awaiting-human-review`

For each transition, capture non-secret timestamps, candidate identity, input/output artifact identity, disposition, and failure classification where applicable. The final evidence MUST demonstrate that no merge/deploy mutation occurred.

## Failure-injection matrix

Before the operational bundle can satisfy Issue #7, exercise at least these deterministic failure points:

| Failure point | Required result |
| --- | --- |
| isolated workspace/branch creation fails | no patch proposal; fail closed |
| patch generation fails or returns substituted identity | reject; no verification or proposal |
| tests fail | stop before evaluation/security/proposal |
| follow-up evaluation fails | stop before security/proposal |
| security review fails | stop before proposal |
| duplicate/substituted evidence identity | reject |
| protected/non-isolated branch returned | reject |
| evidence publication fails | no claim of completed review-ready proposal |
| cancellation/timeout during verification | fail closed; no approval/merge/deploy |
| attempted merge/deploy/credential/policy/infrastructure authority | reject candidate as inadmissible |

These scenarios should reuse existing generator/proposal validators and repository test/security gates. Do not create a parallel approval model.

## Candidate decision record required before implementation

The first operational adapter mutation requires an explicit candidate record identifying:

- workspace mechanism and version;
- patch-generation mechanism/runtime and version;
- test execution mechanism and exact commands/gates;
- follow-up evaluation mechanism;
- security-review mechanism;
- isolated branch/worktree lifecycle;
- non-secret repository/base/candidate identity model;
- credential and network requirements;
- timeout/cancellation/teardown behavior;
- artifact/evidence storage mechanism;
- rollback/disable procedure;
- explicit statement that merge/deploy/protected-branch authority is absent.

If any candidate requires new credentials, network access, workflow-token permissions, hosted execution authority, or another security-sensitive permission expansion, that specific mutation remains architecture/operations gated. Independent preparation and other sprint work continue.

## Exit criterion

This gate is satisfied only by a real operational run whose evidence proves the existing generator executed against an isolated development workspace, all required verification passed, the immutable proposal was produced, and execution stopped at `awaiting-human-review` with no protected or production mutation authority. Documentation or mocks alone cannot satisfy the gate.

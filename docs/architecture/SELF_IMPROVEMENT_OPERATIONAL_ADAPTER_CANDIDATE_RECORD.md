# Self-Improvement Operational Adapter Candidate Record

## Status

**UNSELECTED / BLOCKED FOR IMPLEMENTATION**

This record is the required decision artifact for the first real Issue #7 operational execution. It does not authorize a development runtime, coding agent, shell/process executor, credential, network path, protected-branch mutation, merge, deployment, infrastructure mutation, policy mutation, or production mutation.

## Decision required

Authorize exactly one non-production operational adapter bundle that can execute the existing `EvidenceBackedSelfImprovementPatchGenerator` against a genuinely isolated development workspace and terminate at `awaiting-human-review`.

The selected bundle MUST reuse these existing ports unchanged:

- `IsolatedSelfImprovementPatchWorkspace`
- `SelfImprovementPatchTestRunner`
- `SelfImprovementPatchEvaluator`
- `SelfImprovementPatchSecurityReviewer`

## Candidate identity

Complete every field before approval. Do not include secrets.

| Field | Candidate value |
| --- | --- |
| Candidate ID | UNSELECTED |
| Repository | `UniversalStandards/atlantis-ai-enhanced` |
| Base revision | UNSELECTED |
| Isolated branch/workspace namespace | `proposal/` or `sprint/` |
| Workspace mechanism + version | UNSELECTED |
| Patch-generation mechanism/runtime + version | UNSELECTED |
| Test execution mechanism + version | UNSELECTED |
| Follow-up evaluation mechanism + version | UNSELECTED |
| Security-review mechanism + version | UNSELECTED |
| Evidence/artifact storage mechanism | UNSELECTED |
| Configuration digest | UNSELECTED |
| Credential class required | UNSELECTED |
| Network boundary required | UNSELECTED |
| Timeout/cancellation mechanism | UNSELECTED |
| Teardown/cleanup mechanism | UNSELECTED |
| Disable/rollback procedure | UNSELECTED |

## Authority boundary

Approval MUST state all of the following explicitly:

- protected-branch write authority: **ABSENT**;
- merge authority: **ABSENT**;
- deployment authority: **ABSENT**;
- credential mutation authority: **ABSENT**;
- infrastructure mutation authority: **ABSENT**;
- policy mutation authority: **ABSENT**;
- production runtime mutation authority: **ABSENT**.

Any candidate that cannot satisfy every statement above is inadmissible for this gate.

## Exact execution sequence

The authorized candidate MUST preserve the existing operational sequence without introducing a parallel approval model:

`failed evaluation → isolated workspace/branch → patch → tests → follow-up evaluation → security review → immutable proposal → awaiting-human-review`

The operational run MUST use the repository's existing validators, generator, proposal contract, and applicable test/security gates. Caller-supplied PASS text is not evidence.

## Verification commands and gates

Before approval, populate the exact commands or repository-native gate identifiers that the candidate will execute for:

1. workspace/repository integrity;
2. applicable typecheck;
3. applicable regression tests;
4. applicable security gates, including existing SEC-20 supply-chain admission where dependencies change;
5. follow-up evaluation corresponding to the triggering failed evaluation;
6. immutable proposal validation.

Commands MUST be bounded to the isolated candidate workspace and MUST NOT mutate protected branches or production state.

## Evidence contract

The candidate run MUST emit immutable, non-secret evidence sufficient to bind:

- triggering `executionId`, `observedProblem`, and `objective`;
- repository and base commit;
- isolated branch/workspace identity;
- exact patch/diff digest and `patchArtifactId`;
- test-run evidence identity and disposition;
- follow-up evaluation evidence identity and disposition;
- security-review evidence identity and disposition;
- adapter/runtime/configuration versions and digest;
- timestamps and bounded failure classification for each transition;
- final immutable proposal identity and `awaiting-human-review` disposition;
- affirmative evidence that no merge, deployment, protected-branch, credential, infrastructure, policy, or production mutation occurred.

Patch, test, evaluation, and security evidence identities MUST be distinct.

## Failure-injection plan

The candidate acceptance run MUST deterministically exercise the failure points already required by `SELF_IMPROVEMENT_OPERATIONAL_ADAPTER_ACCEPTANCE.md`:

| Failure point | Required result |
| --- | --- |
| isolated workspace/branch creation failure | fail closed; no patch proposal |
| substituted/non-isolated workspace identity | reject |
| patch generation failure or substituted patch identity | reject; no downstream verification |
| test failure | stop before evaluation/security/proposal |
| follow-up evaluation failure | stop before security/proposal |
| security review failure | stop before proposal |
| duplicate/substituted evidence identity | reject |
| evidence publication failure | no completed review-ready claim |
| timeout/cancellation | fail closed; no approval/merge/deploy |
| attempted prohibited authority | reject candidate as inadmissible |

Failure injection MUST reuse existing generator/proposal validators and repository gates rather than weakening or replacing them.

## Secret and network safety

Before approval, document the minimum credential class and network destinations, if any, without committing token values, environment secrets, private keys, or sensitive process state. Any new credential, hosted execution authority, workflow-token permission, or network expansion requires explicit security/operations approval before that mutation occurs.

## Reversibility

The candidate MUST be disabled by default. Its isolated branch/workspace MUST be abandonable without changing protected branches or production state. Teardown MUST leave enough immutable evidence to diagnose a failed run without retaining credentials or sensitive runtime state.

## Acceptance criteria

Approval may be granted only when:

1. every candidate identity field is populated from authoritative mechanism/runtime documentation;
2. architecture/operations owners explicitly accept the workspace/runtime and lifecycle model;
3. security/network owners explicitly accept any credential or network boundary;
4. prohibited authorities remain absent;
5. the exact existing test/evaluation/security gates are identified;
6. deterministic failure injection is implementable without production mutation;
7. evidence publication and secret-safety behavior are defined;
8. disable/rollback and cleanup are defined;
9. no existing ATLANTIS contract, approval boundary, or release gate is weakened.

## Approval record

- Architecture/operations decision: **PENDING**
- Security/network decision: **PENDING**
- Candidate implementation authorized: **NO**
- Operational execution authorized: **NO**

## Exit criterion

This record becomes implementation-ready only after exactly one candidate is fully populated and explicitly approved. It does not itself satisfy Issue #7 or the Day-7 self-improvement gate. Completion requires a real isolated run with immutable evidence proving the existing generator reached `awaiting-human-review` and exercised no prohibited authority.

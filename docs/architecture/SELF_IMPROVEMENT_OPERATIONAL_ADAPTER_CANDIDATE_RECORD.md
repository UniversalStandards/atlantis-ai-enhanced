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

## Prepared Candidate A dossier — non-authorizing

The following values narrow Candidate A for review without selecting or authorizing it. Values marked `PENDING APPROVAL/EXECUTION BINDING` must be resolved before implementation or execution.

| Field | Candidate A prepared value |
| --- | --- |
| Candidate ID | `candidate-a-local-worktree-v1` — PROPOSED, NOT SELECTED |
| Repository | `UniversalStandards/atlantis-ai-enhanced` |
| Base revision | `f9c89e2ad5af93afcbd05947c97f4b493b1d2549` for this decision snapshot (exact-head Contracts run `33529294577` / #893 successful); acceptance run MUST bind the then-approved immutable base SHA and MUST NOT infer execution authorization from this snapshot |
| Isolated branch/workspace namespace | `proposal/<run-id>` only |
| Workspace mechanism + version | repository-local `git worktree`; exact Git version recorded at execution — PENDING APPROVAL/EXECUTION BINDING |
| Patch-generation mechanism/runtime + version | existing `EvidenceBackedSelfImprovementPatchGenerator`; exact source revision = approved base SHA; no alternate generator |
| Test execution mechanism + version | repository-native Node 22 + pnpm 10.14.0 verification bundle |
| Follow-up evaluation mechanism + version | exact triggering evaluation or existing canonical acceptance equivalent at approved base SHA |
| Security-review mechanism + version | existing SEC-20 source/lock integrity, structured audit when authorized/available, dependency inventory, and existing self-improvement security-review port at approved base SHA |
| Evidence/artifact storage mechanism | non-secret local run evidence only; external/durable publication remains separately gated |
| Configuration digest | SHA-256 over canonical candidate configuration + approved base SHA; calculated before execution — PENDING EXECUTION BINDING |
| Credential class required | none for bounded local harness; any GitHub/private-package/external-evidence credential is OUT OF SCOPE pending separate approval |
| Network boundary required | no new destinations; package installation/audit network use only if explicitly approved, otherwise affected network-dependent gate = BLOCKED |
| Timeout/cancellation mechanism | bounded child-process timeout/cancellation with fail-closed disposition; exact numeric bounds — PENDING APPROVAL. The current repository-native Contracts job has a 10-minute job timeout, recorded only as existing operational evidence and **not** as implicit acceptance-harness authorization. |
| Teardown/cleanup mechanism | finalize non-secret evidence, remove isolated worktree, abandon/delete only `proposal/<run-id>` branch, preserve protected branch unchanged |
| Disable/rollback procedure | adapter off by default and absent from production composition; abandon candidate worktree/branch and retain only non-secret evidence |

### Candidate A authority invariants

The prepared candidate is admissible only with all of these values fixed as `false`/absent:

- `protectedBranchWriteAuthority=false`
- `mergeAuthority=false`
- `deploymentAuthority=false`
- `credentialMutationAuthority=false`
- `infrastructureMutationAuthority=false`
- `policyMutationAuthority=false`
- `productionRuntimeMutationAuthority=false`

## Decision-base repository-native evidence snapshot

This section records evidence observed for the immutable decision base identified above only; it does not select Candidate A or authorize process/network execution. The dossier commit that records this snapshot may itself advance the sprint branch, so the values below MUST NOT be interpreted as the repository's current head without a fresh live query.

- decision-base sprint revision observed for this dossier refresh: `f9c89e2ad5af93afcbd05947c97f4b493b1d2549`;
- exact-head Contracts run for that decision base: `33529294577` (#893), successful;
- repository-native required-check candidate identity observed for that decision base: `validate` from GitHub Actions app id `15368`;
- workflow runtime: Node 22 + pnpm 10.14.0;
- workflow job timeout: 10 minutes;
- workflow permissions: `contents: read` with checkout `persist-credentials: false`;
- verification path: frozen-lockfile install → SEC-20 supply-chain gate → structured audit gate → dependency inventory validation → release-control probe syntax → typecheck → tests.

The acceptance execution MUST re-query all mutable identities immediately before any approved run and MUST fail closed if the approved base, verification commands, or required evidence identity changes unexpectedly.

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

## Prepared verification sequence

Candidate A reuses the repository-native verification path already exercised by the Contracts workflow:

1. bind repository, approved immutable base SHA, `proposal/<run-id>` branch, worktree path, runtime versions, and configuration digest;
2. verify worktree HEAD equals the approved base before patching and protected branch remains untouched;
3. `pnpm install --frozen-lockfile`;
4. `node scripts/sec20-supply-chain-gate.mjs`;
5. run `pnpm audit --json` followed by the existing SEC-20 audit gate only when package-registry network access is explicitly approved/available; otherwise record **BLOCKED**, never PASS;
6. run the Contracts-workflow-equivalent dependency inventory validation;
7. `pnpm typecheck`;
8. `pnpm test`;
9. execute the exact triggering follow-up evaluation or its existing canonical acceptance equivalent;
10. execute the existing self-improvement security review and immutable proposal validation;
11. verify final disposition is `awaiting-human-review` and all prohibited-authority invariants remain false;
12. finalize non-secret evidence, then perform bounded teardown.

No new verification model is introduced. Exact numeric timeout/cancellation bounds and any network-enabled step remain approval-bound.

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

Candidate A's bounded local harness requires no credential by default. Before any network-enabled installation/audit step, hosted execution, private dependency access, GitHub write, or external evidence publication is introduced, the minimum credential class and exact network destinations must be documented and explicitly approved without committing token values, environment secrets, private keys, or sensitive process state.

Any new credential, hosted execution authority, workflow-token permission, or network expansion requires explicit security/operations approval before that mutation occurs.

## Reversibility

The candidate MUST be disabled by default. Its isolated branch/workspace MUST be abandonable without changing protected branches or production state. Teardown MUST leave enough immutable evidence to diagnose a failed run without retaining credentials or sensitive runtime state.

## Remaining decisions before Candidate A can be selected

1. architecture/operations approval for local Git worktree and bounded local process execution;
2. exact numeric timeout and cancellation bounds;
3. explicit decision on package-registry network access for install/audit during the acceptance run, or acceptance that the affected network-dependent gate remains BLOCKED;
4. exact approved immutable base SHA for the acceptance run;
5. confirmation that the triggering evaluation/canonical equivalent to be used is the repository-native one bound to that base SHA;
6. security/network approval confirming no credentials and no network expansion beyond any explicitly allowed package-registry path.

These are decision inputs, not implicit authorization.

## Acceptance criteria

Approval may be granted only when:

1. every execution-bound candidate identity field is populated from authoritative mechanism/runtime evidence;
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
- Candidate selection: **NO SELECTION**
- Candidate implementation authorized: **NO**
- Operational execution authorized: **NO**

## Exit criterion

This record becomes implementation-ready only after exactly one candidate is fully execution-bound and explicitly approved. It does not itself satisfy Issue #7 or the Day-7 self-improvement gate. Completion requires a real isolated run with immutable evidence proving the existing generator reached `awaiting-human-review` and exercised no prohibited authority.

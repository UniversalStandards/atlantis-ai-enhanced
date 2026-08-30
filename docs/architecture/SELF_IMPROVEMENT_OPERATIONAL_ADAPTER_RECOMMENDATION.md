# Self-Improvement Operational Adapter Recommendation

## Status

**RECOMMENDATION ONLY — NOT SELECTED / NOT AUTHORIZED FOR IMPLEMENTATION OR EXECUTION**

This document narrows the Issue #7 operational decision without granting shell/process execution, credentials, network expansion, protected-branch writes, merge, deployment, infrastructure, policy, or production authority. The candidate record remains authoritative and must be explicitly populated and approved before operational implementation begins.

## Recommendation

Prefer **Candidate A: repository-local isolated Git worktree + repository-native verification bundle** for the first bounded non-production acceptance run.

The purpose of Candidate A is to prove the existing `EvidenceBackedSelfImprovementPatchGenerator` against a genuine isolated development workspace while minimizing new authority and dependencies. It is not a production self-modification design.

## Why Candidate A is the narrowest useful proof

The repository already defines the required four ports and the orchestration order:

- `IsolatedSelfImprovementPatchWorkspace`
- `SelfImprovementPatchTestRunner`
- `SelfImprovementPatchEvaluator`
- `SelfImprovementPatchSecurityReviewer`

The current Contracts workflow already establishes a repository-native verification baseline with Node 22, pnpm 10.14.0, frozen-lockfile installation, SEC-20 supply-chain integrity, structured vulnerability audit, dependency inventory validation, typecheck, and regression tests. Candidate A reuses those gates rather than introducing a second approval or verification system.

A local Git worktree/isolated branch also provides the required reversible mutation boundary: the candidate workspace can be created from an immutable base revision, confined to `proposal/` namespace, diffed, hashed, verified, and deleted without merging or modifying the protected branch.

## Candidate A bounded topology

`failed evaluation → immutable base revision → proposal/<run-id> worktree → deterministic patch generation → patch digest/evidence → repository-native tests → canonical follow-up evaluation → repository-native security review → immutable proposal → awaiting-human-review → teardown`

The acceptance harness must have **no merge or deployment operation**. Its success path ends at the existing immutable human-review stop.

## Proposed mechanism mapping

| Required capability | Candidate A recommendation |
| --- | --- |
| Workspace | local Git worktree rooted at an immutable sprint/base commit, on a unique `proposal/<run-id>` branch |
| Patch generation | deterministic development-only patch producer scoped to the isolated worktree and seeded failing evaluation; no protected-branch writer |
| Patch identity | canonical diff bytes + cryptographic digest + base revision + isolated branch identity |
| Test execution | repository-native `pnpm typecheck` and `pnpm test` after `pnpm install --frozen-lockfile` |
| Security review | existing SEC-20 supply-chain gate, structured audit gate, and dependency inventory validation; dependency-changing patches must run the full existing SEC-20 admission path |
| Follow-up evaluation | re-run the exact triggering evaluation or its existing canonical acceptance equivalent against the isolated patch |
| Evidence storage | non-secret local run evidence for the bounded acceptance harness; any external/durable publication remains separately gated |
| Network | no new network destination beyond what an explicitly approved installation/audit execution requires; prefer pre-provisioned dependencies for the bounded harness where available |
| Credentials | none for the local harness; any GitHub write, hosted runner, private dependency, or external evidence credential is out of scope until separately approved |
| Teardown | remove worktree and abandon/delete only the isolated `proposal/` branch after evidence finalization; never alter the protected branch |
| Disable | candidate adapter remains feature-gated/off by default and is omitted from production runtime composition |

## Exact repository-native verification baseline

Candidate A should reuse the currently established verification sequence rather than accepting caller-supplied PASS text:

1. `pnpm install --frozen-lockfile`
2. `node scripts/sec20-supply-chain-gate.mjs`
3. `pnpm audit --json` followed by `node scripts/sec20-audit-gate.mjs <audit-artifact>` when network/package-registry access is explicitly available for the candidate run
4. dependency inventory generation/validation equivalent to the Contracts workflow
5. `pnpm typecheck`
6. `pnpm test`
7. exact triggering follow-up evaluation
8. existing immutable self-improvement proposal validation

If audit network access is not authorized or unavailable, the candidate must report that gate as **BLOCKED** rather than silently treating it as passed.

## Evidence identity and reproducibility

The bounded run should record, without secrets:

- repository and immutable base commit;
- isolated branch/worktree identity;
- Git, Node, and pnpm runtime versions observed at execution time;
- triggering execution/evaluation identity;
- canonical patch/diff digest;
- dependency lock digest before and after the patch;
- configuration digest;
- test, evaluation, security-review, and proposal artifact identities;
- command exit status and bounded timestamps;
- teardown disposition;
- explicit `mergeAuthority=false`, `deploymentAuthority=false`, and `protectedBranchWriteAuthority=false` evidence.

Patch, test, evaluation, security-review, and proposal identities must remain distinct and must reuse the existing generator/proposal validation path.

## Deterministic failure-injection plan

Use the existing acceptance matrix without manufacturing a parallel validator suite. The harness should inject failures at the adapter boundary and prove the existing generator fails closed for:

1. worktree creation failure;
2. substituted or non-`proposal/` branch identity;
3. patch generation failure or substituted trigger identity;
4. test failure;
5. follow-up evaluation failure;
6. security-review failure;
7. duplicate evidence identity;
8. evidence finalization failure;
9. timeout/cancellation;
10. attempted prohibited merge/deploy/credential/policy/infrastructure authority.

The success case and injected failures should use one deterministic seeded repository fixture/evaluation where practical so that evidence is comparable and containment-only test duplication is avoided.

## Candidate B alternative

A hosted coding-agent/workspace bundle remains a valid alternative if Candidate A cannot produce a representative operational proof. Candidate B would require explicit runtime identity, hosted execution authority, credential class, network destinations, workspace lifecycle, evidence publication path, and security/operations approval before implementation. It is therefore broader than necessary for the first acceptance run.

## Acceptance criteria for selecting Candidate A

Selection should occur only after reviewers explicitly accept all of the following:

1. local Git worktree/process execution is authorized for the bounded non-production acceptance environment;
2. the exact patch producer and seeded failing evaluation are named and version/revision bound;
3. the base revision and `proposal/` lifecycle are fixed;
4. exact verification commands and timeout/cancellation bounds are populated in the candidate record;
5. network behavior for installation/audit is explicitly allowed or the affected gate remains BLOCKED;
6. evidence finalization is defined without external credentials unless separately approved;
7. merge, deployment, protected-branch write, credential mutation, infrastructure mutation, policy mutation, and production mutation authority are all explicitly absent;
8. teardown is reversible and retains only non-secret immutable evidence required for diagnosis/reproduction.

## Decision required

Record exactly one outcome in `SELF_IMPROVEMENT_OPERATIONAL_ADAPTER_CANDIDATE_RECORD.md`:

- `SELECT Candidate A — local isolated Git worktree + repository-native verification bundle`;
- `SELECT Candidate B — approved hosted operational bundle` with all authority/network/credential fields populated; or
- `NO SELECTION — request additional evidence/candidate`.

Until that decision and required approvals exist, this recommendation authorizes **no operational adapter mutation or execution**. Independent Day-7 workstreams continue.
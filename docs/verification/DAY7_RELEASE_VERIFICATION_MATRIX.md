# Day-7 Release Verification Matrix

## Purpose

This matrix converts the remaining operational-alpha release thresholds into explicit, evidence-backed gates. It does not select a production provider, grant credentials, expand permissions, authorize deployment, or weaken any existing contract.

A gate is **green** only when the listed evidence exists from the same applicable implementation/release candidate. Unit or process-local evidence MUST NOT be promoted to cross-process, restart, external-durability, provider-failover, or production evidence.

## Release gates

| Gate | Required evidence | Current verified state | Release rule |
| --- | --- | --- | --- |
| Regression suite | Frozen-lockfile install, SEC-20 supply-chain gates, contracts/event-store typecheck and tests | Latest verified runtime-equivalent baseline is **370/370 contracts + 532/532 event-store = 902/902 tests**. The authoritative current-head or head-associated PR-merge CI identity belongs in the sprint record / PR checks rather than being hard-coded into this branch document, because committing a literal head SHA here would immediately create a newer head and make the anchor stale by construction. Frozen install, SEC-20 gates, both TypeScript workspaces, read-only Actions permissions, and zero vulnerability findings at every severity remain required. This CI evidence does not manufacture additional operational capability. | Must remain 100% green on the release candidate |
| Repository release control | Fresh live repository-settings evidence showing PR-only integration, at least one approving review, and the exact ATLANTIS required check enforced on `main`; deterministic proof that pending/failing required checks block integration; captured pre-change rollback state | `main` is currently reported unprotected with required-status-check enforcement off and repository rulesets empty. The repository-native ATLANTIS check identity is `validate` from GitHub Actions app id `15368`, but that identity MUST be re-queried immediately before any settings mutation. The connected integration currently exposes reads but not the bounded repository-settings write required to close this gate. | Must PASS before PR #10 can be release-ready or integrated; green CI without repository enforcement is insufficient |
| Unauthorized protected actions | Approval and policy tests plus adversarial attempts demonstrating no protected mutation without authorization | Existing fail-closed approval/policy foundations and SEC-19/SEC-20 component evidence are green; final same-candidate operational proof remains open | Zero unauthorized protected actions |
| Repository-improvement reference workflow | One execution: request → authorization → normalization → planning → routing → durable execution → tool use → independent verification → memory/evidence → response | Controlled/provider-neutral composition exists; live operational run remains open | One complete same-execution trace and release artifact required |
| Self-improvement review gate | Failing evaluation → isolated patch → tests → follow-up evaluation → security review → immutable proposal → human-review stop | Orchestration, evidence-backed generator, operational acceptance gate, candidate record, and machine-verifiable candidate authorization are landed; real operational adapters/execution remain open | Must stop at `awaiting-human-review`; no merge/deploy/production mutation capability |
| Durable release artifacts | Independent clients, restart survival, stable repeated authoritative readback, pre-commit failure, acknowledgement-loss reconciliation, divergent-publication rejection | Provider-neutral external conformance, candidate record, provider evidence matrix, and machine-verifiable candidate authorization exist; no real external adapter registered | 100% external conformance on approved adapter |
| Recovery ownership | Independent processes/restarts, single live owner, expiry/reacquisition, monotonic fencing, stale-owner rejection, fairness, failure injection, applicable retention/compaction | Provider-neutral contract/conformance, durable-adapter registration, candidate authorization, and exact candidate-to-adapter identity binding exist; no real durable adapter registered | 100% registered durable-adapter conformance |
| Provider failover | Genuine alternate provider/replica/failover path; singular live authority; monotonic fencing through takeover; post-commit/pre-ack authoritative settlement; pre-commit non-manufacture; stale/released authority rejection | `provider-failover` is machine-required by Day-7 readiness and wired into durable ownership all-gates registration; scenarios remain unexecuted against a concrete durable adapter | Recovery and provider-failover tests must be 100% on the approved candidate; process-memory copying is not proof |
| Ownership / immutable-writer atomicity | Evidence that ownership authority and immutable event/writer commitment cannot diverge silently; deterministic reconciliation for uncertain outcomes | Provider-neutral append uncertainty and immutable-writer evidence contracts exist; production binding proof remains open | No unresolved ambiguous commit/authority state |
| Trace completeness | Complete causal topology plus authoritative accounting and deterministic replay/release evidence | Projection/service/publication foundations are landed | 100% required events/evidence for the release workflow |
| Telemetry | Governed release evidence exported downstream without becoming correctness-authoritative | Provider-neutral/OpenTelemetry-shaped export, binding gate, candidate record, and machine-verifiable candidate authorization are landed; real SDK/collector binding open | Export failure must not mutate authoritative release evidence |
| Browser runtime | Real browser launch/navigation/session lifecycle plus `text`, `html`, and `accessibility-tree` observer conformance and substitution/failure evidence | Observer conformance, acceptance gate, candidate record, and machine-verifiable candidate authorization are landed; no concrete browser runtime is authorized and no live runtime evidence exists | Exact-candidate operational browser evidence required; mock/process-local evidence cannot satisfy this gate |
| Deployment reproducibility | Documented, repeatable deploy procedure from an immutable release candidate with recorded inputs and post-deploy verification | Evidence schemas and conformance are landed; actual rehearsal remains open | 100% reproducible before release |
| Rollback reproducibility | Tested rollback to a known-good immutable candidate with state/evidence preservation rules | Evidence schemas and conformance are landed; actual rehearsal remains open | Successful rollback rehearsal required |
| Critical security findings | Adversarial release-candidate review covering authorization bypass, identity substitution, stale authority, artifact substitution, replay, approval bypass, secret leakage, unsafe mutation, prompt/tool-output injection, and dependency/supply-chain compromise | SEC-01 through SEC-20 campaign and executable SEC-19/SEC-20 component gates are landed; remaining live/external scenarios must stay blocked until executed | Zero unresolved critical findings |
| Operator runbook | Start/stop, health, evidence retrieval, approval handling, recovery, reconciliation, rollback, incident escalation | Day-7 operator runbook is landed. The runbook is procedure, not proof that rehearsals or recovery paths executed successfully | Explicit candidate-bound runbook gate evidence required before release |
| Burn-in | Continuous release-candidate operation with failures/restarts injected and evidence retained | Contracts/event-store PASS semantics are aligned and the corrected machine-readable validators are green. Incident IDs are retained as evidence references, not structured incident-resolution state, so unit validation alone cannot adjudicate whether an incident is resolved. Actual candidate-bound burn-in and independently adjudicated incident disposition remain open; validator/unit evidence is not burn-in execution proof. | Required duration/acceptance and incident disposition must be recorded before release declaration |

## Evidence integrity rules

1. Evidence MUST identify the exact commit or synthetic merge commit tested.
2. A result from an earlier head MUST NOT be attributed to a later head unless the later change is explicitly non-runtime and the distinction is recorded.
3. Process-local fixtures MUST be labelled as harness self-tests and MUST NOT satisfy external durability, provider-failover, or restart/cross-process gates.
4. Telemetry is downstream evidence only; it MUST NOT become the authority for execution correctness, ownership, approval, or durable publication.
5. A failed or uncertain persistence acknowledgement MUST be reconciled from authoritative readback; blind duplicate writes are not acceptable evidence.
6. Security, tests, evaluation, and independent verification MUST fail closed.
7. Human-review gates MUST remain non-mutating until an explicit consequential-action approval authorizes a later operation.
8. Production provider, credential, network, deployment, or permission decisions remain separate approval-bound gates.
9. A candidate identity field such as `operatorRunbookRevision` identifies a revision but does not by itself satisfy the explicit PASS/BLOCKED operator-runbook release gate.
10. Provider-failover evidence MUST come from the approved candidate's actual alternate provider/replica/failover path and MUST NOT be inferred from restart-only tests, process-local fixtures, or documentation.
11. Burn-in `PASS` MUST NOT be accepted when executions failed or remain pending, required regression/trace evidence is absent, governed approval/failure-injection/ownership/persistence evidence is absent, unresolved security findings remain, or independent incident-disposition evidence shows an unresolved incident. Because `BurnInEvidence.incidents` is currently an opaque list of evidence references, machine validation of that field alone does not prove incident resolution.
12. Branch documentation MUST NOT hard-code itself as the current exact-head CI anchor. Exact-head/head-associated CI identities belong in mutable sprint records, PR checks, or other evidence stores that can be updated without creating a new code/documentation head.
13. Successful CI MUST NOT be promoted to release-control evidence unless repository settings independently prove the required PR/review/check policy is enforced. The required-check identity MUST be re-queried immediately before repository-settings mutation, and the prior settings state MUST be preserved for rollback evidence.

## Release-candidate evidence bundle

Before PR #10 can be considered ready for release review, the sprint record should identify one candidate commit and link or record:

1. literal branch-head CI or head-associated PR-merge CI, with the tested commit/synthetic merge commit and test totals identified explicitly;
2. repository release-control evidence identifying the enforcement mechanism, required approving-review rule, exact required check identity, blocking verification result, and captured rollback state;
3. complete governed Day-7 reference-workflow trace;
4. runner-bound budget/usage/cost summary;
5. deterministic replay evidence;
6. exact authoritative release artifact and durable-storage conformance result;
7. independent verification result;
8. recovery ownership cross-process/restart conformance result;
9. provider-failover conformance result from the genuine alternate provider/replica/failover path;
10. ownership/writer atomicity or reconciliation evidence;
11. operational browser-runtime evidence for `text`, `html`, and `accessibility-tree` from the exact candidate;
12. OpenTelemetry export evidence, if bound;
13. deployment and rollback rehearsal evidence;
14. consolidated adversarial security report with zero unresolved critical findings;
15. explicit operator-runbook gate evidence tied to the recorded runbook revision;
16. burn-in start/end, incidents, injected failures, independently adjudicated incident disposition, and final result.

## Current next safe work

The matrix is reconciled with the canonical Day-7 readiness catalog and now explicitly carries the repository integration boundary as a release gate rather than leaving it only in the sprint record/runbook supplement. The next highest-leverage mutation remains applying exactly one reversible `main` enforcement mechanism through a repository-settings-capable admin channel, requiring PR integration, at least one approving review, and the re-queried exact `validate` check identity. Use the existing release-control evidence/enforcement probe before and after the mutation and preserve the pre-change state for rollback.

If that specific settings mutation is unavailable, keep the release-control gate BLOCKED and continue independent safe work. The next concrete durable-persistence mutation remains approval-bound: select exactly one non-production candidate from `DURABLE_PERSISTENCE_CANDIDATE_EVIDENCE_MATRIX.md`, complete `DURABLE_PERSISTENCE_ADAPTER_CANDIDATE_RECORD.md`, and obtain explicit architecture/operations approval before provider-specific implementation. The external artifact, browser, telemetry, and self-improvement candidates remain similarly approval-bound.

Until those choices are authorized, continue independent governed-run, deployment/rollback/burn-in preparation and current-head CI/review inspection. Do not create more readiness scaffolding in place of execution evidence, and do not treat an architecture gate as a reason to disable the build cycle.

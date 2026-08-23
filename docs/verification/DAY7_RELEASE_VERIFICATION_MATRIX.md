# Day-7 Release Verification Matrix

## Purpose

This matrix converts the remaining operational-alpha release thresholds into explicit, evidence-backed gates. It does not select a production provider, grant credentials, expand permissions, authorize deployment, or weaken any existing contract.

A gate is **green** only when the listed evidence exists from the same applicable implementation/release candidate. Unit or process-local evidence MUST NOT be promoted to cross-process, restart, external-durability, provider-failover, or production evidence.

## Release gates

| Gate | Required evidence | Current verified state | Release rule |
| --- | --- | --- | --- |
| Regression suite | Frozen-lockfile install, SEC-20 supply-chain gates, contracts/event-store typecheck and tests | Documentation head `45143a19078e7c39a7f20624fc724fe6b1abf93d` passed head-associated PR-merge CI run `32627084259`, which checked out synthetic merge commit `6144a491686afe46ba24a79e030921f6bff663eb`. Frozen install, SEC-20 gates, both TypeScript workspaces, and **301/301 contracts + 505/505 event-store = 806/806 tests** passed with read-only Actions permissions and zero vulnerability findings at every severity. | Must remain 100% green on the release candidate |
| Unauthorized protected actions | Approval and policy tests plus adversarial attempts demonstrating no protected mutation without authorization | Existing fail-closed approval/policy foundations and SEC-19/SEC-20 component evidence are green; final same-candidate operational proof remains open | Zero unauthorized protected actions |
| Repository-improvement reference workflow | One execution: request → authorization → normalization → planning → routing → durable execution → tool use → independent verification → memory/evidence → response | Controlled/provider-neutral composition exists; live operational run remains open | One complete same-execution trace and release artifact required |
| Self-improvement review gate | Failing evaluation → isolated patch → tests → follow-up evaluation → security review → immutable proposal → human-review stop | Orchestration, evidence-backed generator, operational acceptance gate, and candidate record are landed; real operational adapters/execution remain open | Must stop at `awaiting-human-review`; no merge/deploy/production mutation capability |
| Durable release artifacts | Independent clients, restart survival, stable repeated authoritative readback, pre-commit failure, acknowledgement-loss reconciliation, divergent-publication rejection | Provider-neutral external conformance, candidate record, and provider evidence matrix exist; no real external adapter registered | 100% external conformance on approved adapter |
| Recovery ownership | Independent processes/restarts, single live owner, expiry/reacquisition, monotonic fencing, stale-owner rejection, fairness, failure injection, applicable retention/compaction | Provider-neutral contract/conformance and durable-adapter registration exist; no real durable adapter registered | 100% registered durable-adapter conformance |
| Provider failover | Genuine alternate provider/replica/failover path; singular live authority; monotonic fencing through takeover; post-commit/pre-ack authoritative settlement; pre-commit non-manufacture; stale/released authority rejection | `provider-failover` is machine-required by Day-7 readiness and wired into durable ownership all-gates registration; scenarios remain unexecuted against a concrete durable adapter | Recovery and provider-failover tests must be 100% on the approved candidate; process-memory copying is not proof |
| Ownership / immutable-writer atomicity | Evidence that ownership authority and immutable event/writer commitment cannot diverge silently; deterministic reconciliation for uncertain outcomes | Provider-neutral append uncertainty and immutable-writer evidence contracts exist; production binding proof remains open | No unresolved ambiguous commit/authority state |
| Trace completeness | Complete causal topology plus authoritative accounting and deterministic replay/release evidence | Projection/service/publication foundations are landed | 100% required events/evidence for the release workflow |
| Telemetry | Governed release evidence exported downstream without becoming correctness-authoritative | Provider-neutral/OpenTelemetry-shaped export, binding gate, and candidate record are landed; real SDK/collector binding open | Export failure must not mutate authoritative release evidence |
| Browser runtime | Real browser launch/navigation/session lifecycle plus `text`, `html`, and `accessibility-tree` observer conformance and substitution/failure evidence | Observer conformance, acceptance gate, and candidate record are landed; no concrete browser runtime is authorized and no live runtime evidence exists | Exact-candidate operational browser evidence required; mock/process-local evidence cannot satisfy this gate |
| Deployment reproducibility | Documented, repeatable deploy procedure from an immutable release candidate with recorded inputs and post-deploy verification | Evidence schemas and conformance are landed; actual rehearsal remains open | 100% reproducible before release |
| Rollback reproducibility | Tested rollback to a known-good immutable candidate with state/evidence preservation rules | Evidence schemas and conformance are landed; actual rehearsal remains open | Successful rollback rehearsal required |
| Critical security findings | Adversarial release-candidate review covering authorization bypass, identity substitution, stale authority, artifact substitution, replay, approval bypass, secret leakage, unsafe mutation, prompt/tool-output injection, and dependency/supply-chain compromise | SEC-01 through SEC-20 campaign and executable SEC-19/SEC-20 component gates are landed; remaining live/external scenarios must stay blocked until executed | Zero unresolved critical findings |
| Operator runbook | Start/stop, health, evidence retrieval, approval handling, recovery, reconciliation, rollback, incident escalation | Day-7 operator runbook is landed. The runbook is procedure, not proof that rehearsals or recovery paths executed successfully | Explicit candidate-bound runbook gate evidence required before release |
| Burn-in | Continuous release-candidate operation with failures/restarts injected and evidence retained | Evidence schema/conformance is landed; actual burn-in remains open | Required duration/acceptance must be recorded before release declaration |

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

## Release-candidate evidence bundle

Before PR #10 can be considered ready for release review, the sprint record should identify one candidate commit and link or record:

1. literal branch-head CI or head-associated PR-merge CI, with the tested commit/synthetic merge commit and test totals identified explicitly;
2. complete governed Day-7 reference-workflow trace;
3. runner-bound budget/usage/cost summary;
4. deterministic replay evidence;
5. exact authoritative release artifact and durable-storage conformance result;
6. independent verification result;
7. recovery ownership cross-process/restart conformance result;
8. provider-failover conformance result from the genuine alternate provider/replica/failover path;
9. ownership/writer atomicity or reconciliation evidence;
10. operational browser-runtime evidence for `text`, `html`, and `accessibility-tree` from the exact candidate;
11. OpenTelemetry export evidence, if bound;
12. deployment and rollback rehearsal evidence;
13. consolidated adversarial security report with zero unresolved critical findings;
14. explicit operator-runbook gate evidence tied to the recorded runbook revision;
15. burn-in start/end, incidents, injected failures, and final result.

## Current next safe work

The matrix is reconciled with the canonical Day-7 readiness catalog and current verified CI. The next concrete durable-persistence mutation remains approval-bound: select exactly one non-production candidate from `DURABLE_PERSISTENCE_CANDIDATE_EVIDENCE_MATRIX.md`, complete `DURABLE_PERSISTENCE_ADAPTER_CANDIDATE_RECORD.md`, and obtain explicit architecture/operations approval before provider-specific implementation. The external artifact, browser, telemetry, and self-improvement candidates remain similarly approval-bound.

Until those choices are authorized, continue independent governed-run, deployment/rollback/burn-in preparation and current-head CI/review inspection. Do not create more readiness scaffolding in place of execution evidence, and do not treat an architecture gate as a reason to disable the build cycle.
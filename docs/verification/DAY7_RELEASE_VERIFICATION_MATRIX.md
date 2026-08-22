# Day-7 Release Verification Matrix

## Purpose

This matrix converts the remaining operational-alpha release thresholds into explicit, evidence-backed gates. It does not select a production provider, grant credentials, expand permissions, authorize deployment, or weaken any existing contract.

A gate is **green** only when the listed evidence exists from the same applicable implementation/release candidate. Unit or process-local evidence MUST NOT be promoted to cross-process, restart, external-durability, or production evidence.

## Release gates

| Gate | Required evidence | Current verified state | Release rule |
| --- | --- | --- | --- |
| Regression suite | Frozen-lockfile install, contracts typecheck/tests, event-store typecheck/tests | Corrected implementation head `cfb9911a2ee39783cfd7a6acb26008a8c042621e`: head-associated PR-merge run `32570575440` validated synthetic merge `66dec0a5fd1f5c304afb243e42544ad7f660c44e`; 283/283 contracts + 495/495 event-store = **778/778** | Must remain 100% green on the release candidate |
| Unauthorized protected actions | Approval and policy tests plus adversarial attempts demonstrating no protected mutation without authorization | Existing fail-closed approval/policy foundations and SEC-19/SEC-20 component evidence are green; final same-candidate operational proof remains open | Zero unauthorized protected actions |
| Repository-improvement reference workflow | One execution: request → authorization → normalization → planning → routing → durable execution → tool use → independent verification → memory/evidence → response | Controlled/provider-neutral composition exists; live operational run remains open | One complete same-execution trace and release artifact required |
| Self-improvement review gate | Failing evaluation → isolated patch → tests → follow-up evaluation → security review → immutable proposal → human-review stop | Orchestration and concrete evidence-backed generator are landed; real operational adapters/execution remain open | Must stop at `awaiting-human-review`; no merge/deploy/production mutation capability |
| Durable release artifacts | Independent clients, restart survival, pre-commit failure, acknowledgement-loss reconciliation, divergent-publication rejection | Provider-neutral conformance exists; no real external adapter registered | 100% external conformance on approved adapter |
| Recovery ownership | Independent processes/restarts, single live owner, expiry/reacquisition, monotonic fencing, stale-owner rejection, fairness, failure injection, applicable retention/compaction | Provider-neutral contract/conformance exists; no real durable adapter registered | 100% registered durable-adapter conformance |
| Ownership / immutable-writer atomicity | Evidence that ownership authority and immutable event/writer commitment cannot diverge silently; deterministic reconciliation for uncertain outcomes | Design/preparatory evidence exists; production binding proof remains open | No unresolved ambiguous commit/authority state |
| Trace completeness | Complete causal topology plus authoritative accounting and deterministic replay/release evidence | Projection/service/publication foundations are landed | 100% required events/evidence for the release workflow |
| Telemetry | Governed release evidence exported downstream without becoming correctness-authoritative | Provider-neutral and OpenTelemetry-shaped exporter landed; real SDK/collector binding open | Export failure must not mutate authoritative release evidence |
| Deployment reproducibility | Documented, repeatable deploy procedure from an immutable release candidate with recorded inputs and post-deploy verification | Evidence schemas and conformance are landed; actual rehearsal remains open | 100% reproducible before release |
| Rollback reproducibility | Tested rollback to a known-good immutable candidate with state/evidence preservation rules | Evidence schemas and conformance are landed; actual rehearsal remains open | Successful rollback rehearsal required |
| Critical security findings | Adversarial release-candidate review covering authorization bypass, identity substitution, stale authority, artifact substitution, replay, approval bypass, secret leakage, unsafe mutation, prompt/tool-output injection, and dependency/supply-chain compromise | SEC-01 through SEC-20 campaign and executable SEC-19/SEC-20 component gates are landed; remaining live/external scenarios must stay blocked until executed | Zero unresolved critical findings |
| Operator runbook | Start/stop, health, evidence retrieval, approval handling, recovery, reconciliation, rollback, incident escalation | Day-7 operator runbook is landed. The runbook is procedure, not proof that rehearsals or recovery paths executed successfully | Explicit candidate-bound runbook gate evidence required before release |
| Burn-in | Continuous release-candidate operation with failures/restarts injected and evidence retained | Evidence schema/conformance is landed; actual burn-in remains open | Required duration/acceptance must be recorded before release declaration |

## Evidence integrity rules

1. Evidence MUST identify the exact commit or synthetic merge commit tested.
2. A result from an earlier head MUST NOT be attributed to a later head unless the later change is explicitly non-runtime and the distinction is recorded.
3. Process-local fixtures MUST be labelled as harness self-tests and MUST NOT satisfy external durability or restart/cross-process gates.
4. Telemetry is downstream evidence only; it MUST NOT become the authority for execution correctness, ownership, approval, or durable publication.
5. A failed or uncertain persistence acknowledgement MUST be reconciled from authoritative readback; blind duplicate writes are not acceptable evidence.
6. Security, tests, evaluation, and independent verification MUST fail closed.
7. Human-review gates MUST remain non-mutating until an explicit consequential-action approval authorizes a later operation.
8. Production provider, credential, network, deployment, or permission decisions remain separate approval-bound gates.
9. A candidate identity field such as `operatorRunbookRevision` identifies a revision but does not by itself satisfy the explicit PASS/BLOCKED operator-runbook release gate.

## Release-candidate evidence bundle

Before PR #10 can be considered ready for release review, the sprint record should identify one candidate commit and link or record:

1. literal branch-head CI or head-associated PR-merge CI, with the tested commit/synthetic merge commit and test totals identified explicitly;
2. complete governed Day-7 reference-workflow trace;
3. runner-bound budget/usage/cost summary;
4. deterministic replay evidence;
5. exact authoritative release artifact and durable-storage conformance result;
6. independent verification result;
7. recovery ownership cross-process/restart conformance result;
8. ownership/writer atomicity or reconciliation evidence;
9. OpenTelemetry export evidence, if bound;
10. deployment and rollback rehearsal evidence;
11. consolidated adversarial security report with zero unresolved critical findings;
12. explicit operator-runbook gate evidence tied to the recorded runbook revision;
13. burn-in start/end, incidents, injected failures, and final result.

## Current next safe work

Maintain this matrix against exact CI evidence and use the existing readiness/evidence contracts during the first approved release-candidate deployment/rollback rehearsal and burn-in. Do not create more readiness scaffolding in place of execution evidence. Provider/credential/live-mutation decisions remain approval-bound, and none of this matrix authorizes production mutation.

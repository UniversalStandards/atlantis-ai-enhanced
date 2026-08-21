# Day-7 Release Verification Matrix

## Purpose

This matrix converts the remaining operational-alpha release thresholds into explicit, evidence-backed gates. It does not select a production provider, grant credentials, expand permissions, authorize deployment, or weaken any existing contract.

A gate is **green** only when the listed evidence exists from the same applicable implementation/release candidate. Unit or process-local evidence MUST NOT be promoted to cross-process, restart, external-durability, or production evidence.

## Release gates

| Gate | Required evidence | Current verified state | Release rule |
| --- | --- | --- | --- |
| Regression suite | Frozen-lockfile install, contracts typecheck/tests, event-store typecheck/tests | Latest independently verified pre-refresh sprint head `75ec4c1cda7f7d978c94cfc58e9666c623c538c2`: head-associated PR-merge run `32521307831` validated synthetic merge `3693ced01b659f82cf892ef2a640c5e7ab8ba66a`; 283/283 contracts + 448/448 event-store = 731/731 | Must remain 100% green on the release candidate |
| Unauthorized protected actions | Approval and policy tests plus adversarial attempts demonstrating no protected mutation without authorization | Existing fail-closed approval/policy foundations are green; final adversarial release-candidate campaign remains open | Zero unauthorized protected actions |
| Repository-improvement reference workflow | One execution: request → authorization → normalization → planning → routing → durable execution → tool use → independent verification → memory/evidence → response | Controlled/provider-neutral composition exists; live operational run remains open | One complete same-execution trace and release artifact required |
| Self-improvement review gate | Failing evaluation → isolated patch → tests → follow-up evaluation → security review → immutable proposal → human-review stop | Orchestration and 9 focused generator tests are green; real operational adapters/execution remain open | Must stop at `awaiting-human-review`; no merge/deploy/production mutation capability |
| Durable release artifacts | Independent clients, restart survival, pre-commit failure, acknowledgement-loss reconciliation, divergent-publication rejection | Provider-neutral conformance exists; no real external adapter registered | 100% external conformance on approved adapter |
| Recovery ownership | Independent processes/restarts, single live owner, expiry/reacquisition, monotonic fencing, stale-owner rejection, fairness, failure injection, applicable retention/compaction | Provider-neutral contract/conformance exists; no real durable adapter registered | 100% registered durable-adapter conformance |
| Ownership / immutable-writer atomicity | Evidence that ownership authority and immutable event/writer commitment cannot diverge silently; deterministic reconciliation for uncertain outcomes | Design/preparatory evidence exists; production binding proof remains open | No unresolved ambiguous commit/authority state |
| Trace completeness | Complete causal topology plus authoritative accounting and deterministic replay/release evidence | Projection/service/publication foundations are landed | 100% required events/evidence for the release workflow |
| Telemetry | Governed release evidence exported downstream without becoming correctness-authoritative | Provider-neutral and OpenTelemetry-shaped exporter landed; real SDK/collector binding open | Export failure must not mutate authoritative release evidence |
| Deployment reproducibility | Documented, repeatable deploy procedure from an immutable release candidate with recorded inputs and post-deploy verification | Open | 100% reproducible before release |
| Rollback reproducibility | Tested rollback to a known-good immutable candidate with state/evidence preservation rules | Open | Successful rollback rehearsal required |
| Critical security findings | Adversarial release-candidate review covering authorization bypass, identity substitution, stale authority, artifact substitution, replay, approval bypass, secret leakage, and unsafe mutation | Component-level regressions exist; consolidated release-candidate campaign open | Zero unresolved critical findings |
| Operator runbook | Start/stop, health, evidence retrieval, approval handling, recovery, reconciliation, rollback, incident escalation | Open | Required before release |
| Burn-in | Continuous release-candidate operation with failures/restarts injected and evidence retained | Open | Required duration/acceptance must be recorded before release declaration |

## Evidence integrity rules

1. Evidence MUST identify the exact commit or synthetic merge commit tested.
2. A result from an earlier head MUST NOT be attributed to a later head unless the later change is explicitly non-runtime and the distinction is recorded.
3. Process-local fixtures MUST be labelled as harness self-tests and MUST NOT satisfy external durability or restart/cross-process gates.
4. Telemetry is downstream evidence only; it MUST NOT become the authority for execution correctness, ownership, approval, or durable publication.
5. A failed or uncertain persistence acknowledgement MUST be reconciled from authoritative readback; blind duplicate writes are not acceptable evidence.
6. Security, tests, evaluation, and independent verification MUST fail closed.
7. Human-review gates MUST remain non-mutating until an explicit consequential-action approval authorizes a later operation.
8. Production provider, credential, network, deployment, or permission decisions remain separate approval-bound gates.

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
12. operator runbook version;
13. burn-in start/end, incidents, injected failures, and final result.

## Current next safe work

While provider/credential/live-mutation decisions remain approval-bound, safe independent work includes maintaining this matrix against exact CI evidence, preparing the consolidated adversarial security campaign and operator runbook, and defining deployment/rollback and burn-in evidence schemas. None of those preparatory tasks authorizes production mutation.
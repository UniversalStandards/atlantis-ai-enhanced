# Day-7 Adversarial Security Candidate Report

## Candidate binding

- Sprint branch: `sprint/7-day-operational-alpha`
- Candidate head: `851930cb008d537a55f60db090f4daa25dc68f92`
- Tested synthetic PR-merge revision: `5296152d015f7274ca4489cb9532932a5bee47de`
- GitHub Actions workflow: `Contracts`, run `32528767312`, job `96916370446`
- Baseline: frozen-lockfile install PASS; contracts/event-store typecheck PASS; 283/283 contracts + 448/448 event-store = 731/731 tests PASS
- Workflow token permissions: `contents: read`, `metadata: read`
- Evidence level: repository CI plus component/integration regressions only. Process-local evidence is not promoted to cross-process, restart, external-durability, or production proof.

## Scenario evidence map

| ID | Status | Candidate evidence / reason |
| --- | --- | --- |
| SEC-01 Authorization bypass | PASS | `approval-control.test.ts`, `task-entrypoint.test.ts`, and governed entrypoint regressions passed; protected paths fail closed under the tested component/integration topology. |
| SEC-02 Approval bypass | PASS | `github-repository-improvement-adapter.test.ts` and approval-control regressions passed; the concrete mutation port is gated by approval in the tested adapter boundary. |
| SEC-03 Execution identity substitution | PASS | `execution-event-sink-governed-identity.test.ts`, replay/release evidence, repository-improvement, and self-improvement identity-binding regressions passed. |
| SEC-04 Repository/branch substitution | PASS | `repository-improvement-tool.test.ts`, `github-repository-improvement-adapter.test.ts`, and self-improvement patch-generator isolation regressions passed. |
| SEC-05 Stale ownership authority | PASS | Process-local recovery ownership store/conformance/fairness/reacquisition and external-effect ownership regressions passed. No cross-process durable claim is made. |
| SEC-06 Ownership-token leakage | PASS | `recovery-ownership-diagnostic-evidence.test.ts` and ownership evidence regressions passed; authority-bearing ownership material remains excluded from general diagnostic evidence. |
| SEC-07 Replay | PASS | Component/integration `execution-replay-evidence.test.ts`, replay-fixture store, immutable-writer evidence, stale-candidate, and ownership replay/stale-authority regressions passed. |
| SEC-08 Artifact substitution | PASS | Process-local release artifact store/durable-conformance and release evidence/service regressions passed exact identity/readback checks. External durability remains separately blocked. |
| SEC-09 Acknowledgement loss | PASS | Process-local persistence acknowledgement/retry-containment, durable event-store acknowledgement, artifact reconciliation/durable-conformance regressions passed. External/provider acknowledgement-loss proof remains blocked. |
| SEC-10 Pre-commit failure | PASS | Process-local persistence uncertainty and artifact durable-conformance failure-injection regressions passed. Real external restart proof remains blocked. |
| SEC-11 Immutable-writer substitution | PASS | `immutable-writer-commit-evidence.test.ts`, governed append/atomicity, and persistence-proof-consumption regressions passed. |
| SEC-12 Budget/accounting substitution | PASS | `budget.test.ts`, governed release workflow, execution summary/release evidence, and runner-bound accounting regressions passed. |
| SEC-13 Self-improvement escape | PASS | Controlled-topology self-improvement proposal/development-workflow/patch-generator suites passed and terminate at `awaiting-human-review`; no merge/deploy/credential/infrastructure capability is exposed by that boundary. Operational real-workspace proof remains open under Issue #7. |
| SEC-14 Secret leakage | PASS | At the inspected CI/component level, workflow logs expose read-only permission names but redact token values; diagnostic ownership tests passed. This is not a production-secret scan. |
| SEC-15 Telemetry authority confusion | PASS | `execution-release-telemetry.test.ts` and `opentelemetry-release-exporter.test.ts` passed; exporter behavior remains downstream/non-authoritative. |
| SEC-16 Malformed/untrusted record containment | PASS | exact-data-record, runtime-validation, descriptor-hardening, nested-accessor-hardening, timestamp/type/actor validation, and recovery containment suites passed. |
| SEC-17 Retention/compaction fencing loss | BLOCKED | Provider-neutral retention/fencing conformance exists, but no approved real durable `RecoveryOwnershipStore` adapter/maintenance path is registered. Process-local evidence is insufficient for this release claim. |
| SEC-18 Restart/recovery substitution | BLOCKED | Restart-oriented contract/component evidence exists, but no approved real durable recovery-ownership adapter proves fencing/continuation/history across genuine process restart. |
| SEC-19 Prompt/tool-output injection | BLOCKED | The corrected campaign defines the requirement, but this candidate has no dedicated executable adversarial prompt/tool-output injection campaign covering repository/browser/file/tool content across the complete operational workflow. Existing identity/policy boundaries are supporting evidence, not a substitute. |
| SEC-20 Dependency / CI supply-chain compromise | BLOCKED | Frozen lockfile passed; pnpm reported ignored `esbuild` build scripts; GitHub Actions were resolved to concrete action SHAs during the run. No approved vulnerability scanner/SBOM/signature-verification campaign was executed, so zero-critical supply-chain status is not proven. |

## Findings and release disposition

### FIND-SEC-17-18 — durable ownership evidence unavailable

- Severity: high release-evidence gap; no demonstrated critical violation.
- Status: open / blocked by production durable-adapter approval and execution.
- Containment: do not promote process-local ownership evidence to cross-process/restart claims.

### FIND-SEC-19 — operational prompt/tool-output injection campaign not executed

- Severity: high release-evidence gap; no demonstrated critical violation.
- Status: open.
- Containment: keep untrusted content data-only; do not grant live consequential mutation based on untrusted repository/browser/file/tool output until dedicated adversarial execution is green.

### FIND-SEC-20 — supply-chain scan incomplete

- Severity: high release-evidence gap; no demonstrated critical violation.
- Status: open / blocked pending approved scanner execution.
- Evidence: frozen lockfile passed; pnpm intentionally ignored the `esbuild` build script; CI action downloads resolved to concrete SHAs. A vulnerability/SBOM/integrity scanner has not been approved/executed for this candidate.
- Containment: no production promotion until the approved dependency/CI supply-chain check reports zero unresolved critical findings.

## Counts

- Unauthorized protected actions observed in the mapped candidate evidence: **0**.
- Known unresolved critical findings: **0 identified by the evidence executed here**.
- Scenarios with candidate-level PASS evidence: **16** (some explicitly limited to process-local/component evidence).
- BLOCKED scenarios: **4** (`SEC-17`, `SEC-18`, `SEC-19`, `SEC-20`).
- FAIL scenarios: **0**.
- NOT_APPLICABLE scenarios: **0**.

## Final disposition

**AMBER**.

The candidate has a green regression/typecheck baseline and substantial fail-closed component/integration evidence, but it is not releasable as GREEN. Durable ownership/restart proof, a dedicated operational prompt/tool-output injection campaign, and approved supply-chain scanning remain incomplete. External artifact durability, the real governed Day-7 GitHub/tool run, production telemetry binding, deployment/rollback evidence, runbook, and burn-in remain governed by the master sprint release matrix and Issue #8.

This report intentionally records blockers instead of converting missing production evidence into PASS.

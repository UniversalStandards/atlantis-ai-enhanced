# ATLANTIS Day-7 Operational Alpha Operator Runbook

## Status and scope

This runbook defines provider-neutral operating procedures for the ATLANTIS Day-7 operational alpha. It does not select a production provider, grant credentials, expand network or workflow permissions, authorize deployment, or weaken approval/security controls.

This runbook is evidence-oriented: an operator MUST distinguish verified runtime evidence from process-local fixtures, documentation, telemetry, and stale-head CI. Telemetry is never authoritative for correctness.

## Canonical release surfaces

- Repository: `UniversalStandards/atlantis-ai-enhanced`
- Sprint branch: `sprint/7-day-operational-alpha`
- Master sprint issue: #8
- Primary pull request: #10
- Release verification matrix: `docs/verification/DAY7_RELEASE_VERIFICATION_MATRIX.md`
- Adversarial security campaign: `docs/verification/DAY7_ADVERSARIAL_SECURITY_CAMPAIGN.md`

## Operator invariants

An operator MUST NOT:

1. treat a process-local fixture as external durability, cross-process, restart, provider-failover, or production evidence;
2. attribute CI from an earlier runtime head to a later runtime head;
3. bypass explicit approval for consequential actions;
4. retry an uncertain persistence write blindly when authoritative reconciliation is available;
5. treat OpenTelemetry or other downstream telemetry as execution, approval, ownership, or persistence authority;
6. expose ownership tokens, credentials, secrets, or other authority-bearing material in diagnostics;
7. weaken tests, security review, independent verification, branch isolation, or human-review gates to obtain a green release result;
8. declare the operational alpha green while a required verification-matrix gate is BLOCKED, failed, or unsupported.

## Release-candidate identification

Before any release rehearsal, record all of the following together:

- candidate branch-head commit SHA;
- applicable PR synthetic merge SHA, if CI tests the merge rather than the literal head;
- workflow run ID;
- exact test totals;
- dependency/supply-chain gate result;
- workflow token permissions;
- release artifact identity;
- governed execution identity;
- verification-matrix revision.

If any identity is ambiguous, stop release classification and resolve the ambiguity before proceeding.

## Preflight procedure

1. Verify live repository access and required least-privilege permissions.
2. Confirm Issue #8 and PR #10 point to the intended sprint branch and base.
3. Confirm PR merge state and unresolved review-thread state.
4. Identify the exact candidate commit.
5. Inspect candidate-associated CI. Require frozen-lockfile installation, supply-chain gates, typechecks, and all regression tests to pass.
6. Confirm no workflow permission expansion occurred unexpectedly.
7. Confirm the candidate has no unresolved critical security finding.
8. Confirm every release gate in the Day-7 verification matrix has current candidate-bound evidence or is explicitly marked BLOCKED/open.
9. Do not begin a release declaration if any mandatory gate lacks evidence.

## Start / resume governed execution

A governed execution may start or resume only when:

- authorization has succeeded;
- consequential actions have the required explicit approval;
- execution identity is stable and authoritative;
- durable state, ownership, and release-artifact adapters used by the candidate have passed their applicable conformance gates;
- repository improvement occurs only on the approved isolated branch/workspace;
- budget and policy enforcement remain fail closed.

For resumable work, restore from authoritative durable evidence. Do not infer completion or ownership from telemetry, logs, or caller assertions.

## Approval handling

When an execution reaches an approval boundary:

1. preserve the stable execution identity and approval request evidence;
2. perform no protected mutation while approval is absent, rejected, expired, or ambiguous;
3. validate that any approval receipt is bound to the intended operation, repository/branch, execution identity, and requested consequential action;
4. on rejection, terminate or remain waiting according to the governed workflow contract without publishing a partial release artifact as completed evidence;
5. on approval uncertainty, fail closed and reconcile from authoritative approval evidence rather than assuming consent.

## Browser / untrusted-content handling

All browser-, repository-, file-, artifact-, and tool-originated content is untrusted data until admitted by its established contract.

Hostile content MUST NOT be able to confer or alter:

- approval;
- credentials or secret access;
- execution identity;
- repository or branch authority;
- mutation authority;
- policy/security configuration;
- the mandatory human-review boundary.

A browser adapter is release evidence only after the actual release-candidate adapter executes the registered browser-observer conformance for `text`, `html`, and `accessibility-tree` and supplies its own runtime/navigation/rendering/session evidence.

## Evidence retrieval

For a completed governed execution, retrieve and bind the following to the same execution/candidate:

1. canonical execution event history;
2. causal topology;
3. authoritative runner-bound budget/usage/cost summary;
4. deterministic replay evidence;
5. independent verification evidence;
6. exact authoritative release artifact bytes and artifact identity;
7. durable ownership/fencing evidence where recovery ownership was exercised;
8. provider-failover evidence from the approved candidate's genuine alternate provider/replica/failover path, when the release gate is evaluated;
9. operational browser evidence for each required observation representation;
10. downstream telemetry export result, if configured.

Reject mixed-execution, substituted, stale, or noncanonical evidence. Restart-only evidence, process-local fixtures, and copied in-memory state MUST NOT be accepted as provider-failover proof.

## Persistence uncertainty and reconciliation

When a write acknowledgement is missing or uncertain:

1. do not blindly repeat the write;
2. read authoritative durable state using the operation/artifact/execution identity;
3. accept committed state only when authoritative evidence exactly matches the expected canonical identity/content;
4. quarantine or fail closed when authoritative state is missing, divergent, or ambiguous;
5. record the uncertainty, readback result, and final disposition in the release evidence bundle.

For release artifacts, use the repository reconciliation operation: settlement is readback-based and MUST NOT rewrite the artifact.

## Recovery ownership loss

If ownership is lost, expired, fenced, or cannot be proven:

1. stop protected continuation immediately;
2. do not renew, release, or mutate using stale authority;
3. observe authoritative ownership state;
4. permit reacquisition only through the registered ownership-store semantics;
5. require a fresh authority token/claim and monotonically increasing fence where takeover occurs;
6. preserve evidence proving the stale owner cannot disturb its successor.

If a real durable ownership adapter has not passed cross-process/restart conformance, the production durability gate remains BLOCKED.

## Provider failover

Provider failover is a distinct release gate from ordinary restart/recovery. It may be classified PASS only when the approved candidate executes through its genuine alternate provider, replica, or failover path and preserves all of the following:

1. exactly one live authoritative owner after failover;
2. monotonically increasing fencing through takeover;
3. authoritative settlement of post-commit/pre-acknowledgement uncertainty without blind replay;
4. no manufactured ownership or append after a proven pre-commit failure;
5. rejection of stale or released authority after takeover;
6. candidate-bound immutable evidence identifying the failover path exercised.

If the candidate cannot expose a genuine alternate provider/replica/failover path, or the path requires an unresolved architecture or permission decision, keep the provider-failover gate BLOCKED and continue independent safe work. Do not substitute restart-only, process-local, documentation, or copied-memory evidence.

## Health classification

Use three operational states:

- **GREEN** — all mandatory candidate-bound gates pass; zero unresolved critical findings; required durability, provider-failover, security, trace, deployment/rollback, and burn-in evidence exists.
- **AMBER** — implementation is progressing or component evidence is green, but one or more mandatory release gates remain open/BLOCKED or lack production-grade evidence.
- **RED** — a mandatory gate fails, unauthorized protected mutation occurs, critical security finding is unresolved, authoritative evidence diverges, or safe recovery cannot be proven.

AMBER is not a release declaration.

## Incident escalation

Immediately classify the candidate RED and stop consequential continuation when any of the following occurs:

- unauthorized protected mutation;
- approval bypass;
- secret or authority-material exposure;
- two simultaneous authoritative recovery owners for one operation;
- stale owner successfully mutates successor state;
- divergent authoritative release artifact under one artifact identity;
- unreconciled ambiguous commit/ownership state;
- provider failover produces competing authority, fence regression, or unreconciled commit state;
- critical security finding;
- evidence substitution or mixed execution identity accepted as authoritative;
- rollback cannot preserve required durable evidence/state.

Preserve evidence before remediation. Do not destroy the failing state solely to obtain a clean rerun.

## Deployment rehearsal gate

Before deployment rehearsal, record immutable candidate identity, dependency lock state, configuration schema/version, required environment-variable names without secret values, migration/state prerequisites, and expected post-deploy checks.

A deployment rehearsal is successful only when the same recorded inputs reproduce the expected candidate and all post-deploy health/evidence checks pass. Provider-specific commands belong in an approved provider adapter/runbook supplement and are intentionally not invented here.

## Rollback rehearsal gate

A rollback rehearsal MUST prove:

1. the target known-good candidate is immutable and identified;
2. rollback does not erase fencing, immutable writer/event, approval, or release evidence required to reject stale authority or reconcile prior operations;
3. schema/state compatibility is explicitly checked;
4. post-rollback health and evidence retrieval succeed;
5. any forward operation that became uncertain during rollback is reconciled before normal work resumes.

If rollback requires destructive state mutation or an unapproved provider-specific action, stop at that specific gate and continue independent verification/documentation work.

## Burn-in procedure

Burn-in evidence MUST record:

- candidate commit and deployment identity;
- start/end timestamps and intended duration;
- executions attempted/completed/failed;
- approval waits and outcomes;
- injected restart/failure scenarios;
- ownership loss/reacquisition events;
- provider-failover scenarios and outcomes when required by the candidate;
- persistence uncertainty/reconciliation events;
- telemetry/export failures;
- security findings/incidents;
- final regression/security/trace status.

Injected failures MUST exercise only approved, reversible mechanisms. Burn-in cannot substitute for missing external durability, provider-failover, or real adapter conformance.

## Stop procedure

For an orderly stop:

1. stop admission of new governed work;
2. allow already-authorized safe work to reach a contract-defined checkpoint or waiting state;
3. do not force protected work past approval or ownership boundaries;
4. persist/reconcile authoritative state and release evidence;
5. verify no stale ownership authority remains capable of continuation;
6. capture final health, open executions, approval waits, incidents, and evidence identities.

## Day-7 release declaration checklist

A release declaration requires all of the following to be true at the same candidate:

- regression suite 100% green;
- unauthorized protected actions = 0;
- complete governed repository-improvement workflow executed operationally;
- independent verification passed;
- complete trace and authoritative accounting captured;
- deterministic replay evidence captured;
- external release-artifact durability conformance passed;
- durable recovery ownership conformance passed;
- provider-failover conformance passed against the approved candidate's genuine alternate provider/replica/failover path;
- ownership/writer atomicity or deterministic reconciliation proven;
- operational browser evidence passed for all supported observation representations;
- telemetry remains downstream/non-authoritative;
- consolidated adversarial campaign has zero unresolved critical findings;
- deployment rehearsal passed;
- rollback rehearsal passed;
- operator runbook revision recorded;
- burn-in acceptance passed.

If any item is missing, the correct status is AMBER or RED, not GREEN.

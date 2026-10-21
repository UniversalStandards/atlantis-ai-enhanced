# Day-7 Deployment, Rollback, and Burn-In Evidence Contract

## Status and scope

This document defines provider-neutral evidence records and acceptance procedures for the ATLANTIS Day-7 deployment rehearsal, rollback rehearsal, and burn-in gates. It does not authorize deployment, choose a hosting/storage provider, grant credentials, expand network or workflow permissions, or permit destructive state mutation.

These records are release evidence only when bound to the exact release candidate and to an approved execution environment. Documentation or process-local fixtures do not prove deployment reproducibility, rollback safety, or burn-in.

## Shared candidate identity

Every deployment, rollback, and burn-in record MUST carry the same immutable candidate identity:

```text
candidateHeadSha
candidateMergeSha | null
workflowRunId
verificationMatrixRevision
operatorRunbookRevision
dependencyLockDigest
configurationSchemaVersion
deploymentIdentity
recordedAtEpochMs
```

Rules:

1. `candidateHeadSha` MUST identify the literal sprint/release-candidate head.
2. `candidateMergeSha`, when present, MUST identify the synthetic merge actually validated by PR CI.
3. `workflowRunId` MUST identify candidate-associated CI; stale-head CI MUST NOT be substituted.
4. Secret values MUST NOT appear in evidence. Configuration evidence records names/schema/version/digests only.
5. All timestamps MUST be canonical UTC/epoch evidence from the executing environment.
6. A record with ambiguous or mixed candidate identity is invalid and MUST fail the release gate.

## Deployment rehearsal evidence

A deployment rehearsal record MUST contain:

```text
deploymentRehearsalId
candidateIdentity
immutableArtifactIdentities[]
environmentClass
configurationDigest
migrationPrerequisiteEvidence[]
startedAtEpochMs
completedAtEpochMs
steps[]
postDeployChecks[]
releaseEvidenceArtifactId | null
result: PASS | FAIL | BLOCKED
failureReason | null
```

Each `steps[]` entry records a stable step identifier, start/end time, result, and non-secret evidence identity. Provider-specific commands are intentionally outside this contract and belong only in an approved provider supplement.

Each `postDeployChecks[]` entry MUST identify the check, expected condition, observed condition, result, and evidence identity. Required checks include candidate identity, service/process health, authoritative evidence retrieval, approval-policy availability, durable adapter availability when used, and absence of unexpected permission expansion.

### Deployment acceptance procedure

1. Bind the rehearsal to an immutable candidate and candidate-associated green CI.
2. Record dependency lock digest, configuration schema/version, environment class, immutable artifacts, and state/migration prerequisites before mutation.
3. Execute only approved reversible deployment steps.
4. Record every step result without deleting failed-state evidence.
5. Execute all post-deploy checks against the deployed candidate.
6. Retrieve authoritative release/evidence state where the candidate is expected to expose it.
7. Mark `PASS` only when every required step and post-deploy check passes and the deployed identity exactly matches the recorded candidate.
8. Mark `BLOCKED` when provider/credential/network/deployment authority is unavailable; `BLOCKED` MUST NOT be promoted to `PASS`.

## Rollback rehearsal evidence

A rollback rehearsal record MUST contain:

```text
rollbackRehearsalId
candidateIdentity
fromDeploymentIdentity
targetKnownGoodIdentity
compatibilityEvidence[]
preservedAuthorityEvidence[]
startedAtEpochMs
completedAtEpochMs
steps[]
postRollbackChecks[]
uncertainOperations[]
result: PASS | FAIL | BLOCKED
failureReason | null
```

`preservedAuthorityEvidence[]` MUST cover any applicable recovery fencing history, immutable writer/event evidence, approval evidence, release artifacts, and operation identities required to reject stale authority or reconcile uncertain work.

`uncertainOperations[]` MUST record operation identity, uncertainty source, authoritative readback identity, reconciliation disposition, and evidence identity. Blind duplicate writes are forbidden.

### Rollback acceptance procedure

1. Identify the deployed candidate and immutable known-good rollback target.
2. Prove schema/state compatibility before rollback begins.
3. Snapshot or otherwise identify authority/evidence state that MUST survive rollback without exposing secret material.
4. Execute only approved reversible rollback steps.
5. Reconcile every operation whose commit state became uncertain; do not blindly retry.
6. Verify post-rollback health, known-good identity, authoritative evidence retrieval, approval behavior, and stale-authority rejection.
7. Mark `PASS` only when required durable evidence remains sufficient to reject stale owners and reconcile prior operations.
8. Any destructive requirement, missing compatibility proof, lost fencing/evidence history, or unresolved ambiguous operation makes the gate `FAIL` or `BLOCKED`, never `PASS`.

## Burn-in evidence

A burn-in record MUST contain:

```text
burnInId
candidateIdentity
plannedDurationMs
startedAtEpochMs
endedAtEpochMs | null
executionCounts { attempted, completed, failed, waitingApproval }
approvalOutcomes[]
injectedFailures[]
ownershipEvents[]
persistenceUncertaintyEvents[]
telemetryFailures[]
securityFindings[]
regressionEvidence[]
traceCompletenessEvidence[]
incidents[]
finalDisposition: PASS | FAIL | BLOCKED | IN_PROGRESS
```

Each injected failure MUST identify the approved reversible mechanism, injection point, expected containment, observed containment, recovery/reconciliation evidence, and result. Required categories, when supported by the release candidate, are restart, acknowledgement loss, pre-commit failure, ownership loss/expiry/reacquisition, and downstream telemetry failure.

### Burn-in acceptance procedure

1. Start only from a candidate with current green CI and no unresolved critical security finding.
2. Record intended duration before burn-in begins; do not shorten it after observing failures merely to obtain a pass.
3. Exercise representative governed work including approval waits and completed executions.
4. Inject only approved reversible failures; preserve evidence from failing states before remediation.
5. Record ownership, persistence uncertainty, reconciliation, telemetry failure, and incident evidence as they occur.
6. Re-run applicable regression/security/trace checks at the end against the same candidate.
7. `PASS` requires the recorded planned duration to complete, zero unauthorized protected actions, zero unresolved critical findings, complete required traces, successful reconciliation of all uncertain persistence outcomes, and no unresolved authority ambiguity.
8. Missing real durable adapters or unavailable approved failure mechanisms remain `BLOCKED`; process-local simulations MUST NOT satisfy production burn-in evidence.

## Machine-readable record guidance

When these records are later encoded as JSON or another machine-readable artifact, implementations MUST preserve the field semantics above, use exact candidate identities, reject unknown authority-bearing fields, and keep secret/credential values out of the artifact. The schema format itself remains provider-neutral and may be implemented without changing these acceptance rules.

## Release-matrix reconciliation

The Day-7 verification matrix should classify:

- **Deployment reproducibility** as GREEN only with one candidate-bound `PASS` deployment rehearsal record.
- **Rollback reproducibility** as GREEN only with one candidate-bound `PASS` rollback rehearsal record proving required authority/evidence preservation.
- **Burn-in** as GREEN only with a completed candidate-bound `PASS` burn-in record.

A landed runbook or this evidence contract is preparatory evidence only. Until execution records exist, these gates remain open/BLOCKED and the operational-alpha status remains AMBER.

## Next execution boundary

Provider-specific deployment commands, credentials, network topology, destructive migration behavior, and production deployment authority remain explicit approval-bound decisions. Safe work before those decisions includes machine-readable schema implementation, validation/conformance tests, candidate-identity binding, evidence-bundle composition, and reconciliation of the verification matrix with current CI.
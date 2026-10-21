# Resumable Step Exactly-Once Effect Gate

## Status

Day-7 architecture gate and acceptance record. This document does not select a production persistence provider, external-effect provider, credential model, deployment authority, or permission expansion.

## Problem

ATLANTIS can make `workflow.step.completed` evidence and the advanced workflow checkpoint one atomic durable transition. That closes the reviewed completion-event → checkpoint split-write replay window.

Atomic internal completion persistence alone, however, cannot prove exactly-once execution of an arbitrary external side effect if a process can stop after the external effect succeeds but before the atomic completion transition becomes durable. A runner must not claim a stronger guarantee than the external-effect boundary can support.

## Required distinction

The implementation and release evidence MUST distinguish these guarantees:

1. **Atomic workflow progress:** completion evidence and the advanced checkpoint become visible together or not at all.
2. **No replay after acknowledged completion:** once the atomic completion transition is durably acknowledged, restart resumes after that step.
3. **Exactly-once external effect:** an externally consequential operation cannot be applied twice across process failure, uncertain acknowledgement, retry, or restart.

Guarantees 1 and 2 are provided by the existing provider-neutral `ResumableDurabilityPort` / atomic completion contract when the actual runner consumes it. Guarantee 3 requires an external-effect protocol in addition to atomic workflow progress.

## Provider-neutral external-effect alternatives

A production-capable consequential step MUST use at least one accepted mechanism below.

### A. Stable idempotency key

The runner supplies a stable operation identity derived from immutable execution identity, workflow identity/version, and step identity/index. The external system durably deduplicates repeated submissions and returns the original authoritative result for the same operation identity.

Acceptance requires restart tests proving repeated delivery cannot apply the effect twice and cannot bind the same operation identity to different request content.

### B. Transactional outbox / same consistency domain

The intended external effect is durably staged in the same atomic transaction as workflow progress, and a restart-safe dispatcher applies the staged operation with durable deduplication.

Acceptance requires transaction rollback/commit proof, dispatcher restart proof, duplicate-delivery proof, and authoritative result reconciliation.

### C. Fenced effect lease / compare-and-set authority

The external effect target accepts a fencing token or conditional version and rejects superseded writers or duplicate transitions.

Acceptance requires concurrent-writer, ownership-loss, late-settlement, and restart tests.

### D. Authoritative reconciliation with quarantine

When the target can authoritatively answer whether an operation committed, ATLANTIS may reconcile an uncertain outcome before permitting another attempt. If commit/non-commit cannot be proven, the execution is quarantined and further consequential mutation is blocked.

Acceptance requires committed, known-not-committed, conflicting, and permanently-uncertain cases, including restart during reconciliation.

## Rejected semantics

The following are insufficient for an exactly-once claim:

- retrying a consequential step merely because no completion checkpoint is visible;
- assuming an exception means the external operation did not commit;
- using a newly generated idempotency key on retry;
- treating event/checkpoint atomicity as atomicity with an unrelated external service;
- accepting an event cursor ahead of the checkpoint as proof of external-effect state without validated authoritative reconciliation;
- silently downgrading a consequential step to at-least-once behavior.

## Runner integration acceptance

The current recovery P1 can be closed only when the actual `ResumableSequentialWorkflowRunner` no longer performs the reviewed split `workflow.step.completed` append followed by independent checkpoint advancement.

Runner-level evidence MUST prove:

1. completion event and advanced checkpoint use one authoritative `ResumableDurabilityPort` consistency domain;
2. caller-visible next-step index, completed-step prefix, post-step value, usage, event tail, and checkpoint revision advance only from the validated atomic acknowledgement;
3. ordinary interruption/retry recovery that legitimately leaves event-tail progress beyond the last checkpoint remains valid;
4. a failure before atomic publication exposes neither completion evidence nor advanced checkpoint;
5. a failure after durable atomic publication but before caller acknowledgement recovers as completed without rerunning the step;
6. consequential external-effect tests use one of alternatives A-D above rather than attributing external exactly-once semantics to internal persistence alone;
7. ambiguous external-effect state fails closed or quarantines rather than blindly retrying.

## Decision required before production consequential effects

Select and authorize the production external-effect protocol for each consequential adapter class: stable idempotency, transactional outbox, fencing/CAS, or authoritative reconciliation/quarantine. Different adapter classes may choose different mechanisms if each satisfies this gate.

This decision is intentionally deferred. Provider-neutral runner wiring, atomic-progress tests, failure-injection scaffolding, reference/in-memory verification, CI inspection, and non-consequential execution work may continue without it.

## Day-7 release consequence

Until a production external-effect mechanism is selected and evidenced, ATLANTIS may claim atomic resumable workflow progress and no replay after acknowledged atomic completion, but MUST NOT claim universal exactly-once execution for arbitrary external side effects.

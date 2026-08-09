# Immutable Writer Commit Evidence Options

## Status

Decision-preparation artifact for the ATLANTIS seven-day operational-alpha sprint.

This document narrows the remaining production-persistence architecture decision without selecting a database, cloud provider, transaction primitive, deployment topology, credential model, or production adapter. It does not authorize a permission expansion or deployment change.

## Problem statement

The existing provider-neutral persistence contract can classify a committed append when authoritative durable evidence exactly matches the expected event identity, execution identity, stream position, and content digest. That is sufficient for deterministic reconciliation of a stable historical observation, but a mutable post-CAS current-state read is not, by itself, immutable writer-specific proof that one exact append operation committed.

Before binding the first production adapter, ATLANTIS needs a provider-neutral way to prove that a particular admitted writer operation produced one durable immutable event transition. The proof must remain valid after later writes advance mutable current state.

## Required invariants

Any accepted design MUST prove all of the following:

1. The evidence is bound to exactly one append operation identity.
2. The evidence is bound to the expected execution ID and event ID.
3. The evidence is bound to the expected stream version and content digest.
4. The evidence cannot be reinterpreted as proof for a different writer, event, execution, or stream position.
5. A later successful append cannot invalidate or overwrite the historical proof.
6. A conflicting or failed append cannot manufacture committed evidence.
7. The evidence survives process restart and can be revalidated independently of the caller that performed the write.
8. Verification does not depend on ambient mutable in-process state.
9. Verification fails closed when the adapter cannot prove the binding.
10. No secret, credential, lease token, or other excluded authority material is required in durable trace evidence.
11. The mechanism remains compatible with the existing four-way append outcome model: committed, conflict, known failure, uncertain.
12. Ambiguous transport settlement remains uncertain until immutable evidence or valid non-commit proof resolves it.

## Option A — Transaction-bound immutable commit receipt

The atomic append operation returns or durably exposes an immutable receipt produced by the same transactional boundary that committed the event.

Minimum receipt fields:

- receipt ID;
- operation ID;
- execution ID;
- event ID;
- committed stream version;
- committed global sequence when used;
- content digest;
- provider transaction or mutation identity when available;
- commit timestamp or provider commit position when authoritative;
- verification method and issuer identity when the receipt is externally verifiable.

### Required guarantee

The adapter MUST prove the receipt could only have been produced if the exact event transition committed atomically. A receipt generated merely by the client before durable commit is not acceptable.

### Strengths

- Direct writer-specific proof.
- Efficient reconciliation when the receipt is durable and independently queryable.
- Natural binding to transaction or conditional-write settlement.

### Risks

- Some providers do not expose a sufficiently immutable transaction receipt.
- A client-generated acknowledgement can be mistaken for provider commit evidence unless the boundary is explicit.
- Provider-specific receipt verification must remain behind the adapter boundary.

## Option B — Version-addressable immutable committed read

The adapter exposes an authoritative read by immutable event identity or committed stream position. The returned historical record cannot be replaced by later writes.

Minimum lookup capability:

```text
read_committed_event(
  execution_id,
  event_id | stream_version
) -> exact immutable event record | absent
```

### Required guarantee

Once the event is committed, the same immutable event identity or historical stream position MUST continue to resolve to the same canonical record after later stream mutations and after process restart.

### Strengths

- Provider-neutral and easy to verify with restart tests.
- Historical proof naturally survives current-state advancement.
- Reuses the canonical event record and digest model.

### Risks

- A mutable materialized "current row" is not sufficient.
- Implementations must prove historical lookup cannot alias a later value.
- Tombstones, compaction, or retention policies cannot destroy proof inside the required operational evidence window.

## Option C — Provider operation identity plus immutable historical read

The adapter returns a provider operation or transaction identity and separately exposes an immutable historical event read. Reconciliation accepts committed status only when both observations bind to the same attempted append.

Minimum binding:

- provider operation identity resolves to committed;
- immutable historical event resolves to the exact event ID, execution ID, stream version, and digest;
- adapter proves the provider operation and historical event belong to the same atomic mutation.

### Required guarantee

Neither side may stand alone. A provider operation marked committed without exact immutable event binding is insufficient, and an event read without writer-operation binding is containment evidence rather than writer-specific proof.

### Strengths

- Works with providers whose transaction APIs and historical data APIs expose complementary evidence.
- Strong ambiguity reconciliation when operation settlement can be queried after transport failure.

### Risks

- More complex adapter proof obligation.
- Cross-API correlation must itself be authoritative rather than inferred from timestamps or mutable metadata.

## Explicitly insufficient evidence

The following MUST NOT be accepted as immutable writer-specific commit proof by themselves:

1. Reading only the mutable current stream version after CAS.
2. Reading only the latest event after a successful-looking client call.
3. A client-generated UUID or acknowledgement created before provider commit settlement.
4. A log message emitted by the writer process.
5. A non-transactional combination of "operation succeeded" and a later mutable current-state read when intervening writers may have advanced the stream.
6. A provider response that cannot be revalidated after restart.
7. Wall-clock proximity between a write attempt and an observed event.
8. A receipt that omits exact operation/event/execution/version/digest binding.

These observations may remain useful containment or diagnostic evidence, but they cannot authorize a committed classification when writer identity is ambiguous.

## Decision matrix

| Criterion | Option A: transaction receipt | Option B: immutable historical read | Option C: operation + historical read |
| --- | --- | --- | --- |
| Exact writer binding | Strong when provider-issued | Requires adapter binding to admitted operation | Strong when correlation is authoritative |
| Survives later writes | Required | Required by design | Required |
| Restart revalidation | Required | Natural acceptance gate | Required |
| Provider neutrality | Medium | High | Medium |
| Ambiguous transport reconciliation | Strong if receipt is queryable | Strong when event identity is unique and historical | Strong |
| Implementation complexity | Medium | Low-to-medium | High |
| Risk of mutable-current-state confusion | Low | Medium unless historical semantics are proven | Low-to-medium |
| Suitable as sole proof | Yes, if transactional and immutable | Yes, if writer binding is proven | Yes, only as combined evidence |

## Executable acceptance gates

The first production adapter MUST pass all of these tests against the real adapter boundary before its commit evidence is accepted.

### Gate 1 — Later-writer stability

1. Writer A commits event A at stream version N.
2. Capture A's commit evidence.
3. Writer B commits event B at stream version N+1.
4. Revalidate A's evidence.
5. A MUST still prove event A at version N with the original digest.

### Gate 2 — Competing writer isolation

1. Writers A and B attempt the same expected stream version concurrently.
2. Exactly one transition commits.
3. Only the winning writer may obtain valid committed evidence.
4. The losing writer's evidence MUST classify as conflict, known failure, or uncertain as appropriate; it MUST NOT validate as committed.

### Gate 3 — Post-commit acknowledgement loss

1. The provider commits the append.
2. Transport is severed before the caller receives the normal acknowledgement.
3. The caller records or reconstructs uncertainty.
4. After restart, immutable evidence MUST reconcile the exact append as committed without duplication.

### Gate 4 — Pre-commit failure

1. The operation fails before durable commit.
2. No valid committed evidence may exist.
3. Historical readback at the expected position MUST not falsely bind the failed writer to a later writer's event.

### Gate 5 — Process restart

1. Commit an event and persist only adapter-required durable evidence.
2. Terminate the process.
3. Recreate the adapter from durable state.
4. Revalidate the evidence without caller-memory assistance.

### Gate 6 — Identity substitution rejection

For otherwise plausible evidence, independently mutate each of operation ID, execution ID, event ID, stream version, global sequence when present, and content digest. Every substitution MUST fail closed.

### Gate 7 — Replay rejection

Evidence from a completed append MUST NOT validate as committed evidence for a distinct uncertainty record or a distinct attempted append identity.

### Gate 8 — Retention and compaction safety

Any adapter retention, compaction, projection, or tombstone behavior enabled for the operational alpha MUST preserve the immutable proof for at least the required release evidence and recovery horizon. If the provider cannot guarantee that, the adapter is not acceptable under that configuration.

## Acceptance-harness shape

The provider-neutral integration harness SHOULD expose a fixture equivalent to:

```text
attempt_append(expected) -> append_outcome
capture_commit_evidence(outcome | operation_id) -> evidence | absent
revalidate_commit_evidence(expected, evidence) -> committed | invalid | uncertain
restart_adapter()
read_committed_event(execution_id, event_id | stream_version) -> event | absent
```

The harness must not require production credentials in pull-request CI. A production-provider test lane may run only in an explicitly approved protected environment with a documented permission and secret inventory.

## Relationship to recovery ownership

Immutable writer commit evidence and atomic recovery ownership solve different failure modes and MUST remain separate contracts:

- commit evidence proves what one append operation durably committed;
- recovery claim/lease/fencing proves which worker currently owns authority to perform recovery work.

A correct adapter needs both before uncertain-outcome recovery may perform external or durable mutation safely under contention.

## Decision rule

A provider adapter may implement Option A, Option B, or Option C only if its real integration tests prove every invariant and executable gate above. Provider convenience is not sufficient reason to weaken the contract.

If more than one option is available, prefer the design with the smallest trusted surface and the strongest restart-verifiable immutable binding. The final provider-specific choice remains an architecture decision and is intentionally deferred.

## Next architecture decision

After this matrix is reviewed, the remaining paired decision is the provider-neutral atomic recovery claim/lease/fencing contract: exclusive claim acquisition, opaque ownership token, monotonically increasing fence, lease expiry/renewal, bounded continuation/fairness, ownership-loss behavior, and restart/crash recovery.

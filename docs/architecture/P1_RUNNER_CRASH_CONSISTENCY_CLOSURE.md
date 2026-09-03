# Runner P1 Crash-Consistency Closure

## Status

Provider-neutral implementation constraint for current Day-7 P1 issues #15, #17, and #19. This document does not select a production persistence provider, external-effect provider, credential, deployment authority, or protected-branch permission.

## Goal

Close the three current runner P1s without creating three unrelated persistence mechanisms or weakening the authoritative `ResumableDurabilityPort` established for completed-step recovery.

## Shared invariant

A workflow transition that changes replay authority MUST have one authoritative durable interpretation after any crash or acknowledgement loss. Recovery must never combine event evidence from one consistency domain with retry/progress/terminal state from another.

The existing authoritative durability domain remains the owner of restart-visible events and checkpoints. New terminal and retry transitions should extend that domain or reconcile from its validated durable evidence; they must not introduce a parallel terminal/retry store.

## #15 timeout fencing

Timeout is a control-plane revocation boundary, not proof that an in-flight provider/tool call stopped. Before terminal timeout finalization, the attempt must lose authority to commit consequential state.

Required provider-neutral semantics:

1. Each active attempt receives a revocable attempt/commit authority identity.
2. Deadline expiry revokes that authority before `execution.timed_out` can become terminal.
3. Consequential adapters must validate current authority at their commit boundary or provide cancellation acknowledgement that proves late completion cannot commit.
4. Late resolution/rejection after revocation may be observed for diagnostics but cannot advance workflow progress or regain commit authority.
5. Adapters unable to prove cancellation/fencing support are inadmissible for consequential timed operations; fail closed rather than assuming `Promise.race` cancellation.
6. This does not claim universal exactly-once external effects.

Minimum deterministic proof: timeout wins while operation remains pending; late resolve; late reject; late consequential commit attempt; all leave authoritative workflow progress terminal and unchanged after revocation.

## #17 terminal publication + checkpoint retirement

Terminal disposition and retirement of replayable recovery state are one logical transition.

Preferred implementation: extend the authoritative durability domain with a terminal transition whose acknowledged result proves terminal event identity plus retirement/tombstone state together. An equivalent implementation may publish terminal evidence first and retain enough authoritative state for recovery to deterministically return the same terminal result until retirement is proven.

Forbidden state: checkpoint/recovery state absent while no authoritative terminal evidence exists.

Failure-injection boundaries:

- before terminal publication;
- after publication before acknowledgement;
- before retirement;
- after retirement before/at acknowledgement.

For every boundary, restart must either resume from intact authoritative recovery state or return the same terminal disposition; it must never replay an already-completed prefix.

## #19 retry failure + retry-budget consumption

A durable retryable failed-attempt record and consumption of its retry allowance are one logical transition.

Preferred implementation: authoritative atomic failed-attempt transition updates retry accounting and publishes `workflow.step.attempt.failed` together. Equivalent recovery-time reconciliation is acceptable only when it derives retry consumption from validated authoritative evidence and is identity-bound to execution, workflow, step, attempt, and event tail.

Required invariant: one durable failed-attempt identity consumes exactly one allowance, including after acknowledgement loss and repeated restart. No crash boundary may restore consumed retry budget; no reconciliation may double-count the same failed-attempt identity.

## Reuse requirements

- Reuse `ResumableDurabilityPort` as the authoritative consistency domain.
- Reuse existing event/checkpoint validation and exact-tail/revision patterns from atomic completed-step handling.
- Reuse existing retry, timeout, cancellation, approval, budget, and restart behavioral suites; add only focused failure-injection cases needed for the new transition boundaries.
- Do not add caller-supplied PASS evidence or a second recovery authority.

## Closure order

1. #15: define/revoke attempt commit authority and prove late consequential completion is fenced.
2. #17: make terminal publication/retirement crash-consistent using the same authoritative durability domain.
3. #19: make retry-failure publication/consumption crash-consistent using the same authoritative durability domain.
4. Run exact-head typecheck and complete tests after each implementation slice.
5. Require exact-head Contracts, CodeQL, and Socket success before resolving the corresponding review thread.

## Acceptance boundary

This document is implementation guidance, not closure evidence. Issues #15, #17, and #19 remain open until runner-level tests and exact-head CI/security prove their respective acceptance criteria.
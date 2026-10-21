# External-effect trace integrity verification

## Scope

Independent verification of changes after `408f20e7279657cc5bbd058fab1fa149ea62a870` on `sprint/7-day-operational-alpha`.

The incoming slice added durable `external.effect.executed` and `external.effect.reconciled` evidence hooks to the provider-neutral external-effect execution helper.

## Defect identified

The initial hook context was not explicitly bound to an execution identity and accepted a fixed parent event ID while obtaining sequences from an external callback. Reusing the hook could therefore produce sibling evidence events with the same parent instead of a contiguous chain. A receipt could also be appended to a context intended for another execution stream.

Because sequence allocation occurred outside the hook, a failed append could consume a sequence and leave a gap depending on the caller's cursor implementation.

## Correction

- Added mandatory `executionId` binding to the evidence context.
- Rejected receipts whose execution ID differs from the evidence stream.
- Replaced externally allocated sequence values with hook-owned `initialSequence` state.
- Advanced sequence and parent state only after a successful durable append.
- Chained each later evidence event to the last successfully appended event.
- Added fail-closed validation for execution identity, cursor structure, event ID, actor, and canonical occurrence timestamp.

## Corrective commits

- `cb5446769021d1a9985010519bbc7b558372a071` — preserve external-effect evidence stream identity and chain integrity.
- `f2f12b5a323019262e5334f7b6ced3b720d1778d` — add stream-binding, chaining, and append-failure regressions.

## Exact-head evidence

- Implementation head: `f2f12b5a323019262e5334f7b6ced3b720d1778d`
- GitHub Actions run: `30881064769`
- Frozen pnpm installation: passed with cache hit.
- Contracts typecheck: passed.
- Event-store typecheck: passed.
- Contracts tests: 102 passed.
- Event-store tests: 51 passed.
- Total tests: 153 passed.
- External-effect execution suite: 10 passed.
- Validation token permissions: contents read, metadata read.

## Verified invariants

1. Evidence is appended only to the receipt's bound execution stream.
2. Repeated evidence events form a contiguous parent chain.
3. Sequence and parent state advance only after successful append.
4. Failed appends can be retried without creating an evidence-sequence gap.
5. Receipt persistence still precedes execution or reconciliation evidence emission.

## Architecture and security assessment

Provider-neutral boundaries remain intact. No provider SDK, production persistence decision, secret, permission expansion, approval weakening, or deployment change was introduced.

The correction improves trace integrity but does not solve atomic external-effect ownership. Two concurrent callers can still both observe no receipt and no provider reconciliation result, then both invoke the provider.

Cross-store atomicity among provider commitment, receipt storage, checkpoint storage, and event append also remains unresolved.

## Next integration action

Implement a provider-neutral atomic external-effect claim or lease boundary with owner identity, expiry, crash recovery, committed transition, and non-owner behavior. Prove through a concurrent regression that exactly one caller invokes `provider.execute`, and then integrate the claimed effect path into protected resumable execution and the full governed composition-root test.

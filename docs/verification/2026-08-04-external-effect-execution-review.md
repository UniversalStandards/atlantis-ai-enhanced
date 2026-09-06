# External-effect execution verification

## Scope

Independent review of the four commits after `191948519f4159f35b3b36ae237585cdffb67339` through implementation head `b0c71acc73906abcb3318ee4d1e0e2ac82ad4645`.

The change set is limited to the provider-neutral external-effect execution helper, its public package export, and focused tests.

## Verified behavior

`executeExternalEffectWithReconciliation`:

1. returns a receipt already present in the durable store without consulting the provider;
2. asks the provider to reconcile before attempting a new effect;
3. validates every stored, reconciled, or newly executed receipt against execution ID, step ID, effect type, and idempotency key;
4. persists provider-reconciled and newly executed receipts;
5. recovers after a provider commit when the first durable receipt save fails, provided the provider can later reconcile that commitment;
6. fails closed when receipt identity conflicts with the requested effect identity.

## Exact implementation evidence

- Implementation head: `b0c71acc73906abcb3318ee4d1e0e2ac82ad4645`
- GitHub Actions run: `30876556507`
- Frozen pnpm installation: passed with cache hit.
- Contracts and event-store typechecks: passed.
- Contracts tests: 97 passed.
- Event-store tests: 51 passed.
- Total tests: 148 passed.
- External-effect execution tests: 5 passed.
- Validation token permissions remained read-only.

## Blocking defect

The helper does not provide atomic ownership of an uncommitted external effect.

Two concurrent callers can both observe:

`durable store miss → provider reconciliation miss`

and then both call `provider.execute(identity)` for the same idempotency key. The current `ExternalEffectReceiptStore` exposes only `load` and `save`; neither operation creates an exclusive claim or lease. The test named "executes once" verifies one invocation, not concurrent single execution.

Provider-side idempotency may reduce risk for some integrations, but the contract does not require or prove it. Therefore the helper must not yet be represented as exactly-once execution.

## Safe disposition

No partial locking API was introduced. A safe correction must define complete provider-neutral claim semantics, including atomic acquisition, ownership token, lease expiry or recovery, release, committed transition, and behavior during approval wait or worker restart.

## Required acceptance proof

A concurrency regression must start two invocations for the same identity and prove:

1. exactly one caller obtains execution ownership;
2. `provider.execute` is called at most once;
3. the non-owner waits, reconciles, or fails closed without executing;
4. a crashed owner can be recovered through an explicit lease policy;
5. a committed receipt becomes the durable result for all later callers.

## Next integration action

Define and implement the atomic external-effect claim/lease boundary, then integrate the claimed reconciliation helper into protected resumable execution with durable observed/reconciled trace events. After that, complete the governed composition-root integration test across execution identity claim, checkpoint store, event sink, approval state, and external-effect receipt store.

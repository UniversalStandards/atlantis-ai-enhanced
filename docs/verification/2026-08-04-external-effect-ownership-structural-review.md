# External-effect ownership structural-integrity review

## Verification scope

Independent verification covered the five commits after `4bfbc53d5ce20a43bff6dd92d42519a168c9ff2b` through implementation head `3810f8e3f13b71df010c68af7ed59743c83623de`.

Reviewed:

- accepted atomic external-effect ownership ADR;
- provider-neutral ownership contract;
- deterministic in-memory reference store;
- concurrency, expiry, renewal, fencing, observation, release, and receipt-identity tests;
- package export;
- exact-head GitHub Actions evidence;
- PR #10 and master sprint Issue #8 status.

## Verified evidence

- PR #10 remained open, draft, and mergeable.
- GitHub Actions run `30887957998` succeeded on `3810f8e3f13b71df010c68af7ed59743c83623de`.
- Frozen pnpm installation passed.
- Contracts and event-store typechecks passed.
- 163 tests passed: 112 contracts and 51 event-store tests.
- The ownership suite contributed 10 passing tests.
- Validation permissions remained read-only.
- No unresolved inline review thread or duplicate ownership implementation was found.

## Verified ownership behavior

The reference store correctly demonstrates:

1. one unexpired acquisition for one normalized effect identity;
2. opaque token non-disclosure to non-owners;
3. monotonic fencing generations after release or expiry;
4. stale-owner rejection for renewal and commit;
5. stale release protection;
6. bounded renewal that preserves token and generation;
7. committed-receipt reuse for later callers;
8. fail-closed receipt identity validation;
9. read-only observation;
10. explicit process-local test-only status rather than production durability.

## Defect identified: ownership inputs are not structurally fidelity-safe

The ownership boundary hardens optional metadata through prototype and property-descriptor inspection, but equivalent protection is not applied to the ownership request, renewal request, or bearer claim objects.

`normalizeClaim` and acquisition or renewal normalization read fields directly. An accessor-backed field can therefore execute while the security-sensitive claim is being validated. Inherited fields and non-enumerable fields are also accepted because the boundary does not require an exact plain data record with own enumerable data properties.

This matters because a claim carries the opaque ownership token and fencing generation. Once runtime integration persists, restores, or accepts claims across process boundaries, structural ambiguity at this boundary can undermine deterministic validation and evidence integrity even when value equality checks later reject the claim.

## Required correction

Before wiring ownership into `executeExternalEffectWithReconciliation`:

1. validate acquisition requests, renewal requests, and claims as plain records;
2. inspect own property descriptors without invoking accessors;
3. reject symbol keys, accessors, non-enumerable properties, custom prototypes, missing required own fields, and unexpected fields where the contract is intended to be exact;
4. preserve normalized immutable return values;
5. add regressions proving getters are not executed and inherited or hidden authorization fields are rejected;
6. retain all existing concurrency, fencing, expiry, renewal, and receipt-identity behavior.

## Architecture and security status

No provider SDK, production persistence selection, secret, permission expansion, deployment change, approval weakening, or irreversible operation was introduced.

Cross-store atomicity and exactly-once behavior remain explicitly unresolved. The in-memory store remains reference infrastructure only.

## Next integration action

Harden structural validation for ownership requests, renewals, and claims with focused regressions. After exact-head CI passes, integrate `ExternalEffectOwnershipStore` into `executeExternalEffectWithReconciliation`, add durable ownership lifecycle evidence, prove concurrent callers invoke `provider.execute` at most once, and then complete the governed composition-root restart test.

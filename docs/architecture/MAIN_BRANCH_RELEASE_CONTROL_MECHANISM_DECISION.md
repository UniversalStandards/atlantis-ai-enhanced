# Main-branch release-control mechanism decision

## Status

**UNSELECTED — repository enforcement required before Day-7 integration**

This record narrows the remaining repository-governance decision without selecting or applying a repository setting. It grants no deployment authority, credential scope, provider authority, or production permission.

## Required invariant

Whichever mechanism is selected for `main` MUST:

1. require pull-request based integration;
2. require the exact ATLANTIS `validate` check produced by GitHub Actions app id `15368`, after re-verifying that identity immediately before mutation;
3. block integration while that required check is pending or failing;
4. require at least one approving review before integration;
5. apply to the `main` release path without weakening existing CodeQL, Socket Security, or workflow permissions;
6. remain reversible and have a captured pre-change state;
7. leave PR #10 unmerged until all other Day-7 gates are satisfied.

## Option A — classic branch protection

Use GitHub branch protection directly on `main`.

Acceptance evidence:

- `main.protected == true`;
- detailed branch protection is readable;
- required pull-request reviews are configured;
- required status checks contain an exact `checks[]` entry for `validate` with app id `15368`;
- a fresh successful `validate` check exists for the current PR head;
- deterministic GitHub rule evaluation or a non-production negative verification demonstrates pending/failing required checks cannot integrate.

Advantages: directly matches the existing `release-control-evidence.mjs` enforcement probe and is the smallest change from the current unprotected state.

Tradeoff: policy is branch-local rather than expressed as a reusable repository ruleset.

## Option B — repository ruleset

Use an active repository ruleset whose target/conditions include `main` and whose rules enforce the same invariant.

Acceptance evidence:

- the applicable ruleset is active and targets `main`;
- pull-request integration and approving review requirements are explicit;
- the exact `validate` / app-id `15368` check is required;
- a fresh successful `validate` check exists for the current PR head;
- deterministic GitHub rule evaluation or a non-production negative verification demonstrates pending/failing required checks cannot integrate;
- the release-control evidence probe is extended and tested to understand the selected ruleset representation before it is used as the final enforcement assertion.

Advantages: policy can be expressed as a reusable repository governance object.

Tradeoff: the current enforcement probe intentionally understands detailed branch protection, not ruleset semantics; selecting this option therefore requires a small provider-neutral probe extension before final verification.

## Selection rule

Choose exactly one mechanism only when the repository-settings mutation can be performed and immediately verified. Prefer the smallest reversible mechanism that satisfies every invariant. Do not broaden credentials or bypass review to make either option work.

If the connected integration cannot mutate the selected repository setting, record the exact failed capability and continue independent safe work. Connector inability is not authorization to weaken the invariant.

## Pre-mutation checklist

Immediately before mutation:

1. fetch PR #10 and confirm it is open, unmerged, and points to `sprint/7-day-operational-alpha`;
2. fetch current-head check runs and require exactly one successful `validate` check from app id `15368`;
3. capture `main` protection state and repository rulesets;
4. abort the mutation if check identity is absent, changed, or ambiguous;
5. preserve the captured state as rollback evidence.

## Post-mutation checklist

Immediately after mutation:

1. re-read the selected repository control;
2. prove PR/review enforcement;
3. prove the exact required-check binding;
4. prove pending/failing required-check blocking;
5. run the applicable release-control enforcement probe;
6. update Issue #8 and PR #10 with mechanism, exact configuration, verification evidence, and rollback state.

## Evidence freshness rule

Do not treat a commit SHA or check-run id recorded in this document as live repository state. `main` protection, repository rulesets, PR #10 head/state, and the exact `validate` check identity MUST be re-queried immediately before any repository-settings mutation.

Last captured verification before this maintenance correction (2026-09-01): `main` was unprotected, required-status enforcement was off, repository rulesets were empty, PR #10 was open/draft/mergeable, and the then-current sprint head `6a1ac1c9e8fa38fba574402444409a1afd6353ef` had a successful `validate` check from GitHub Actions app id `15368`. This paragraph is historical evidence only and must not be used as a substitute for the pre-mutation checklist above.

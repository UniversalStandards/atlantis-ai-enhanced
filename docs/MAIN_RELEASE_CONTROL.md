# `main` release-control plan

## Current state

The connected GitHub execution surface is read-only for repository branch
protection and ruleset settings. A live read of `main` reported
`protected: false`, no required status checks, and no repository rulesets.
The available GitHub tools do not expose the mutation endpoint, so this
repository deliberately remains fail-closed: no workflow, local check, or
documentation in this change is presented as a substitute for server-side
enforcement.

The missing authority is a repository-settings-capable administrator with
permission to write repository rulesets (or classic branch protection) for
`UniversalStandards/atlantis-ai-enhanced`.

## Single reversible mutation

Apply one active repository ruleset targeting `refs/heads/main` with this
payload through the GitHub repository-rulesets API:

```json
{
  "name": "main release control",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          {
            "context": "validate",
            "integration_id": 15368
          }
        ]
      }
    },
    {
      "type": "non_fast_forward"
    }
  ],
  "bypass_actors": []
}
```

Use `POST /repos/UniversalStandards/atlantis-ai-enhanced/rulesets` to create
the ruleset, or update the single returned ruleset by ID if an equivalent
ruleset already exists. Do not create a second overlapping release gate.
`bypass_actors` must remain empty; do not grant an administrator, actor, or
team a bypass role. Record the returned ruleset ID so the change can be
reverted with `DELETE /repos/UniversalStandards/atlantis-ai-enhanced/rulesets/{id}`.

The pull-request rule makes direct pushes and non-PR changes ineligible.
`strict_required_status_checks_policy` binds the successful check to the
current PR head. The `integration_id` binding is required to distinguish the
GitHub Actions `validate` check from an unrelated check with the same name.
An absent, pending, cancelled, skipped, stale, or unsuccessful check therefore
cannot satisfy the required-status rule.

## Required verification evidence

After mutation, capture the ruleset response and the following read-only
checks for the exact PR head being integrated:

1. `GET /repos/UniversalStandards/atlantis-ai-enhanced/rulesets` shows the
   ruleset is `active`, targets `refs/heads/main`, has the pull-request rule,
   has `required_approving_review_count >= 1`, has no bypass actors, and has
   the required status `{context: "validate", integration_id: 15368}`.
2. `GET /repos/UniversalStandards/atlantis-ai-enhanced/commits/{head}/check-runs`
   shows the `validate` check from GitHub Actions app `15368` is successful and
   has the exact PR head SHA. Repeat with pending and failing fixtures (or
   GitHub's mergeability/status response) and record that both are rejected.
3. `GET /repos/UniversalStandards/atlantis-ai-enhanced/pulls/10` confirms PR
   `#10` remains open and has no independent approval yet; do not self-approve
   or bypass it.
4. Re-run the existing Contracts `validate` workflow and release-control
   self-tests, preserving CodeQL, Socket Security, SEC-20, frozen-lockfile,
   typecheck, and test checks.

Issue `#13`, sprint issue `#8`, PR `#10`, and readiness comment `5288781441`
must be updated with the returned ruleset ID, exact head SHA, check-run ID,
review evidence, and negative-gate evidence. Until that evidence exists,
issue `#13` is not complete.

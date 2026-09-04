# ADR: Surgical Work Units and Agent Delegation

## Status
Accepted for ATLANTIS sprint execution.

## Context
ATLANTIS delivery accumulated large long-lived pull requests where many independent outcomes, fixes, and follow-up corrections were bundled together. This reduced reviewability, increased stale-ancestry risk, made rollback boundaries coarse, and delayed visible project progress because substantial completed work remained hidden behind one still-open PR.

GitHub-native coding agents can safely perform substantial implementation work when given precise bounded instructions, but agent output must remain independently verified and must not receive authority to select production providers, credentials, irreversible semantics, security-sensitive permissions, deployment authority, or governance bypasses.

## Decision
ATLANTIS adopts issue-first surgical work units as the default delivery model.

1. Parent/meta issues coordinate goals, dependencies, and release readiness.
2. Independently verifiable outcomes become child issues with explicit acceptance criteria.
3. Implementation-heavy child issues should be delegated to GitHub Copilot/coding agents when safe and useful.
4. Each delegated issue receives canonical ancestry, objective, dependencies, invariants, existing contracts/validators to reuse, prohibited shortcuts, tests, evidence requirements, and rollback constraints.
5. Prefer one child issue → one focused branch → one focused PR.
6. Target <= 10 logical commits and <= 25 changed files per PR.
7. More than 20 logical commits or more than 50 changed files triggers decomposition review unless a documented exception shows splitting would increase risk.
8. Generated/mechanical artifacts may be accounted separately, but review evidence must remain bounded.
9. Oversized or divergent PRs stop accumulating new unrelated work; they become reference evidence while fresh surgical issues are implemented from current canonical HEAD.
10. Independent verification is required before integration or issue closure.
11. Closed verified child issues, not raw commit count, are the primary visible progress unit.
12. Architecture gates block only dependent mutations; safe provider-neutral and independent work continues.

## Consequences
### Positive
- Faster visible progress through issue closure.
- Smaller review and rollback surfaces.
- Lower stale-branch and accidental-regression risk.
- Better parallelism between coding agents and human/AI reviewers.
- Easier mapping between acceptance criteria, evidence, and delivered code.

### Costs
- More issues and PRs must be coordinated.
- Dependency ordering must be maintained explicitly.
- Later parallel branches may need refresh/rebase after earlier slices integrate.
- Mechanical changes may require documented scope exceptions.

## Non-goals
This ADR does not authorize automatic merge, production deployment, provider selection, credential use, branch-protection changes, security-sensitive permission expansion, or bypass of review/governance requirements.

## Verification
Sprint automation and repository instructions must enforce this operating model in prompts, issue templates, progress reporting, and review behavior. Deviations should be documented in the affected issue/PR with an explicit rationale and bounded exception.
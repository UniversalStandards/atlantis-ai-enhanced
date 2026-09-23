# ADR: Bounded Work Packets, Focused PRs, and Agent Delegation

## Status
Accepted for ATLANTIS sprint execution.

## Context
ATLANTIS delivery accumulated large long-lived pull requests where many independent outcomes, fixes, and follow-up corrections were bundled together. This reduced reviewability, increased stale-ancestry risk, made rollback boundaries coarse, and delayed visible project progress because substantial completed work remained hidden behind one still-open release PR.

The opposite extreme—forcing every tiny code change into its own issue and PR—would also create coordination overhead and artificial fragmentation. The desired unit is therefore not the smallest possible change; it is the smallest coherent work packet with one meaningful acceptance and rollback boundary.

GitHub-native coding agents can safely perform substantial implementation work when given precise bounded instructions, but agent output must remain independently verified and must not receive authority to select production providers, credentials, irreversible semantics, security-sensitive permissions, deployment authority, or governance bypasses.

## Decision
ATLANTIS adopts a bounded-work-packet release-train model.

1. Parent/meta issues coordinate goals, dependencies, and release readiness.
2. Independently verifiable outcomes become child issues/work packets with explicit acceptance criteria.
3. Tightly coupled implementation, tests, migrations, and documentation may remain in one work packet when they share a validation and rollback boundary.
4. Implementation-heavy work packets should be delegated to GitHub Copilot/coding agents when safe and useful.
5. Each delegated issue receives canonical ancestry, objective, dependencies, invariants, existing contracts/validators to reuse, prohibited shortcuts, tests, evidence requirements, and rollback constraints.
6. Prefer one coherent work packet → one focused branch → one focused PR. A focused PR may close a small tightly coupled issue set when those issues share one validation/rollback boundary.
7. Use PR size as a reviewability signal rather than a hard gate. Aim for roughly <=10 logical commits and <=25 changed files. Crossing roughly 20 logical commits or 50 changed files triggers decomposition review; a larger PR is acceptable when a documented rationale shows splitting would increase coupling, reduce test validity, or make rollback less safe.
8. `sprint/7-day-operational-alpha` is the integration branch. Verified focused PRs land there in dependency order.
9. PR #10 is the release/integration PR from the sprint branch toward `main`; it is not the default place to accumulate unrelated implementation work.
10. Oversized or divergent implementation PRs stop accumulating new unrelated work; they become reference evidence while fresh bounded work packets are implemented from current canonical HEAD.
11. Independent verification is required before integration or issue closure.
12. Closed verified child issues/work packets and integrated focused PRs—not raw commit count or release-PR closure—are the primary visible progress units.
13. Architecture gates block only dependent mutations; safe provider-neutral and independent work continues.

## Consequences
### Positive
- Faster visible progress through work-packet closure.
- Smaller review and rollback surfaces without forced micro-PR fragmentation.
- Lower stale-branch and accidental-regression risk.
- Better parallelism between coding agents and independent reviewers.
- Easier mapping between acceptance criteria, evidence, and delivered code.
- PR #10 can remain the stable release gate while implementation proceeds through focused integration PRs.

### Costs
- More issues and PRs must be coordinated than in a mega-PR model.
- Dependency ordering must be maintained explicitly.
- Later parallel branches may need refresh/rebase after earlier slices integrate.
- Some larger coherent changes require documented scope exceptions.

## Non-goals
This ADR does not authorize automatic merge, production deployment, provider selection, credential use, branch-protection changes, security-sensitive permission expansion, or bypass of review/governance requirements.

## Verification
Sprint automation and repository instructions must enforce this operating model in prompts, issue templates, progress reporting, and review behavior. Deviations should be documented in the affected issue/PR with an explicit rationale and bounded exception.
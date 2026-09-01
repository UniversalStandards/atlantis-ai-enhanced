# Main Branch Release-Control Gate

## Purpose

Define the minimum repository-level integration control required before the ATLANTIS Day-7 operational alpha may be integrated into `main`. This document is an acceptance contract and operator runbook; it does not grant deployment authority and does not select credentials, providers, or production infrastructure.

## Current verified condition

As of 2026-09-01, live GitHub inspection reports `main` with `protected: false`, branch protection disabled, required-status-check enforcement off, and no required checks. PR #10 is open, draft, mergeable, and its current sprint head has a successful `Contracts` workflow run. Successful CI therefore exists as evidence but is not enforced at the repository integration boundary.

## Required invariant

Before release integration, `main` MUST reject an integration attempt that does not satisfy all of the following:

1. The change reaches `main` through a pull request rather than an unreviewed direct push.
2. The repository requires the applicable ATLANTIS CI/check policy before merge.
3. A failing or pending required check prevents merge.
4. The control applies to the release integration path and cannot be bypassed by ordinary development workflow.
5. The sprint/development branch may remain writable only where that does not weaken the `main` integration boundary.

## Reversible implementation choices

Either GitHub branch protection or a repository ruleset may implement the invariant. This contract deliberately does not choose between them. The operator should prefer the smallest reversible configuration that enforces the invariant without granting new credentials, deployment permissions, or production authority.

## Check-name discovery

Do not guess a required check name. Inspect the successful workflow/check evidence for the exact PR head and bind the repository control to the check GitHub actually reports for that integration path. If the check identity is unstable or ambiguous, stop that specific settings mutation and correct the workflow/check identity first.

## Verification procedure

After the repository setting is changed, capture fresh live evidence showing:

1. `main` reports protection/ruleset enforcement enabled.
2. PR-based integration is required.
3. The intended required check is explicitly configured.
4. The current PR head has that check in a successful state.
5. A deterministic non-production verification demonstrates that a failing or pending required check blocks merge, or equivalent GitHub rule evaluation evidence proves the same invariant.
6. PR #10 remains unmerged until all other Day-7 release gates are satisfied.

## Failure handling

If the connector or operator lacks permission to mutate repository settings, record the exact failed capability/endpoint and continue independent safe workstreams. Do not weaken CI, bypass review, merge PR #10, broaden credentials, or disable the build cycle as a workaround.

If configuration causes unintended repository lockout or blocks the intended development path, revert the repository setting to its immediately prior state and preserve the captured evidence for review.

## Exit evidence

This gate is complete only when Issue #8 and PR #10 contain fresh evidence identifying the enforcement mechanism, configured required check(s), verification result, and timestamp/commit context. Green workflow history alone is not sufficient.

# Browser Release-Adapter Candidate Decision Record

## Status

**ENGINEERING SELECTION AUTHORIZED BY STANDING PROGRAM INTENT.** The first ATLANTIS browser-runtime implementation is selected for production-ready, disabled-by-default non-production execution. This does not authorize production browsing, production credentials, or unrestricted external egress.

`PRODUCTION_READINESS_AND_EXECUTION_AUTHORITY.md` controls the distinction between production-ready engineering and production deployment authority.

## Selected candidate

**Candidate A — pinned Playwright + Playwright-managed Chromium in an isolated GitHub Actions/Linux execution boundary**, as specified by `BROWSER_RELEASE_ADAPTER_RECOMMENDATION.md`.

Exact Playwright package version, Chromium runtime/build identity, source revision, fixture digest, and runner identity must be captured from the implementation/run evidence and kept pinned/reproducible through the repository's frozen dependency and SEC-20 gates.

## Standing engineering authority

Engineering may proceed without another human approval cycle to:

1. add the Playwright dependency and browser runtime after repository dependency/security admission;
2. implement the concrete ATLANTIS browser-content observer adapter;
3. create repository-controlled localhost hostile-content fixtures;
4. configure isolated CI/runtime execution with deny-by-default external navigation/egress;
5. execute real Chromium navigation and representation acquisition;
6. run timeout, redirect, crash/termination, substitution, secret-safety, teardown, and reproducibility scenarios;
7. publish exact-candidate evidence to the existing `browser-runtime` gate when all assertions pass.

The implementation must be production-ready even though the acceptance execution is non-production.

## Candidate identity

| Field | Selected value |
| --- | --- |
| Adapter implementation | ATLANTIS Playwright browser-content observer adapter |
| Source revision | Exact immutable sprint commit captured at execution |
| Browser engine | Playwright-managed Chromium; exact runtime revision captured at execution |
| Automation/session mechanism | Exact pinned Playwright package/runtime admitted by lockfile/SEC-20 |
| Execution topology | Dedicated isolated GitHub-hosted Linux CI job or equivalently isolated reproducible Linux runner |
| Navigation/network boundary | Repository-controlled loopback fixture; external destinations denied unless separately required and authorized |
| Session lifecycle | Fresh browser context per scenario; bounded timeout; deterministic close/teardown; crash detection |
| Representation acquisition | `text`, `html`, and accessibility representation from the same page/session |
| Fixture identities | Immutable repository fixture digest(s) + source commit |
| Release candidate | Exact Day-7 candidate identity from execution |
| Capability requirements | No production credential; no repository write authority required for observation |
| Disable/rollback | Disable candidate registration/job and remove browser execution path without changing canonical observer contracts |

## Existing-contract execution plan

1. Register the concrete adapter with `registerBrowserContentObserverConformance` unchanged.
2. Run the repository-controlled hostile fixture through a real Chromium session.
3. Capture requested URL, final URL, adapter revision, browser runtime identity, session identity, timestamps, fixture identity, and release-candidate identity.
4. Acquire text, HTML, and accessibility representations from the same fixture; all remain `untrusted-browser-content`.
5. Exercise redirect/final-URL substitution, representation substitution, adapter-revision substitution, and candidate substitution; every mismatch fails closed.
6. Exercise navigation timeout, browser crash/termination, representation-acquisition failure, and teardown; none may fabricate successful evidence.
7. Verify browser-originated content and metadata cannot create approval, authorization, policy, credential, deployment, repository-write, or tool authority.
8. Sanitize/inspect evidence for cookies, authorization headers, bearer tokens, credential values, and secret-bearing browser state before publication.
9. Re-run from recorded non-secret configuration and verify reproducibility.
10. Bind successful evidence to the canonical `browser-runtime` independent release gate only for the exact candidate.

## Required evidence manifest

The run must emit immutable identities for candidate/source revision, runtime/version, hostile fixture set, observer-conformance result, navigation/session trace, text/HTML/accessibility observations, redirect/substitution failures, timeout, crash/termination, representation failure, secret-safety result, reproducibility rerun, and exact-candidate `browser-runtime` gate evidence.

## Production readiness vs production deployment

A successful candidate may be described as **production-ready** when its engineering and evidence satisfy the applicable gates. That does not mean it is browsing production systems, using production credentials, or deployed to production.

## Rejection/correction conditions

Reject or correct any implementation that grants page/DOM/accessibility content authority, substitutes mocks for required real-browser evidence, silently normalizes identity mismatches, emits secrets, requires repository/deployment write authority merely to observe content, disables failure checks, or reuses evidence across candidates/configurations.

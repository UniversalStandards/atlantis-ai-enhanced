# Browser Release-Adapter Recommendation

## Status

Engineering recommendation for the ATLANTIS Day-7 non-production browser-runtime gate. **RECOMMENDATION ONLY — NO BROWSER CANDIDATE IS SELECTED OR AUTHORIZED FOR INSTALLATION OR EXECUTION BY THIS RECORD.**

This recommendation complements `BROWSER_RELEASE_ADAPTER_ACCEPTANCE.md` and `BROWSER_RELEASE_ADAPTER_CANDIDATE_RECORD.md`. It does not grant package-install authority, browser-download authority, network expansion, credentials, deployment authority, or production authority.

## Recommended first candidate

**Candidate A — Playwright 1.62.0 + Playwright-managed Chromium in an isolated GitHub Actions Ubuntu runner, executing a repository-controlled localhost hostile-content fixture with a deny-by-default external navigation policy.**

The candidate should run headlessly and serially for release evidence. The exact Chromium build must be the browser binary resolved by the pinned Playwright release and recorded from the candidate execution itself rather than inferred in advance.

## Why this is the preferred first proof

1. **Existing ATLANTIS fit.** The repository is already TypeScript/pnpm-based and validated in GitHub Actions, so this candidate adds the least conceptual glue around the existing `BrowserContentObserver` boundary.
2. **Real browser runtime.** Playwright's documented CI path runs actual browser binaries and supports installing browser plus Linux dependencies through the CLI.
3. **Version-coupled browser identity.** Playwright documents that each Playwright release is tied to specific supported browser binaries. The execution manifest can therefore bind package version, browser revision, source commit, fixture digest, and release-candidate identity.
4. **Reproducible CI topology.** GitHub-hosted Ubuntu runners already execute the ATLANTIS contract suite. A dedicated browser job can be isolated from the read-only contract job and configured with one worker for determinism.
5. **Small credential surface.** A repository-controlled localhost fixture requires no application credential, external account, or production service merely to prove hostile-content non-authority.
6. **Failure control.** Playwright supports explicit navigation/session timeouts and browser lifecycle control, which map directly to the existing acceptance requirements for timeout, crash/termination, representation failure, and teardown evidence.
7. **Representation coverage.** The adapter can derive visible text and HTML directly from the page and accessibility information through browser APIs without granting page content any governance authority.
8. **Reversibility.** The candidate can remain disabled by default and be removed by deleting the isolated job, adapter registration, package dependency, and browser-install step. It does not require changing canonical ATLANTIS contracts.

## Authoritative implementation evidence reviewed

- Playwright CI documentation currently shows `npx playwright install --with-deps` as the supported browser/dependency installation path and recommends one worker in CI for stability and reproducibility.
- The Playwright CI documentation currently provides a GitHub Actions example using `actions/checkout@v6` and `actions/setup-node@v6`.
- Playwright browser documentation states that each Playwright version requires specific browser binaries and that a specific browser such as Chromium can be installed explicitly.

Documentation is admission evidence only. It does not satisfy the ATLANTIS `browser-runtime` gate.

## Proposed exact non-production topology

| Field | Recommended value |
| --- | --- |
| Adapter implementation | ATLANTIS Playwright browser-content observer adapter |
| Source revision | Exact sprint commit selected at authorization time |
| Browser engine | Playwright-managed Chromium; exact runtime revision captured at execution |
| Automation/session mechanism | `@playwright/test` / Playwright 1.62.0 |
| Execution topology | Dedicated GitHub-hosted Ubuntu 24.04 Actions job |
| Navigation boundary | Repository-controlled HTTP server bound to loopback; browser requests fail closed for destinations outside the explicitly allowed fixture origin unless required by the harness |
| Workers | 1 |
| Session lifecycle | Fresh browser context per scenario; deterministic close in `finally`; explicit navigation/action timeout |
| Representation acquisition | visible text, serialized HTML, accessibility representation from the same page/session |
| Fixture identity | SHA-256 or equivalent immutable digest of repository-controlled fixture bytes plus source commit |
| Credential requirements | none for hostile-content fixture execution |
| Production access | none |
| Disable path | remove/disable candidate registration and isolated workflow/job; no canonical contract change |

## Required network rule

The hostile fixture should be served from `127.0.0.1` / localhost inside the isolated job. The browser adapter must treat attempts by hostile content to navigate or fetch outside the approved fixture origin as non-authoritative and fail closed according to the candidate's explicit network policy.

The candidate must not require access to GitHub write APIs, production URLs, user cookies, authorization headers, browser profiles, or external secrets to prove SEC-19.

## Required operational evidence

The candidate must execute the existing browser observer conformance unchanged and add genuine runtime evidence for:

1. real Chromium launch;
2. real navigation to the immutable hostile fixture;
3. requested URL and final URL capture;
4. text observation;
5. HTML observation;
6. accessibility observation;
7. prompt-injection-shaped content remaining inert data;
8. redirect/final-URL substitution rejection;
9. execution/release-candidate identity substitution rejection;
10. adapter/browser revision substitution rejection;
11. navigation timeout failure;
12. browser termination/crash failure;
13. representation-acquisition failure;
14. session teardown;
15. secret-safety inspection;
16. second clean rerun proving reproducibility;
17. exact-candidate `browser-runtime` evidence publication only after all prior checks pass.

## Evidence that must never be promoted

The following remain insufficient for release proof:

- DOM-shaped unit fixtures;
- process-local browser-content objects;
- mocked Playwright page/browser objects;
- screenshots without bound runtime/session identity;
- successful navigation without hostile-content authority tests;
- Playwright installation alone;
- green CI that does not actually launch the recorded Chromium candidate;
- browser observations from a different commit, browser revision, fixture digest, or release-candidate identity.

## Rejection conditions

Reject this candidate if execution requires persistent write permission to the repository, production credentials, uncontrolled internet egress, a shared user browser profile, weakening `BrowserContentObserver` validation, accepting page content as approval/policy/tool authority, or substituting mocked browser evidence for a real session.

## Alternative candidate

If GitHub-hosted runner/browser installation proves non-reproducible or cannot enforce the required network/lifecycle controls, the next candidate should be an immutable Playwright container image with the same ATLANTIS observer contract and evidence requirements. Moving to a remote browser service should occur only if local/container execution is demonstrably inadequate because that option introduces a larger external trust, credential, and network surface.

## Decision handoff

An authorized operator may now record exactly one browser outcome:

- `SELECT Candidate A — Playwright 1.62.0 + Playwright-managed Chromium on isolated GitHub Actions runner`, or
- `NO SELECTION — request additional browser evidence/candidate`.

Selection would authorize only disabled-by-default, non-production package/browser installation and execution of the existing browser acceptance/conformance gates. It would not authorize production deployment, browser access to production systems, repository write authority, credential use, or weakening any existing ATLANTIS control.
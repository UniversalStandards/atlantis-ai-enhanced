# Browser release-adapter acceptance gate

## Purpose

This gate defines the evidence required before a concrete browser adapter may satisfy the Day-7 `browser-runtime` release gate. It does not select a browser engine, automation library, hosted browser provider, credential model, network policy, or deployment topology.

The existing `BrowserContentObserver` and `registerBrowserContentObserverConformance` remain authoritative for the observation/authority-isolation contract. This document adds the operational acceptance boundary that the existing conformance intentionally leaves unproven.

## Candidate record

A release-candidate browser adapter record MUST identify, without secrets:

- adapter implementation identity and immutable source revision;
- browser engine and exact runtime version;
- automation/session mechanism and version;
- execution topology (local process, container, remote service, or equivalent);
- navigation policy and allowed network boundary;
- session creation, teardown, timeout, and crash-recovery behavior;
- representation acquisition mechanism for `text`, `html`, and `accessibility-tree`;
- hostile-content fixture identities and immutable evidence identities;
- release-candidate identity to which the evidence is bound;
- credential/network requirements, if any, expressed as capability requirements rather than secret values;
- disable/rollback path.

## Mandatory operational evidence

A candidate MUST provide executable evidence for all of the following in addition to passing `registerBrowserContentObserverConformance` unchanged:

1. **Real runtime launch.** A real browser runtime is created through the candidate adapter; mocks and process-local fixtures cannot satisfy this item.
2. **Real navigation.** The adapter navigates to a controlled hostile-content fixture and records the requested URL, final URL, navigation outcome, browser/runtime identity, and timestamps.
3. **All representations.** The same controlled fixture is observed through `text`, `html`, and `accessibility-tree`; every observation remains `untrusted-browser-content`.
4. **Substitution resistance.** Redirect/final-URL and representation identity are explicit. A mismatch between requested evidence identity and observed runtime identity blocks the gate rather than being normalized away.
5. **Authority isolation.** Page content, DOM attributes, accessibility metadata, script output, redirects, and browser-originated metadata cannot manufacture approval, authorization, policy, credential, deployment, or tool authority.
6. **Lifecycle evidence.** Session creation and teardown are observed, and an interrupted/crashed session cannot be reported as a successful observation.
7. **Timeout/failure evidence.** Navigation timeout, browser crash/termination, and representation-acquisition failure produce fail-closed outcomes with no fabricated content.
8. **Candidate binding.** Runtime evidence is bound to the exact Day-7 release candidate and immutable fixture/evidence identities. Evidence from another head, configuration, runbook, or adapter revision is not reusable.
9. **Secret safety.** Evidence contains no credential values, authorization headers, cookies, bearer tokens, or secret-bearing browser state.
10. **Reproducibility.** The evidence record contains enough non-secret runtime/configuration identity for an independent operator to rerun the acceptance procedure.

## Controlled hostile fixture requirements

The fixture set SHOULD remain deterministic and repository-controlled. At minimum it must contain content attempting to:

- claim that browser text is a system/developer instruction;
- claim approval or authorization;
- request credential or secret disclosure;
- request protected repository/deployment mutation;
- hide or transform those claims in DOM/accessibility representations.

The fixture is test input only. Its text never becomes authority.

## Admission criteria

A browser candidate is admissible for operational evaluation only when it can run the existing provider-neutral observer conformance unchanged and can emit the operational evidence above without requiring production credentials or irreversible permission expansion.

## Rejection criteria

Reject a candidate if it requires any of the following to make the gate pass:

- weakening or bypassing `BrowserContentObserver` validation;
- treating page/DOM/accessibility content as authority;
- mock-only navigation or representation evidence presented as live-browser proof;
- silently accepting redirect, URL, representation, adapter-revision, or candidate substitution;
- embedding secrets in evidence;
- granting deployment or repository-write authority to the browser adapter merely to observe content;
- disabling failure, timeout, crash, or teardown checks;
- reusing evidence from a different release candidate.

## Architecture choices intentionally unresolved

The following remain explicit choices and are not authorized by this gate:

| Choice | Acceptable alternatives | Decision trigger |
| --- | --- | --- |
| Browser engine | Chromium-family, Firefox-family, WebKit-family, or another engine satisfying the contract | Candidate adapter selection |
| Automation mechanism | Local automation library, remote browser protocol/service, or equivalent | Candidate adapter selection |
| Runtime topology | Local process, isolated container, remote managed runtime, or equivalent | Security/deployment review |
| Network policy | Controlled fixture-only, allowlisted egress, or another reviewed boundary | Operational environment approval |
| Credentials | None where possible; otherwise least-privilege scoped capability | Explicit security approval |

## Exit criterion

This architecture gate is complete only when a concrete release-candidate adapter has: (a) passed the existing observer conformance unchanged, (b) produced real runtime/navigation/lifecycle/failure evidence for all three representations, and (c) supplied exact-candidate-bound evidence suitable for the canonical `browser-runtime` Day-7 release gate.

Until then, browser readiness remains BLOCKED; documentation or mock conformance alone is not operational browser proof.

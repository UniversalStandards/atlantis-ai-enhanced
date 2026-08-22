# Browser release-adapter candidate decision record

## Status

Decision-preparation record for the ATLANTIS Day-7 operational alpha. **No browser engine, automation mechanism, hosted service, credential model, network policy, or deployment topology is selected or authorized by this record.**

This record operationalizes `BROWSER_RELEASE_ADAPTER_ACCEPTANCE.md` so an authorized non-production candidate can be evaluated without weakening or duplicating `BrowserContentObserver` / `registerBrowserContentObserverConformance`.

## Candidate identity — required before execution

The approving operator MUST complete every field below before candidate evidence may be admitted:

| Field | Required value |
| --- | --- |
| Adapter implementation | Exact implementation identity |
| Source revision | Immutable commit/digest |
| Browser engine | Exact engine and runtime version |
| Automation/session mechanism | Exact mechanism and version |
| Execution topology | Local process, isolated container, remote service, or reviewed equivalent |
| Navigation/network boundary | Explicit allowed destinations/egress policy |
| Session lifecycle | Creation, teardown, timeout, crash handling |
| Representation acquisition | `text`, `html`, `accessibility-tree` mechanisms |
| Fixture identities | Immutable hostile-fixture identities/digests |
| Release candidate | Exact Day-7 candidate identity |
| Capability requirements | Non-secret credential/network capabilities, or `none` |
| Disable/rollback | Exact reversible disable path |

An incomplete row keeps `browser-runtime` BLOCKED.

## Candidate alternatives and decision criteria

Candidate selection MUST be explicit. Evaluation should prefer the smallest non-production trusted surface that can execute the existing observer conformance unchanged and produce real runtime evidence.

| Candidate family | Evidence to establish before selection | Principal risk to prove away |
| --- | --- | --- |
| Local automation library + browser runtime | Reproducible pinned runtime, deterministic launch/navigation, representation extraction, crash/timeout control | Host/process coupling and runtime reproducibility |
| Isolated container + browser runtime | Immutable image/runtime identity, controlled network boundary, deterministic teardown | Container/runtime dependency and evidence provenance |
| Remote browser protocol/service | Exact service/runtime identity, session isolation, controlled egress, authoritative lifecycle evidence | External service trust, network/credential surface, runtime substitution |

No row is preferred or approved by this document.

## Existing-contract execution plan

For the selected candidate, execute rather than recreate the established contract:

1. Register the concrete adapter with `registerBrowserContentObserverConformance` unchanged.
2. Run the repository-controlled hostile fixture through a **real** browser session.
3. Capture the requested URL, final URL, adapter revision, engine/runtime identity, session identity, timestamps, fixture identity, and exact release-candidate identity.
4. Acquire `text`, `html`, and `accessibility-tree` representations from the same controlled fixture; each remains `untrusted-browser-content`.
5. Exercise redirect/final-URL substitution, representation substitution, adapter-revision substitution, and candidate substitution; each mismatch MUST fail closed.
6. Exercise navigation timeout, browser crash/termination, representation-acquisition failure, and teardown. None may fabricate successful content/evidence.
7. Verify browser-originated content and metadata cannot create approval, authorization, policy, credential, deployment, repository-write, or tool authority.
8. Sanitize and inspect evidence for cookies, authorization headers, bearer tokens, credential values, and secret-bearing browser state before publication.
9. Re-run from the recorded non-secret configuration and verify reproducibility.
10. Bind successful evidence to the canonical `browser-runtime` independent release gate for the exact candidate; do not reuse evidence across heads/configurations/runbooks/adapters.

## Required evidence manifest

The candidate run MUST emit immutable identities for at least:

- candidate record and source revision;
- runtime/version manifest;
- hostile fixture set;
- observer-conformance result;
- navigation/session lifecycle trace;
- `text` observation;
- `html` observation;
- `accessibility-tree` observation;
- redirect/substitution failure evidence;
- timeout failure evidence;
- crash/termination failure evidence;
- representation-acquisition failure evidence;
- secret-safety inspection result;
- reproducibility rerun result;
- final exact-candidate `browser-runtime` gate evidence.

Missing or substituted evidence keeps the gate BLOCKED.

## Admission / rejection

Admit a candidate for execution only when it requires no production credential, irreversible permission expansion, or weakening of existing observer validation. Reject any candidate that requires page/DOM/accessibility content to become authority, mock-only evidence to stand in for runtime evidence, silent identity normalization, secret-bearing evidence, repository/deployment write authority merely to observe content, disabled failure checks, or cross-candidate evidence reuse.

## Decision required

The unresolved major architecture choice is now explicit: **authorize one concrete non-production browser candidate (engine/runtime + automation/session mechanism + topology + network boundary) for operational evaluation.** Until that choice is made, implementation-specific installation/configuration is not authorized.

This gate does not stop independent sprint work. Durable persistence, external artifact durability, Issue #7 operational adapters, telemetry binding, governed execution preparation, and deployment/rollback/burn-in evidence remain independent workstreams.

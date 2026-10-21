# Telemetry SDK / Collector Binding Gate

## Status

Decision-preparation and conformance artifact for the ATLANTIS seven-day operational-alpha sprint. This document does **not** select an OpenTelemetry SDK, exporter package, collector distribution, transport, endpoint, credential model, network path, backend, or production deployment authority.

## Existing invariant

ATLANTIS already projects governed `ExecutionReleaseEvidence` into `ExecutionReleaseTelemetryRecord` and then into the provider-neutral `OpenTelemetryReleaseSpan` shape. Telemetry is downstream of authoritative correctness evidence. Export failure is observable but must never acknowledge, rewrite, substitute, invalidate, or become a prerequisite for authoritative release evidence.

The existing `OpenTelemetryReleaseSpanSink` is therefore the architecture boundary for the first real SDK/collector integration. Provider-specific code belongs behind that sink rather than inside release-evidence composition.

## Decision required

Authorize one concrete non-production telemetry path consisting of:

1. SDK/runtime and exact version;
2. span/export mechanism used to implement `OpenTelemetryReleaseSpanSink`;
3. collector or direct receiver mode;
4. transport and endpoint topology;
5. credential/authentication mechanism, if any;
6. network boundary;
7. test environment and teardown path.

Selection is architecture/operations gated because these fields affect dependencies, outbound network access, credentials, lifecycle, and deployment. No selection is implied by this document.

## Mandatory acceptance criteria

A candidate binding is admissible only if it proves all of the following without weakening existing tests or release semantics:

1. It implements the existing `OpenTelemetryReleaseSpanSink` boundary; canonical release evidence and telemetry projection remain provider-neutral.
2. `atlantis.execution.release` and every currently projected attribute reach the authorized receiver with exact values for a known governed execution.
3. Export is best-effort and non-authoritative. Receiver outage, timeout, rejection, malformed acknowledgement, shutdown race, or exporter exception cannot change the authoritative release artifact, readiness result, execution outcome, replay evidence, or budget evidence.
4. No retry path can replay or mutate an ATLANTIS protected action. Telemetry retries, when provided by the selected SDK/exporter, are confined to telemetry transport.
5. Telemetry does not gain repository-write, deployment, approval, persistence-writer, recovery-ownership, browser-control, or release-publication authority.
6. Secrets, authorization headers, tokens, endpoint credentials, and sensitive environment values never enter span attributes, release artifacts, test fixtures, traces committed to the repository, or sprint comments.
7. Endpoint/transport configuration is externalized. A disabled/no-op configuration remains available so telemetry availability cannot become a startup or correctness dependency.
8. Startup, flush, shutdown, timeout, backpressure, and receiver-unavailable behavior are exercised deterministically in non-production.
9. Candidate identity is recorded with SDK/exporter/collector versions, topology, endpoint class (not secret endpoint material), configuration digest, test execution identity, and release-candidate identity.
10. The existing OpenTelemetry exporter regressions continue unchanged and pass alongside the concrete integration evidence.
11. Dependency additions, if required, pass frozen-lockfile, SEC-20 source/integrity, inventory, and vulnerability gates before admission.
12. The integration has a reversible disable/rollback path that does not require rewriting authoritative release evidence.

## Failure-injection matrix

The non-production evaluation must capture evidence for at least:

| Scenario | Required result |
| --- | --- |
| Receiver healthy | Exact projected span is observed at the authorized receiver. |
| Receiver unavailable before export | Export reports failure or remains best-effort; governed evidence remains unchanged. |
| Receiver timeout | Bounded telemetry failure; no execution/release correctness transition. |
| Receiver rejects payload | Rejection is contained to telemetry; no authoritative retry/mutation occurs. |
| Exporter throws synchronously/asynchronously | Existing containment semantics remain intact. |
| Shutdown/flush race | Process can terminate according to the selected bounded policy without promoting telemetry to authority. |
| Duplicate telemetry delivery | Receiver-side duplication cannot be interpreted as duplicate ATLANTIS execution or release authority. |
| Configuration/endpoint substitution | Evidence identity detects the substituted candidate/configuration; evidence is not attributed to another release candidate. |

## Evidence record

Before `telemetry-binding` may be marked PASS, record:

- exact SDK/runtime/exporter/collector names and versions;
- adapter source identity and configuration digest;
- non-secret topology and transport;
- release-candidate identity;
- governed execution ID used for verification;
- receiver observation proving exact span name and attributes;
- failure-injection results for the matrix above;
- secret-safety inspection result;
- dependency/security gate results;
- disable/rollback verification;
- CI/run identifiers and immutable evidence locations.

## Rejection conditions

Reject a candidate if it makes telemetry authoritative, blocks release correctness on collector availability, requires protected-action authority, leaks credentials into evidence, silently changes canonical evidence schemas, cannot bound shutdown/backpressure behavior, requires weakening existing containment tests, or cannot be disabled without changing authoritative state.

## Exit criterion

This gate is resolved only when one concrete non-production SDK/collector path is explicitly authorized, implemented behind `OpenTelemetryReleaseSpanSink`, and produces the required execution and failure evidence. Documentation, mocks, or the existing OpenTelemetry-shaped projection alone are not operational telemetry proof.

## Parallel work while unresolved

Durable persistence selection, browser runtime authorization, external release-artifact durability, Issue #7 isolated-development adapters, governed Day-7 execution preparation, and deployment/rollback/burn-in work remain independent. This telemetry gate must not stop the build cycle.

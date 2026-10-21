# Telemetry SDK / Collector Candidate Record

## Status

**ENGINEERING SELECTION AUTHORIZED BY STANDING PROGRAM INTENT.** The first telemetry binding may now be implemented as a production-ready, disabled-by-default non-production candidate. Production telemetry endpoints, production credentials, and external observability-account authority remain separate deployment/identity concerns.

`PRODUCTION_READINESS_AND_EXECUTION_AUTHORITY.md` controls the distinction between production-ready engineering and production deployment authority.

## Selected candidate

Use the exact evidence-backed local OpenTelemetry candidate specified by `TELEMETRY_SDK_COLLECTOR_RECOMMENDATION.md`: ATLANTIS `OpenTelemetryReleaseSpanSink` → manual OpenTelemetry JS tracing → OTLP/HTTP protobuf → isolated localhost OpenTelemetry Collector/receiver path.

Exact package, Collector, source revision, configuration digest, and runtime identities must be pinned/captured from implementation evidence and admitted through frozen-lockfile and SEC-20 gates.

## Candidate identity

| Field | Selected value |
| --- | --- |
| Candidate ID | `otel-local-day7-v1` |
| SDK/runtime and version | Exact pinned OpenTelemetry JS trace SDK version from recommendation/lockfile evidence |
| Exporter/span mechanism and version | Exact pinned OTLP/HTTP protobuf trace exporter from recommendation/lockfile evidence |
| Collector/receiver and version | Exact pinned OpenTelemetry Collector version/image from recommendation/execution evidence |
| Transport | OTLP over HTTP/protobuf on isolated loopback/local test network |
| Endpoint class | Localhost/isolated non-production Collector endpoint |
| Authentication class | None required for first isolated local conformance candidate |
| Execution topology | ATLANTIS test/runtime process + isolated local Collector/receiver |
| Network boundary | Loopback or isolated local container network; no production/external backend required |
| Adapter source revision | Exact immutable sprint commit captured at execution |
| Configuration digest | Secret-free immutable digest captured at execution |
| Release-candidate identity | Exact candidate identity captured at execution |
| Test environment identity | Exact CI/container/runtime identity captured at execution |
| Teardown/disable mechanism | Disable span-sink registration/exporter and terminate isolated Collector; authoritative ATLANTIS state remains unchanged |

## Standing engineering authority

Engineering may proceed without another human approval cycle to add the admitted dependencies, implement the binding, run the local Collector, execute failure injection, and produce candidate-bound evidence. No external telemetry account or credential is needed for this first proof.

The implementation must be production-ready even though the proof environment is non-production.

## Required implementation mapping

The candidate remains behind `OpenTelemetryReleaseSpanSink`. It must preserve existing span shape/attributes, keep telemetry best-effort and non-authoritative, externalize endpoint/authentication configuration, support disabled/no-op operation, bound lifecycle/backpressure behavior, confine telemetry retry to telemetry transport, and record candidate/configuration identity.

Automatic instrumentation is not required for this first candidate. Prefer the smaller manual tracing surface unless executable evidence establishes a reason to expand it.

## Failure-injection plan

Execute the existing binding-gate scenarios against the real isolated receiver path:

- healthy receiver;
- unavailable receiver;
- timeout;
- payload rejection;
- exporter exception;
- shutdown/flush race;
- duplicate delivery;
- configuration/endpoint substitution.

Every scenario must prove authoritative release, readiness, and execution evidence remains unchanged by telemetry failure.

## Security and authority constraints

Telemetry receives no repository-write, deployment, approval, persistence-writer, recovery-ownership, browser-control, or release-publication authority. Sensitive authentication/endpoint material must never enter spans, committed fixtures, release artifacts, or sprint comments.

If a later candidate requires outbound external network access or credentials unavailable to the engineering runtime, that specific boundary may require human intervention. It does not block this localhost candidate.

## Acceptance evidence

Before `telemetry-binding` can PASS, attach immutable evidence for exact candidate/version/configuration identity, governed execution/release-candidate identity, receiver observation of projected spans, all failure scenarios, secret-safety inspection, dependency/security results, disabled/no-op behavior, teardown/rollback verification, and CI/run identities.

## Production readiness vs production deployment

Passing this gate may establish a production-ready telemetry binding. It does not mean ATLANTIS is connected to a production telemetry backend or that production telemetry credentials have been authorized.

## Rejection/correction conditions

Reject or correct a candidate if it makes telemetry authoritative, blocks release correctness on receiver availability, can replay protected actions, leaks credentials, changes canonical evidence semantics, cannot bound lifecycle behavior, requires weakening existing tests, or cannot be disabled without changing authoritative state.

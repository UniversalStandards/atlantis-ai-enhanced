# Telemetry SDK / Collector Candidate Evidence Matrix

## Status

Decision support for the ATLANTIS seven-day operational-alpha sprint. **NO CANDIDATE SELECTED. NO IMPLEMENTATION AUTHORIZED.**

This record narrows the pending telemetry architecture decision while preserving `TELEMETRY_SDK_COLLECTOR_CANDIDATE_RECORD.md` as the approval boundary. It does not authorize dependencies, credentials, outbound network access, deployment authority, or production telemetry.

## Existing invariant

The selected candidate must remain behind the existing `OpenTelemetryReleaseSpanSink`. Telemetry is best-effort and non-authoritative: receiver/exporter failure may produce telemetry failure evidence, but may not mutate canonical execution, readiness, approval, release-publication, recovery-ownership, or persistence state.

The existing `TELEMETRY_SDK_COLLECTOR_BINDING_GATE.md` remains the executable acceptance boundary and must run unchanged against the concrete candidate.

## Candidate A — OpenTelemetry JS OTLP/HTTP exporter to a local isolated OpenTelemetry Collector

Authoritative references:

- OpenTelemetry JavaScript exporter guidance: https://opentelemetry.io/docs/languages/js/exporters/
- OpenTelemetry Collector configuration: https://opentelemetry.io/docs/collector/configuration/
- OTLP exporter specification: https://opentelemetry.io/docs/specs/otel/protocol/exporter/

Evidence-supported posture:

- OTLP/HTTP provides an explicit SDK-to-receiver transport boundary without selecting a hosted telemetry backend.
- A local isolated Collector can provide a genuine receiver process while keeping evaluation non-production and reversible.
- Endpoint, headers/authentication, batching, timeout, retry, and shutdown behavior remain configuration-sensitive and must be pinned in the candidate record.
- Collector receipt is observational evidence only; it cannot become release authority.

Open evidence before selection: exact Node/OpenTelemetry package versions, OTLP/HTTP exporter package/version, Collector image/binary digest and version, receiver endpoint class, processor/exporter pipeline, retry/batch settings, deterministic receiver-failure mechanism, lifecycle/flush bounds, network namespace/boundary, dependency delta, teardown path, and evidence capture mechanism.

## Candidate B — OpenTelemetry JS OTLP/gRPC exporter to a local isolated OpenTelemetry Collector

Authoritative references:

- OpenTelemetry JavaScript exporter guidance: https://opentelemetry.io/docs/languages/js/exporters/
- OpenTelemetry Collector configuration: https://opentelemetry.io/docs/collector/configuration/
- OTLP exporter specification: https://opentelemetry.io/docs/specs/otel/protocol/exporter/

Evidence-supported posture:

- OTLP/gRPC provides a standard SDK-to-Collector boundary and can be exercised against an isolated local receiver.
- Transport/library lifecycle, channel behavior, retry, timeout, and shutdown semantics differ from HTTP and therefore constitute a distinct candidate configuration.
- No hosted service or production endpoint is implied by this candidate family.

Open evidence before selection: exact SDK/exporter/Collector versions and digests, gRPC transport dependency/security impact, endpoint class, retry/backpressure policy, deterministic unavailable/timeout/rejection injection, flush/shutdown bounds, network boundary, teardown path, and evidence capture mechanism.

## Candidate C — OpenTelemetry JS OTLP exporter to an approved non-production remote Collector

Authoritative references:

- OpenTelemetry JavaScript exporter guidance: https://opentelemetry.io/docs/languages/js/exporters/
- OpenTelemetry Collector configuration: https://opentelemetry.io/docs/collector/configuration/
- OTLP exporter specification: https://opentelemetry.io/docs/specs/otel/protocol/exporter/

Evidence-supported posture:

- A remote Collector can prove a genuine network receiver boundary closer to deployment conditions.
- It necessarily introduces endpoint, egress, authentication, trust, and operations questions that local candidates can avoid.
- No remote endpoint, credential, hosted provider, or network permission is selected by this matrix.

Open evidence before selection: exact remote Collector identity/version/configuration digest, transport, endpoint and authentication classes, egress policy, credential handling, receiver isolation, retention policy, failure-injection authority, teardown/disable path, and approval for required network/credential scope.

## Comparative decision matrix

| Criterion | A: OTLP/HTTP + local Collector | B: OTLP/gRPC + local Collector | C: OTLP + remote Collector |
| --- | --- | --- | --- |
| Genuine receiver process | Yes | Yes | Yes |
| Hosted telemetry provider required | No | No | Not necessarily, but remote operations required |
| New network/credential approval inherently required | No, if loopback/isolated local only | No, if loopback/isolated local only | Usually yes |
| Reversible non-production topology | Plausible | Plausible | Depends on approved environment |
| Transport-specific dependency delta | HTTP exporter stack | gRPC exporter stack | Depends on selected transport |
| Can exercise unavailable/timeout/rejection | Yes | Yes | Yes, subject to failure-injection authority |
| Ready to implement without approval | **No** | **No** | **No** |

## Deterministic selection acceptance criteria

A candidate may be selected only when the canonical candidate record answers every item below with non-secret, reviewable evidence:

1. Exact SDK/runtime, exporter, Collector/receiver versions and immutable source/image identities.
2. Exact transport and endpoint class, with authentication class explicitly `none` or identified without credential values.
3. Exact execution topology and network boundary.
4. Bounded batching, retry, timeout, backpressure, flush, and shutdown behavior.
5. Deterministic mechanisms for healthy receipt, unavailable receiver, timeout, payload rejection, exporter exception, shutdown/flush race, duplicate delivery, and configuration/endpoint substitution.
6. Proof that every failure remains telemetry-only and cannot alter authoritative release/execution state.
7. Secret-safety inspection and evidence-capture plan.
8. Dependency/lockfile/SEC-20 impact and reproducible installation plan.
9. Disabled/no-op mode and reversible teardown that leaves authoritative state unchanged.
10. Exact release-candidate/configuration binding plus matching architecture and operations approvals; security/network/credential approval when the candidate requires it.

A missing or ambiguous answer is a **no-select** result. Adapter code must not invent the answer.

## Explicit disqualifiers

Reject a candidate for Day-7 when it:

- makes telemetry receiver availability authoritative to release correctness;
- requires production credentials, production endpoints, protected deployment authority, or irreversible infrastructure merely to run conformance;
- can replay or trigger protected actions from telemetry delivery;
- cannot bound retry/backpressure/flush/shutdown behavior;
- cannot deterministically exercise the existing failure scenarios;
- places secrets or credential-bearing headers/configuration in committed evidence;
- requires weakening `OpenTelemetryReleaseSpanSink`, the binding gate, or canonical evidence semantics;
- cannot be disabled and torn down without mutating authoritative state.

## Decision handoff

Architecture/operations should record exactly one outcome: `SELECT Candidate A`, `SELECT Candidate B`, `SELECT Candidate C`, or `NO SELECTION — request additional evidence/candidate`, then fully populate `TELEMETRY_SDK_COLLECTOR_CANDIDATE_RECORD.md` for that exact configuration revision.

Selection authorizes only disabled-by-default non-production implementation and execution of the existing telemetry binding gate. It does not authorize production telemetry, production credentials, external egress, or deployment.

## Current conclusion

Candidates A and B provide bounded local receiver topologies that can plausibly prove real SDK/Collector behavior without selecting a hosted provider. Candidate C can prove a stronger external network boundary but introduces additional security/operations approvals. This matrix intentionally does not rank or select among them.

Until explicit selection is recorded, continue durable-persistence, external-artifact, browser, self-improvement, governed-run, deployment/rollback, and burn-in workstreams independently.
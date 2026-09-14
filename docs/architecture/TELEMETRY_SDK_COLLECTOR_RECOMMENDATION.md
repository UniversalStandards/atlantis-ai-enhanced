# Telemetry SDK / Collector Recommendation

## Status

**RECOMMENDATION ONLY — NO TELEMETRY CANDIDATE SELECTED OR AUTHORIZED FOR INSTALLATION, NETWORK ACCESS, OR EXECUTION.**

This document narrows `TELEMETRY_SDK_COLLECTOR_CANDIDATE_RECORD.md` to one bounded non-production candidate while preserving the existing rule that telemetry is best-effort and non-authoritative. It grants no dependency-install authority, outbound network permission, collector deployment authority, credentials, or production telemetry authority.

## Recommended first candidate

**Candidate A — manual OpenTelemetry JavaScript tracing using `@opentelemetry/sdk-trace` 2.10.0 + OTLP/HTTP protobuf trace exporter `@opentelemetry/exporter-trace-otlp-proto` 0.221.0 to an isolated OpenTelemetry Collector 0.159.0 bound to localhost in a non-production GitHub Actions job, with the Collector `debug` exporter as the terminal receiver.**

The existing ATLANTIS `OpenTelemetryReleaseSpanSink` remains the authoritative application-side boundary for projecting release telemetry. The concrete SDK/collector binding must sit behind that port and must never become a source of release truth.

## Why this is the preferred first proof

1. **Minimal semantic expansion.** `@opentelemetry/sdk-trace` is a manual tracing SDK, so ATLANTIS can emit only the already-defined release spans instead of adding broad automatic instrumentation or implicitly changing application behavior.
2. **Vendor-neutral transport.** OTLP is the OpenTelemetry-native protocol and is stable for traces. The Collector is explicitly vendor-neutral.
3. **Small network boundary.** A localhost-only collector on the isolated CI runner proves a real SDK-to-receiver path without credentials, external SaaS accounts, production endpoints, or internet egress for telemetry delivery.
4. **Failure isolation.** Collector termination, receiver rejection, timeout, and exporter failure can be injected without affecting authoritative ATLANTIS execution/release state.
5. **Deterministic evidence.** Exact SDK/exporter/collector versions, source commit, configuration digest, projected span identity, and receiver observation can be bound into the release evidence manifest.
6. **Reversible topology.** The isolated job, packages, and collector process/container can remain disabled by default and can be removed without changing canonical ATLANTIS contracts or authoritative state.
7. **Avoids unnecessary auto-instrumentation.** `@opentelemetry/sdk-node` is broader and currently published as an experimental convenience package. The first ATLANTIS proof does not need automatic HTTP/database/framework instrumentation.

## Current version evidence

At preparation time:

- `@opentelemetry/sdk-trace` current npm release: `2.10.0`;
- `@opentelemetry/exporter-trace-otlp-proto` current npm release: `0.221.0`;
- OpenTelemetry Collector current released line before the 2026-08-31 scheduled release: `0.159.0`;
- OTLP specification: stable for traces/metrics/logs;
- OTLP/HTTP default collector endpoint convention: port `4318`, traces path `/v1/traces`.

The exporter package is currently marked experimental by its npm package documentation even though OTLP itself is stable. That is a candidate risk to admit explicitly, not something to hide. Exact package versions still require frozen-lockfile + SEC-20 admission before any implementation.

## Proposed exact non-production topology

| Field | Recommended value |
| --- | --- |
| Candidate ID | `otel-js-local-collector-nonprod-v1` |
| SDK/runtime | `@opentelemetry/api` + `@opentelemetry/sdk-trace` 2.10.0 on Node.js 22 |
| Exporter | `@opentelemetry/exporter-trace-otlp-proto` 0.221.0 |
| Collector | OpenTelemetry Collector 0.159.0 |
| Receiver | OTLP HTTP receiver, loopback only |
| Terminal exporter | Collector `debug` exporter for evidence inspection; no external observability backend |
| Transport | OTLP/HTTP protobuf |
| Endpoint class | `http://127.0.0.1:4318/v1/traces` inside isolated job |
| Authentication class | none for localhost-only first proof |
| Execution topology | dedicated non-production GitHub-hosted Ubuntu 24.04 job or equivalent isolated runner |
| Network boundary | telemetry delivery limited to loopback; no production/external telemetry endpoint |
| Adapter | existing `OpenTelemetryReleaseSpanSink` projected into manual SDK spans |
| Sampling | AlwaysOn for the bounded conformance scenarios so expected release spans cannot disappear due to sampling |
| Processor | explicitly bounded processor configuration; prefer deterministic/simple processing for conformance, then separately test bounded batching if adopted |
| Feature gate | explicit telemetry SDK/collector binding flag |
| Feature-gate default | disabled |
| Teardown | force flush/shutdown within bounded timeout; terminate collector; remove temporary config/artifacts after evidence retention |

## Authority rule

Telemetry is observational only.

The following must remain true even when every telemetry component fails:

- execution authorization is unchanged;
- approval state is unchanged;
- durable execution state is unchanged;
- recovery ownership/fencing is unchanged;
- immutable release evidence is unchanged;
- readiness/release disposition is unchanged;
- protected actions are neither retried nor replayed because of telemetry transport behavior.

A telemetry success acknowledgement is never evidence that a governed execution or release action succeeded. A telemetry failure is never evidence that an authoritative action failed.

## Proposed span mapping

The candidate should consume only the canonical span projection already produced by `OpenTelemetryReleaseSpanSink`.

At minimum the binding must preserve:

- canonical span name;
- trace/span identity rules already defined by ATLANTIS;
- execution identity;
- release-candidate identity;
- evidence/artifact identity where already admitted;
- timestamps/durations already projected;
- status and attributes already admitted by the existing span boundary.

Provider/collector metadata may be added only in a namespaced observational form and may not overwrite canonical ATLANTIS attributes.

## Export/lifecycle behavior

1. The application-side sink creates/project spans through the manual tracing provider.
2. The exporter sends OTLP/HTTP protobuf only to the admitted loopback collector endpoint.
3. Export retry/backoff remains confined to telemetry transport.
4. Export queues must be bounded.
5. Export timeout must be bounded.
6. `forceFlush()`/shutdown must be bounded and must not block the authoritative release path indefinitely.
7. On exporter/collector failure, the telemetry result is recorded as observational failure while the authoritative result remains unchanged.
8. Teardown closes exporter/provider/collector resources deterministically.

## Proposed failure-injection plan

The candidate must prove at least:

1. **Healthy receiver:** exact projected span reaches the collector and is observed with the expected candidate/configuration identity.
2. **Collector unavailable before export:** authoritative release result remains unchanged; telemetry reports bounded failure.
3. **Collector terminated during export:** no protected action is retried; authoritative evidence is unchanged.
4. **Receiver timeout:** exporter/lifecycle timeout is bounded and non-authoritative.
5. **Payload rejection:** rejection cannot alter canonical release/readiness state.
6. **Exporter exception:** application catches/isolates it at the telemetry boundary.
7. **Flush/shutdown race:** bounded shutdown does not corrupt or mutate release state.
8. **Duplicate delivery:** duplicate telemetry observation cannot be interpreted as duplicate authoritative execution.
9. **Endpoint/configuration substitution:** candidate/configuration mismatch fails telemetry evidence admission; it does not alter release truth.
10. **Secret-safety:** no credentials, environment secrets, repository tokens, connection strings, or protected payload fields appear in received telemetry/evidence.
11. **Disabled mode:** with the candidate feature gate disabled, authoritative behavior is identical and no collector connection occurs.
12. **Clean rerun:** second fresh collector/runtime execution reproduces the candidate-bound span evidence.

## Retry and duplicate-delivery rule

OTLP/exporter retries are allowed only for telemetry delivery. Because OTLP can produce duplicate telemetry under retry/acknowledgement ambiguity, ATLANTIS must treat receiver observations as observational records rather than exactly-once authoritative facts.

No exporter retry may invoke or replay an ATLANTIS protected action, event append, approval, repository operation, browser operation, or release publication.

## Dependency admission proposal

If Candidate A is selected, every new package must enter through the normal frozen package-manager flow and pass SEC-20 before use.

Proposed dependency posture:

- prefer the manual `@opentelemetry/sdk-trace` package rather than `@opentelemetry/sdk-node` to avoid unnecessary automatic instrumentation and environmental behavior;
- use only the trace-specific OTLP protobuf exporter required by this gate;
- do not add metrics/logs exporters merely because they exist;
- do not add instrumentation plugins for HTTP, database, filesystem, or frameworks during this candidate proof;
- record that the OTLP exporter npm package is marked experimental and make that status part of the approval review;
- collector binary/container identity and checksum must be evidence-bound at execution.

## Collector configuration proposal

The first proof should use a repository-controlled, non-secret configuration equivalent in semantics to:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318

exporters:
  debug:
    verbosity: detailed

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
```

The exact admitted configuration must be canonicalized/digested and tied to the candidate record. It must not expose the receiver publicly.

## Security proposal

The first candidate requires:

- no external telemetry credentials;
- no production endpoint;
- no repository write permission;
- no browser control;
- no deployment authority;
- no persistence-writer authority;
- no recovery-ownership authority;
- no approval authority;
- no release-publication authority.

The collector process/container should run with the minimum privileges needed to listen on loopback and emit debug output/evidence. Any later external backend, authentication, TLS trust, public endpoint, or cross-network collector is a new explicit decision and is not inherited from this localhost proof.

## Acceptance mapping

A selected candidate must execute the existing telemetry binding gate unchanged and produce immutable evidence for:

- exact candidate ID;
- SDK/exporter/collector versions;
- source revision;
- configuration digest;
- release-candidate/execution identity;
- healthy receiver observation;
- all failure-injection scenarios;
- non-authoritative behavior proof;
- disabled/no-op behavior;
- secret-safety inspection;
- dependency/SEC-20 results;
- teardown/rollback verification;
- CI/run identity.

## Proposed candidate-record values

If architecture/operations select this candidate, `TELEMETRY_SDK_COLLECTOR_CANDIDATE_RECORD.md` can be populated, subject to reviewer amendment, with:

- Candidate ID: `otel-js-local-collector-nonprod-v1`
- SDK/runtime and version: `@opentelemetry/api + @opentelemetry/sdk-trace 2.10.0; Node.js 22`
- Exporter/span mechanism and version: `existing OpenTelemetryReleaseSpanSink -> manual SDK span -> @opentelemetry/exporter-trace-otlp-proto 0.221.0`
- Collector/receiver and version: `OpenTelemetry Collector 0.159.0; OTLP HTTP receiver + debug exporter`
- Transport: `OTLP/HTTP protobuf`
- Endpoint class: `loopback-only /v1/traces receiver on isolated non-production runner`
- Authentication class: `none for localhost-only conformance candidate`
- Execution topology: `isolated GitHub-hosted Ubuntu 24.04 job or equivalent dedicated non-production runner`
- Network boundary: `loopback-only telemetry transport; no external backend`
- Adapter source revision: `PENDING exact selected sprint commit`
- Configuration digest: `PENDING generated from exact admitted collector/exporter config`
- Release-candidate identity: `PENDING exact governed run`
- Test environment identity: `PENDING exact runner/job identity`
- Teardown/disable mechanism: `disable feature registration; bounded provider shutdown; terminate collector; remove isolated candidate resources`

Architecture, operations, and any required security/network approval fields remain PENDING until explicit selection.

## Authoritative references

- OpenTelemetry JavaScript exporters: https://opentelemetry.io/docs/languages/js/exporters/
- OTLP exporter specification: https://opentelemetry.io/docs/specs/otel/protocol/exporter/
- OTLP protocol specification: https://opentelemetry.io/docs/specs/otlp/
- OpenTelemetry Collector: https://opentelemetry.io/docs/collector/
- `@opentelemetry/sdk-trace`: https://www.npmjs.com/package/@opentelemetry/sdk-trace
- `@opentelemetry/exporter-trace-otlp-proto`: https://www.npmjs.com/package/@opentelemetry/exporter-trace-otlp-proto
- Collector releases: https://github.com/open-telemetry/opentelemetry-collector-releases/releases

## Decision handoff

An authorized reviewer may record exactly one telemetry outcome:

- `SELECT Candidate A — manual OTel JS + OTLP/HTTP protobuf + localhost Collector`, or
- `NO SELECTION — request additional telemetry evidence/candidate`.

Selection would authorize only disabled-by-default, non-production dependency/collector installation and execution of the telemetry binding/conformance gate. It would not authorize an external telemetry backend, production networking, production deployment, credentials, automatic instrumentation expansion, or any change to authoritative ATLANTIS semantics.
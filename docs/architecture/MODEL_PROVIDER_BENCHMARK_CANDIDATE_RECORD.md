# Model-provider benchmark candidate record

## Status

**UNSELECTED / BLOCKED FOR REAL-PROVIDER EXECUTION**

This record closes the admission ambiguity for Issue #6 without selecting a production provider, credential, endpoint, billing authority, network permission, model, deployment topology, or promotion policy.

## Purpose

Issue #6 requires a benchmark report comparing the existing deterministic/mock path with one real model provider. The comparison must be evidence-bearing and reproducible, but choosing a concrete provider or granting external-service authority is an architecture/operations decision. This record is the bounded handoff between the already implemented evaluation contracts and that decision.

## Invariants that do not depend on provider choice

1. The mock and real-provider legs consume the same versioned benchmark cases, scoring contract, acceptance thresholds, and result schema.
2. Provider identity, model identity/version, request parameters, evaluator identity/version, timestamps, latency, token/usage data when exposed, normalized cost inputs, errors, retries, and final score evidence are recorded without secrets.
3. The real-provider leg is non-production and disabled by default. Missing authorization fails closed before any external request.
4. Credentials are injected by the execution environment and are never committed, logged, copied into evidence, or inferred by the benchmark runner.
5. Benchmark execution grants no model/prompt/workflow promotion authority. Results are evidence for a later human-governed decision only.
6. The runner must distinguish provider rejection, timeout, transport failure, malformed response, evaluator failure, and budget exhaustion; failures may not be silently converted into successful scores.
7. Retry behavior is bounded and recorded. A retry may not erase the first-attempt outcome.
8. The benchmark has explicit request-count and spend ceilings and aborts before exceeding either ceiling.
9. Raw provider responses used as evidence are treated as untrusted data and may not create tool, repository, deployment, credential, or policy authority.
10. The mock baseline remains deterministic; the real-provider result may not overwrite or mutate its fixtures.

## Candidate fields required before execution

| Field | Current value |
| --- | --- |
| Candidate provider | PENDING |
| Candidate model + immutable/versioned identity where available | PENDING |
| SDK/API transport and version | PENDING |
| Non-production endpoint/region | PENDING |
| Credential injection mechanism | PENDING |
| Required outbound network scope | PENDING |
| Request-count ceiling | PENDING |
| Spend ceiling | PENDING |
| Timeout/retry policy | PENDING |
| Data-retention / provider-training posture | PENDING |
| Teardown / credential-revocation procedure | PENDING |
| Architecture approval | PENDING |
| Operations approval | PENDING |
| Security/network approval when required | PENDING |
| Real-provider execution authorized | NO |

## Deterministic admission criteria

Real-provider execution is admitted only when every candidate field above is concrete, internally consistent, non-secret where recorded, and the required approvals refer to the same candidate configuration. Any mismatch keeps execution blocked.

The benchmark may reuse the repository's existing evaluation scorecards, bounded refinement behavior, budget controls, evidence identity rules, and release-evidence machinery. It must not introduce a second scoring vocabulary or a parallel authorization system merely for the real-provider leg.

## Required evidence from the first admitted run

The first run must preserve one immutable comparison bundle containing: benchmark fixture/version identity; mock-leg results; real-provider candidate identity; authorization/approval references; request and response evidence with secrets removed; normalized scorecard results; latency/usage/cost evidence; retry/error evidence; budget-ceiling result; evaluator identity; and a final comparison report that explicitly states whether Issue #6 acceptance is met.

A green unit test, mocked transport, candidate record, or successful authorization check is not real-provider benchmark evidence.

## Decision required

Record exactly one outcome before external execution:

- **SELECT a concrete non-production provider/model candidate** and populate every required field with matching approvals; or
- **NO SELECTION — request additional evidence/candidate**.

Until then, safe work may continue on provider-neutral benchmark fixtures, deterministic score normalization, failure injection, evidence serialization, and disabled-by-default integration scaffolding.
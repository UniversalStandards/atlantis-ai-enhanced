# Model-provider benchmark decision matrix

## Status

**PREPARATORY / NO PROVIDER SELECTED / NO EXTERNAL EXECUTION AUTHORIZED**

This matrix advances Issue #6 without selecting a production provider, credential, endpoint, billing authority, network permission, model, or promotion policy. It is subordinate to `MODEL_PROVIDER_BENCHMARK_CANDIDATE_RECORD.md` and reuses that record's admission invariants and evidence contract.

## Decision to be made

Record exactly one bounded Day-7 outcome before any real-provider benchmark request:

1. **SELECT Candidate A — OpenAI-compatible non-production API/model configuration**;
2. **SELECT Candidate B — Anthropic-compatible non-production API/model configuration**;
3. **SELECT Candidate C — Google Gemini-compatible non-production API/model configuration**; or
4. **NO SELECTION — request additional evidence/candidate**.

A candidate family name is not authorization. Selection is valid only after the exact provider, model/version identity where available, transport/version, endpoint/region, credential injection mechanism, outbound-network scope, request/spend ceilings, timeout/retry policy, retention/training posture, teardown procedure, and required approvals are populated in the canonical candidate record.

## Provider-neutral acceptance invariants

Every selectable candidate must satisfy the same invariants. No candidate receives a weaker benchmark contract because of provider-specific API behavior.

| Gate | Required acceptance evidence |
| --- | --- |
| Same benchmark | Exact same versioned coding and conversational fixtures as the deterministic/mock leg |
| Same scoring | Existing scorecard vocabulary, thresholds, evaluator identity/version, and bounded-refinement rules |
| Identity | Exact provider plus model/version identity where exposed, transport/version, and execution timestamp |
| Fail closed | Missing/mismatched authorization prevents the first external request |
| Secret safety | Credentials injected externally; absent from repository, logs, raw evidence, and reports |
| Bounded authority | Benchmark path cannot invoke tools or mutate repositories, deployments, credentials, infrastructure, or policy |
| Bounded cost | Concrete request-count and spend ceilings enforced before dispatch |
| Bounded retries | Timeout/retry policy is finite; first-attempt outcome remains visible |
| Failure fidelity | Rejection, timeout, transport failure, malformed response, evaluator failure, and budget exhaustion remain distinct outcomes |
| Evidence | Immutable comparison bundle contains mock and real legs, normalized scores, latency/usage/cost, retries/errors, and authorization references |
| Data posture | Retention/provider-training posture is known and accepted before request dispatch |
| Teardown | Credential revocation/teardown procedure exists before execution |
| Promotion isolation | Benchmark result grants no automatic model, prompt, workflow, merge, or deployment promotion authority |

## Candidate comparison worksheet

`UNKNOWN` means evidence must be supplied for the exact candidate configuration before selection. It must not be interpreted as a negative finding or silently defaulted.

| Criterion | Candidate A — OpenAI-compatible | Candidate B — Anthropic-compatible | Candidate C — Gemini-compatible |
| --- | --- | --- | --- |
| Exact provider/account boundary | UNKNOWN | UNKNOWN | UNKNOWN |
| Exact model/version identity | UNKNOWN | UNKNOWN | UNKNOWN |
| Supported transport/SDK version | UNKNOWN | UNKNOWN | UNKNOWN |
| Non-production endpoint/region | UNKNOWN | UNKNOWN | UNKNOWN |
| Credential injection path | UNKNOWN | UNKNOWN | UNKNOWN |
| Minimum outbound network scope | UNKNOWN | UNKNOWN | UNKNOWN |
| Request-count ceiling | UNKNOWN | UNKNOWN | UNKNOWN |
| Spend ceiling | UNKNOWN | UNKNOWN | UNKNOWN |
| Timeout/retry policy | UNKNOWN | UNKNOWN | UNKNOWN |
| Retention/training posture | UNKNOWN | UNKNOWN | UNKNOWN |
| Teardown/revocation procedure | UNKNOWN | UNKNOWN | UNKNOWN |
| Architecture approval | PENDING | PENDING | PENDING |
| Operations approval | PENDING | PENDING | PENDING |
| Security/network approval if required | PENDING | PENDING | PENDING |
| Real-provider execution authorized | NO | NO | NO |

## Selection rule

A candidate becomes selectable only when every `UNKNOWN`/`PENDING` field is replaced with evidence for one exact configuration and all required approvals bind to that same configuration. If more than one candidate clears admission, prefer the candidate that can execute the existing benchmark contract with the least new authority and smallest outbound/network/credential surface; do not use this tie-breaker to waive a required gate.

If no candidate clears admission, record **NO SELECTION**. Do not manufacture a mock substitute and call it real-provider evidence.

## First-run protocol after selection

1. Re-query the selected candidate's mutable identities and approval references immediately before execution.
2. Abort before dispatch if provider/model/transport/endpoint, authorization, budget, network scope, or credential-injection evidence differs from the approved record.
3. Run the deterministic/mock leg against the frozen fixture/version.
4. Run exactly the admitted real-provider leg under the same scoring and bounded-refinement contract.
5. Preserve first-attempt failures and all bounded retries.
6. Produce the immutable comparison bundle required by the canonical candidate record.
7. Stop at evidence/report generation. Do not promote a model, prompt, workflow, repository change, or deployment automatically.

## Evidence boundary

This matrix is architecture-gate preparation only. It is not a provider recommendation, approval, credential request, network authorization, benchmark result, or operational proof. A real-provider request remains prohibited until one exact candidate configuration satisfies the canonical admission record and its matching approvals are present.
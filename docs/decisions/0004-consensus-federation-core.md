# ADR 0004: Consensus Federation Is the Core; Workflows Are the Decomposition Layer

- Status: Accepted
- Date: 2026-11-12
- Supersedes: nothing. Narrows the scope of ADR 0003.

## Context

Two decisions were in force and pointed in different directions.

- ADR 0003 (2026-07-30) makes explicit workflows the default execution model, with supervisor agents as an escalation path.
- The ATLANTIS Consensus Federation Specification v1.0.0 (2026-09-19) makes multi-model deliberation the core: several model families answer independently, their positions are compared, dissent is preserved, and a provenance record accompanies every output. It keeps supervisor-worker only as decomposition above the panel layer.

The specification is the later and more specific decision. It also carries the product's reason to exist: one model's answer cannot be checked against itself.

## Decision

1. **Consensus Federation is the core pattern.** A unit of work that produces an answer, artifact, verification, judgment, or generated option is a deliberation.
2. **Workflows are how work is decomposed and sequenced, not how answers are produced.** The sequential runner (`@atlantis/orchestration`) orders steps, enforces budgets, gates consequential actions, and records history. A step that needs a model's judgment calls the deliberation kernel (`@atlantis/deliberation`) instead of a single model.
3. **Supervisor escalation stays** as defined in ADR 0003, for work no workflow anticipates. It sits above the panel layer and is capped at four workers.
4. **No emission by vote, in any mode.** Agreement must be unanimous among responding families to release a single answer. Otherwise every position is reported.
5. **Build order.** Provenance schema first, then Mode C (verification), then the validation corpus, then the remaining modes. Reveal rounds are not built until the gate in §"Evidence gate" is passed.
6. **Diversity is counted in model families**, with these minimums: D0 1, D1 2, D2 3, D3 4, D4 5. The D0 and D1 values are set by this ADR; D2 to D4 come from the specification.
7. **Any provider.** Panelists sit behind one provider-neutral interface. The kernel ships an adapter for the OpenAI-compatible chat-completions wire format so a user can bring their own key for any provider or self-hosted model that speaks it.

## Evidence gate for reveal rounds

The specification calls for up to three reveal rounds in which panelists see each other's positions. Published evidence does not support building that first.

- A NeurIPS 2025 study across seven benchmarks found that independent answers aggregated without any debate account for most of the gain attributed to multi-agent debate, and that debate alone does not raise expected correctness (Choi, Zhu, Li, "Debate or Vote", arXiv:2508.17536).
- A January 2026 follow-up found that unmodified debate often does worse than aggregation at higher cost, and that gains appear only with specific changes: diverse initial positions and calibrated confidence (Zhu et al., arXiv:2601.19921).

Both findings support the parts of the specification already built here: blind independent answers and family diversity. They are evidence against assuming reveal rounds help.

Therefore reveal rounds ship only after the known-answer corpus shows, for the configured roster, that a revealed round improves on blind Mode C. `scoreKnownAnswers` reports the numbers this gate needs: precision when concordant, the best single panelist's accuracy, the rate of concordant-but-wrong answers, and a plurality baseline. The plurality figure is a measurement only; it is never used to choose an output.

## Consequences

- `@atlantis/deliberation` exists with provenance schema 1.0.0 and Mode C. Modes A, B, D, and E are not implemented.
- The issue tracker's Agent Harness Runtime work (#44, #45) is unaffected: it concerns how a single agent executes, below this layer.
- Classified deliberations still require self-hosted open-weight panelists inside the authorized boundary. Nothing in this repository provides that; it is an overlay concern.
- A concordant panel can still be wrong when every family shares the error. The corpus measures how often; the kernel cannot detect it at run time.

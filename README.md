# ATLANTIS AI

A civilian-first, provider-independent AI operating platform, built
workflow-first: repeatable work runs as explicit, budgeted, auditable workflows,
and supervisor agents are an escalation path rather than the default.

## Status

**Pre-alpha kernel.** Five packages, no API, no UI, no deployment. The
longer-term product description is in [docs/VISION.md](docs/VISION.md); treat
it as direction, not as a feature list.

| Package                                                 | What it provides                                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@atlantis/contracts`](packages/contracts)             | Provider-neutral types for workflows, executions, events, evaluation, policy, and approval; fail-closed budget enforcement.                                          |
| [`@atlantis/events`](packages/events)                   | Append-only in-memory event store with a SHA-256 hash chain per execution, plus an event recorder.                                                                   |
| [`@atlantis/events-postgres`](packages/events-postgres) | The same event store contract on PostgreSQL, with database triggers that reject rewrites.                                                                            |
| [`@atlantis/orchestration`](packages/orchestration)     | Sequential workflow runner: budgets, retries, duration limits, cancellation, policy and approval gating, bounded refinement, supervisor escalation.                  |
| [`@atlantis/deliberation`](packages/deliberation)       | Consensus Federation kernel: provenance records and Mode C verification across model families, with a bring-your-own-key adapter for any OpenAI-compatible endpoint. |

What is not here yet is tracked in
[docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) and the GitHub
issues.

## Quick start

Requires Node.js ≥ 22.12 and pnpm 10.

```bash
git clone https://github.com/UniversalStandards/atlantis-ai-enhanced.git
cd atlantis-ai-enhanced
corepack enable
pnpm install
pnpm check
```

## Example

```ts
import { InMemoryEventStore } from "@atlantis/events";
import { runSequentialWorkflow, sequence } from "@atlantis/orchestration";

const workflow = sequence<string>({
  id: "summarize",
  version: "1.0.0",
  description: "Normalize a request, then draft a reply",
})
  .step({
    id: "normalize",
    description: "Trim and collapse whitespace",
    execute: async (text: string) => text.trim().replace(/\s+/g, " "),
  })
  .step({
    id: "draft",
    description: "Draft a reply",
    maxAttempts: 2,
    execute: async (text: string, context) => {
      context.usage.toolCalls += 1; // steps report what they consume
      return `Received: ${text}`;
    },
  })
  .build();

const store = new InMemoryEventStore();
const result = await runSequentialWorkflow(workflow, "  hello   world ", {
  store,
  userId: "user-1",
  budget: {
    maxToolCalls: 5,
    maxRetries: 2,
    maxIterations: 3,
    maxTokens: 10_000,
    maxDurationMs: 30_000,
    maxCostUsd: 0.5,
  },
});

result.status; // "succeeded" | "failed" | "cancelled" | "budget_exceeded"
await store.read(result.executionId); // ordered, immutable event history
store.verify(result.executionId); // { valid: true, length, headHash }
```

## Verifying an answer across model families

```ts
import { createOpenAICompatiblePanelist, verify } from "@atlantis/deliberation";

const panel = [
  createOpenAICompatiblePanelist({
    id: "a",
    family: "family-one",
    model: process.env.MODEL_A!,
    baseUrl: process.env.BASE_URL_A!,
    apiKey: process.env.API_KEY_A!,
  }),
  // ...one panelist per model family; depth 2 needs three families
];

const result = await verify({ prompt: "What is 17 * 23?", panel, depth: 2 });

result.status; // "concordant" | "divergent" | "insufficient_panel"
result.answer; // set only when every responding family agrees
result.positions; // every distinct answer and who gave it
result.provenance; // hashes only; safe to log and retain
```

There is no vote. If the families disagree, the disagreement is the result:
every position is returned under an unresolved-discrepancy header, or nothing
is released when the output is a legally binding instrument.

## Guarantees the runner makes

- **Budgets fail closed.** Tool calls, retries, iterations, tokens, duration,
  and cost are checked before and after every step, attempt, and revision. A
  counter that is `NaN`, infinite, or negative is a violation, not a pass.
- **Hung steps are abandoned** at the duration limit and their
  `context.signal` is aborted.
- **No unaudited execution.** If the event store refuses an event, the run
  rejects instead of continuing.
- **Inputs and outputs stay out of the audit log.** Events carry identifiers,
  counters, scores, and error names/messages only.
- **Consequential steps are gated.** A step that declares an `action` is
  denied unless a policy allows it, and waits for explicit approval when the
  policy requires it. Retries and escalation cannot bypass a denial.
- **Supervisor escalation is opt-in per workflow mode.** In `"workflow"` mode a
  failed step fails the execution even if the step defines an escalation.

## Repository layout

```text
packages/contracts       shared types and budget enforcement
packages/events          event store and recorder
packages/events-postgres durable event store
packages/orchestration   workflow runner
packages/deliberation    consensus federation kernel
docs/decisions           architecture decision records
docs/                    modernization plan, implementation status, vision
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).

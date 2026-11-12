# ATLANTIS AI

A civilian-first, provider-independent AI operating platform, built
workflow-first: repeatable work runs as explicit, budgeted, auditable workflows,
and supervisor agents are an escalation path rather than the default.

## Status

**Pre-alpha foundation.** This repository contains the orchestration kernel's
first three packages and nothing else yet: no model providers, no API, no UI,
no persistence. The longer-term product description is in
[docs/VISION.md](docs/VISION.md); treat it as direction, not as a feature list.

| Package                                             | What it provides                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@atlantis/contracts`](packages/contracts)         | Provider-neutral types for workflows, executions, events, evaluation, and escalation; fail-closed budget enforcement.                                                |
| [`@atlantis/events`](packages/events)               | Append-only event store contract implementation (in-memory) with a SHA-256 hash chain per execution, plus an event recorder.                                         |
| [`@atlantis/orchestration`](packages/orchestration) | Deterministic sequential workflow runner: budgets, retries, duration limits, cancellation, bounded evaluate→revise loops, supervisor escalation, full event history. |

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

## Guarantees the runner makes

- **Budgets fail closed.** Tool calls, retries, iterations, tokens, duration,
  and cost are checked before and after every step, attempt, and revision. A
  counter that is `NaN`, infinite, or negative is a violation, not a pass.
- **Hung steps are abandoned** at the duration limit and their
  `context.signal` is aborted.
- **No unaudited execution.** If the event store refuses an event, the run
  rejects instead of continuing.
- **Inputs and outputs stay out of the audit log.** Events carry identifiers,
  counters, and error names/messages only.
- **Supervisor escalation is opt-in per workflow mode.** In `"workflow"` mode a
  failed step fails the execution even if the step defines an escalation.

## Repository layout

```text
packages/contracts       shared types and budget enforcement
packages/events          event store and recorder
packages/orchestration   workflow runner
docs/decisions           architecture decision records
docs/                    modernization plan, implementation status, vision
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).

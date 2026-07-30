# ADR-0001: Workflow-First Orchestration

## Status
Accepted — 2026-07-30

## Context
ATLANTIS must execute complex work reliably across multiple models, agents, tools, and environments. Fully autonomous supervisor agents provide flexibility, but they introduce model-driven coordination overhead, less predictable execution, greater cost, and a larger failure surface. Recent LangChain4j experimentation reported that a deterministic workflow implementation completed the same debugging task roughly three times faster than a supervisor implementation, while an older model became trapped in a tool-calling loop.

## Decision
ATLANTIS will use workflow-first orchestration.

1. Repeatable or decomposable tasks use explicit, versioned task graphs by default.
2. Supervisor agents are escalation mechanisms for genuinely open-ended or unanticipated work.
3. A routing policy selects workflow, supervisor, or hybrid execution based on task novelty, uncertainty, risk, and available workflow coverage.
4. Every workflow step has typed inputs and outputs, bounded retries, explicit exit conditions, and an assigned model or deterministic component.
5. Execution loops are capped by tool calls, iterations, elapsed time, token use, and monetary cost.
6. Runtime agents cannot directly modify production runtime code or policy. Improvement proposals are emitted as reviewable artifacts or pull requests.
7. Every execution produces a replayable event history with model, prompt, tool, policy, approval, cost, latency, result, and evaluation metadata.

## Canonical Workflow Shape

Intent normalization → policy and risk classification → planning → architecture review → implementation or execution → security review → testing → evaluation → bounded refinement → documentation → summary.

Independent review and evaluation stages may run in parallel where dependencies allow.

## Required Platform Capabilities

- Workflow compiler and versioned workflow registry
- Supervisor escalation and return-to-workflow protocol
- Execution graph and trace visualization
- Evaluation engine with task-specific scoring
- Model and provider benchmark suite
- Replay and deterministic fixture mode
- Budget and circuit-breaker controls
- Self-improvement proposal pipeline

## Consequences

### Positive
- Lower latency and model spend for repeatable work
- Better reproducibility, testing, and auditing
- Clearer failure localization
- Safer limits on autonomous behavior
- Easier comparison of models and workflow revisions

### Trade-offs
- Workflows require explicit design and maintenance
- Novel work may still need supervisor coordination
- Replay fidelity depends on recorded tool outputs and provider determinism

## Acceptance Criteria

This decision is implemented when ATLANTIS can execute one governed conversation workflow end to end, display its execution graph, enforce all configured budgets, score the result, perform a bounded refinement pass, and replay the run with deterministic fixtures.
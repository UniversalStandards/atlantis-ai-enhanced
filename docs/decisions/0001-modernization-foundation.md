# ADR 0001: Modernization Foundation

- Status: Accepted
- Date: 2026-07-29
- Decision owners: ATLANTIS AI program

## Context

The current repository contains valuable Python orchestration, policy, evidence, MCP, and agent-management concepts. However, it presents the project as production-ready while lacking a complete user-facing application, provider-neutral contracts, governed streaming conversations, durable workflow execution, modern observability, and continuous AI evaluations.

## Decision

ATLANTIS will use a hybrid architecture:

1. TypeScript will be the primary language for the web application, public API contracts, provider abstraction, policy-facing tool contracts, and orchestration application layer.
2. Existing Python modules will be retained only after inventory and validation, and will serve as specialized workers or services where Python has a clear advantage.
3. The platform will be provider-independent. OpenAI is the first production adapter, not the internal architecture.
4. PostgreSQL will be the primary system of record, supporting structured data, full-text retrieval, and vector retrieval.
5. Long-running execution will use durable, resumable task semantics with checkpoints, retries, cancellation, approvals, and audit history.
6. MCP will be supported behind a policy and trust boundary.
7. OpenTelemetry will instrument requests, model calls, retrieval, tools, approvals, and workflow transitions.
8. AI evaluations will be required for routing, prompts, tools, retrieval, memory, authorization, and groundedness changes.
9. Replit will be used for rapid prototype validation; GitHub remains authoritative for production code.
10. Kubernetes will not be introduced until demonstrated scale, isolation, or enterprise requirements justify it.

## Consequences

- Existing code is not discarded automatically; every asset is classified as retain, refactor, replace, or archive.
- The repository will temporarily contain both Python and TypeScript workspaces.
- Provider-specific SDK objects must be translated at adapter boundaries.
- Policy and approval logic cannot be bypassed by UI or model behavior.
- Documentation claiming production readiness must be revised to match demonstrated capabilities.

## Success criteria

A clean checkout supports a governed end-to-end vertical slice: authentication, persistent conversation, streamed model response, provider metadata, a harmless policy-gated tool, explicit approval, audit event inspection, reload persistence, and user-controlled deletion.
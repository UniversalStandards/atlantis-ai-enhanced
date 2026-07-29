# ATLANTIS AI Modernization and Step One Implementation Plan

## 0. Executive Direction

ATLANTIS AI is the unified civilian-first AI operating platform. SWARM, HITMAN, OPENCLAW, UAIP, MCP integrations, desktop automation, mobile access, and workflow automation are modules inside one coordinated system.

The modernization goal is to preserve the original mission while replacing outdated implementation assumptions with a provider-independent, secure, observable, testable, and durable architecture.

## 1. Source-of-Truth Model

- GitHub: code, architecture decisions, issues, pull requests, releases, and technical documentation.
- Notion: program planning, decisions, status, dependencies, and cross-functional documentation.
- Google Drive: formal reports and shareable planning documents.
- Replit: rapid working application prototype and demonstration environment.
- OpenAI Platform: securely provisioned model credentials and project-level API access.

## 2. Updated Architecture

### 2.1 Core platform

- TypeScript-first monorepo
- Next.js and React web application
- Provider-independent AI abstraction
- PostgreSQL with hybrid retrieval and vector support
- Redis-compatible coordination layer
- MCP tool and context interoperability
- Durable task graph execution
- Explicit approval and policy enforcement
- OpenTelemetry traces, metrics, and logs
- Continuous AI evaluations

### 2.2 Logical modules

- ATLANTIS Gateway
- ATLANTIS Core
- Policy and Trust Engine
- Memory and Knowledge Engine
- Task Graph Engine
- SWARM specialist-agent execution
- OPENCLAW browser, desktop, and device automation
- Capability Registry
- Provider Adapters
- MCP Client and Server Layer

## 3. Step One Objective

Create a compilable and testable foundation that establishes permanent contracts for identity, conversations, models, tools, agents, memory, tasks, approvals, events, audit records, provider adapters, MCP compatibility, and front-end streaming.

## 4. Step One Deliverables

1. Account creation and sign-in
2. Persistent conversations
3. Streaming real-model responses
4. OpenAI provider adapter
5. Local or mock provider adapter for testing
6. Model registry and selection metadata
7. Tool registry with one harmless demonstration tool
8. Policy evaluation before tool execution
9. Approval object and approval UI
10. Audit event persistence
11. OpenTelemetry instrumentation
12. Unit, integration, browser, and AI evaluation tests
13. Docker-based local development
14. GitHub Actions CI
15. Initial architecture decision records
16. Security and contribution policies
17. AGENTS.md repository instructions

## 5. Architectural Laws

1. No provider-specific object crosses the provider-adapter boundary.
2. Every consequential tool call passes through policy evaluation.
3. Every persistent memory has provenance, scope, and deletion behavior.
4. Every long-running task has a durable identifier and resumable state.
5. Every external action produces an audit event.
6. Every public API is schema validated and versioned.
7. Every agent receives only the tools and context required for its task.
8. No secrets appear in prompts, logs, source code, or client bundles.
9. Model output is untrusted until validated.
10. Retrieved content cannot override system policy.
11. Irreversible actions require explicit authorization.
12. Users can stop, inspect, and correct active work.
13. The platform must function with more than one model provider.
14. A failed specialist cannot corrupt the parent task state.
15. AI quality changes must be measured through evaluations.

## 6. Execution Levels

- Level 0 — Informational: answer, analyze, draft, or explain without external changes.
- Level 1 — Reversible internal: read connected data and create temporary artifacts.
- Level 2 — External or consequential: send, publish, modify records, deploy, or purchase.
- Level 3 — High impact: financial transfers, identity changes, destructive deletion, security changes, or physical systems.

Level 2 and Level 3 actions require explicit approval unless a narrowly scoped standing authorization applies. Essential authorization and integrity protections cannot be disabled by a user-facing toggle.

## 7. Recommended Repository Topology

```text
apps/
  web/
  gateway/
  worker/
packages/
  contracts/
  database/
  identity/
  policy/
  events/
  orchestration/
  task-graph/
  memory/
  retrieval/
  model-router/
  provider-openai/
  provider-anthropic/
  provider-google/
  provider-local/
  mcp-client/
  mcp-server/
  tool-runtime/
  sandbox/
  observability/
  evaluations/
  ui/
  config/
services/
  python-ml/
  document-processing/
infrastructure/
  environments/
  modules/
  containers/
  policies/
evals/
  datasets/
  graders/
  scenarios/
  reports/
docs/
  architecture/
  decisions/
  security/
  operations/
  product/
  protocols/
```

## 8. Completion Criteria

A clean checkout must support installation, development, linting, type checking, unit tests, end-to-end tests, AI evaluations, and production builds.

A user must be able to sign in, create a conversation, receive a streamed model response, inspect the selected provider and model, request a harmless tool invocation, see the policy decision, approve a gated action, inspect the resulting audit event, reload without losing the conversation, and delete user-controlled data.

## 9. Immediate Backlog

1. Inventory the current repository and classify existing code as retain, refactor, replace, or archive.
2. Create root workspace and package contracts.
3. Establish shared TypeScript and linting configuration.
4. Add AGENTS.md, SECURITY.md, CONTRIBUTING.md, and architecture decision records.
5. Implement identity and tenant context.
6. Implement provider-neutral conversation contracts.
7. Implement the OpenAI adapter and mock adapter.
8. Add persistence, streaming, policy evaluation, approvals, and audit events.
9. Add observability and evaluation harnesses.
10. Deliver the first end-to-end vertical slice.

## 10. Governance

ATLANTIS exists to increase the agency of any natural person or sentient being. Any deployment that measurably reduces autonomy without fully informed and understood consent is considered a system failure.

# ADR 0002 — Agent Harness Runtime Standard

**Status:** Proposed for adoption across ATLANTIS-connected projects  
**Date:** 2026-09-13  
**Scope:** ATLANTIS AI, SWARM, HITMAN, OPENCLAW, UAIP, coding-agent automation, MCP integrations, and any future runtime that repeatedly plans, calls tools, observes results, refines work, or delegates to subagents.

## 1. Context

ATLANTIS already defines provider-neutral contracts, durable task graphs, policy enforcement, approvals, memory, MCP interoperability, observability, evaluation, bounded execution budgets, and specialist-agent delegation. Recent industry work around "agent harnesses" reinforces that these capabilities should not remain a loose collection of features. They belong to a first-class runtime layer with explicit boundaries and invariants.

The relevant architectural lesson is not to adopt one vendor harness wholesale. It is to make the stable engineering ideas part of ATLANTIS itself while preserving provider independence and the workflow-first architecture established by ADR-0001.

Reference reviewed: freeCodeCamp, "What Is an Agent Harness? The Architecture Behind Claude Code, DeepSeek Harness, and Hermes Agent" (2026-09-11), https://www.freecodecamp.org/news/what-is-an-agent-harness/

## 2. Decision

ATLANTIS SHALL implement an explicit **Agent Harness Runtime** between model/provider adapters and higher-level workflow / multi-agent orchestration.

The runtime is responsible for carrying a bounded unit of work from goal to completion through a repeatable plan → act → observe → evaluate → refine loop. It SHALL be model-agnostic, tool-agnostic, policy-governed, observable, resumable, and sandboxed.

Higher-level orchestration MAY coordinate many harness instances, but orchestration SHALL NOT duplicate the harness responsibilities defined below.

## 3. Layered Architecture

ATLANTIS SHALL use the following conceptual layers.

### 3.1 Protocol and Capability Layer

Responsibilities:

- MCP clients and servers
- native connector adapters
- capability discovery and registration
- schema-normalized tool descriptions
- authentication and delegated authorization metadata

A capability is registered once and exposed through a stable ATLANTIS tool contract. Provider-specific or transport-specific objects SHALL NOT leak into the harness core.

### 3.2 Agent Harness Runtime

Every harness instance SHALL contain five mandatory mechanisms:

1. **Execution loop** — drives the unit of work until success, safe failure, escalation, or a configured limit.
2. **Tool router** — validates, authorizes, dispatches, and records tool calls.
3. **Context and memory manager** — decides what is loaded, retained, compacted, offloaded, retrieved, and persisted.
4. **Planning mechanism** — creates or selects an explicit execution plan before consequential actions.
5. **Sandbox boundary** — constrains filesystem, shell, browser, network, credential, and external side effects.

No ATLANTIS agent runtime is considered production-ready if any one of these five mechanisms is only implied by prompts or conventions.

### 3.3 Orchestration Layer

Responsibilities:

- durable task graphs
- workflow compilation and versioning
- recursive / specialist delegation
- fan-out and depth controls
- checkpointing and resume
- supervisor escalation
- parallel branch coordination
- join / synthesis semantics

Workflow-first remains the default. Supervisor agents are escalation mechanisms for novel or poorly covered work, not the universal control plane.

### 3.4 Cross-Cutting Reliability Layers

The following apply across protocol, harness, and orchestration:

- policy and identity
- OpenTelemetry-compatible traces, metrics, and logs
- model/tool cost accounting
- continuous evaluations
- anomaly detection
- security review
- human approval for consequential actions
- sandbox isolation

Observability is mandatory from the first executable slice, not a later operational add-on.

## 4. Runtime Invariants

Every harness execution SHALL enforce all of the following.

### 4.1 Bounded execution

Limits MUST exist for:

- turns / model calls
- tool calls
- recursion depth
- subagent fan-out
- elapsed wall time
- tokens
- monetary cost
- repeated failures
- repeated or near-identical outputs

Crossing a limit MUST produce a typed terminal or escalation event. Silent infinite loops are prohibited.

### 4.2 Structured failure handling

Tool and model failures MUST be classified at minimum as:

- validation error
- authorization / policy denial
- transient provider error
- rate limit
- timeout
- deterministic tool failure
- malformed model response
- sandbox violation
- unavailable dependency
- budget exhaustion
- loop / non-progress detection

Retries MUST be bounded, backoff-aware where appropriate, and restricted to failures that are reasonably retryable. A deterministic failure SHALL NOT be retried indefinitely with the same inputs.

Where policy allows, the router MAY switch provider, model, tool implementation, or execution strategy after a typed failure.

### 4.3 Idempotency and side-effect safety

Consequential tool calls MUST carry an idempotency or deduplication strategy when the target system supports one.

Before retrying an external write, the harness MUST determine whether the prior attempt completed, partially completed, or failed before side effects.

### 4.4 Tool least privilege

Each agent or task node receives only the tools and data required for its assigned work.

Tool availability MUST be generated from policy and task context, not from a universal unrestricted tool list.

### 4.5 Sandboxing as an enforceable boundary

Shell, filesystem, browser automation, untrusted code execution, and other high-risk tool classes MUST run in an isolated execution environment appropriate to the risk.

Production design SHALL support disposable containers or microVM-class isolation for untrusted execution. Local-directory-only conventions are insufficient as the sole production boundary.

Sandbox policy MUST be testable. CI SHALL include regression tests proving that an agent cannot escape its allowed filesystem, network, credential, or process boundary.

### 4.6 Planning before consequential action

Consequential tasks MUST have an inspectable plan or selected workflow before external side effects begin.

Plans MAY be generated dynamically, selected from a reusable workflow, or compiled from both. Plans SHALL record intended steps, dependencies, approvals, expected outputs, and stop conditions.

## 5. Context Engineering Standard

Context is a governed resource, not an append-only transcript.

### 5.1 Isolation

Subagents SHOULD receive a clean task-specific context rather than an unbounded copy of the parent conversation.

Child results SHOULD return to the parent as typed result objects and concise evidence-preserving summaries, while full raw traces remain addressable by reference.

### 5.2 Adaptive compaction

ATLANTIS SHALL preserve the existing Adaptive Context Compaction concept and promote it to a platform capability.

Compaction policies MUST support:

- large tool-output offloading
- completed-subtask summarization
- retrieval of raw evidence by reference
- priority retention for requirements, decisions, constraints, approvals, failures, and unresolved questions
- emergency compaction before context exhaustion

Compaction MUST NOT discard provenance needed to audit a final claim or action.

### 5.3 Long-session continuity

Long-running tasks SHALL checkpoint:

- plan state
- completed nodes
- active approvals
- memory references
- tool outputs or durable references to them
- budget state
- evaluation state
- parent/child relationships

A process restart SHALL NOT require reconstructing mission state from natural-language summaries alone.

## 6. Memory and Reusable Skill Compounding

ATLANTIS already distinguishes episodic and semantic memory. A third governed artifact type SHALL be added: **Reusable Skills / Procedures**.

A reusable skill is a versioned, testable procedure derived from repeated successful work. It MAY include a workflow template, tool sequence, prompt fragment, policy requirements, evaluation rubric, or recovery strategy.

Skills MUST contain:

- stable identifier and version
- originating executions / provenance
- trigger conditions
- required capabilities
- permissions and risk level
- success metrics
- last validation date
- owner or responsible subsystem
- expiry / review policy
- rollback history

A newly learned skill SHALL NOT silently become globally authoritative. Promotion requires evaluation against regression scenarios and policy review appropriate to its risk.

Unused, failing, or obsolete skills SHALL be deactivated or retired so the skill library does not become permanent architectural debt.

## 7. Plugin and Extension Model

ATLANTIS SHOULD combine a small mandatory harness kernel with swappable extensions.

The following MUST be replaceable behind stable contracts:

- model/provider adapter
- tool provider
- memory backend
- session/event store
- sandbox backend
- planner
- evaluator / grader
- context compactor
- scheduler / queue
- UI client

The execution loop, policy enforcement points, event schema, budget enforcement, and safety invariants are part of the kernel and SHALL NOT be bypassable by plugins.

Architecture itself should be configurable, but safety guarantees should not be optional configuration.

## 8. Unit of Work and the Non-Code "Diff"

Coding agents naturally produce a repository diff. General-purpose ATLANTIS work needs an equivalent review object.

Every execution SHALL produce a **Work Delta** containing, as applicable:

- starting state references
- requested objective
- plan selected or generated
- files / records / resources read
- files / records / resources created, modified, or deleted
- external actions performed
- decisions made
- approvals obtained
- tool and model calls
- costs and latency
- evidence / citations
- evaluations and review findings
- final state references
- unresolved items

The Work Delta is the reviewable, replayable equivalent of a code diff for research, documents, business workflows, device automation, and other non-code missions.

No consequential autonomous mission is considered complete until its Work Delta is durable and inspectable.

## 9. Evaluation and Observability

Every production harness run SHALL emit correlated telemetry for:

- model calls
- tool calls
- retries
- policy decisions
- approvals
- context compaction
- memory retrieval and writes
- skill retrieval and writes
- subagent spawn / join
- checkpoints
- sandbox events
- token usage
- monetary cost
- latency
- evaluations
- terminal outcome

Evaluation SHALL cover both output quality and execution behavior.

Regression suites SHOULD include failure-injection scenarios such as provider outage, malformed tool response, rate limit, sandbox denial, repeated output, partial external write, stale memory, corrupted checkpoint, and child-agent failure.

## 10. Model and Harness Selection

ATLANTIS SHALL select models, harness configurations, and extensions based on measured failure modes and task requirements rather than popularity metrics.

Selection inputs SHOULD include:

- success rate on relevant evals
- long-session reliability
- tool-use accuracy
- latency
- cost
- context behavior
- sandbox compatibility
- provider resilience
- maintenance maturity
- observed sustained usage where relevant

Benchmark results and routing changes SHALL be recorded and reviewable.

## 11. Relationship to Existing ATLANTIS Decisions

This ADR extends rather than replaces prior architecture.

ADR-0001 remains authoritative for workflow-first orchestration, bounded retries, exit conditions, execution budgets, replayable event history, evaluation, and supervisor escalation.

The modernization plan remains authoritative for provider neutrality, MCP interoperability, durable task graphs, approvals, auditability, OpenTelemetry, evaluations, memory provenance, user control, and sandbox/package topology.

This ADR adds the missing first-class harness boundary and makes context engineering, sandbox invariants, typed failure recovery, idempotency, reusable skill governance, and Work Delta artifacts explicit platform requirements.

## 12. Required Implementation Packages

The target repository topology SHALL include, whether as separate packages or clearly separated modules:

- `packages/harness-runtime`
- `packages/tool-router`
- `packages/context-manager`
- `packages/planning`
- `packages/sandbox`
- `packages/skills`
- `packages/work-delta`
- `packages/observability`
- `packages/evaluations`

Existing `orchestration`, `task-graph`, `memory`, `policy`, `events`, `model-router`, provider adapters, MCP packages, and capability registry SHALL integrate through contracts rather than circular dependencies.

## 13. Acceptance Criteria

This ADR is implemented when ATLANTIS can demonstrate all of the following in automated tests and a production-like environment:

1. A model-agnostic harness executes a task through plan → tool call → observation → evaluation → completion.
2. A transient tool failure succeeds through bounded recovery while a deterministic failure exits or escalates without looping.
3. Turn, tool-call, time, token, and cost budgets stop execution fail-closed.
4. Context compaction occurs automatically while preserving traceable evidence references.
5. A child agent runs with isolated task context and returns a typed result without corrupting parent state.
6. Untrusted shell or code execution cannot escape the configured sandbox boundary.
7. A durable checkpoint resumes after process restart.
8. A consequential external action is policy-checked, approval-gated when required, idempotency-aware, and represented in the Work Delta.
9. A reusable skill is created from successful work, regression-tested, versioned, retrieved on a later matching task, and can be retired.
10. A full trace shows model, tool, policy, approval, sandbox, memory, context, cost, evaluation, and outcome events under one execution identifier.
11. Failure-injection tests prove recovery from at least provider outage, rate limit, malformed tool output, loop detection, and child-agent failure.
12. The same workflow can run against at least two model providers without changing harness-core contracts.

## 14. Propagation Rule

All ATLANTIS-connected repositories and generated implementations SHALL either:

- adopt this standard directly, or
- document why a specific requirement does not apply and which equivalent control satisfies the same invariant.

New agentic projects MUST reference this ADR during architecture review so these reliability and safety lessons are inherited rather than rediscovered.

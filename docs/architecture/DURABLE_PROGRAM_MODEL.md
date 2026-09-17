# ATLANTIS Durable Program Model

## Status

Architecture evidence and design constraint for the ATLANTIS operational-alpha. This document does **not** select a workflow vendor, persistence provider, queue, browser runtime, credential model, network topology, or production deployment. It refines how orchestration semantics and persistence infrastructure are separated.

## External evidence ingested

On 2026-08-30, ATLANTIS reviewed Vercel's 2026-08-27 article, **"The best workflow engine is a programming language"**:

- https://vercel.com/blog/the-best-workflow-engine-is-a-programming-language

The article presents several relevant design observations:

1. Ordinary programming-language control flow already expresses sequencing, branching, loops, parallelism, and exception handling; a separately authored DAG is often unnecessary.
2. Durable execution can be introduced beneath normal-looking code by distinguishing orchestration from side-effecting durable steps.
3. Long-lived external interaction and human approval can use a unified hook-style primitive that parks and resumes execution.
4. The workflow runtime can sit behind a swappable infrastructure interface rather than binding workflow source code to one database, queue, or hosted control plane.
5. In-flight workflow versioning is an infrastructure concern: a run must remain bound to compatible executable semantics rather than replaying historical state against arbitrarily changed code.
6. The article explicitly notes that correctness has non-zero step overhead because durable step execution requires networking/queueing/persistence; the abstraction must not hide those costs from release engineering.

These are architectural inputs, not proof that Vercel Workflow SDK, its hosted backend, or any other cited system satisfies ATLANTIS governance, persistence, recovery, or release gates.

## Core ATLANTIS principle

**The program describes what should happen. The ATLANTIS runtime guarantees how it happens safely, durably, observably, and under governance.**

ATLANTIS SHOULD allow normal program control flow to be the primary authoring model when it is sufficient. ATLANTIS MUST NOT require a developer, agent, or user to manually maintain a second workflow graph solely to reproduce semantics already present in executable control flow.

A task graph MAY still exist as a derived execution, planning, visualization, verification, scheduling, or evidence representation. Derived graphs are not a second authority for workflow meaning unless explicitly admitted by a governed contract.

## Separation of concerns

### 1. Program / orchestration layer

Responsible for expressing intent and control flow:

- sequencing;
- branching;
- bounded loops and refinement;
- parallel work;
- exception handling;
- approval waits;
- cancellation and deadlines;
- return values.

This layer must remain provider-neutral.

### 2. Governed durable-step layer

Responsible for side effects and externally observable operations:

- model/provider invocation;
- GitHub/repository operations;
- browser actions;
- file/artifact writes;
- messaging/approval delivery;
- infrastructure APIs;
- payments or other consequential external effects when separately authorized.

Every consequential step remains subject to existing ATLANTIS authorization, approval, budget, execution-identity, retry, cancellation, uncertainty, and evidence rules.

### 3. Durable runtime / execution-world boundary

The runtime supplies capabilities without changing workflow source semantics. A concrete runtime may combine or separate implementations, but the provider-neutral boundary conceptually covers:

- checkpoint/state persistence;
- append/event persistence;
- recovery ownership and fencing;
- queues/scheduling/wakeups;
- external hooks/events;
- immutable execution/version identity;
- authentication/authorization context propagation;
- artifact/evidence references;
- telemetry transport;
- clock/timer/deadline services.

A persistence candidate such as PostgreSQL or Azure Cosmos DB is therefore a **substrate behind this boundary**, not the workflow language and not ATLANTIS itself.

## Required governance invariants

The durable-program authoring model does not relax any existing ATLANTIS control. Any implementation must preserve all of the following:

1. Authorization precedes protected execution.
2. Human approval remains explicit for consequential actions.
3. Durable execution identity survives waits and recovery.
4. Completed steps are not repeated merely because the orchestrator restarts.
5. Retries remain bounded and policy controlled.
6. Ambiguous external effects are reconciled from authoritative evidence rather than blindly repeated.
7. Budget checks remain fail closed.
8. Cancellation and timeout semantics remain explicit and terminal where defined.
9. External/browser/tool content remains data and cannot silently become authority.
10. Independent verification remains separate from the actor that performed consequential work.
11. Evidence and trace identity remain immutable and candidate/run bound.
12. Provider/runtime replacement cannot weaken canonical contracts.

## Version-safe execution requirement

A durable program must be recoverable against compatible executable semantics.

ATLANTIS MUST bind an execution to an immutable or otherwise compatibility-verifiable workflow implementation identity. At minimum, release evidence must identify:

- workflow/program identity;
- source revision or immutable bundle digest;
- contract/schema version;
- execution ID;
- checkpoint/event compatibility version;
- runtime adapter identity/configuration digest;
- approved migration or compatibility rule when code changes during an in-flight run.

ATLANTIS MUST NOT replay durable history against arbitrary new workflow code and call a successful process start "recovery." If the original executable revision cannot be restored and no approved compatibility migration exists, recovery must fail closed or enter an explicit migration/escalation state.

## Hook / human-in-the-loop requirement

ATLANTIS SHOULD expose one provider-neutral wait/resume abstraction capable of representing approval and external-event waits without requiring the orchestration author to manually operate a separate signal/query/update taxonomy.

The existing approval contracts remain authoritative. Any generalized hook abstraction must preserve:

- execution identity;
- request/decision identity;
- expiration;
- actor identity;
- authorization scope;
- one-time or explicitly versioned resolution semantics;
- durable evidence of request and resolution;
- rejection of substituted or stale resolutions.

## Persistence-decision consequence

`DURABLE_PERSISTENCE_CANDIDATE_EVIDENCE_MATRIX.md` evaluates storage substrates only. Candidate selection MUST NOT silently select a workflow authoring framework or hosted orchestration control plane.

The durable persistence decision should prefer a substrate that can implement the existing provider-neutral ports with the smallest trusted surface while preserving:

- transactional/conditional authority;
- monotonic fencing;
- immutable append semantics;
- authoritative settlement after ambiguous acknowledgement;
- genuinely independent clients;
- restart/failover proof;
- reversible non-production conformance.

Workflow-runtime conveniences may be evaluated independently after they are mapped to ATLANTIS contracts. No SDK directive, compiler transform, managed workflow API, or vendor-specific history format becomes canonical merely because it offers convenient durable execution.

## Candidate-evaluation questions introduced by this evidence

For every durable runtime or workflow-framework candidate, record answers to these questions before adoption:

1. Can normal program control flow remain the source of orchestration truth?
2. Can side-effecting steps be isolated without changing ATLANTIS authorization and evidence semantics?
3. Can the backend implementation be replaced without rewriting workflow source logic?
4. How are in-flight executions bound to compatible code versions?
5. How are external events and human approvals durably addressed and authenticated?
6. Does the framework require a new privileged control plane or worker fleet, and if so, what additional trusted surface does that create?
7. Does it expose authoritative committed/conflict/known-failure/uncertain outcomes, or does it obscure acknowledgement ambiguity?
8. Can ATLANTIS independently verify the event/checkpoint/evidence state, or is correctness trapped inside opaque vendor state?
9. Can all runtime capabilities be disabled/removed without changing canonical workflow semantics?
10. What is the measured latency/cost of a durable step, and does step granularity create material budget or throughput risk?

## Current decision

**ADOPT THE ARCHITECTURAL PRINCIPLE; DO NOT SELECT A VENDOR FROM THIS EVIDENCE ALONE.**

ATLANTIS will treat ordinary program control flow as the preferred workflow-authoring model where feasible and treat durable runtime infrastructure as a swappable, governed execution-world boundary.

This decision does not alter the pending Day-7 persistence selection. PostgreSQL 18-class and Azure Cosmos DB for NoSQL remain candidate persistence substrates under their existing decision matrix; SQLite WAL retains its existing Day-7 disposition. No provider-specific implementation is authorized by this document.

## Next implementation consequence

When the durable-persistence candidate is eventually approved, its adapter SHOULD be implemented beneath the existing runner/event/checkpoint/ownership contracts rather than forcing provider semantics into workflow source code. A later implementation slice may add a provider-neutral `ExecutionWorld` composition interface if doing so removes wiring duplication without weakening existing ports or evidence boundaries.

Any such code change requires normal build, typecheck, test, trace/evidence review, and must remain disabled by default until the corresponding runtime candidates are approved.
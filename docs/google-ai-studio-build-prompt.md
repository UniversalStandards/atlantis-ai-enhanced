# ATLANTIS AI — Google AI Studio Build Prompt

**Purpose:** Paste the prompt in the fenced block below into Google AI Studio's "Describe an app and let Gemini do the rest" field (New App) to build ATLANTIS AI — a civilian-first multi-agent coordination platform with recursive agent delegation. This document also serves as the canonical build spec: every numbered heading below corresponds to a line in the prompt, so the two stay traceable to each other.

Priority order: **civilian first, government second, business third.** Production quality only — no demo framing, no placeholders, no stripped-down illustrative version of any feature.

---

## The Prompt (copy everything in this block into AI Studio)

```
Build "ATLANTIS AI" — a production-grade, civilian-first multi-agent coordination platform
(government and enterprise are secondary deployment targets, not the primary audience).
Ship a fully working, polished application on first build — every feature below must be
completely functional, not illustrative.

Use the Gemini API (already configured here) as the reasoning engine for every agent.
Persist state in IndexedDB so history, learned patterns, and preferences survive across
sessions without an external backend.

CORE CONCEPT — RECURSIVE SUPERVISOR ARCHITECTURE
A root Supervisor agent receives a "mission," classifies its topology (Centralized,
Decentralized, Hybrid, or Independent), and delegates to up to 4 child agents. Delegation is
recursive: any agent, at any depth, may itself act as a supervisor and spawn up to 4 of its
own children if a subtask still needs breaking down. Each child reports its result only to
the parent that spawned it; each parent synthesizes its children's reports into one summary
and passes that single summary up to its own parent. The root Supervisor's final synthesis —
built from what its direct children already synthesized from theirs — is the mission result.
Cap fan-out at 4 per node at every level (saturation threshold) and cap recursion depth at a
user-adjustable max (default 3 levels) to prevent runaway spawning. A node recurses only if
its own assigned subtask is still decomposable; otherwise it is a leaf and executes directly
via a single Gemini call. Children report only to their immediate spawning parent — no
skip-level reporting — and a parent blocks on all of its live children before it synthesizes.

BUILD THESE FEATURES, ALL FULLY FUNCTIONAL:

1. MISSION CONSOLE
   - Natural-language mission input field.
   - Autocomplete drawn from mission history, ranked by recency and frequency, weighted by
     learned phrasing patterns from the Adaptive Personalization Layer (feature 3).
   - On submit: classify topology, delegate recursively per the Core Concept rules above,
     stream every active node's output live with a per-node status badge (queued / running /
     complete / error) and token-level streaming render.
   - Final output is the rolled-up synthesis, with inline citation markers that are
     click-to-jump to the exact source node that produced each fact.

2. RECURSIVE AGENT TREE VIEW
   - A real-time, expandable tree/graph (not a flat list) showing every spawned agent as a
     node under its actual parent.
   - Animated node insertion on spawn and animated collapse-into-parent on synthesis.
   - Clicking any node reveals its inputs, its reasoning, and the child reports it
     synthesized.
   - Each node displays a depth/fan-out indicator, e.g. "Level 2 of 3 · 3/4 children
     reporting."

3. ADAPTIVE PERSONALIZATION LAYER
   - Learns, over time: sector preference, topology preference, delegation-depth preference,
     and phrasing patterns.
   - Uses these signals to reorder quick-actions and pre-fill defaults.
   - Provides a visible, inspectable "adaptation log" showing exactly what has been learned.
   - Lets the user correct any individual learned signal, or reset either one signal or all
     signals back to defaults.

4. SECTOR ROUTING
   - 18 operational sectors: Emergency Response, Infrastructure, Intelligence Analysis,
     Public Health, Cybersecurity, Logistics & Supply, Communications, Legal & Compliance,
     Finance & Budget, Personnel, Space & Advanced Tech, Environmental, Transportation,
     Energy, Education, Healthcare, International Affairs, Science & Research.
   - Auto-suggest the most likely sector(s) from the mission text before the user picks,
     distinguishing a primary sector from secondary/cross-cutting sectors.

5. ADAPTIVE CONTEXT COMPACTION (ACC) METER
   - Live gauge with 5 real, functionally enforced tiers (not cosmetic):
     * None: under 70% context capacity — full history passed through.
     * Light: 70-80% — drop tool results over 500 tokens.
     * Medium: 80-90% — summarize completed sub-tasks.
     * Aggressive: 90-95% — compress to outcome + key decisions only.
     * Emergency: over 95% — critical facts only, and warn the parent supervisor.
   - Show both a per-node gauge and an aggregate mission-wide gauge.

6. DOOM LOOP GUARD
   - Fingerprint the last 3 outputs per node (a simple hash is sufficient).
   - On a first detected repeat: warn and inject a corrective directive into that specific
     node only.
   - On a second repeat: escalate — interrupt that node and raise a human-review banner at
     the level of its parent, without touching unrelated branches of the tree.

7. DUAL MEMORY SYSTEM
   - Episodic tab: this session's full mission log, including the complete agent tree per
     mission, not just the final answer.
   - Semantic tab: cross-session distilled lessons, auto-generated by Gemini after each
     mission completes, stored as structured entries (trigger / context / action / outcome /
     confidence), and actually retrieved to prime future missions — not just displayed.

8. INDEPENDENT SAFETY LAYER STRIP
   - 5 separately-evaluated checks per mission, each capable of failing without disabling the
     others: (1) input validation — schema validation and injection detection; (2)
     classification/sensitivity guard — pre-output classification check; (3) tool-execution
     sandboxing — rate-limited, isolated execution per node; (4) output review — an
     LLM-as-judge pass before delivery; (5) audit logging — full action log plus anomaly
     alerting.

9. COST/COMPLEXITY ROUTER
   - Score each node's task complexity at spawn time.
   - Route to a labeled tier — fast/lightweight, balanced, or deep-reasoning — with the
     rationale for that assignment visibly shown next to the node.

10. MISSION HISTORY & SEARCH
    - Full-text searchable, sortable archive of past missions, including their full agent
      trees.
    - Export any mission as JSON or Markdown.

11. DELEGATION DEPTH CONTROL
    - A user-facing max-depth slider (default 3, per the Core Concept).
    - A per-mission override of that default, separate from the global setting.

UX BAR
This must feel ahead of its time: a command palette (Cmd/Ctrl+K), full keyboard navigation,
dark-mode-first with strong contrast, jank-free real-time streaming, and thoughtful empty,
loading, and error states throughout — zero dead ends. A first-time user should understand
what to do within seconds; a frequent user should feel the app sharpening around their
habits through the Adaptive Personalization Layer.

Ship this as one coherent, production-quality build — no stripped-down or illustrative
version of any feature above, including the recursive delegation and reporting chain, the
agent tree view, and the adaptive personalization layer.
```

---

## Build Spec Outline (for reference — mirrors the prompt above)

1. Core Concept — Recursive Supervisor Architecture
   1.1 Root Supervisor
       1.1.1 Mission intake (natural-language parsing, sector auto-tagging)
       1.1.2 Topology classification (Centralized / Decentralized / Hybrid / Independent)
       1.1.3 Initial delegation (subtask decomposition, child instantiation, ≤4 children)
   1.2 Recursive Delegation Rule
       1.2.1 Fan-out cap (≤4 per node, every level; overflow merges into fewer children)
       1.2.2 Depth cap (default 3, user-adjustable, hard stop at max)
       1.2.3 Recursion trigger condition (recurse only if decomposable; otherwise leaf)
       1.2.4 Reporting chain (child → immediate parent only; parent blocks on all children)
   1.3 Synthesis Rollup
       1.3.1 Per-node synthesis (merge + resolve conflicting child outputs)
       1.3.2 Root final synthesis (from children's summaries, with full traceability)

2. Mission Console
   2.1 Input & Autocomplete (natural-language field; history-based, recency+frequency+learned)
   2.2 Execution Flow (topology classification; recursive delegation trigger; live streaming
       with per-node status badges and token-level render)
   2.3 Output (rolled-up synthesis; fact-to-leaf-agent traceability with inline citations)

3. Recursive Agent Tree View
   3.1 Tree Rendering (real-time placement under true parent; animated spawn/complete/collapse)
   3.2 Node Inspection (inputs & reasoning; synthesized child reports; depth/fan-out indicator)

4. Adaptive Personalization Layer
   4.1 Learning Signals (sector, topology, delegation-depth, phrasing patterns)
   4.2 Adaptation Log (inspect; correct; reset — full or per-signal)

5. Sector Routing
   5.1 18-Sector Taxonomy
   5.2 Auto-Suggestion Engine (text-based inference; primary vs. secondary sector tagging)

6. Adaptive Context Compaction (ACC) Meter
   6.1 Tier Definitions (None <70% / Light 70-80% / Medium 80-90% / Aggressive 90-95% /
       Emergency >95%, each with its trigger condition and functional effect)
   6.2 Functional Enforcement (per-node history truncation; per-node and aggregate gauges)

7. Doom Loop Guard
   7.1 Fingerprinting (per-node output hashing; 3-output repeat window)
   7.2 Intervention (node-level interrupt; corrective directive injection; warn then escalate)

8. Dual Memory System
   8.1 Episodic Memory (session mission log; full agent-tree capture)
   8.2 Semantic Memory (cross-session lesson distillation; structured entries; mission priming)

9. Independent Safety Layer Strip
   9.1 Layer 1 — Input Validation (schema validation; injection detection)
   9.2 Layer 2 — Classification/Sensitivity Guard
   9.3 Layer 3 — Tool-Execution Sandboxing (rate limiting; isolated per-node execution)
   9.4 Layer 4 — Output Review (LLM-as-judge pass)
   9.5 Layer 5 — Audit Logging (full action log; anomaly alerting)

10. Cost/Complexity Router
    10.1 Complexity Scoring (per node, at spawn time)
    10.2 Tier Assignment (fast/lightweight; balanced; deep-reasoning)
    10.3 Visible Rationale

11. Mission History & Search
    11.1 Archive (full-text search; sortable fields)
    11.2 Export (JSON; Markdown)

12. UX Bar
    12.1 Navigation & Speed (command palette; full keyboard navigation)
    12.2 Visual Polish (dark-mode-first, high contrast; jank-free streaming)
    12.3 State Handling (empty; loading; error)
    12.4 Delegation Depth Control (user-facing slider; per-mission override)

---

*ATLANTIS AI — civilian first, government second, business third. Production build, not a demo.*

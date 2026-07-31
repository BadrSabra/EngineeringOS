---
name: Gap analysis fixes batch-2
description: Second batch of implementation gaps fixed from the request-lifecycle trace analysis.
---

## G-11 — Context cache (context-builder.ts)
Added a module-level 30-second TTL cache (`contextCache: Map<projectId, { data, expiresAt }>`).
Every `buildProjectContext` call checks the cache first; a cache hit skips all 7 DB queries.
`invalidateContextCache(projectId)` evicts immediately — exported from the package index.
Called from `routes/ai.ts` apply-changes endpoint after files are written so the next chat turn sees the new disk state.
**Why:** 7 parallel DB queries fired on every single chat message with no caching; a 30-second TTL covers the entire lifespan of a typical back-and-forth exchange.

## G-08 — Workflow metrics gate (workflow-orchestrator.ts → orchestrateWorkflow)
After `decide()`, before `validateDecision()`: if `projectContext.latestMetrics` contains the `"⚠ WARNING:"` unverified-metrics marker AND the proposed action is "advance" or "complete", the decision is blocked and a "wait" is returned with a `blockers` entry explaining the gate.
**Why:** The prompt instruction "emit 'wait' if metrics are N/A" was text-only; the model could ignore it and advance a workflow on placeholder data.

## G-10 — Silent workflow decision downgrade (workflow-orchestrator.ts → orchestrateWorkflow)
After `validateDecision()`, if the returned `action` differs from the proposed `action`, a structured `DECISION_DOWNGRADED` warning is logged (with `originalAction`, `downgradedTo`, `reason`, and `nextPhase`).
**Why:** Previously the downgrade was silent — the event log showed "wait" with no indication that the AI had tried to advance. Now the server log distinguishes "AI chose wait" from "AI tried to advance but was rejected."

## G-18 — Single-shot agent retries (task-agent.ts, scan-analyst.ts, code-reviewer.ts)
All three agents now catch `GroqClientError` with code `NON_200` or `TIMEOUT` and retry once with the same model and messages.
Import needed: `import { GroqClientError } from "../errors.js"` (not from groq-client.js).
**Why:** A transient 429 or network blip previously went straight to boilerplate fallback output with no retry attempt, unlike the chat agent which already had this pattern.

## Pre-existing Tasks.tsx type errors (also fixed in batch-1)
`setFilterStatus` / `setFilterPriority` select `onChange` handlers cast `e.target.value as TaskStatusFilter | ''` and `TaskPriorityFilter | ''`.

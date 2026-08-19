# AI Orchestrator — Request Lifecycle Gap Analysis

**Method**: Execution-trace, not file-by-file. Each finding is tied to an actual code path.  
**Date**: 2026-07-18  
**Scope**: 9 lifecycle stages from HTTP entry point to dashboard state refresh.

---

## Gap Matrix

| # | Trace | File | Function / Line | Current State | Gap | Severity |
|---|-------|------|-----------------|---------------|-----|----------|
| G-01 | Context → Tasks | `context-builder.ts` | `buildProjectContext` | Fetches top-50 tasks by `updatedAt DESC`, then re-sorts in-memory by priority and slices to 10 | **Re-sort happens after LIMIT**: high-priority tasks with older `updatedAt` are cut before the sort, so the AI may never see critical P0 tasks if they haven't been touched recently | **High** |
| G-02 | Apply → Events | `routes/ai.ts` | `POST /ai/chat/apply-changes` | Writes audit log (`ai_executed`) after writing files | **No `eventsTable` entry** is created for apply. Unlike AI analysis/review (which emit events the AI can read via context), a write is invisible to the event log — the AI cannot learn it happened | **High** |
| G-03 | Push → Graph | `routes/git.ts` | `POST /git/push` | Records audit log; returns 200 | **No discovery/scan is triggered after push**. The graph, metrics, and AI context all remain pre-push until the user manually runs a scan. The AI will answer questions about code that no longer reflects what is on the remote | **High** |
| G-04 | Apply ↔ Chat race | `routes/ai.ts` + `AiChat.tsx` | `applyChanges` / `sendMessage` | Apply writes files; chat builds context at start of next request | **No server-side lock during apply**. User can submit a new message while apply is still writing files. `buildProjectContext` will read DB state (old) while disk state is partially new — AI may see an inconsistent mix of old context and new file content if `read_file` tools are called | **High** |
| G-05 | Apply → Dashboard refresh | `AiChat.tsx` | `applyMutation.onSuccess` | Removes applied paths from `pendingChanges` state | **No query invalidation** after apply. Git-status, file-tree, and graph queries in the dashboard are not refreshed — the panel shows stale state (e.g., no "M" dirty marker in git-status) until the user manually navigates away | **High** |
| G-06 | Apply → localStorage ghost | `AiChat.tsx` | `pendingChanges` (localStorage) | Changes persisted to `localStorage` keyed by `sessionId`; removed in `onSuccess` | **If the client crashes or closes between server write and `onSuccess`**, changes remain in `localStorage` forever as phantom pending items. On reload the user sees "pending" changes that are already on disk — applying them again overwrites with the same content silently | **High** |
| G-07 | Workflow → Phase name | `workflow-orchestrator.ts` | `validateDecision` | Rejects advance to out-of-order or non-existent phase index | **`nextPhase` string from the model is not validated against actual phase names** in the DB record before the "advance" transition. The model can hallucinate a phase name that looks valid but doesn't match the stored value; this passes `validateDecision` (which checks index order) but stores a mismatched string | **Medium** |
| G-08 | Workflow → Metrics gate | `workflow-orchestrator.ts` + `workflow.prompt.ts` | `validateDecision` | Prompt says "emit 'wait' if metrics are N/A"; `validateDecision` checks phase ordering | **No code enforces the metrics-N/A gate**. If metrics are stale/placeholder (which `buildProjectContext` marks explicitly), `validateDecision` still allows "advance". The orchestrator can advance a workflow on zero real data | **Medium** |
| G-09 | Agent → Silent data loss | `chat-agent.ts` | Line ~361 (`ChatOutputSchema`) | `pendingChanges` parsed from model output | **On Zod validation failure, `pendingChanges` are silently dropped** (replaced with `[]`). The model's file-write intent is lost without any log entry or user-visible indication. The chat response says "I made changes" but no changes are queued | **Medium** |
| G-10 | Agent → Silent decision downgrade | `workflow-orchestrator.ts` | `validateDecision` | Invalid decisions fall back to `{ action: "wait" }` | **Downgrade is silent**: no log entry, no user notification, no event. The workflow "waits" forever and the user has no signal that the AI's decision was rejected — they see "workflow is waiting" with no explanation | **Medium** |
| G-11 | Context → No cache | `context-builder.ts` | `buildProjectContext` | Called fresh on every request | **7 parallel DB queries per message with no caching**. Under any moderate conversation load these queries repeat verbatim. First-order effect is latency; second-order effect is read-query contention during scan writes | **Medium** |
| G-12 | Context → Non-transactional reads | `context-builder.ts` | `Promise.all([...7 queries...])` | Queries run in parallel, no transaction wrapper | **A scan can finish between two of the parallel queries**: `latestScanJob` can report "completed" while `metricsTable` still holds the pre-scan row (written last). Context can carry inconsistent scan status + pre-scan metrics simultaneously | **Medium** |
| G-13 | Tool dispatch → String prefix | `chat-agent.ts` | Tool dispatch loop | Dispatches to `executeGitTool` if function name starts with `"git_"`, else `executeFileTool` | **Fragile prefix match**. If a future tool has `git_` in its name but is not a git tool (or vice versa), it silently routes to the wrong executor with no type error. No central registry to enforce the contract | **Medium** |
| G-14 | Events → Apply / Commit / Push | `routes/ai.ts`, `routes/git.ts` | `applyChanges`, `commitChanges`, `pushChanges` | Audit log written; no `eventsTable` entry | **No high-level events** are emitted for any of the three write operations. AI analysis and review create `eventsTable` rows that appear in the dashboard activity feed and in the AI context's `recentEvents`. Apply/commit/push are invisible to both | **Medium** |
| G-15 | Prompt → Generated-files rule | `chat.prompt.ts` | Rule: "never edit auto-generated files" | Prompt instruction only | **No code enforcement**. There is no generated-file list checked in `safePath` or `write_file`. If the AI ignores the instruction (e.g., under tool-call pressure), it will happily queue changes to generated files. The next codegen run silently overwrites them | **Medium** |
| G-16 | Entry → rootPath fallback | `routes/ai.ts` | `POST /ai/chat` | Falls back to `WORKSPACE_PATH` env var if `project.rootPath` doesn't exist on disk | **Silent wrong-directory fallback**. If the stored `rootPath` is stale (moved project, deleted directory), the AI silently operates on the workspace root instead of surfacing a clear "project not found on disk" error | **Low** |
| G-17 | Context → Same shape for all agents | `context-builder.ts` | `buildProjectContext` | Returns identical `ProjectContext` to all 5 agents | **No context tailoring**. The task agent receives full graph entities it never uses; the scan analyst receives workflow state it doesn't need. Wasted token budget and potential context pollution from irrelevant data | **Low** |
| G-18 | Agent → Single-shot, no retry | `task-agent.ts`, `scan-analyst.ts`, `code-reviewer.ts` | All three | Single model call; fallback on any error | **Only chat-agent has retries** (NON_200 → MODEL_POWERFUL, parse failure → JSON correction). The other three agents fall straight to generic fallbacks on any failure. A transient 429 or network blip silently produces boilerplate output instead of retrying | **Low** |
| G-19 | Dashboard → Multi-tab state | `AiChat.tsx` | `applyMutation.onSuccess` | Removes paths from local React state | **Apply success is not broadcast**. A second browser tab for the same session still shows the old `pendingChanges` from `localStorage`. There is no WebSocket/SSE event or query invalidation that would sync across tabs | **Low** |

---

## Stage-by-Stage Narrative

### Stage 1 — Entry Point (`routes/ai.ts`)

Auth is solid: all endpoints do either `loadProjectByIdForUser` (ownership) or `requireProjectAccess` (middleware). There is no endpoint that accepts a `projectId` and skips the check.

One subtle issue: `/ai/chat` falls back to `WORKSPACE_PATH` if `rootPath` is missing on disk (G-16). Every other agent endpoint trusts whatever `rootPath` is stored without a disk existence check — this is inconsistent.

Session handling: `/ai/chat` generates a UUID if none is provided but does not verify the session exists in the DB. New and existing sessions go through the same path; orphan session IDs from a previous run are silently adopted.

---

### Stage 2 — Context Builder (`context-builder.ts`)

The context is a flat, 7-query snapshot with no cache and no transaction (G-11, G-12).

The most impactful data-quality issue is the tasks query (G-01): the DB `ORDER BY updatedAt DESC LIMIT 50` runs first, then in-memory priority re-sort, then slice to top 10. A P0 task created two weeks ago that hasn't been updated since will be ranked below 50 recently-touched P3 tasks and will be invisible to the AI.

Graph entities: `confidence DESC LIMIT 60`, then grouped with a 20-per-type, 50-total cap. No timestamp filter — if the last scan was 30 days ago the AI still gets that data with no staleness signal attached.

---

### Stage 3 — Prompts vs Code Enforcement

| Rule | Enforced? | Where |
|------|-----------|-------|
| No `write_file` without exact path | ✅ Yes | `safePath` + null-byte/traversal check in `file-tools.ts` |
| No editing generated files | ❌ No | Prompt only — no generated-file list in code (G-15) |
| No VCS writes | ✅ Yes | `commit`/`push` omitted from tool definitions entirely |
| `nextPhase` must be verbatim | ❌ No | `validateDecision` checks index order, not string equality (G-07) |
| `wait` if metrics N/A | ❌ No | No code checks `placeholder` metrics before allowing advance (G-08) |
| Confidence "low" if context missing | ✅ Yes | Task agent fallback forces `needsHumanReview: true` |
| Score 0 if graph empty | ✅ Yes | Review agent checks graph entity count |

---

### Stage 4 — Agent Execution

All agents: **Input → Prompt → Model → `extractJson` repair → Zod parse → fallback → output**.

`extractJson` handles code-fence stripping and finding the outermost `{}`/`[]` brackets. It cannot fix structural problems (missing required fields, wrong types) — those always fall to Zod fallback.

Only chat-agent retries (G-18). On any transient Groq error, task/scan/review agents immediately return boilerplate.

Silent data loss paths:
- `pendingChanges` dropped on `ChatOutputSchema` failure (G-09)
- Workflow decision downgraded to "wait" without logging (G-10)
- Scan insights replaced with `[]` on parse failure
- Review verdict replaced with `needs_changes` / score 70 on parse failure

---

### Stage 5 — Tool Runtime

Positive findings: iteration cap (6), execution cap (10), deduplication cache, 10 s timeout per tool, error returned as `role: "tool"` message for model self-correction, `write_file` queues only (no disk write without approval).

Gap: dispatch by string prefix (G-13). The `chat-agent` loop checks `if (name.startsWith("git_"))` to route. No registry enforces this invariant; a naming collision is a silent misbehavior, not a compile error.

No atomicity across multiple `write_file` calls within one tool session: if the user approves "apply all" and the second file fails, the first is already on disk. This is the scenario fixed in PR-04 (partial apply state), but the root cause — no transactional write — remains.

---

### Stage 6 — Parsing & Validation

`parseAgentResponse` never throws; callers always get *something*. This is intentional for stability but means no caller can distinguish "model gave a great answer" from "model response was garbage and we used the fallback."

There is no logging of the raw model output when parsing fails — the original response is discarded. This makes debugging AI misbehavior very hard in production.

---

### Stage 7 — Apply Changes

After `write_file` succeeds:
- Audit log written ✅
- `eventsTable` entry: ❌ (G-02)
- Context cache invalidated: N/A (no cache) — next `/ai/chat` call re-reads DB fresh ✅
- Git-status / file-tree queries invalidated in dashboard: ❌ (G-05)
- Race with concurrent chat message: ❌ (G-04)
- `localStorage` ghost on crash: ❌ (G-06)

---

### Stage 8 — Full Git Cycle

```
Apply ✅ → Commit ✅ → Push ✅ → Discovery ❌ → Graph ❌ → Metrics ❌ → Context reflects new state ❌
```

After push, the chain is broken. The repository state advances but every downstream layer (discovery, graph, metrics, AI context) stays at the pre-push snapshot until the user manually triggers a scan. The AI can push code changes and then answer questions about graph structure using data that is now wrong.

No `eventsTable` rows are created for apply, commit, or push (G-14). These operations are invisible to the dashboard activity feed and to the AI's `recentEvents` context.

---

### Stage 9 — Dashboard Integration

`AiChat.tsx`:
- `pendingChanges` in `localStorage` — durable across page refreshes, but creates ghost state on crash (G-06)
- No query invalidation after apply (G-05)
- No multi-tab sync (G-19)
- No input disable during apply in progress (G-04 — user can race a new message)

`GitPanel.tsx`:
- Git-status query is invalidated after commit ✅
- Git-status is NOT invalidated after apply (different mutation)
- "Commit" section now guarded by `statusQ.isSuccess` (PR-02 fix) ✅

---

## Priority Order for Fixes

| Priority | Gap ID | Rationale |
|----------|--------|-----------|
| 1 | G-01 | Task priority query — affects AI decision quality on every request |
| 2 | G-03 | Post-push scan trigger — broken feedback loop |
| 3 | G-02 + G-14 | Missing events — apply/commit/push invisible to AI and dashboard |
| 4 | G-04 + G-05 | Apply race + no query invalidation — state correctness |
| 5 | G-06 | localStorage ghost state — user-visible data integrity |
| 6 | G-09 | Silent pendingChanges drop — write intent lost silently |
| 7 | G-07 + G-08 | Workflow validation gaps |
| 8 | G-11 | Context cache — performance |
| 9 | G-12 | Non-transactional reads — correctness under load |
| 10 | G-10 + G-15 + G-16 + G-18 | Remaining medium/low gaps |

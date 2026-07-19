# EngineeringOS — PR Backlog
> Source of truth: forensic analysis `engineeringos_forensic_analysis_complete_1784431954519.md`
> Last updated: 2026-07-19
> Closed this session before this document was written:
> - **Forensic PR-01** — 10 missing OpenAPI endpoints + codegen regenerated ✅
> - **Placeholder/debt pass** — 7 functional gaps (Tasks/Rules/Workflows/Events/GitPanel/AiChat/Graph) ✅

Ordering principle: **correctness before completeness, backend before frontend, explicit failure before silence.**

---

## PR-A — Discovery stub honesty
**Status:** 🔲 Open  
**Priority:** P1 — highest clarity-per-effort ratio  
**Risk:** Medium — currently `ARCHIVE_UPLOAD`, `REMOTE_FILESYSTEM`, `DOCKER_VOLUME` return soft "coming soon" notes in both the adapter and the `GET /api/discovery/sources` response. A caller cannot distinguish "unsupported" from "broken".

**Scope:**
- `artifacts/api-server/src/lib/discovery-adapters.ts` — stub adapters currently `throw` with "coming soon"; replace with a structured `UnsupportedAdapter` that returns a proper `501 Not Implemented` error body `{ error: "not_supported", reason: "…", hint: "…" }` rather than a JS exception
- `artifacts/api-server/src/routes/discovery.ts` — the `POST /projects/discover` handler must catch the unsupported-adapter case and return `501` with a user-readable message, not crash
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — the three unsupported source types already render correctly as `available: false`; add a tooltip/note so the user knows *why* they're disabled ("requires server-side file access — not supported in this deployment")
- Replace the Replit-specific example path `/home/runner/workspace/my-project` in the wizard's LOCAL_FOLDER input with a portable hint (`/path/to/your/project`)

**Acceptance:**
- `GET /api/discovery/sources` — the three unsupported types have `available: false` + a human-readable `notes` field
- `POST /projects/discover` with an unsupported source type returns HTTP 501, never 500
- No JS exception propagates to the generic error handler for a known-unsupported source type
- Wizard UI shows a tooltip explaining *why* the option is disabled

**Depends on:** nothing  

---

## PR-B — Write-path event emission consistency
**Status:** 🔲 Open  
**Priority:** P1 — audit chain completeness; without this, the Events feed is an unreliable view of system state  
**Risk:** Medium — missing events are silent gaps; over-emitting is noisy but safe

**Scope (identified in forensic §5 "Apply / commit / push"):**
- `artifacts/api-server/src/routes/git.ts` — `POST /projects/:projectId/git/commit` already emits `GitCommitCreated`; `POST /projects/:projectId/git/push` already emits `GitPushed`. Verify both also call `recordAudit` with `action: "executed"` — they do for push, confirm for commit
- `artifacts/api-server/src/routes/ai.ts` — `POST /api/ai/chat/apply-changes`: currently records audit per-file but **does not emit a single `AiChangesApplied` event** tying the apply batch together; add one event after all files are written successfully
- `artifacts/api-server/src/routes/tasks.ts` — task state transitions (`running → verifying`, `verifying → completed`, etc.) emit `TaskStatusChanged` events — verify each transition emits; add any that are missing
- `artifacts/api-server/src/routes/workflows.ts` — workflow advance/fail/retry-phase operations have events in some paths; audit all three and fill gaps

**Acceptance:**
- Every `POST /api/ai/chat/apply-changes` that succeeds produces one `AiChangesApplied` event in `eventsTable` with `projectId` + `correlationId`
- Every task state transition produces a `TaskStatusChanged` event with `before`/`after` in payload
- Every workflow `advance`/`fail-phase`/`retry-phase` produces an event
- `GET /api/events?projectId=X` shows a coherent timeline of scan → task → workflow → apply activity

**Depends on:** nothing  

---

## PR-C — AI auto-trigger on `verifying` state
**Status:** 🔲 Open  
**Priority:** P1 — the endpoint exists (`POST /api/ai/tasks/:taskId/execute`) but nothing calls it automatically  
**Risk:** Low-medium — a background fire-and-forget; the task already transitions to `verifying` correctly; adding the trigger only adds the auto-execute side-effect

**Scope:**
- `artifacts/api-server/src/routes/tasks.ts` — after any state transition that sets `status = 'verifying'` AND `task.prompt` is non-null, enqueue a call to `heavyJobQueue.enqueue(() => executeTaskWithAI(taskId))` (or an equivalent direct call)
- The AI execution path (`routes/ai.ts` → `lib/ai-orchestrator`) already exists and is tested; this is a wiring change only
- `artifacts/dashboard/src/pages/Tasks.tsx` — the "No prompt generated yet" state is already rendered; no UI change needed (the task will auto-advance)

**Acceptance:**
- A task manually moved to `verifying` with a `prompt` field triggers AI execution within the same request lifecycle (or within one job-queue cycle)
- A task in `verifying` with `prompt: null` does NOT trigger AI execution
- The task log shows an entry when auto-execution fires
- No regression in existing task manual-execute path

**Depends on:** PR-B (event emission — auto-trigger should emit a `TaskAutoTriggered` event)  

---

## PR-D — Workflow phase condition evaluation
**Status:** 🔲 Open  
**Priority:** P2 — the `phases[].condition` field exists in the DB schema and OpenAPI spec but is never evaluated; advance always moves linearly  
**Risk:** Low — purely additive; a `condition` that evaluates to false returns `409` instead of advancing; no regression on workflows without conditions

**Scope:**
- `artifacts/api-server/src/routes/workflows.ts` — `POST /:workflowId/advance`: before calling `executeDecision({ action: 'advance' })`, check `currentPhase.condition`; if the field is non-empty, evaluate it (simple: parse as a JS expression against a safe context of `{ taskStatus, qualityScore, … }`; if it throws or returns falsy, return `409 { error: "condition_not_met", condition, hint }`)
- `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts` — the AI agent already returns an `action: advance | wait | fail | complete`; wire its `wait` action to surface the condition check reason in the HTTP response
- `artifacts/dashboard/src/pages/Workflows.tsx` — the creation wizard now captures steps per phase (fixed in previous session); expose the `condition` field as an optional input per phase (one small text input: "Advance condition (optional)")

**Acceptance:**
- A workflow phase with `condition: "qualityScore >= 80"` blocks advance when the project's latest `qualityScore < 80` and returns `409` with a clear message
- A phase with no condition advances freely (existing behavior unchanged)
- Condition evaluation errors surface as `400` with the raw expression and the parse error

**Depends on:** nothing  

---

## PR-E — AI parse failure and 429 surfacing
**Status:** 🔲 Open  
**Priority:** P2 — forensic §10 risk #4: "silent fallback in parsing or decision validation"  
**Risk:** Low-medium — hardens existing code, doesn't change API shape

**Scope:**
- `lib/ai-orchestrator/src/groq-client.ts` — already has bounded retry logic; verify that `429 Too Many Requests` and `503 Service Unavailable` produce a structured error (`{ code: "rate_limited" | "provider_unavailable", retryAfter? }`) that propagates to the route, not a generic 500
- `lib/ai-orchestrator/src/parsing.ts` (or equivalent) — when schema validation fails after all retries, return a typed `ParseFailure` result with the raw output attached; callers must not swallow it into a generic empty response
- `artifacts/api-server/src/routes/ai.ts` — map `ParseFailure` → `422 { error: "model_output_invalid", raw: "…" }` so the dashboard can distinguish "AI gave a bad answer" from "network error"
- `artifacts/dashboard/src/pages/AiChat.tsx` — the `describeAiError` helper already exists; extend it to handle `model_output_invalid` and `rate_limited` codes with user-readable messages ("The model returned an unexpected response — try rephrasing" / "Rate limit hit — wait a moment and try again")

**Acceptance:**
- Groq 429 → client sees `{ error: "rate_limited", retryAfter: N }` (not 500)
- Parse failure after retries exhausted → client sees `422` (not 200 with empty content)
- AiChat shows distinct toast messages for rate-limit vs. parse failure vs. network error
- No change to happy-path behavior

**Depends on:** nothing  

---

## PR-F — Plugin-runtime documentation heuristic
**Status:** 🔲 Open  
**Priority:** P2 — low-urgency but listed in both PLACEHOLDER_REGISTER and forensic §8  
**Risk:** Low  

**Scope:**
- `artifacts/api-server/src/lib/plugin-runtime.ts` line ~283 — the "documentation heuristic" computes a ratio of documentable entities to source files as a stand-in for real doc coverage. Two options (pick one):
  - **Option A (recommended):** Rename the metric in the emitted event from `documentationCoverage` to `documentationHeuristic` so consumers know it is advisory; update the event payload shape; update any dashboard display that reads this field
  - **Option B:** Leave the heuristic but add a `heuristicWarning: true` flag to the event payload and surface it in the Plugins page tooltip
- `lib/api-client-react/src/custom-fetch.ts` — the "not implemented" comment refers to request cancellation (AbortController support); replace with `// Request cancellation is not implemented — fetch does not support AbortController in this configuration` to make it unambiguous

**Acceptance:**
- No consumer reads `documentationCoverage` and treats it as actual doc-comment extraction
- `custom-fetch.ts` comment is self-documenting to a future reader

**Depends on:** nothing  

---

## PR-G — Architecture documentation
**Status:** 🔲 Open  
**Priority:** P2 — forensic §6 and completion-plan P1 both flag the absence of a single architectural deliverable  
**Risk:** None (docs only)

**Scope:**
- Create `docs/architecture.md` containing:
  - Layer map (contract → persistence → scanner → knowledge-engine → AI orchestrator → API runtime → dashboard)
  - Package dependency graph (from forensic §2, already accurate)
  - Trust boundaries (auth layer, ownership scoping, encryption boundary for credentials)
  - Key execution flows (discovery, scan, chat, task-execute, workflow-advance) as prose + sequence summaries
  - Decision log (pointers to `.agents/memory/` entries for non-obvious choices)
  - Open items section (mirrors this backlog, PR-H onward)
- Add a header to `docs/completion-plan.md` and `docs/fact-record.md` marking them as **historical phase logs** — not current truth — so readers don't confuse them with `architecture.md`
- Update `replit.md` with a pointer to `docs/architecture.md`

**Acceptance:**
- A new contributor can read `docs/architecture.md` and understand the system without reading the code
- `fact-record.md` has a banner: "Historical phase log — not a current truth baseline. See `docs/architecture.md`"

**Depends on:** PR-A through PR-F (so the architecture reflects the post-cleanup state)  

---

## PR-H — Job queue crash safety
**Status:** 🔲 Open — **decision point before implementation**  
**Priority:** P3 — in-process queue is a known risk; not blocking current functionality  
**Risk:** High implementation risk if replacing the queue; low risk if documenting behavior

**Decision:** Two paths — pick one before starting:

| Path | Effort | Outcome |
|------|--------|---------|
| **H-1: Document honestly** | Low | Add startup log + API response header noting that in-flight jobs are lost on restart; expose job count in `GET /api/healthz`; update `docs/architecture.md` with the durability caveat | 
| **H-2: Replace with pg-boss** | High | Replace `heavyJobQueue` with pg-boss backed by the existing Postgres DB; jobs survive restarts; requires schema migration + worker lifecycle management |

**Recommendation:** H-1 now, H-2 as a separate project. The reconciliation logic at startup already marks stale `running` jobs as `failed`, so the behavior is honest — it just isn't visible.

**Scope for H-1:**
- `artifacts/api-server/src/lib/job-queue.ts` — expose `getStats()` returning `{ running, queued, concurrency }`
- `artifacts/api-server/src/routes/health.ts` — include `jobQueue: getStats()` in `GET /api/healthz` response (behind auth or unrestricted, TBD)
- `artifacts/api-server/src/index.ts` — log queue stats on startup
- OpenAPI: add `jobQueue` to `HealthStatus` schema

**Acceptance (H-1):**
- `GET /api/healthz` returns `{ status: "ok", jobQueue: { running: N, queued: N, concurrency: 2 } }`
- Documented in `architecture.md` with the durability caveat

**Depends on:** PR-G (architecture.md exists to receive the durability caveat)  

---

## PR-I — SSE streaming for AI chat
**Status:** 🔲 Open — large architectural change  
**Priority:** P3 — UX improvement, not a correctness gap  
**Risk:** High — changes the HTTP contract for `/api/ai/chat`, requires OpenAPI update + codegen + client rewrite

**Scope:**
- `artifacts/api-server/src/routes/ai.ts` — convert `POST /api/ai/chat` from a single JSON response to an SSE stream; emit events: `{ type: "stage", stage: "building-context" }`, `{ type: "stage", stage: "calling-model" }`, `{ type: "token", content: "…" }`, `{ type: "done", sessionId, sources, pendingChanges }`
- `lib/api-spec/openapi.yaml` — add a new operation or replace the existing one with `text/event-stream` content type
- `lib/api-client-react` — generated client cannot consume SSE; add a handwritten hook `useAiChatStream` in `lib/api-client-react/src/` that wraps `EventSource` or `fetch` with `ReadableStream`
- `artifacts/dashboard/src/pages/AiChat.tsx` — wire the streaming hook; show a live typing indicator per token

**Acceptance:**
- User sees progressive output while the model generates
- Session/message DB writes happen at stream end (on `done` event)
- Non-streaming fallback (plain POST) still works for programmatic clients

**Depends on:** PR-E (error surfacing, so stream errors propagate cleanly)  

---

## Execution sequence

```
PR-A  ──────────────────────────────────────────────┐
PR-B  ──────────────────────────────────────────────┤
PR-D  ──────────────────────────────────────────────┤  (all independent)
PR-E  ──────────────────────────────────────────────┤
PR-F  ──────────────────────────────────────────────┘
         │
         └──► PR-C  (depends on PR-B for event emission)
                │
                └──► PR-G  (depends on A–F being closed)
                       │
                       └──► PR-H  (depends on PR-G for architecture.md)
                              │
                              └──► PR-I  (depends on PR-E for error surfacing)
```

**Recommended sprint order:**

| Order | PR | Rationale |
|-------|----|-----------|
| 1 | PR-A | Fastest win; eliminates silent failures in a user-facing entry point |
| 2 | PR-B | Fixes audit chain before adding more writes in PR-C |
| 3 | PR-C | Auto-trigger wiring — pure backend, clear scope |
| 4 | PR-D | Completes the workflow state machine — pure backend |
| 5 | PR-E | Hardens AI before streaming work begins |
| 6 | PR-F | Trivial — housekeeping, 30-minute job |
| 7 | PR-G | Architecture doc — do after code is stable |
| 8 | PR-H | Decide path, implement H-1 or H-2 |
| 9 | PR-I | Largest scope; do last when everything else is clean |

---

## Closed (archived)

| ID | What | Closed |
|----|------|--------|
| Forensic PR-01 | 10 missing OpenAPI endpoints + codegen | 2026-07-19 |
| Debt pass | 7 functional gaps (Tasks/Rules/Workflows/Events/GitPanel/AiChat/Graph) | 2026-07-19 |
| Old PR 01 | Truth baseline sync | 2026-07-15 |
| Old PR 02 | Execution alignment inventory | 2026-07-15 |
| Old PR 05 (partial) | DiscoverProjectWizard 7 fixes | 2026-07-19 |
| Old PR 06 (partial) | AiChat error classification | 2026-07-15 |
| Old PR 09 (partial) | codegen:check + typecheck + test scripts | 2026-07-15 |

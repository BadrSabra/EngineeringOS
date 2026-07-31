# AI Orchestrator — Trace-by-Trace Analysis

> Generated: 2026-07-18  
> Methodology: full runtime trace across Prompt → Context → Model → Parse → Events → Context-refresh for every agent path.  
> Status: all divergences closed unless explicitly marked "accepted / deferred".

---

## Why this analysis exists

A gap list (bugs fixed one-by-one) reveals what is broken.  
A trace analysis reveals where the **system's stated behaviour diverges from its actual runtime behaviour** — divergences that manifest only when you follow a complete request from the HTTP entry point to the DB write that the next request reads.

The five categories of divergence this review looks for:

| Category | Question |
|----------|----------|
| **Prompt ↔ Context** | Does the context actually contain what the prompt says it does? |
| **Prompt ↔ Schema** | Does the output schema enforce what the prompt tells the model to produce? |
| **Schema ↔ Fallback** | Does a silent `.default()` or `fallback()` mask a real model failure? |
| **Runtime ↔ Events** | Does every meaningful operation emit a traceable event? |
| **Security** | Are any tool arguments accepted without bounds-checking? |

---

## Trace 1 — Chat Request (`POST /api/ai/chat`)

```
HTTP → auth → loadProject → rootPath resolve → buildProjectContext
     → chat() → [tool loop] → parseAgentResponse → pendingChanges
     → save messages → return → [client: apply-changes] → invalidateCache → events
```

### 1-A Prompt ↔ Context ✅
All six `AgentContextSchema` fields (`project`, `recentTasks`, `latestMetrics`, `graphSummary`, `recentEvents`, `workflows`) are populated by `buildProjectContext` before being passed to the prompt. The `hasTools` toggle injected into the prompt correctly reflects whether a `rootPath` was resolved. No field is ever undefined or empty — every fallback string ("No tasks yet", "Knowledge graph empty — run a scan first") satisfies the schema's `min(1)` constraint.

### 1-B Prompt ↔ Schema ✅
The prompt tells the model to produce `{"response": "...", "sources": [...]}`.  
`ChatResponseSchema` enforces exactly those fields. `pendingChanges` is appended *server-side* by `executeFileTool` — the model never writes it — so there is no Prompt/Schema divergence here.

### 1-C Schema ↔ Fallback (chat — NOTED)
`sources` defaults to `[]` when the model omits it. The prompt instructs the model to always include sources; when it doesn't, the `[]` default silently hides the omission. Acceptable: the UI treats an empty sources array as "no references cited" rather than an error.

### 1-D Tool loop — `completeRaw` ↔ tool dispatch ✅
Tool calls are dispatched by exact name match in `chat-agent.ts`. File tools and git tools are dispatched by `startsWith` prefix (`file_`, `git_`) and then by a secondary `switch`. This is fragile (G-13, accepted risk) but functional for the current tool set. No tools have overlapping prefixes.

### 1-E `git_diff` path traversal — **FIXED (D-01)**
**Before:** `args.path` was passed to `git diff HEAD -- <path>` with no bounds check.  
**After:** `path.resolve(rootPath, args.path)` is compared against `normalRoot + path.sep`; any path that escapes the project root returns an explicit error string instead of being passed to git.

### 1-F rootPath silent fallback (G-16 — accepted)
If the stored `rootPath` does not exist on disk, the route falls back to `WORKSPACE_PATH` with a `console.warn`. This is a minor UX gap (the AI operates on a different directory than intended) already documented. Emitting a DB event for the fallback would be a cleaner fix; deferred.

---

## Trace 2 — Task Execution (`POST /api/ai/tasks/:taskId/execute`)

```
HTTP → auth → loadTask → requireProjectAccess → api-key check
     → atomic claim (status → "running") → buildProjectContext
     → executeTask() → [single LLM call, NON_200 retry]
     → parseAgentResponse → update task (completed | verifying)
     → emit TaskCompleted | TaskVerifying event → return
```

### 2-A Prompt ↔ Context ✅
The task prompt receives all six context fields plus task-specific fields (`taskTitle`, `taskDescription`, `taskPrompt`, `taskPriority`, `relatedFiles`). The `relatedFiles` field is cast from `unknown` with a `?? []` guard, so an empty array is passed rather than `null`.

### 2-B Schema ↔ Fallback ✅ / (NOTED)
`needsHumanReview` defaults to `true` in `TaskRecommendationSchema`. This means a parse failure produces a task result that always routes to `"verifying"` instead of `"completed"`, which is the safe degradation path — correct behaviour.

### 2-C Agent retry — **FIXED (D-06)**
**Before:** Agent-level retry covered `NON_200 | TIMEOUT`. `TIMEOUT` is already retried 3× inside `completeRaw`, so the agent-level retry would produce up to 6 total TIMEOUT attempts.  
**After:** Agent-level retry covers `NON_200` only — the one error code the base client does **not** retry.

### 2-D Operational failure event — **FIXED (D-04)**
**Before:** A `GroqClientError` (RATE_LIMITED, AUTH_ERROR, etc.) caused `handleOrchestratorError` to return an HTTP error with no `eventsTable` write. The next AI context had no awareness of the failure.  
**After:** `handleOrchestratorError` accepts optional `{ projectId, operation }` context and fire-and-forgets an `AiOrchestratorError` event before sending the HTTP response.

---

## Trace 3 — Scan Analysis (`POST /api/ai/projects/:projectId/analyze`)

```
HTTP → auth → requireProjectAccess → api-key check
     → buildProjectContext → analyzeScan() → [NON_200 retry]
     → parseAgentResponse → emit AiScanAnalysisCompleted → return
```

### 3-A Prompt ↔ Context ✅
The scan analyst prompt receives the full six-field context. `latestMetrics` includes the `⚠ WARNING:` marker when metrics are unverified, and the prompt explicitly instructs "no insights for N/A metrics".

### 3-B Schema ↔ Fallback ✅ / (NOTED)
`insights` defaults to `[]` on parse failure. The fallback `ScanAnalysisOutput` includes a human-readable `overallAssessment` from the raw model output, so information is not entirely lost.

### 3-C Scan failure blind spot — **FIXED (D-02)**
**Before:** `runScanJob` catch block wrote `status: "failed"` to `scan_jobs` but emitted no `eventsTable` row. The AI context's `recentEvents` had no record of the failure; only the `latestMetrics` WARNING string carried a hint.  
**After:** The catch block now emits `ProjectScanFailed` (severity: error) with the first 200 chars of the error message and `correlationId: jobId`.

---

## Trace 4 — Code Review (`POST /api/ai/projects/:projectId/review`)

```
HTTP → auth → requireProjectAccess → api-key check
     → buildProjectContext → reviewCode() → [NON_200 retry]
     → parseAgentResponse → emit AiCodeReviewCompleted → return
```

### 4-A Prompt ↔ Context ✅
The review prompt receives `fileContents` (first 5 files, 1 500 chars each) in addition to the six context fields. The truncation happens in the prompt builder, not the route — no data is silently dropped at the route layer.

### 4-B Verdict ↔ Severity ✅
The route maps `result.verdict === "approved"` → `severity: "success"`, otherwise `"warning"`. The `CodeReviewResultSchema` enforces the verdict enum, so the mapping is exhaustive.

---

## Trace 5 — Workflow Orchestration (`POST /api/ai/workflows/:workflowId/orchestrate`)

```
HTTP → auth → loadWorkflow → requireProjectAccess → api-key check
     → buildProjectContext → orchestrateWorkflow()
       → decide() → [metrics gate D-02] → validateDecision() → [downgrade log G-10]
     → emit AiWorkflowOrchestration → update workflow row → return
```

### 5-A Prompt ↔ Context ✅
Workflow prompt receives `workflowName`, `phases[]`, `currentPhase`, `completedPhases`, and the full `projectContext`. The phase `condition` strings are embedded as-is.

### 5-B Condition evaluation — architectural gap (D-07 — ACCEPTED / DEFERRED)
Phase conditions like `"test coverage > 80%"` are free-text strings. The model must extract the threshold from `latestMetrics` (also a string) and perform the comparison in its head. This is inherently unreliable — the model may misparse the metric string or hallucinate the condition result. A structured condition evaluator (parse condition → extract metric field → numeric compare) would make the gate deterministic. Deferred: requires schema changes to `WorkflowPhaseSchema` and a condition-evaluator module.

### 5-C Metrics gate — **FIXED (G-08)**
The `orchestrateWorkflow` function now blocks "advance" and "complete" decisions in code when `latestMetrics` contains the `⚠ WARNING:` marker. The text instruction alone was insufficient.

### 5-D Decision downgrade visibility — **FIXED (G-10)**
A structured `DECISION_DOWNGRADED` log entry fires when `validateDecision` changes the proposed action. The `AiWorkflowOrchestration` event's message reflects the final (possibly downgraded) action.

---

## Trace 6 — Context Builder (`buildProjectContext`)

```
projectId → [30s TTL cache hit?] → db.transaction (7 queries)
          → tasks sort (DB: priority ASC, updatedAt DESC) → metrics verify
          → graph entities → events (10 most recent) → workflows → build strings → cache
```

### 6-A Cache ✅ (G-11 fixed)
30-second TTL in-process cache. `invalidateContextCache(projectId)` is called after `apply-changes` and available for any other write path to call. Cache entries store `{ data, expiresAt }` — no stale data is served past the TTL boundary.

### 6-B Task priority sort ✅ (G-01 fixed)
DB sorts `priority ASC, updatedAt DESC` then `LIMIT 10`. In-memory re-sort kept as safety net for unknown priority strings.

### 6-C Metrics consistency (G-12 — partially mitigated)
`Promise.all` over 7 queries runs without a transaction. A scan completing between the `scan_jobs` query and the `metrics` query could produce a snapshot where `scanJob.status = "completed"` but `latestMetric` is from the previous scan. The `⚠ WARNING:` marker in `latestMetrics` covers the case where the metric pre-dates the scan (keyed on whether the *scan job* is verified), partially mitigating this. Full REPEATABLE READ isolation deferred — sequential queries inside a transaction would add measurable latency to every chat request.

### 6-D Event formatting — **FIXED (D-05)**
**Before:** Events were formatted as `- [SEVERITY] YYYY-MM-DD HH:mm TYPE: Message`, dropping `taskId`, `workflowId`, and `correlationId`. The AI could see that "TaskCompleted" fired but not which task.  
**After:** Format is `- [SEVERITY] YYYY-MM-DD HH:mm TYPE: Message [task:abc12345 wf:def67890 corr:ghi00001]` — references are appended only when the field is non-null.

---

## Trace 7 — Events Lifecycle

### 7-A Event emission completeness

| Operation | Event emitted | Fixed? |
|-----------|--------------|--------|
| Task created | `TaskCreated` ✅ | — |
| Task status/priority/title changed (PATCH) | ❌ (audit only) | **D-03 fixed** |
| Task execute started | `TaskExecutionStarted` ✅ | — |
| Task completed | `TaskCompleted` ✅ | — |
| Task failed | `TaskFailed` ✅ | — |
| Task verifying | `TaskVerifying` ✅ | — |
| AI apply-changes | ❌ (audit only) | **G-02/G-14 fixed** |
| Git commit | ❌ | **G-14 fixed** |
| Git push | ❌ | **G-14 fixed** |
| Scan queued | `ProjectScanQueued` ✅ | — |
| Scan completed | `ProjectScanned` ✅ | — |
| Scan **failed** | ❌ | **D-02 fixed** |
| Scan analysis completed | `AiScanAnalysisCompleted` ✅ | — |
| Code review completed | `AiCodeReviewCompleted` ✅ | — |
| Workflow orchestration | `AiWorkflowOrchestration` ✅ | — |
| Orchestrator error (rate-limit, auth) | ❌ | **D-04 fixed** |
| Discovery runs | ❌ | Accepted — no dedicated event type defined |
| rootPath silent fallback | ❌ | Deferred |

### 7-B Events ↔ AI Context feedback loop ✅
`buildProjectContext` selects the 10 most recent events ordered by `timestamp DESC`. Every fixed event type above now appears in this window. The AI's context correctly reflects the last 10 meaningful system events, including failures that previously were invisible.

---

## Divergence Summary

| ID | Category | Severity | Status |
|----|----------|----------|--------|
| D-01 | Security — `git_diff` path traversal | High | ✅ Fixed |
| D-02 | Events — scan failure invisible | High | ✅ Fixed |
| D-03 | Events — manual task PATCH invisible | Medium | ✅ Fixed |
| D-04 | Events — orchestrator errors invisible | Medium | ✅ Fixed |
| D-05 | Context — event refs dropped | Medium | ✅ Fixed |
| D-06 | Runtime — double TIMEOUT retry | Low | ✅ Fixed |
| D-07 | Prompt — condition evaluation unstructured | Medium | ⚠️ Accepted / Deferred |

---

## Open Architectural Observations (no immediate fix)

**OA-1: Tool dispatch by string prefix (G-13)**  
`startsWith("git_")` + `startsWith("file_")` routing is fragile. A future tool named `git_file_sync` would match both. A registry map `{ [toolName]: handler }` would be safer. Low-urgency; current tool set has no name collisions.

**OA-2: Workflow condition evaluation (D-07)**  
Phase `condition` fields are free-text evaluated by the model from the `latestMetrics` string. Numeric thresholds ("coverage > 80%") are unreliable this way. A structured evaluator would require:  
1. `WorkflowPhaseSchema.condition` → `{ metric: string, op: ">"|"<"|"=", threshold: number }` union with legacy string  
2. A `evaluateCondition(condition, context)` function that extracts the metric value and runs the comparison deterministically  
3. The result passed to `orchestrateWorkflow` as a pre-evaluated `conditionsMet: boolean[]` per phase

**OA-3: Per-agent context shaping (G-17)**  
All 5 agents receive an identical `ProjectContext`. The chat agent needs all 6 fields; the workflow orchestrator needs tasks + events but not the full graph summary; the scan analyst needs metrics + graph but not tasks. Sending all agents the full context is over-broad but not harmful. Per-agent trimming would reduce prompt token count, deferred.

**OA-4: Multi-tab state (G-19)**  
`apply-changes` success is not broadcast to other tabs. A second open tab shows stale pending changes until manually refreshed. Requires SSE or WebSocket broadcast infrastructure. Deferred.

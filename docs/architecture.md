# EngineeringOS — Architecture Reference

> **This is the current truth baseline** (last verified 2026-07-19, post PR-A through PR-F).
> `docs/completion-plan.md` and `docs/fact-record.md` are historical phase logs — see those
> files' banners for context.

---

## 1. Layer Map

```
┌──────────────────────────────────────────────────────────────────┐
│  Dashboard  (artifacts/dashboard)                                 │
│  React 19 + Vite 7 + TailwindCSS 4 + wouter                      │
│  React Query hooks  ←  generated from OpenAPI spec (Orval)       │
└─────────────────────────┬────────────────────────────────────────┘
                          │ HTTP (cookie-auth, same-origin)
┌─────────────────────────▼────────────────────────────────────────┐
│  API Server  (artifacts/api-server)                               │
│  Express 5 · clerkMiddleware · requireAuth · requireProjectAccess │
│  Routes: projects · tasks · rules · workflows · events · metrics  │
│          graph · discovery · scan · plugins · ai · git            │
└──────┬──────────────┬───────────────┬───────────────┬────────────┘
       │              │               │               │
       ▼              ▼               ▼               ▼
┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────────────┐
│    DB    │  │   Scanner    │  │Knowledge │  │  AI Orchestrator  │
│ (lib/db) │  │ (lib/scanner)│  │  Engine  │  │(lib/ai-orchestr..)│
│ Drizzle  │  │ walk·rule·   │  │(lib/know.│  │ groq-client       │
│ Postgres │  │ graph·metrics│  │-engine)  │  │ chat·scan·review  │
└──────────┘  └──────────────┘  │ BFS·     │  │ task·workflow     │
                                │ centrality│  │ agents            │
                                └──────────┘  └──────────────────┘
```

**Reading order (inside-out):** DB schema → scanner → knowledge-engine → AI orchestrator → API routes → dashboard. Never introduce a UI-first dependency.

---

## 2. Package Dependency Graph

```
workspace (pnpm root)
├── lib/db                     — Drizzle schema + migrations
│   └── drizzle-orm, pg
├── lib/api-spec               — openapi.yaml (single source of truth)
│   └── generates →
│       ├── lib/api-client-react  (React Query hooks via Orval)
│       └── lib/api-zod           (Zod request/response schemas via Orval)
├── lib/scanner                — file walker, rule matcher, graph extractor, metrics
│   └── lib/db (reads schema types)
├── lib/knowledge-engine       — BFS impact/path/neighbourhood, centrality, clusters
│   └── lib/db (direct dep — not just transitive)
├── lib/ai-orchestrator        — Groq client, 5 AI agents, context builder, parsing
│   └── lib/db (for context-builder queries)
├── artifacts/api-server       — Express app, all routes, job queues
│   ├── lib/db
│   ├── lib/scanner
│   ├── lib/knowledge-engine
│   ├── lib/ai-orchestrator
│   └── lib/api-zod
└── artifacts/dashboard        — React SPA
    ├── lib/api-client-react
    └── lib/api-zod
```

**Key rule:** No `lib/*` package imports from `artifacts/*`. The arrow is one-way.

---

## 3. Trust Boundaries

### Authentication

- Every `/api/*` route (except `/api/healthz`) requires a valid Clerk session.
- `clerkMiddleware()` is mounted globally in `app.ts`; `requireAuth` is applied per-router.
- In `NODE_ENV=test`, `requireAuth` is bypassed (see `.agents/memory/clerk-auth-testing.md`).
- The dashboard uses session cookies (same-origin); no Bearer tokens on the web client.

### Authorization (ownership scoping)

- Every project has a single `ownerId` (Clerk user ID). No teams, no roles.
- `requireProjectAccess` middleware: 404 if project not found, 403 if owned by another user.
- `loadProjectByIdForUser()` is used in routes where `projectId` comes from request body/query (not path params).
- All routes — tasks, rules, workflows, events, metrics, graph, AI, discovery — enforce ownership. See `.agents/memory/project-ownership-scoping.md`.

### Credential encryption

- User-supplied Groq API keys are encrypted at rest in the `ai_provider_credentials` table.
- The encryption key is derived from `SESSION_SECRET` (env secret, never committed).
- Keys are never logged; decryption errors are logged without the ciphertext.

### Rate limiting

- Per-project LLM rate limit (configurable, default 10 req/min) enforced in `ai.ts` before any Groq call.
- Rate limit check occurs **before** the atomic task claim so a task is never left stuck in `running` on a rate-limit rejection.

---

## 4. Key Execution Flows

### 4a. Project Discovery

```
Client POST /api/projects/discover
  → SourceAdapter.resolve(sourceType, sourceConfig)
       LOCAL_FOLDER   → validate rootPath (realpath, no symlink escape)
       GIT_REPOSITORY → git clone --depth 1 to /tmp/eos-git-<uuid>/
       others         → 501 (stub-honest — see PR-A)
  → DB: insert discovery_session (status=discovering)
  → heavyJobQueue.enqueue(discoveryRunner)
       discoveryRunner: walks rootPath, extracts graph+metrics, inserts project row
       atomic claim: UPDATE discovery_sessions SET status=claimed WHERE status=pending
  → job-reconciliation on startup: queued→re-enqueue, running→fail, pending→re-enqueue
```

See `.agents/memory/discovery-feature.md`, `.agents/memory/discovery-multi-source.md`, `.agents/memory/pr01-job-durability.md`.

### 4b. Scan

```
Client POST /api/projects/:projectId/scan
  → requireProjectAccess
  → DB: insert scan_job (status=queued)
  → heavyJobQueue.enqueue(scanRunner)
       scanRunner:
         walk project rootPath
         run rule-matcher → rule violations
         graph-extractor (TS compiler API + Python AST + regex fallback)
         metrics-calc → quality scores
         knowledge-engine import (entities + relationships)
         DB: update metrics, insert events
  → job-reconciliation on restart: interrupted→failed
  → post-scan: triggers AI auto-trigger if project in "verifying" state (PR-C)
```

See `.agents/memory/scanner-ast-extraction.md`.

### 4c. AI Chat

```
Client POST /api/ai/chat  { projectId, message, sessionId? }
  → requireAuth + loadProjectByIdForUser
  → requireGroqApiKey (DB lookup → env fallback → 428 if missing)
  → checkProjectRateLimit → 429 if exceeded
  → buildProjectContext(projectId)  ← cached 5 min; invalidated on any context-table write
  → chat({ message, history, projectContext, rootPath, apiKey })
       GroqClient.complete() with tool definitions (read/list/search/write)
       agentic loop (max 6 tool iterations)
       parseAgentResponse → AgentParseResult
       if !ok → return ChatResult with _parseError
  → if result._parseError → 422 { error: "model_output_invalid", raw, parseCode }
  → if GroqClientError → handleOrchestratorError → 429/401/502/503
  → DB: upsert session, insert user+assistant messages
  → 200 { response, sources, pendingChanges, sessionId }
```

See `.agents/memory/ai-orchestrator-layer.md`, `.agents/memory/ai-tool-calling.md`.

### 4d. Task AI Execute

```
Client POST /api/ai/tasks/:taskId/execute
  → requireGroqApiKey (before claim — if missing → 428, task never claimed)
  → checkProjectRateLimit (before claim — if exceeded → 429, task never claimed)
  → atomic claim: UPDATE tasks SET status=running WHERE id=? AND status=?
       if 0 rows → 409 (concurrent claim)
  → executeTask({ ... })
       GroqClient.complete()
       parseAgentResponse → if !ok → return TaskAgentResult with _parseError
  → if result._parseError → rollback claim → taskLog(error) → 422
  → if GroqClientError → rollback claim → taskLog(error) → handleOrchestratorError
  → DB: update task status (completed|verifying), insert taskLog + event + audit
  → 202 { updated task }
```

See `.agents/memory/fk-atomic-claim-ordering.md`.

### 4e. Workflow Phase Advance

```
Client POST /api/ai/workflows/:workflowId/orchestrate
  → loadProjectByIdForUser (via workflow.projectId)
  → parseWorkflowPhases (validate + catch duplicate names)
  → _orchestratingWorkflows.has(workflowId) → 409 if concurrent
  → orchestrateWorkflow({ phases, currentPhase, projectContext, apiKey })
       decide() → Groq → parseAgentResponse → WorkflowDecisionResult (± _parseError)
       metricsGate: block advance/complete if metrics unverified
       validateDecision: enforce linear ordering; downgrade illegal decisions to "wait"
  → if decision._parseError → 422
  → executeDecision (pure — callers persist)
  → DB: update workflow/execution state, insert event + audit
  → 200 { decision }

Client POST /api/workflows/:workflowId/executions/:execId/advance
  → PRE-condition evaluation: Function() sandbox with { qualityScore, currentPhase, completedPhases }
  → DB: update phase, insert event
  → 200
```

See `.agents/memory/pr-d-workflow-conditions.md`.

---

## 5. Decision Log

These entries capture non-obvious tradeoffs. The `.agents/memory/` files hold the full context.

| Decision | File | Why |
|---|---|---|
| Deferred FK + atomic claim ordering | `fk-atomic-claim-ordering.md` | Real FK on claim column breaks pre-tx optimistic patterns |
| Parse-failure surfaced as 422, not silent 200 | (PR-E, this backlog) | Callers must distinguish "bad model output" from "network error" |
| Context cache: TTL is perf, not correctness | `context-cache-invalidation-rule.md` | Any DB write to context tables must bust the cache immediately |
| Drizzle error wrapping: `.cause` not `err` | `drizzle-error-wrapping.md` | Raw pg error is on `err.cause` with node-postgres driver |
| `git-diff` vs `git-status` for drift check | `testing-drift-checks.md` | `git-status --porcelain` is reliable; `git-diff` has edge cases |
| BFS direct dep on lib/db | `knowledge-engine.md` | drizzle-orm must be direct dep in knowledge-engine — not just transitive |
| Orval $ref for non-empty request bodies | `orval-openapi-codegen.md` | Inline schemas collide with generated zod-type exports |
| requireAuth bypass on NODE_ENV=test | `clerk-auth-testing.md` | Lets supertest integration tests run without mocking Clerk tokens |
| Rate limit + key check before atomic claim | (PR-E, routes/ai.ts) | Task never stuck in "running" on a 428/429 rejection |
| SourceAdapter URL whitelist (https only) | `pr04-discovery-hardening.md` | Prevent SSRF via git clone of internal URLs |

---

## 6. AI Orchestrator Agents

| Agent | Route | Output schema | Parse-failure behavior |
|---|---|---|---|
| `chat` | `POST /api/ai/chat` | `ChatResponseSchema` | `_parseError` → 422 |
| `analyzeScan` | `POST /api/ai/projects/:id/analyze` | `ScanSummarySchema` | `_parseError` → 422 |
| `reviewCode` | `POST /api/ai/projects/:id/review` | `CodeReviewResultSchema` | `_parseError` → 422 |
| `orchestrateWorkflow` | `POST /api/ai/workflows/:id/orchestrate` | `WorkflowDecisionSchema` | `_parseError` → 422 |
| `executeTask` | `POST /api/ai/tasks/:id/execute` | `TaskRecommendationSchema` | `_parseError` → rollback claim → 422 |

All agents: GroqClientError codes → `handleOrchestratorError` → 429/401/502/503.

---

## 7. Job Queue

`heavyJobQueue` is a process-local, bounded-concurrency queue (max 2 concurrent slots).

- **Not** Redis/BullMQ — process-local only. A multi-instance deployment would need a distributed queue.
- On server startup, `lib/job-reconciliation.ts` audits the DB and resolves stale job states:
  - `queued` → re-enqueue
  - `running` → mark failed (process died mid-run)
  - `pending` → re-enqueue (for discovery sessions)
  - `discovering` → mark error
- Scan jobs and discovery sessions both use this queue.

### PR-H (H-1): Durability caveat

> ⚠️ **Jobs in flight are lost on process restart.** The queue is in-process only — a crash, deploy, or SIGKILL drops any `running` or `queued` closures. The reconciliation layer at startup marks their DB rows as `failed`, so callers can detect and re-submit them. This behavior is honest and observable:
> - `GET /api/healthz` returns `{ status: "ok", jobQueue: { running: N, queued: N, concurrency: 2 } }` so operators can see current queue depth.
> - Startup logs emit `jobQueue` stats so a clean boot (running=0, queued=0) is distinguishable from a crash-restart where reconciliation may have re-enqueued jobs.
>
> A future H-2 migration to pg-boss (backed by the existing Postgres DB) would make jobs durable across restarts. That is a separate project from the current H-1 observability baseline.

---

## 8. Database Schema (key tables)

| Table | Purpose |
|---|---|
| `projects` | Root entity; `ownerId` scopes all child data |
| `tasks` | Work items; `status` FSM (pending→queued→running→completed\|verifying\|failed) |
| `rules` | Code quality rules; `projectId=NULL` means global |
| `workflows` + `workflow_executions` | Multi-phase workflow definitions and run state |
| `scan_jobs` | Background scan job tracking |
| `discovery_sessions` | Background discovery job tracking |
| `graph_entities` + `graph_relationships` | Knowledge graph (populated by scanner) |
| `metrics` | Time-series quality scores per project |
| `events` | Append-only event log (all operations emit here) |
| `audit_logs` | Structured before/after audit trail |
| `ai_chat_sessions` + `ai_chat_messages` | AI conversation history |
| `ai_provider_credentials` | Encrypted Groq API keys |
| `task_logs` | Per-task execution logs (correlationId links to events) |
| `plugin_events` | Events emitted by the plugin runtime |

---

## 9. Closed PRs Summary

All PRs A–I are closed.

| PR | Title | Status |
|---|---|---|
| PR-A | Discovery atomic-claim + rootPath hard-fail | ✅ Closed |
| PR-B | Audit log completeness | ✅ Closed |
| PR-C | AI auto-trigger on task queue | ✅ Closed |
| PR-D | Workflow condition evaluation | ✅ Closed |
| PR-E | AI parse failure + 429 surfacing | ✅ Closed |
| PR-F | Plugin-runtime doc heuristic + custom-fetch comment | ✅ Closed |
| PR-G | Architecture documentation (this file) | ✅ Closed |
| PR-H | Job queue crash safety — H-1 observability baseline (see §7) | ✅ Closed |
| PR-I | SSE streaming for AI chat (see §5 and below) | ✅ Closed |

### PR-I: SSE streaming for AI chat

`POST /api/ai/chat/stream` emits `text/event-stream` events:

| Event | Shape | When |
|---|---|---|
| `stage` | `{ type, stage: "building-context" \| "calling-model" }` | Before each phase |
| `done` | `{ type, sessionId, message, sources, pendingChanges }` | On success, after DB writes |
| `error` | `{ type, code, message, hint?, raw?, parseCode? }` | On any failure |

- The original `POST /api/ai/chat` (JSON response) remains available as a non-streaming fallback.
- SSE is consumed via the handwritten `useAiChatStream` hook in `@workspace/api-client-react/src/use-ai-chat-stream.ts` — Orval cannot generate SSE hooks.
- DB writes (session + messages) happen on the success path before the `done` event; the client does not need to poll for the saved message.
- The `AiChat.tsx` dashboard page uses `useAiChatStream` and shows real server-side stage labels instead of a client-side timer that rotated through fake messages.

---

## 10. Codegen and Build

- **OpenAPI-first:** `lib/api-spec/openapi.yaml` is the single source of truth for all API contracts.
- After any change to `openapi.yaml`, run `pnpm run codegen` before anything else.
- `pnpm run codegen:check` (CI gate) fails if generated files are out of sync with the spec.
- The dashboard never calls raw `fetch` for API routes — it uses the generated React Query hooks.
- esbuild bundles the API server to CJS for production; Vite bundles the dashboard.

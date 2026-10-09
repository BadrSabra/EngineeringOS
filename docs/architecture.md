# EngineeringOS — Architecture Reference

> **This is the current truth baseline** (last verified 2026-09-30).
> `docs/completion-plan.md` and `docs/fact-record.md` are historical phase logs — see those
> files' banners for context.

---

## Current AI execution note (2026-08-27)

The AI layer is provider-agnostic at the route boundary. Provider selection is
driven by `lib/ai-orchestrator/src/provider-registry.ts` and
`artifacts/api-server/src/lib/ai-route-helpers.ts`, with capability checks,
priority ordering, circuit handling, and bounded fallback across the configured
providers.

The current analysis surfaces are:

- `POST /api/ai/chat` and `POST /api/ai/chat/stream`
- `POST /api/ai/projects/:projectId/analyze` and `/analyze/stream`
- `POST /api/ai/projects/:projectId/review` and `/review/stream`
- `POST /api/ai/tasks/:taskId/execute`
- `POST /api/ai/workflows/:workflowId/orchestrate`
- `GET/POST /api/ai/executions/*` for history, recovery, resume capability,
  cancellation, and redacted audit export

Context loading uses a repeatable-read database snapshot with a short-lived
cache. Streamed executions persist identity, checkpoints, evidence/proof
metadata, and terminal failures so reconnects cannot turn incomplete work into
success.

Forensic conclusions are fail-closed: complete reads with no accepted Finding
may produce `NO_VERIFIED_FINDING`; zero or partial reads, stale or
unattributed evidence, cancellation, provider exhaustion, or failed recovery
produce `ANALYSIS_INCOMPLETE`. Only server-owned evidence and validation gates
can produce a verified Finding.

## امتداد تجربة المستخدم المقترح (2026-10-09 — غير منفذ)

هذا مقترح تصميم يترجم متطلبات البدء الأول والأسئلة العامة إلى حدود معمارية؛
لا يصف routes أو جداول أو واجهات موجودة. راجع
`docs/dashboard-user-experience-review.md` للقرار وتجربة المستخدم المقترحة.

### إنشاء تطبيق من قالب

- يبقى `Discover Project` مخصصًا لاستيراد واكتشاف مصادر المشاريع. لا تُعاد
  صياغة `discovery_sessions` كعملية تهيئة قالب؛ معناها الحالي يتضمن مصدرًا
  وتقارير اكتشاف واستيراد.
- يُضاف قالب React/Vite مُراجع ومُرقّم الإصدار مع lockfile واعتماديات ثابتة.
  وصف المستخدم لا يختار اعتماديات أو أوامر shell أو ملفات تثبيت.
- يلزم سجل دائم منفصل لعملية إنشاء المشروع قبل وجود صف في `projects`، مرتبط
  بالمالك ومعرّف عملية وlease وحالة قابلة للاسترداد. يستخدم العامل
  `heavyJobQueue` ومسارات dispatch/reconciliation الحالية بدل طابور أو workflow
  موازٍ. لا يُسجل المشروع بوصفه نشطًا قبل اكتمال التهيئة والتحقق.
- تُعاد استخدام حدود الجذر المُدار وعلامة الملكية والتنظيف الآمن في
  `project-materialization.ts`؛ لا يُنشأ مسار ثانٍ لحفظ جذور المشاريع. يعمل
  تثبيت القالب ببيئة allowlist لا ترث أسرار API، مع حدود للمدة والمخرجات
  والتزامن، وبفشل صريح إذا تعذر تثبيت الاعتماديات المقفلة.
- يستخدم العرض خدمة `workspace-runtime` الحالية و`pnpm run dev`. يجب أن يحترم
  القالب `PORT` والـ host المطلوبين للمعاينة؛ لا يضاف مشغل معاينة آخر.
- يحفظ سجل التهيئة وصف المستخدم اللازم لإتمام التسليم. بعد نجاح الإنشاء يُرسل
  الوصف إلى محادثة المشروع كطلب أولي للقراءة والتخطيط، لا كتعليمات كتابة
  مباشرة. تظل موافقة الخطة ومسار البناء والتحقق الحالي هي السلطة الوحيدة
  للتعديل.

### محادثات عامة محفوظة بلا مشروع

- قرار المنتج هو حفظ سجل الأسئلة العامة بحيث يمكن فتحه لاحقًا. يُوصى بتخزين
  جلسات ورسائل عامة مملوكة للمستخدم، مع قائمة وفتح وحذف؛ والاحتفاظ بها حتى
  الحذف الصريح. لا تمتد ذاكرة هذه المحادثات إلى محادثة أخرى أو إلى مشروع.
- لا تُعدّل `ai_chat_sessions.project_id` ليصبح اختياريًا ولا تُسجل جلسة عامة
  على مشروع وهمي. المفتاح الحالي غير قابل لـ`NULL`، وواجهات المحادثة والذاكرة
  والميزانية وحد المعدل مبنية على نطاق المشروع.
- تُضاف حدود API وواجهة عامة مستقلة في النطاق، لكنها تعيد استخدام المصادقة
  واختيار المزود وسلسلة التراجع والتنقيح وقياس الاستخدام ونقل البث المشترك حيث
  يصلح. لا يُنشأ عميل مزود أو نظام بث ثانٍ.
- لا يملك المسار العام `projectId` أو `rootPath` أو أدوات مشروع. يتطلب
  المنسق الحالي `ProjectContext` صالحًا رغم اختيار سياق عام؛ لذا يلزم محوّل
  سياق عام صريح واختبار عقد يثبت أن قائمة أدوات المزود فارغة. لا تمرر سياق
  مشروع فارغًا أو بيانات مشروع اصطناعية.
- يُستخدم محدد معدل بنطاق المستخدم ضمن آلية قاعدة البيانات القائمة، لا معرّف
  مشروع مصطنع. تكون المحادثة العامة نصية وتعتمد على نص المستخدم وتاريخ الجلسة
  فقط؛ لا تنشئ مهام أو عمليات مشروع أو أدلة قبول، ولا تدّعي تحليل ملفات.
- تعني الاستمرارية حفظ سجل المحادثة المكتملة وحالات الفشل المعروضة؛ لا تعني
  استئناف تنفيذ مشروع أو استعادة بث حي بعد انقطاع. لا يُضاف وعد باستئناف عام
  قبل تحديد دورة حياة مستقلة واختبارها.

### أسئلة تحقق قبل التنفيذ

- أثبت بتثبيت عبر سجل الحزم أن القالب المقفل يعمل في بيئة المشروع؛ الاختبار
  المحلي السابق لم يثبت التثبيت الشبكي.
- اختبر الاسترداد والتنافس والتنظيف بحيث لا يستطيع عامل قديم أو طلب مكرر
  تسجيل مشروعين أو حذف جذر لا يملكه.
- اختبر أن المحادثة العامة لا تمرر جذرًا أو أدوات أو مشروعًا، وأن سجلها لا
  يُقرأ أو يُحذف من مستخدم آخر، وأن حذف الجلسة يحذف رسائلها التابعة.
- اختبر أن وصف التطبيق يذهب إلى محادثة مشروع للقراءة والتخطيط، وأن أي تعديل
  يظل خلف موافقات المشروع والتحقق الحاليين.

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
│ Drizzle  │  │ walk·rule·   │  │(lib/know.│  │ provider registry │
│ Postgres │  │ graph·metrics│  │-engine)  │  │ context/admission │
└──────────┘  └──────────────┘  │ BFS·     │  │ task·workflow     │
                                 │ centrality│  │ evidence·durable  │
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
 ├── lib/ai-orchestrator        — provider strategies, model selection, context
 │                                loading/admission, agents, tools, evidence
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

- User-supplied provider API keys are encrypted at rest in the `ai_provider_credentials` table.
- The encryption key is derived from `SESSION_SECRET` (env secret, never committed).
- Keys are never logged; decryption errors are logged without the ciphertext.

### Rate limiting

- Per-project LLM rate limit (configurable, default 20 req/min) is enforced before any provider call.
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
   → job-reconciliation on startup: queued→re-enqueue, expired running→retry/fail,
     pending→re-enqueue, expired discovering→error
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
   → job-reconciliation on restart: interrupted/expired→retry within budget or failed
  → post-scan: triggers AI auto-trigger if project in "verifying" state (PR-C)
```

See `.agents/memory/scanner-ast-extraction.md`.

### 4c. AI Chat

```
Client POST /api/ai/chat or /api/ai/chat/stream
  → requireAuth + owner-scoped project/session resolution
  → resolveTurnIntent/classification and select the required tool/evidence policy
  → requireProvider (saved provider key or supported server fallback; 428 if none)
  → checkProjectRateLimit → 429 if exceeded
  → buildProjectContext(projectId)
        context cache → requested sections in one REPEATABLE READ snapshot
        → context serialization/admission under the selected execution budget
  → chatWithFallback(...)
        provider registry/capability filtering → bounded provider fallback
        → tool policy + bounded tool loop when the request needs tools
        → parsing, evidence, objective, and terminal-outcome gates
  → sanitize provider-derived text and metadata at the user-facing boundary
  → JSON route: persist session and user/assistant messages → 200 response
  → stream route: create or reuse durable execution, persist checkpoints,
        emit structured stage/step/completion/failure events, and support
        reconnect/recovery without converting incomplete work into success
```

Stream recovery reconciles durable status/checkpoint/history; a running
execution does not currently reattach the caller to its live SSE feed or replay
missed frames. Project daily provider reservations and terminal evidence
snapshots also have different boundaries from the in-memory request ledger and
checkpoint progress; see the supplemental findings in
`docs/ai-layer-deep-analysis.md`.

See `.agents/memory/ai-orchestrator-layer.md`, `.agents/memory/ai-tool-calling.md`.

#### Provider retry and fallback ownership

Provider failures carry a bounded, server-classified rate-limit scope. A
`RATE_LIMITED` response attributed to `upstream_shared_pool` or
`provider_credential` is not retried against the same model and does not trigger
the tool loop's same-provider `powerModel` retry. The OpenRouter client remains
the owner of its bounded model chain; for these scopes it returns the failure
instead of cascading to another OpenRouter model. A caller may move to another
provider only when that caller already owns an authorized fallback candidate.

Retry decisions are deterministic and use the typed error scope; the language
model does not decide whether to retry. Unknown/model-scoped rate limits retain
their existing bounded behavior. The same scope rule applies before and during
stream startup; after stream output begins, a failure is terminal to avoid
duplicating partial output.

An `upstream_shared_pool` rate limit also cools only the exact failed model for
90 seconds in shared PostgreSQL state, in both regular and streaming requests.
Other OpenRouter models remain eligible; this is model-specific coordination,
not a pool-wide quarantine or a claim about other models' upstream routing.
`provider_credential` limits do not create a model-specific cooldown. The
provider circuit remains separate and unchanged.

#### Resume, idempotency, and attempt identity

The durable chat request stores a `turnIntent` value and bounded resume
contracts, not a full resolved `TurnIntent` or the per-invocation
`ExecutionPlan`. `ActiveTaskState` remains the owner of mutable task state and
its `ActiveTaskExecutionPlan`. On explicit resume, the stored request owns the
original messages, revision, and proof contract, while some route-derived
planning is still recomputed. The exact boundary and source-backed findings
are in the dated supplement to `docs/ai-layer-deep-analysis.md`.

The `(userId, idempotencyKey)` constraint deduplicates durable execution rows,
but the current reuse check does not compare a canonical hash of the complete
request. It must not be treated as proof that a repeated key has identical
message, intent, or objective semantics. The non-streaming chat endpoint has
no client-selected request key.

Keep `ai_executions.attempt` distinct from provider-request attempt numbers.
Provider usage telemetry currently does not include the durable attempt in its
stream attempt ID; duplicate IDs are ignored, and ordinary JSON chat telemetry
does not carry an execution ID. Provider usage remains diagnostic evidence,
not terminal acceptance.

Checkpoint read progress contains paths and statuses, not the complete source
bodies used for acceptance. Resumable evidence is restored from accepted
evidence-read rows; preserve targeted-read spans when reusing those bodies.
Likewise, project daily reservations pre-admit an outer provider candidate,
not every physical request inside its tool loop; later usage events can count
those requests when telemetry succeeds, but cannot prevent an overrun within
that candidate. Telemetry failure must not silently remove consumed work from
budget accounting. Session-list labels and historical acceptance projections
should derive from each message's durable outcome and exact attempt, not report
text or the execution's latest state.

Questions about a structured response-status badge need an explicit,
server-validated binding to the assistant message and exact execution attempt
that emitted it. Conversation history alone is not that binding: provider
history may contain only role/content and omit the structured response
provenance and acceptance. Keep such diagnostics separate from broad
project-query state inheritance; if the referenced terminal record is missing
or ambiguous, ask for clarification instead of selecting the latest execution.

### 4d. Task AI Execute

```
Client POST /api/ai/tasks/:taskId/execute
  → requireProvider (before claim — if missing → 428, task never claimed)
  → checkProjectRateLimit (before claim — if exceeded → 429, task never claimed)
  → atomic claim: UPDATE tasks SET status=running WHERE id=? AND status=?
       if 0 rows → 409 (concurrent claim)
  → executeTask({ ... })
        runAgentWithFallback() → provider strategy → parse/validate output
  → parse/provider failure → rollback or terminalize the claim safely
      → taskLog(error) → typed incomplete/error response
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
       decide() → provider strategy/fallback → parseAgentResponse
         → WorkflowDecisionResult (± _parseError)
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
| Parse-failure surfaced as 422, not silent 200 | (PR-E) | Callers must distinguish "bad model output" from "network error" |
| Context cache: TTL is perf, not correctness | `context-cache-invalidation-rule.md` | Any DB write to context tables must bust the cache immediately |
| Drizzle error wrapping: `.cause` not `err` | `drizzle-error-wrapping.md` | Raw pg error is on `err.cause` with node-postgres driver |
| `git-diff` vs `git-status` for drift check | `testing-drift-checks.md` | `git-status --porcelain` is reliable; `git-diff` has edge cases |
| BFS direct dep on lib/db | `knowledge-engine.md` | drizzle-orm must be direct dep in knowledge-engine — not just transitive |
| Orval $ref for non-empty request bodies | `orval-openapi-codegen.md` | Inline schemas collide with generated zod-type exports |
| requireAuth bypass on NODE_ENV=test | `clerk-auth-testing.md` | Lets supertest integration tests run without mocking Clerk tokens |
| Rate limit + key check before atomic claim | (PR-E, routes/ai.ts) | Task never stuck in "running" on a 428/429 rejection |
| SourceAdapter URL whitelist (https only) | `pr04-discovery-hardening.md` | Prevent SSRF via git clone of internal URLs |
| Apply/chat race lock (`_applyingProjects`) | (forensic G-04) | Chat context reads during an active file-write window see partial disk state |
| `fallbackChatOutput` salvages valid changes | (forensic G-09) | Schema-invalid model output previously silently dropped all proposed changes |
| `buildProjectContext` in REPEATABLE READ tx | (forensic G-12) | 8 independent queries could produce an internally inconsistent context on concurrent writes |
| Tool dispatch via explicit registry Sets | (forensic G-13) | `startsWith("git_")` would silently misroute any future tool whose name collided with the prefix |
| rootPath fallback not persisted to DB | (forensic G-16) | Writing `WORKSPACE_FALLBACK` permanently over stored rootPath exposes entire monorepo to AI tools |

---

## 6. AI Orchestrator Agents

| Agent | Route | Output schema | Parse-failure behavior |
|---|---|---|---|
| `chat` | `POST /api/ai/chat` | `ChatResponseSchema` | `_parseError` → 422 |
| `analyzeScan` | `POST /api/ai/projects/:id/analyze` | `ScanSummarySchema` | `_parseError` → 422 |
| `reviewCode` | `POST /api/ai/projects/:id/review` | `CodeReviewResultSchema` | `_parseError` → 422 |
| `orchestrateWorkflow` | `POST /api/ai/workflows/:id/orchestrate` | `WorkflowDecisionSchema` | `_parseError` → 422 |
| `executeTask` | `POST /api/ai/tasks/:id/execute` | `TaskRecommendationSchema` | `_parseError` → rollback claim → 422 |

All agents use provider strategies behind the registry. Normalized provider
errors are mapped by `handleOrchestratorError` to typed HTTP responses;
recoverable failures are retried across compatible configured providers before
they reach the route. The legacy `GroqClientError` name remains an internal
compatibility detail, not a provider requirement.

---

## 7. Job Queue

`heavyJobQueue` is a process-local, bounded-concurrency dispatcher (max 2
concurrent slots), not the source of truth for queued work. The durable queue
record is the existing `scan_jobs` or `discovery_sessions` row in Postgres.
This is sufficient for the target deployment because API instances share
Postgres and can rediscover work; introducing a third-party queue is not
required by the current operational boundary. If deployment requirements
change to require work execution independent of API lifetimes, the next
boundary is a durable worker/checkpoint service rather than more in-memory
queue state.

- Each API instance periodically dispatches persisted `queued` scan jobs and
  `pending` discovery sessions into its local limiter.
- PostgreSQL advisory locks plus atomic worker claims prevent duplicate work
  when multiple instances observe the same durable row.
- On server startup, `lib/job-reconciliation.ts` audits the DB and resolves abandoned job states:
  - `queued` → re-enqueue
   - expired `running` → retry within the persisted retry budget, otherwise fail
  - `pending` → re-enqueue (for discovery sessions)
   - expired `discovering` → mark error (discovery has no safe checkpoint)
   - expired AI task `running` → return to `verifying`, or fail when retries are exhausted
- Every claim, heartbeat, terminal write, and recovery transition is fenced by
  the current worker identity and status/lease predicate. A stale worker's
  completion or follow-on mutation is ignored rather than being allowed to
  overwrite a newer attempt.
- A periodic dispatcher recovers fresh queued/pending rows after a commit-to-
  dispatch crash window. A periodic stale sweep bounds expired scan,
  discovery, and AI-task leases. Recovery is logged with stable operation IDs,
  retry outcomes, and conflict skips; `/api/healthz` continues to expose the
  local queue depth and operational degradation counters without presenting
  recovered or incomplete work as success.
- Scan jobs and discovery sessions both use this queue.

### Durability boundary

> Queued work survives a process restart because its parameters and lifecycle
> state are persisted before dispatch. An in-flight scan is not checkpoint
> resumable: reconciliation requeues it within its retry budget; an interrupted
> discovery is marked as error because its intermediate filesystem state cannot
> be safely reconstructed. AI executions have a separate checkpoint/resume
> mechanism.
>
> The local queue closure itself is still lost on restart, but that closure is
> only a dispatch handle; the durable row is rediscovered at startup and by the
> periodic dispatcher. This behavior is observable:
> - `GET /api/healthz` returns `{ status: "ok", jobQueue: { running: N, queued: N, concurrency: 2 } }` so operators can see current queue depth.
> - Startup logs emit reconciliation and queue stats.
> - The durable dispatcher logs recovered work and retries temporary database
>   failures on its next interval.

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
| `ai_provider_credentials` | Encrypted per-provider API keys |
| `task_logs` | Per-task execution logs (correlationId links to events) |
| `plugin_events` | Events emitted by the plugin runtime |

---

## 9. Closed PRs Summary

All PRs A–I and forensic audit PRs 1–5 are closed.

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
| Audit PR-1 | Verification bootstrap — setup/build/test runnable from clean clone | ✅ Closed |
| Audit PR-2 | Observability hardening — audit + rate-limiter failures surfaced in `/api/healthz` via `operationalCounters`; rate-limiter fail-open upgraded from WARN to ERROR | ✅ Closed |
| Audit PR-3 | Durability upgrade — PostgreSQL advisory locks in `runScanJob` and `runDiscovery` prevent duplicate concurrent execution on multi-instance deployments | ✅ Closed |
| Audit PR-4 | Doc/code reconciliation — rate limit corrected to 20 req/min; context cache corrected to 30 s | ✅ Closed |
| Audit PR-5 | Generated-artifact drift guard — dedicated `contract-drift` CI job runs codegen:check + typecheck on every PR touching `lib/api-spec/openapi.yaml`; full validate job unchanged | ✅ Closed |

### Current streaming and durable execution

The current streaming contract is broader than the original chat-only SSE
delivery:

- Chat, scan analysis, and code review each expose structured stage/progress
  events, terminal completion, and terminal failure or incomplete outcomes.
- Chat streaming creates or resumes an `ai_executions` record keyed by the
  request's durable identity and idempotency binding. Checkpoints retain
  bounded progress, evidence/proof metadata, and failure state.
- Recovery and reconnect use persisted execution state and a server-owned
  resume token. A provider response, client reconnect, or worker lease cannot
  override cancellation, failed evidence, or an incomplete terminal state.
- Provider-derived response text, paths, IDs, and diagnostics are redacted
  before persistence or stream emission; raw diagnostics remain server-side.
- AI-generated remediation text is narrative guidance only. It cannot satisfy
  server-owned verification, acceptance, scope, revision, or evidence gates.

### Historical PR-I: original SSE delivery

The following records the original chat-stream delivery and is retained as
compatibility history. The current behavior is defined by the section above.

`POST /api/ai/chat/stream` emits `text/event-stream` events:

| Event | Shape | When |
|---|---|---|
| `stage` | `{ type, stage: "building-context" \| "calling-model" }` | Before each phase |
| `done` | `{ type, sessionId, message, sources, pendingChanges }` | On success, after DB writes |
| `error` | `{ type, code, message, hint?, parseCode? }` | On any failure; provider diagnostics are redacted |

- The original `POST /api/ai/chat` (JSON response) remains available as a non-streaming fallback.
- SSE is consumed via handwritten stream hooks — Orval cannot generate SSE hooks.
- DB writes (session + messages) happen on the success path before the `done` event; the client does not need to poll for the saved message.
- The `AiChat.tsx` dashboard page uses `useAiChatStream` and shows real server-side stage labels instead of a client-side timer that rotated through fake messages.

---

## 10. Codegen and Build

- **OpenAPI-first:** `lib/api-spec/openapi.yaml` is the single source of truth for all API contracts.
- After any change to `openapi.yaml`, run `pnpm run codegen` before anything else.
- `pnpm run codegen:check` (CI gate) fails if generated files are out of sync with the spec.
- The dashboard never calls raw `fetch` for API routes — it uses the generated React Query hooks.
- esbuild bundles the API server to CJS for production; Vite bundles the dashboard.

## 11. Autonomous readiness baseline

The current readiness decision and observed capability status are documented in
`docs/actual-capability-baseline-v1.md`; the executable gate is described
below. Historical forensic reports may provide rationale, but are not current
status references. The gate is deliberately narrower than a product-parity
assessment:

- verified completion requires objective/acceptance binding, approved scope,
  matching project and candidate revision/hash, passed required nodes,
  retained redacted evidence, and a terminal `PROVEN` verdict;
- core execution integrity and operator recovery are scored separately;
- live providers, deployment, remote push, repository freshness, graph-limit
  presentation, and exhaustive dashboard reload/reconnect behavior are
  explicitly `NOT VERIFIED`, `INCOMPLETE`, or deferred rather than passing;
- proposed or cancelled follow-up work is never treated as merged evidence.

This reference is source- and deterministic-check based. It does not claim
that the existing routes form one uninterrupted autonomous worker loop.

The executable operation gate is the server-owned
`evaluateOperationalReadiness` contract in
`artifacts/api-server/src/lib/operational-readiness-gate.ts`. It produces one
auditable decision with four states: `proven`, `incomplete`, `blocked`, and
`failed`.

- `proven` requires matching project/candidate revisions, an approved scope,
  passed required nodes, complete redacted evidence, and a terminal
  `PROVEN` verdict.
- `incomplete` covers cancellation, restart/partial evidence, and other
  evidence that is not sufficient to claim completion.
- `blocked` identifies a failed blocking check and includes a bounded recovery
  action; `failed` is reserved for a terminal operation failure.
- Optional observable-agent campaign findings are evaluated only when they are
  bound to the same operation and revision. They can block readiness, but
  optional external observation never upgrades deterministic proof.

Client state, model text, live-provider output, and deployment state cannot
override a failed blocking check. Operation evidence projections carry this
same readiness result so API receipts and dashboard projections share one
server decision.

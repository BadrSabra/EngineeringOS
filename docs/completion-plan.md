# EngineeringOS — Phased Completion Plan

> ⚠️ **Historical phase log — not a current truth baseline.**
> This document records the sequencing decisions made during the original build-out phases.
> For the current system architecture, package layout, and execution flows, see **`docs/architecture.md`**.
> For open work items, see `attached_assets/PR_BACKLOG_1784476473246.md`.

Source of truth for sequencing further work on EngineeringOS. Companion to `docs/fact-record.md`.
Do not start from the UI — always work inside-out: data → execution → analysis → orchestration →
governance → tests → presentation → docs.

## Sequencing rule

1. Data integrity & constraints
2. Backend execution hardening (discovery, scan runner, tasks, workflows)
3. Scanner / graph-extraction depth
4. Graph as a real knowledge layer
5. Workflows as a real orchestration engine
6. Unified audit / events / task-logs / metrics traceability
7. Test coverage expansion
8. UI depth (reflect internal truth, not a simplified view)
9. Final documentation & handoff

Starting out of order (e.g. UI before data integrity, or workflow engine before data integrity) risks
building a nice-looking layer on top of an unstable one — explicitly called out as the top risk in the
source planning docs.

## Phase 0 — Freeze architectural truth ✅ (2026-07-10)

Producing/maintaining `docs/fact-record.md` and this plan, kept in sync with the real code.

## Phase 1 — Data integrity & constraints ✅ (2026-07-10, first pass)

- Added DB-level FKs: `events.taskId` → `tasks.id` (set null), `events.workflowId` → `workflows.id`
  (set null), `scan_jobs.projectId` → `projects.id` (cascade), `discovery_sessions.importedProjectId`
  → `projects.id` (set null).
- Verified no orphaned rows blocked the push; `drizzle-kit push` applied cleanly.
- Remaining in this phase: audit further nullable fields with operational meaning (task
  `verificationResult`, workflow `phases` shape) for stronger invariants — lower risk, deferred.

## Phase 2 — Backend execution hardening ✅ (2026-07-10)

- `scan-runner.ts`: `performScan`'s writes (tasks, rule hit-counts, graph entities/relationships,
  metrics row, project status/score update, scan event) now run inside one `db.transaction`, so a
  late failure (e.g. graph extraction throwing) rolls back everything instead of leaving partial
  state while the job is marked failed. `recordAudit` stays outside the transaction by design (see
  `audit.ts`) since it's best-effort telemetry on an already-committed change.
- Fixed a latent bug the Phase 1 FK exposed: `routes/discovery.ts`'s project-import atomic claim
  (`discovery_sessions.status: ready → importing`) was a standalone statement that ran *before* the
  project row existed, violating the new FK. Moved the claim inside the same transaction as the
  project insert (ordered after it), preserving the same optimistic-concurrency guarantee via
  Postgres row locking.
- `tasks.ts`: `execute`, `retry`, and `rollback` now use an atomic conditional-`UPDATE` claim (status
  + retryCount guard) instead of read-then-write, so concurrent calls on the same task can't race;
  the verification-result / log / event writes for each are wrapped in one transaction.
- `workflows.ts`: `start`/`stop` now atomically claim the workflow via a status-guarded update and
  wrap the execution-row transition + event emission in one transaction, so a workflow can't end up
  "running" with no execution row (or vice versa) after a partial failure or race.
- Full test suite and typecheck pass; verified via app-preview screenshot and log inspection after
  each workflow restart.

Remaining lower-priority items for this phase, deferred: broader partial-success reporting (e.g.
surfacing "graph extraction failed but files were still scanned" instead of an all-or-nothing
transaction) — intentionally not done, since atomicity was the higher-priority correctness property
requested by the source plan; can be revisited if partial results become a product requirement.

## Phase 3 — Scanner / graph-extraction depth ✅ (2026-07-10, first pass)

- `graph-extractor.ts`: added CommonJS support to the TS/JS AST path — `require("./x")` calls now
  resolve to `imports` relationships the same way ES `import`s do; `module.exports = fn`,
  `module.exports.foo = fn`, and `exports.foo = fn` now produce function entities so CommonJS-only
  files aren't invisible to the graph.
- Added `export = Foo;` (TS CommonJS-interop) support: identifiers referenced this way are now
  treated as exported even when the underlying `class`/`function` declaration has no `export`
  keyword of its own, via a pre-pass that collects `export =` target names before the main walk.
  This was a real gap, not just a documentation note — previously e.g. `class Foo {}` + `export =
  Foo;` produced no entity at all.
- Class methods (public, non-private) are now extracted as function entities qualified as
  `ClassName.methodName`, closing the "class methods" gap noted in the fact record. Constructors and
  `#private`/`private` members are intentionally excluded — not part of the externally-callable
  surface the graph should track.
- Python extraction is unchanged (still regex heuristic) — the source plan's priority ordering put
  CommonJS/class-method gaps ahead of a full Python AST parser, and adding a Python parser dependency
  is a bigger, separate decision better scoped as its own phase item if prioritized.
- Added 4 new scanner tests covering CommonJS require/exports, `export =`, and class methods; full
  scanner suite (49 tests) and workspace typecheck/test both green.

Remaining in this phase (deferred, lower priority): a real Python AST parser instead of regex
heuristics; deeper CommonJS patterns (e.g. `Object.assign(module.exports, {...})`, re-exports via
`module.exports = require(...)`).

**2026-07-13 follow-up fix:** found and fixed a real scope-consistency bug in the Python AST
extractor (`python-ast-script.py`): classes were collected via `ast.walk(tree)` (recurses into
every nesting depth) while functions were collected only from `tree.body` (module level), so a
class defined *inside a function body* (a local helper) leaked into the graph as a top-level
entity, and a private-by-convention class's methods still surfaced as orphaned
`_PrivateClass.method` entities even though the class itself was excluded. Replaced with a single
recursive `collect_class_entities` helper that only descends into class bodies (so a class-nested
inner class, e.g. a Django-style `Meta`, is still captured) and never into function bodies. Added
a scanner test (`excludes function-local classes/functions but keeps class-nested inner classes`)
covering all three cases; full scanner suite (61 tests) green.

**2026-07-13 second follow-up:** `lib/knowledge-engine` had zero test files, which made the
aggregate `pnpm run test` abort there before ever reaching `artifacts/api-server`'s route tests
(pnpm's recursive runner bails on first failure, and vitest exits non-zero on "no test files
found"). Added real unit tests (`inference.test.ts`, pure functions, no DB) and DB-backed
integration tests (`queries.test.ts`, same pattern as `artifacts/api-server`'s `graph.test.ts`) —
23 tests total. Running them surfaced a genuine, previously-hidden bug: `getImpactedEntities`'s
`maxDepthReached` was off by one (it counted a final BFS hop that found no new entities). Fixed by
decrementing `currentDepth` before breaking out of the loop when a hop is empty. Also fixed two
unrelated pre-existing full-workspace `typecheck` failures found while verifying: `lib/ai-orchestrator`
was missing from the root `tsconfig.json`'s project references (so its `dist/index.d.ts` was never
built, breaking `artifacts/api-server`'s import of it), and `"ai_executed"` was used as an audit
action but missing from the `audit_action` pg enum in `lib/db`. Full workspace now green:
`pnpm run typecheck` (12/12 projects) and `pnpm run test` (scanner 61, knowledge-engine 23,
api-server 68 — 152 tests) both pass clean.

## Phase 4 — Graph as a knowledge layer ✅ (2026-07-10, first pass)

- Fixed a real bug in `routes/graph.ts`: `GET /graph/relationships?projectId=&sourceId=` silently
  dropped the `sourceId` filter whenever `projectId` was also present (an `and()` call with no
  arguments is a no-op), so the two filters didn't compose. Both now combine correctly via WHERE
  clauses instead of a post-fetch filter that could only apply one at a time.
- Added `GET /graph/entities/:entityId/neighbors` — returns an entity plus its incoming/outgoing
  relationships and the neighboring entities themselves in one call. This is the missing primitive
  for treating the graph as a *navigable* structure: before this, a caller had to fetch the full
  entity list and full relationship list separately and cross-reference them by hand to answer "what
  does this file depend on / what depends on it".
- Deferred (not yet wired into the OpenAPI contract or the dashboard UI — see Phase 8 for the UI
  side): the dashboard's Graph page still renders a randomly-positioned scatter plot with no edges
  drawn between nodes. Wiring `/neighbors` into a real node-link view is UI work, tracked separately
  under Phase 8 so this phase stays scoped to the data/API layer.

## Phase 5 — Workflow engine ✅ (2026-07-10, first pass)

- `routes/workflows.ts`: `currentPhase` used to be set once at start and never move again — there was
  no way to actually progress through a workflow's `phases` list. Added three endpoints that make it
  a real state machine:
  - `POST /workflows/:workflowId/advance` — atomically claims the running execution (guarded on both
    status and current phase, so a race can't double-advance) and moves it to the next phase, or to
    `completed` if the current phase was the last one. Appends the finished phase to
    `completedPhases` on both the execution row and mirrors `currentPhase`/`status` onto the parent
    workflow row.
  - `POST /workflows/:workflowId/fail-phase` — marks the running execution (and workflow) `failed`
    with an error message, without discarding which phase it failed at.
  - `POST /workflows/:workflowId/executions/:executionId/retry-phase` — atomically claims a `failed`
    execution and puts the *same* phase back into `running`, rather than restarting the whole
    workflow from phase one. This is the retry-at-phase primitive the plan called for.
  - All three are transaction-wrapped with atomic-claim guards, following the same pattern as Phase
    2's execute/retry/rollback and start/stop, and each emits an event + audit entry.
- Added `artifacts/api-server/src/routes/workflows.test.ts` (4 new tests: full advance-to-completion
  sequence, fail-then-retry-in-place, 409 on advancing with no running execution, 409 on retrying a
  non-failed execution).
- Not done (deferred, larger scope): branching/conditional phases (the `phases[].condition` field
  exists in the schema but nothing evaluates it yet), and rollback-to-a-previous-phase (only
  retry-in-place exists, not "go back to phase N and redo everything after it"). These are real
  orchestration-engine features, not bugs, and are sizable enough to warrant their own follow-up pass
  if prioritized.

## Phase 6 — Unified traceability & governance ✅ (2026-07-10, verified largely already satisfied)

- Audited every mutating route (`projects`, `tasks`, `workflows`, `rules`, `plugins`, `discovery`):
  each one calls `recordAudit` after its transaction commits and emits an `events` row inside the
  transaction. Read-only routes (`dashboard`, `events`, `graph`, `health`, `metrics`) correctly have
  neither — there's no state change to trace. No mutating route was found missing audit/event
  coverage, so this phase's core ask (consistent traceability across the mutation surface) was
  already met by the patterns established in Phases 2 and 5; this pass was verification, not new
  code.
- `audit.ts`'s best-effort/fire-and-forget design (see its own doc comment) is a deliberate tradeoff,
  not a gap: it's evaluated and reaffirmed, not changed, since making audit block primary mutations
  would trade availability for a compliance guarantee nothing in this codebase currently needs.
- Not done (deferred, real scope not verification): a shared correlation ID threaded across
  audit/events/task-logs/metrics for a single logical operation (e.g. one `scan` producing a
  `scan_jobs` row, several `tasks` rows, a `metrics` row, and an `events` row — currently linked only
  by `projectId`/timestamps, not a single ID you could filter by). Worth its own follow-up if the
  product needs "show me everything that happened in this one operation" as a first-class view.

## Phase 7 — Test coverage expansion ✅ (2026-07-10)

- Added `graph.test.ts` for `/graph/entities/:id/neighbors` (outgoing/incoming split, isolated-entity
  empty case, 404 for a missing entity) — this endpoint had no test coverage even though it was
  implemented in an earlier phase.
- Added `tasks.test.ts` (create/list, execute → verifying with no rule/files, 409 on double-execute,
  retry increment + max-retries 409, rollback, update/delete), `plugins.test.ts` (seeded list,
  enable/disable round-trip, 404 for unknown plugin id), and `metrics.test.ts` (time-series ordering
  scoped to a project, `/metrics/latest` picks the newest row per project, empty array for a project
  with no metrics yet). Also added `workflows.test.ts` coverage for `advance`/`fail-phase`/
  `retry-phase` as part of Phase 8's contract-drift fix.
- Full suite is now 29 passing tests across scanner/api-server (projects, discovery, workflows,
  graph, tasks, plugins, metrics). Remaining route groups without dedicated tests: rules, events, and
  dashboard-summary — all thin read paths already exercised indirectly via `projects.test.ts`'s
  summary assertions; left as a lower-priority follow-up rather than blocking further work.

## Phase 8 — UI depth ✅ (2026-07-10, closed out; extended 2026-07-12)

- Closed the Phase 4 contract gap: `GET /api/graph/entities/{entityId}/neighbors` is now in
  `openapi.yaml` (`getGraphEntityNeighbors` operation) and regenerated into
  `lib/api-zod`/`lib/api-client-react`, so the server capability is no longer invisible to the
  generated client.
- Graph page (`artifacts/dashboard/src/pages/Graph.tsx`) is now a real explorer instead of a
  decorative scatter plot: clicking an entity (in the list or on the plot) fetches its neighbors via
  the new hook and shows a detail panel with "depends on" / "depended on by" relationship lists
  (each entry itself clickable to pivot the selection); the scatter plot dims non-neighbors and
  highlights the selected node + its neighbors. Search box now actually filters the entity list.
  The plot still uses a deterministic pseudo-layout (no true force-directed graph rendering) — that
  remains a possible future improvement, not required for the "navigable, not just a flat list"
  acceptance bar.
- Closed a second Phase 5/8 contract gap: `advance`, `fail-phase`, and `executions/:id/retry-phase`
  existed on the server (Phase 5) but were never added to `openapi.yaml`, so the generated client had
  no way to call them. Added all three operations (`advanceWorkflow`, `failWorkflowPhase`,
  `retryWorkflowPhase`) plus a named `FailWorkflowPhaseInput` schema (inline object bodies collide
  with orval's zod-type-folder naming, so named schemas are used for any non-empty request body from
  here on), regenerated codegen.
- Workflows page now uses those hooks: a running workflow shows "Advance" (move to next phase, or
  complete on the last phase) and a fail-phase button next to start/stop; each workflow card has a
  collapsible "Execution history" section (`useListWorkflowExecutions`) listing every past run with
  status, current phase, `completedPhases` trail, error message, and a retry button on failed runs
  that calls `retry-phase` in place. This closes the "Workflows page doesn't visualize
  phases/currentPhase" gap from the fact record.
- Events page: search and filter controls used to be decorative (no `onChange`, no filtering logic).
  Wired them up — project and severity filters now actually narrow `useListEvents` results (project
  filter passes `projectId` server-side; severity + free-text search filter client-side over the
  fetched page), with an active-filter badge, a clear-filters action, and a "no events match filters"
  empty state distinct from "no events at all".
- Closed the last placeholder in Phase 8: "Build Pipeline" is no longer a no-op button. It opens a
  modal (project picker, name, optional description, an ordered/editable list of phase names) that
  calls `useCreateWorkflow` against the existing `POST /api/workflows` endpoint and invalidates the
  workflow list on success; the empty-state panel also links to it. No new backend work was needed —
  this was purely a missing UI for an endpoint that already existed.
- Not done (deferred): reducing over-simplification on ProjectDetail/Metrics pages (already fairly
  deep — verified via code read, not flat summaries).
## Phase 9 — Continued development (2026-07-12)

### Session: Knowledge graph layer + UI depth + Plugin framework

**Knowledge graph (Phase 4 continuation):**
- Fixed Orval path+query collision (`GetGraphEntityImpactParams`): moved entityId to a query param so Orval generates `...QueryParams` (different name from type file, no collision). Added pattern to orval-openapi-codegen.md memory note.
- Added `drizzle-orm` as a direct dep to `lib/knowledge-engine` (transitive deps don't resolve for the compiler).
- Added `lib/knowledge-engine` to `artifacts/api-server/tsconfig.json` project references.
- Wired 3 new route handlers into `graph.ts`: `GET /graph/impact?entityId=&maxDepth=`, `GET /graph/path?fromId=&toId=&maxDepth=`, `GET /graph/summary/:projectId`.
- Added 12 new integration tests in `graph.test.ts` covering all three endpoints (4 cases each: happy path, edge cases, empty/not-found).

**Graph.tsx full rebuild:**
- Replaced decorative Recharts ScatterChart (no edges) with real SVG force-directed layout: 80-iteration spring simulation, colored nodes by type, directed edge lines with arrowheads.
- Left sidebar: type legend + graph summary stats (entity/relationship counts, cluster count, avg degree, isolated nodes) via `useGetGraphSummary`.
- Right panel: tabbed detail view — Relations tab (outgoing/incoming, each clickable) + Impact tab via `useGetGraphEntityImpact` showing affected entities with hop depth and relation type, highlighted in amber on the canvas.
- Node labels shown when entity count < 30 or node selected; selected node glows; impacted/neighbor nodes stay bright when others dim.

**Dashboard page improvements:**
- `Tasks.tsx`: wired search input with real client-side filter + clear button; added tabbed detail view with a "Logs" tab using `useGetTaskLogs` polling every 5s for running tasks.
- `Rules.tsx`: wired search input + severity server-side filter; added summary stat strip (active rules count, critical/high count, total violations); rules are now expandable showing description, detection pattern, fix description, verify steps, and metadata.
- `ProjectDetail.tsx`: added Knowledge Graph summary section using `useGetGraphSummary` — shows entity count, relationship count, cluster count, isolated count, and top connected nodes. Hides when no graph data available.

**Plugin framework (Task #9):**
- Built `artifacts/api-server/src/lib/plugin-runtime.ts`:
  - Typed hook contract: `ScanCompleteContext`, `PluginHook`, `ScanCompleteResult`, `PluginEvent`.
  - 6 in-process plugin implementations (plugin-react, plugin-node, plugin-security, plugin-performance, plugin-python, plugin-docs), each with meaningful `onScanComplete` logic over entity/violation data.
  - `dispatchOnScanComplete()`: loads enabled plugin IDs from DB, dispatches to registered hooks, inserts any returned events. Best-effort (errors logged, not propagated), same pattern as `recordAudit`.
- Wired into `scan-runner.ts`: `capturedEntities` escapes the transaction closure; `dispatchOnScanComplete` called in the post-transaction `.then()` callback alongside the audit, carrying language/framework/entity/violation context.
- Added 14 pure unit tests in `plugin-runtime.test.ts` covering all 6 plugins (no DB required).

**Codegen drift check:**
- `scripts/check-codegen-drift.ts`: TypeScript CI guard — runs codegen, checks git diff + untracked files in generated dirs, exits 1 with actionable message if any drift. Complements the existing `codegen:check` npm script.

All changes: full project typecheck passes clean.

## Phase 10 — طبقة الذكاء الاصطناعي / AI Orchestration Layer ✅ (2026-07-13)

### ما تم بناؤه

**حزمة جديدة: `lib/ai-orchestrator/`** — مكتبة وكلاء ذكاء اصطناعي تعمل بـ Groq (LLaMA 3.3-70b وLLaMA 3.1-8b)، مستقلة عن api-server وقابلة للاستخدام من أي حزمة أخرى.

**5 وكلاء متخصصون:**
- `chat-agent.ts` — محادثة تفاعلية مع سياق المشروع الكامل (graph + metrics + tasks + events)؛ يُرجع JSON مع مصادر البيانات.
- `task-agent.ts` — يُنفّذ مهمة engineering عبر LLM، يكتب النتيجة في `agentResponse`، ويقرر ما إذا كانت تحتاج مراجعة بشرية.
- `scan-analyst.ts` — يحلل نتائج الفحص والمقاييس ويُنتج `ScanInsight[]` مرتبة بالأولوية.
- `code-reviewer.ts` — مراجعة شاملة تُنتج `CodeReviewOutput` مع verdict (approved/needs_changes/major_rework).
- `workflow-orchestrator.ts` — يقرر الخطوة التالية لأي workflow (advance/wait/fail/complete) بناءً على حالة الـ phases والسياق.

**`context-builder.ts`** — يجمع سياق المشروع من DB (projects, tasks, metrics, graph_entities, events) في طلبات متوازية ويُعيده كسلاسل نصية جاهزة لـ system prompt.

**جداول DB جديدة (تم push إلى Postgres):**
- `ai_chat_sessions` — جلسات المحادثة مرتبطة بالمشروع.
- `ai_chat_messages` — رسائل بأدوار (user/assistant/system) مع حقل `sources` (JSON string).

**7 نقاط API جديدة تحت `/api/ai/*`:**
| Endpoint | الوظيفة |
|---|---|
| `POST /api/ai/chat` | إرسال رسالة، إنشاء/استئناف session، رد AI مع sources |
| `GET /api/ai/chat/sessions?projectId=` | قائمة sessions لمشروع |
| `GET /api/ai/chat/:sessionId/messages` | رسائل session |
| `POST /api/ai/projects/:projectId/analyze` | تحليل scan بالذكاء الاصطناعي |
| `POST /api/ai/projects/:projectId/review` | مراجعة الكود |
| `POST /api/ai/workflows/:workflowId/orchestrate` | قرار orchestration |
| `POST /api/ai/tasks/:taskId/execute` | تنفيذ مهمة عبر AI agent |

**OpenAPI spec:** أُضيفت جميع النقاط والـ schemas (`AiChatRequest`, `AiChatOutput`, `AiChatSession`, `AiChatMessage`, `AiScanAnalysis`, `AiScanInsight`, `AiCodeReview`, `AiCodeIssue`, `AiOrchestrationDecision`, `AiReviewRequest`, `AiOrchestrateRequest`). جرى `pnpm run codegen` بنجاح وتجاوز typecheck.

**Dashboard:** صفحة `AiChat.tsx` جديدة على `/ai` مع sidebar للـ sessions، أزرار quick-actions (Analyze Scan / Code Review / Task Status / Workflow Health)، message bubbles مع sources badges، وسيلة تحديث (optimistic UI). أُضيف "AI Assistant" في Sidebar.

### ملاحظات تقنية
- `customFetch` غير مُصدَّر من `@workspace/api-client-react` — استخدم `fetch` مباشرة في صفحات dashboard تستدعي endpoints غير مولَّدة.
- Orval قاعدة: inline request-body schemas تتعارض مع zod-type exports — استخدم `$ref` لأي body غير فارغ (موثَّق في orval-openapi-codegen.md).

### مؤجّل (لم يُنفَّذ بعد)
- Auto-trigger AI عند وصول مهمة لـ `verifying` وعندها `prompt` (الآن: endpoint منفصل فقط).
- SSE/streaming للـ chat responses.
- أزرار "AI Analyze" و"AI Review" مدمجة في صفحات Projects وTasks.

## Phase 9 — Final documentation & handoff (ongoing)

- Keep `docs/fact-record.md` and this plan current after each phase; update `replit.md` pointers.
- **2026-07-11:** `docs/fact-record.md` updated — added 17 previously undocumented entries (lib/db package files, scripts/, 3 new lib/api-zod generated types, orval-openapi-codegen memory note, 5 new attached_assets). Architecture layer map and inter-package dependency map added as new sections. This plan updated to reflect the 9-track execution roadmap.
- **2026-07-11 (Task #3 close-out):** Full re-audit of `docs/fact-record.md` against the live file tree (every tracked, non-generated, non-`node_modules` file) found exactly one undocumented file — a newly uploaded planning attachment — which was added, and one stale count (`artifacts/api-server` header said 27, actual table rows were 31; corrected). Quick-stats total corrected to 359 from an actual row count, not an estimate. No other drift found — layer map and dependency map from the prior pass still match current packages.
- **2026-07-11 (Task #4, first increment — DB constraints + centralized config):** Ran `pnpm install` to unblock real verification (typecheck/test/db push) for this track; all three artifact workflows restarted cleanly afterward.
  - DB schema hardening: `projects.rootPath` and `plugins.name` are now UNIQUE; `events.message` is NOT NULL (default `""`); `discovery_sessions.status`/`.source` and `audit_logs.entityType`/`.action` converted from free-text to `pgEnum`, with `AuditEntityType`/`AuditAction` in `lib/audit.ts` now derived directly from the DB enum's `.enumValues` so the schema stays the single source of truth. Pushed via `drizzle-kit push`.
  - Left `graph_relationships.relation` and `tasks.phase` as free text — deliberately: both are extensible by design (new relation kinds land in Track #6's scanner work; workflow phase names are user/workflow-defined, not a fixed set), so a DB enum would just create migration friction with no real safety gain right now.
  - Left `rules.projectId` nullable — appears to be intentional support for global (non-project-scoped) rules, not an oversight; not touched without confirming that assumption against real usage first.
  - Found and fixed a genuine regression from the `projects.rootPath` UNIQUE constraint: the discovery-import atomic-claim design has two concurrent requests each insert a *candidate* project row (using the session's rootPath) before either resolves the claim race, so the loser now hits the new unique constraint instead of the claim's conditional-UPDATE check. Fixed by catching that specific Postgres unique-violation (code `23505`, constraint `projects_root_path_unique` — surfaced on drizzle's wrapped error's `.cause`, not the error itself) and mapping it to the same 409 conflict response. Full test suite (29 tests) passes twice in a row post-fix.
  - Added `artifacts/api-server/src/config.ts`: a single Zod-validated env module (`NODE_ENV`, `LOG_LEVEL`) plus a `getPort()` used only by the listener entrypoint (kept separate from the base schema so importing `config` — e.g. in tests that only exercise the Express app via supertest — doesn't force `PORT` to be set). Replaced the scattered `process.env.NODE_ENV`/`LOG_LEVEL` reads in `app.ts`/`logger.ts`/`index.ts` with it. `lib/db`'s own `DATABASE_URL` check was left as-is (separate package, separate consumers).
  - Minor dead-code cleanup: removed `artifacts/api-server/src/lib/.gitkeep` (the directory already has real files; `.gitkeep` there was leftover, unlike `src/middlewares/.gitkeep` which guards a genuinely empty directory).
  - Audited API response shapes across all route files: already consistent (flat JSON success bodies, `{ error }` shape on failures, a single centralized error-handling middleware in `app.ts`) — no changes needed there; an earlier read had incorrectly flagged `dashboard.ts` as wrapping responses in `{ data }`, which it does not.
  - Naming-convention audit (full pass): DB tables/columns are consistently snake_case, route paths are consistently plural-resource + kebab-case multi-word segments (`scan-jobs`, `retry-phase`, `fail-phase`), TS fields are consistently camelCase via drizzle's column mapping. No inconsistencies found — no changes needed.
  - Task #4 is now complete: DB constraints tightened, response-shape/error-handling audited (already consistent, no changes needed), config centralized, naming conventions verified consistent, one dead file removed.
- **2026-07-11 (Task #3, second audit pass):** Re-ran the file-drift check with an automated `git ls-files` vs. fact-record-table diff (not manual inspection) and found 3 genuinely undocumented files: `.agents/memory/drizzle-error-wrapping.md`, and two newly-uploaded `attached_assets` planning-text duplicates. All three added with real entries; `.agents/memory` header corrected 8→9, `attached_assets` header corrected 35→38, quick-stats total corrected to 363. Also fixed a real gap in the inter-package dependency map: `artifacts/api-server` depends on `lib/api-zod` (for request/response Zod validation) in addition to `lib/db` and `lib/scanner`, which the prior map omitted. No other drift found.

---

## Segunda ola — 9-Track Execution Plan (Tasks #3–#9)

Based on an architectural review completed 2026-07-11 (see `attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md` and `attached_assets/خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx`), the project moves into a second wave of structured work. The prior phases (0–8) established the correct foundation; these tasks deepen each layer.

### Track sequencing

Work inside-out — same principle as before. The task dependency chain enforces this:

```
#3 Sync fact record & architecture docs        (no blockers)
  └── #4 Stabilize technical foundation        (depends on #3)
        ├── #5 Complete workflow & rule engines (depends on #4)
        ├── #6 Deepen graph, scanner & discovery(depends on #4)
              ├── #7 Upgrade dashboard UI       (depends on #5, #6)
              ├── #8 Expand test coverage       (depends on #5, #6)
              └── #9 Complete plugin framework  (depends on #5, #6)
```

### Task summaries

| Task | Track | Key deliverables |
|------|-------|-----------------|
| **#3** Sync fact record & architecture docs | Documentation & governance | fact-record.md accurate, layer map, dependency map, this plan updated |
| **#4** Stabilize technical foundation | Technical foundation | DB constraints tightened, unified API response shape, validated config module, naming conventions |
| **#5** Complete workflow & rule engines | Core engines | Workflow state machine enforced, retry/rollback, rule violation history, audit completeness |
| **#6** Deepen graph, scanner & discovery | Scanner / graph depth | Python structured extraction, CommonJS deeper patterns, class methods, rootPath hard-fail |
| **#7** Upgrade dashboard to operational UI | Presentation | Phase history UI, graph neighbor explorer, metric trends, task inline logs, empty/error states |
| **#8** Expand test coverage & observability | Testing & governance | Failure-path tests, scan pipeline integration test, correlation ID middleware, codegen drift check |
| **#9** Complete plugin framework | Plugins & extensibility | Plugin hook contract, in-process registry, hooks wired into core engines, example plugin |

### Acceptance criteria (second wave)

- Each task's "Done looks like" section is the acceptance bar — not the steps.
- No task is considered complete if: it breaks the build, drifts the OpenAPI contract, or introduces untested mutations.
- `docs/fact-record.md` and this plan are updated as part of completing Task #3; subsequent tasks update only if they add new files.

## Phase 12 — Contract Stabilisation & Full Test Coverage ✅ (2026-07-14)

10-PR series targeting the P0 test-coverage gap identified in Phase 11, the discovery contract
inconsistencies, and the scan runner architecture. All 10 PRs landed in a single session.

### PR 1 — Discovery contract stabilisation
- `SOURCE_CAPABILITIES`: flipped `WORKSPACE_PROJECT` from `available: false` to `available: true` —
  the resolver already handled it correctly; the capability was advertising "coming soon" for a
  feature that was already implemented.
- Import-route 409 split into two deterministic messages: `"Session already imported"` (status =
  `imported`) vs `"Discovery not yet complete"` (status = `discovering` | `error`). Previously both
  collapsed to the same ambiguous string.
- `discovery.test.ts`: fixed `source: "local"` → `sourceType: "LOCAL_FOLDER"` (wrong schema column,
  silently ignored by Drizzle's default); added 4 new `describe` blocks: `GET /discovery/sources`
  (6 tests), `POST /projects/discover` path-validation (9 tests), `GET /projects/discover/:id`
  (3 tests), `GET /projects/discover/:id/summary` (5 tests), plus tightened import-route assertions.

### PR 2 — Discovery source adapter architecture
- Extracted `artifacts/api-server/src/lib/discovery-adapters.ts` with a typed `SourceAdapter` union
  (`SupportedAdapter | UnsupportedAdapter`), per-type adapter implementations, a named `ADAPTERS`
  registry, and two public functions: `resolveSource` (validates + resolves in one call) and
  `cleanupResolveResult` (handles tempDir teardown). Adding a new source type now requires only a
  new registry entry — zero changes to the route.
- `discovery.ts`: removed 75 lines of inline switch-based `resolveSource` + duplicated types; now
  imports from the adapters module. Removed unused `execFile`/`promisify`/`rm`/`or` imports.
- `discovery-adapters.test.ts`: 25 unit tests covering `isResolveError`, the registry, per-adapter
  `validate()`, `WORKSPACE_PROJECT.resolve()` DB-404 path, the `resolveSource` facade, and
  `cleanupResolveResult`.

### PR 3 — Import transaction integrity
- Added 9 new tests proving the transaction is all-or-nothing:
  - Exactly one metrics row per import; correct `overallScore`.
  - `ProjectImported` event created in the same transaction.
  - Graph entity stubs created from `detectedApis`, capped at 50; zero stubs when list is empty.
  - Task priority mapping: `critical→p0`, `high→p1`, `other→p2`.
  - No partial writes after a concurrent 409 (session stays `"imported"`, exactly one project row).
  - Re-importing an already-imported session leaves no extra project row.
  - Second session with the same `rootPath` gets 409 "root path already exists" and its session
    stays `"ready"` (DB-level UNIQUE constraint path proved end-to-end).

### PR 4 — Scan runner isolation
- `discovery.ts`: removed unused `graphRelationshipsTable` import.
- `job-reconciliation.test.ts`: fixed `source: "local"` → `sourceType: "LOCAL_FOLDER"` (same bug
  pattern as PR 1).
- `projects.test.ts`: added 5 new tests in a dedicated "DB side-effects" suite:
  - Scan creates exactly one metrics row.
  - Scan creates a `ProjectScanned` event.
  - Failed scan creates neither a metrics row nor a `ProjectScanned` event (transaction rollback
    verified at the DB level, not just via the job status).
  - `GET /projects/:projectId/scan-jobs/:jobId` returns the completed job with a non-null `result`
    field containing `filesFound` and `rootExists`.
  - Second sequential scan on the same project produces a second metrics row.

### PR 5 — Rules engine test coverage
- New `rules.test.ts` (30 tests): list (empty, populated, severity filter, projectId filter, hitCount
  order), create + audit entry, get / 404, update + audit / 404, delete (idempotent), evaluate
  (no-pattern skip, missing-path project: matched=false, 404 rule, 404 project, RuleEvaluated event
  + audit entry).

### PR 6 — Events API test coverage
- New `events.test.ts` (8 tests): list returns array, projectId filter (all returned events belong to
  project), type filter, correlationId filter, limit parameter, descending timestamp order, default
  limit ≤ 50, required fields shape.

### PR 7 — Dashboard summary test coverage
- New `dashboard.test.ts` (11 tests): all required top-level fields, projectCount, activeTaskCount
  (running+verifying+queued), completedTaskCount, taskStatusBreakdown grouping, recentEvents ≤ 20,
  topRules ≤ 5 with correct shape, trend `"improving"` / `"declining"` / `"stable"` with DB-level
  metric fixtures proving the diff logic.

### PR 8 — Health endpoint test coverage
- New `health.test.ts` (2 tests): `GET /api/healthz` returns 200 `{status:"ok"}`; confirms no 401/403
  (health must never be auth-gated — verified against the route registration order in `app.ts`).

### PR 9 — AI routes smoke tests
- New `ai.test.ts` (19 tests) with full `vi.mock("@workspace/ai-orchestrator")` — all Groq calls
  replaced with shape-correct stubs. Tests cover: chat 400-validation, session creation, session
  reuse (message count verified in DB), session list (400 without projectId, empty array, populated),
  messages list (empty, chronological order), analyze (200 shape, AiScanAnalysisCompleted event),
  review (200 shape, AiCodeReviewCompleted event, verdict→severity mapping), orchestrate (404 unknown
  workflow, 200 decision shape, AiWorkflowOrchestration event), task-execute (404, 409 completed/failed,
  202 with status=completed, 202 with status=verifying when needsHumanReview, task logs + event,
  audit entry with action=ai_executed).

### Net result

| Metric | Before | After |
|--------|--------|-------|
| Test files | 11 | 16 |
| Tests | 132 | 203 |
| Route files without dedicated tests | 5 (rules, events, dashboard, health, ai) | 0 |
| Schema column bug (`source: "local"`) | 2 occurrences | 0 |
| `WORKSPACE_PROJECT` available flag | `false` (wrong) | `true` |
| Import-409 message variants | 1 (ambiguous) | 2 (deterministic) |
| `resolveSource` architecture | 75-line switch in route | Registry in isolated module |

### Remaining open items (unchanged from Phase 11)

- ~~**P0**: Authorization model — no `ownerId`/`teamId` on projects; any Clerk user sees all data.~~ **[مُغلق ✅ 2026-07-14]** — `ownerId` مُضاف إلى projects schema؛ `requireProjectAccess`/`requireProjectWriteAccess`/`loadProjectByIdForUser` مُطبَّقة على كل routes؛ 219/219 اختبار يمر.
- **P1**: AI auto-trigger on `verifying` state with `prompt` field.
- **P1**: `docs/architecture.md` — single deliverable architectural document.
- **P2**: SSE/streaming for AI chat responses.
- **P2**: Workflow phase branching (evaluate `phases[].condition` before advancing).
- **P2**: Durable job queue (replace in-process `heavyJobQueue` with pg-boss/BullMQ for crash safety).

## Phase 11 — Closure Backlog (identified 2026-07-13, السلاسل 20–33)

مراجعة 14 وثيقة تحليل متقاطع (السلاسل 20–33) أكّدت أن المنصة أصبحت **control plane تشغيليًا ناضجًا**، وحدّدت ثلاثة محاور مفتوحة تمنع اعتبارها مغلقة حوكميًا.

### ما أكّدته المراجعة على أنه مكتمل

| الطبقة | الحالة المؤكَّدة |
|---|---|
| OpenAPI / codegen | 47 مسار، 58 عملية، 59 schema؛ drift-check يمنع الانحراف الصامت |
| DB schema | 16 جدولًا بـ FKs صريحة، enums مشتقة من DB، constraints مضبوطة |
| Scan pipeline | queue محدود التزامن (2) + reconciliation عند startup + atomic transaction |
| Knowledge graph | BFS queries (impact/path/neighbourhood) + centrality/clustering inference |
| AI orchestration | 5 وكلاء + 7 endpoints + سياق حي من DB + جلسات محادثة دائمة |
| Workflow state machine | advance/fail-phase/retry-phase + execution history |
| Audit / traceability | correlationId يربط scan ↔ audit ↔ events ↔ metrics |
| Plugin framework | 6 plugins in-process + dispatchOnScanComplete مُتصل بـ scan-runner |
| Dashboard | 15 صفحة تعكس الطبقات الداخلية: graph explorer، workflow controls، AI chat |

### محاور الإغلاق المتبقية

#### ~~P0 — Authorization model~~ **[مُغلق ✅ 2026-07-14]**
**الحل المنفَّذ:** `ownerId` موجود في جدول `projects` (NOT NULL)؛ ثلاثة رموز تصدير من `requireProjectAccess.ts`: `requireProjectAccess` (قراءة)، `requireProjectWriteAccess` (كتابة)، `loadProjectByIdForUser` (للـ routes التي تأتي فيها projectId من query/body)؛ مُطبَّقة على كل 8 resource routes (projects, tasks, rules, workflows, events, metrics, graph, ai)؛ اصطلاح 404/403 موثَّق؛ 219/219 اختبار يمر.

#### P0 — Test coverage gaps (تغطية مسارات ai/events/rules/dashboard/health)
**المشكلة:** الاختبارات الحالية تغطي: job-queue، job-reconciliation، plugin-runtime، scanner (4 ملفات)، ومسارات: discovery، graph، metrics، plugins، projects، tasks، workflows. **غير مغطاة بشكل مباشر:** ai، events، rules، dashboard، health.

هذه الأسطح ليست broken، لكنها مناطق ثقة بلا حصن اختباري، وهو مقبول لمنصة داخلية لكن غير كافٍ للتسليم.

**ما يجب إضافته:**
- `routes/ai.test.ts` — smoke tests لـ chat + analyze + review + orchestrate + execute (NODE_ENV=test bypass)
- `routes/events.test.ts` — create event, list with projectId filter, filter by correlationId
- `routes/rules.test.ts` — CRUD + evaluate
- `routes/health.test.ts` — GET /api/healthz يعيد 200 بدون auth

#### P1 — Expose correlationId fully in the OpenAPI contract
**المشكلة:** `correlationId` موجود في `events.ts` route وكـ query param، لكنه غير ممثَّل في `openapi.yaml`، ما يعني أن العميل المولَّد لا يرى هذه القدرة.

**الإصلاح:** إضافة `correlationId` كـ optional query param في `listEvents` operation وإعادة تشغيل codegen.

#### P1 — AI auto-trigger on verifying state
**المشكلة:** task-agent endpoint موجود (`POST /api/ai/tasks/:taskId/execute`) لكنه لا يُستدعى تلقائيًا عندما تصل مهمة إلى حالة `verifying` وتملك `prompt`.
**الإصلاح:** hook في `tasks.ts` route بعد انتقال الحالة إلى `verifying` يُطلق `executeTask` في الخلفية.

#### P1 — Final architectural documentation
**المشكلة:** `ARCHITECTURAL_ANALYSIS.md` غير موجود. الوثائق الحالية (fact-record + completion-plan + replit.md) تغطي التشغيل لكن لا تُنتج وثيقة معمارية واحدة قابلة للتسليم.
**الإصلاح:** إنشاء `docs/architecture.md` يجمع: layer map، dependency graph، trust boundaries، decision log (بالإحالة لـ .agents/memory)، وopen items.

#### P2 — SSE/streaming for AI chat responses
**المشكلة:** AI chat يعيد الرد دفعةً واحدة لا stream؛ المستخدم لا يرى تقدمًا خلال الانتظار.
**الإصلاح:** تحويل `POST /api/ai/chat` إلى SSE stream مع إضافة operation جديدة للعقد.

#### P2 — Workflow phase branching / conditions
**المشكلة:** حقل `phases[].condition` موجود في schema لكن لا شيء يُقيّمه. الـ advance endpoint يتجاهله ويتقدم خطيًا دائمًا.
**الإصلاح:** تقييم condition expression قبل advance؛ إذا لم تتحقق يُعاد `409` مع سبب.

#### P2 — Durable job queue
**المشكلة:** `heavyJobQueue` in-process — crash يفقد jobs في الانتظار؛ reconciliation يُفشلها لا يُستأنفها.
**الإصلاح:** إذا احتاجت المنصة ديمومة أعلى، استبدال queue بـ pg-boss أو BullMQ مع worker منفصل.

### قاعدة الإغلاق

المشروع الآن في وضع **"يحتاج إغلاق الحزمة لا بناء الفكرة"**:
- البناء = إثبات أن الطبقات تعمل. ✅ مكتمل.
- الإغلاق = إثبات أن الطبقات آمنة، قابلة للتتبع، قابلة للتسليم، وقابلة للصيانة. ← هنا نحن الآن.

---

## Acceptance criteria (overall)

- No build/run breakage at any phase.
- Contract (OpenAPI), server, and generated client stay consistent.
- Discovery and scan pipelines are more reliable than before.
- Clear improvement in graph and/or workflow depth.
- Tests cover the sensitive paths touched by each phase.
- Docs reflect current reality, not aspiration.

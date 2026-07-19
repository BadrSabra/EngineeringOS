# EngineeringOS — Forensic Engineering Report

**Repository state:** current archive analyzed statically from code as source of truth.  
**Inventory coverage:** all **722** files in the archive are listed in the accompanying CSV.  
**Route parity:** **77** route handlers in api-server, matching **77** OpenAPI operations.  
**DB schema:** **17** Drizzle tables.  
**Tests:** **32** test files.  

---

## 1) Executive Summary

EngineeringOS is a monorepo platform with a real runtime core, not a thin demo. The strongest, most mature spine is:

`artifacts/api-server` → `lib/db` → `lib/scanner` → `lib/knowledge-engine` → `lib/ai-orchestrator` → `artifacts/dashboard`

The backend exposes a broad API surface with authentication, ownership checks, job orchestration, scan/discovery pipelines, graph queries, AI flows, workflow/task control, metrics, events, rules, plugins, and git integration. The contract layer is strongly formalized: OpenAPI → generated Zod schemas → generated React Query client. The DB schema is also explicit and centralized.

The main architectural strength is the separation between:
- **runtime API and persistence**
- **scanner / knowledge graph**
- **AI orchestration**
- **generated contract surfaces**
- **dashboard UI**

The main architectural weakness is **operational durability**: heavy discovery and scan work is queued **in process**, so queued jobs are not durable across restarts and the platform is not yet a full external-worker system. A second weakness is **trace guarantees**: `recordAudit()` is best-effort, so state mutations can succeed while trace rows fail.

This report is built from code, with docs used only for comparison. The complete per-file inventory is in `EngineeringOS_full_inventory.csv`.

---

## 2) Repository Scope and Inventory

| Top-level | Files |
|---|---|
| lib | 247 |
| artifacts | 217 |
| attached_assets | 189 |
| .agents | 35 |
| docs | 14 |
| scripts | 8 |

| Class | Count | Share |
|---|---|---|
| runtime | 339 | 47.0% |
| test | 32 | 4.4% |
| doc/historical | 239 | 33.1% |
| config/root/other | 112 | 15.5% |

**Package shape**
- Workspace packages: `artifacts/*`, `lib/*`, `scripts`
- Major runtime packages: `api-server`, `dashboard`, `ai-orchestrator`, `scanner`, `knowledge-engine`, `db`
- Generated contract packages: `api-zod`, `api-client-react`
- Historical/contextual surfaces: `attached_assets`, `.agents/memory`
- Standalone sidecar/sandbox: `artifacts/mockup-sandbox`

**Notable counts**
- `artifacts/api-server/src/routes`: 14 route files, **77** handlers total.
- `lib/db/src/schema`: **17** tables.
- `artifacts/dashboard/src/pages`: 15 routed pages.
- `lib/api-zod/src/generated`: large generated contract surface.
- `lib/api-client-react/src/generated`: generated React Query client surface.

---

## 3) System Architecture

### Core layered architecture
1. **Presentation layer** — `artifacts/dashboard`
2. **API composition and runtime** — `artifacts/api-server`
3. **AI orchestration** — `lib/ai-orchestrator`
4. **Scanner / extraction** — `lib/scanner`
5. **Knowledge queries / inference** — `lib/knowledge-engine`
6. **Persistence / schema** — `lib/db`
7. **Contract generation** — `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`
8. **Operational scripts** — `scripts`
9. **Documentation / archive** — `docs`, `attached_assets`, `.agents`

### Dependency graph (textual)
| Source | Dependency | Type | Strength | Confidence |
|---|---|---|---|---|
| Dashboard | api-client-react generated hooks | runtime UI -> generated client | direct | High |
| api-client-react | api-zod + openapi.yaml | generated contract client | build-time | High |
| api-server | db/scanner/knowledge-engine/ai-orchestrator | runtime backend composition | direct | High |
| scanner | python-ast-script.py | subprocess AST extraction for Python | direct | Medium |
| knowledge-engine | db schema | pure query/inference over stored graph | direct | High |
| scripts/validate-truth-flow | api-zod truth-flow schema + attached_assets baseline | drift gate | direct | High |

### What is confirmed by code
- `api-server` bootstraps first, then reconciles jobs and fixes dead paths before listening.
- `dashboard` talks to the API only through generated hooks and custom fetch plumbing.
- `api-server` validates auth and project ownership per route.
- `ai-orchestrator` uses a single Groq gateway plus parsing/validation wrappers.
- `scanner` and `knowledge-engine` are independent libraries; the server orchestrates them.
- `api-zod` and `api-client-react` are generated from OpenAPI and guarded by drift checks.

### What remains unresolved
- Durable queueing/worker persistence across process restarts is not implemented.
- The repository has many historical assets and docs that are not runtime truth.
- Some sandbox / generated preview surfaces are isolated from the product core.

---

## 4) Layer-by-Layer Analysis

### Backend runtime
**Files:** `artifacts/api-server/src/*`  
**Role:** entrypoint, routing, auth, heavy jobs, audit, plugin dispatch, startup repair.  
**Status:** mostly complete, with major durability caveat.  
**Evidence:** route handlers, startup reconciliation, path validation, ownership checks, job queue, scan runner.

### AI orchestration
**Files:** `lib/ai-orchestrator/src/*`  
**Role:** Groq gateway, prompts, schemas, parsing, chat/task/review/scan/workflow agents, file/git tools.  
**Status:** high maturity, but tightly coupled to in-process HTTP execution.  
**Evidence:** `groq-client.ts`, `parsing.ts`, `context-builder.ts`, `agents/*`, `tools/*`.

### Scanner / extraction
**Files:** `lib/scanner/src/*`  
**Role:** file walking, rule matching, graph extraction, metrics, Python AST helper.  
**Status:** implemented and test-covered.  
**Evidence:** export surface and parser-backed Python helper.

### Knowledge engine
**Files:** `lib/knowledge-engine/src/*`  
**Role:** pure graph query and inference layer.  
**Status:** implemented and cleanly separated.  
**Evidence:** pure async DB queries, in-memory inference functions, provenance-aware views.

### Persistence
**Files:** `lib/db/src/schema/*`, `lib/db/src/index.ts`  
**Role:** single source of truth for tables/enums.  
**Status:** strong and central.  
**Evidence:** 17 tables, typed Drizzle exports, FK relations.

### Contract surfaces
**Files:** `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`  
**Role:** API contract and client generation.  
**Status:** very strong.  
**Evidence:** route count parity with OpenAPI, generation and drift gates.

### UI
**Files:** `artifacts/dashboard/src/*`  
**Role:** presentation and user workflows.  
**Status:** solid shell, thinner than backend.  
**Evidence:** all major operational pages exist and rely on generated client hooks.

### Legacy / historical / archive
**Files:** `attached_assets/*`, `.agents/memory/*`, `docs/*`, `artifacts/mockup-sandbox/*`, `tsconfig.base.json.bak`  
**Role:** reference, historical evidence, sandbox, or backup.  
**Status:** not runtime truth.  
**Evidence:** not part of main execution path.

---

## 5) File-by-File Analysis

The exhaustive file-by-file inventory is in the CSV.  
Below is the critical-file ledger for the runtime core:

| ID | Path | Status | Confidence | Used | Note |
|---|---|---|---|---|---|
| C-01 | artifacts/api-server/src/app.ts | Runtime / build | Confirmed | yes | Express hardening, Clerk, auth gate, no-store, central error handler. |
| C-02 | artifacts/api-server/src/index.ts | Runtime / build | Confirmed | yes | Bootstrap: reconcile stuck jobs, fix dead root paths, then listen. |
| C-03 | artifacts/api-server/src/config.ts | Runtime / build | Confirmed | yes |  |
| C-04 | artifacts/api-server/src/routes/index.ts | Runtime / build | Confirmed | no/isolated |  |
| C-05 | artifacts/api-server/src/routes/ai.ts | Runtime / build | Confirmed | no/isolated | Chat, apply-changes, analyze, review, orchestrate, task execute. |
| C-06 | artifacts/api-server/src/routes/projects.ts | Runtime / build | Confirmed | no/isolated |  |
| C-07 | artifacts/api-server/src/routes/discovery.ts | Runtime / build | Confirmed | no/isolated |  |
| C-08 | artifacts/api-server/src/routes/tasks.ts | Runtime / build | Confirmed | no/isolated |  |
| C-09 | artifacts/api-server/src/routes/rules.ts | Runtime / build | Confirmed | no/isolated |  |
| C-10 | artifacts/api-server/src/routes/workflows.ts | Runtime / build | Confirmed | no/isolated |  |
| C-11 | artifacts/api-server/src/routes/events.ts | Runtime / build | Confirmed | no/isolated |  |
| C-12 | artifacts/api-server/src/routes/metrics.ts | Runtime / build | Confirmed | no/isolated |  |
| C-13 | artifacts/api-server/src/routes/graph.ts | Runtime / build | Confirmed | no/isolated |  |
| C-14 | artifacts/api-server/src/routes/plugins.ts | Runtime / build | Confirmed | no/isolated |  |
| C-15 | artifacts/api-server/src/routes/dashboard.ts | Runtime / build | Confirmed | no/isolated |  |
| C-16 | artifacts/api-server/src/routes/git.ts | Runtime / build | Confirmed | no/isolated |  |
| C-17 | artifacts/api-server/src/lib/scan-runner.ts | Runtime / build | Confirmed | no/isolated | Heavy scan pipeline: walk → rules → graph → metrics → plugin hooks. |
| C-18 | artifacts/api-server/src/lib/job-queue.ts | Runtime / build | Confirmed | no/isolated | In-memory bounded concurrency queue shared by discovery/scan. |
| C-19 | artifacts/api-server/src/lib/job-reconciliation.ts | Runtime / build | Confirmed | yes |  |
| C-20 | artifacts/api-server/src/lib/path-validation.ts | Runtime / build | Confirmed | no/isolated |  |
| C-21 | artifacts/api-server/src/lib/discovery-adapters.ts | Runtime / build | Confirmed | no/isolated | Source adapters: local, workspace project, git; unsupported future sources return 501. |
| C-22 | artifacts/api-server/src/lib/plugin-runtime.ts | Runtime / build | Confirmed | no/isolated |  |
| C-23 | artifacts/api-server/src/lib/audit.ts | Runtime / build | Confirmed | no/isolated |  |
| C-24 | artifacts/api-server/src/lib/graph-provenance.ts | Runtime / build | Confirmed | no/isolated |  |
| C-25 | artifacts/api-server/src/middlewares/requireAuth.ts | Runtime / build | Confirmed | no/isolated |  |
| C-26 | artifacts/api-server/src/middlewares/requireProjectAccess.ts | Runtime / build | Confirmed | no/isolated |  |
| C-27 | lib/scanner/src/index.ts | Runtime / build | Confirmed | yes |  |
| C-28 | lib/scanner/src/file-walker.ts | Runtime / build | Confirmed | no/isolated |  |

**Interpretation**
- `Confirmed` = direct code evidence.
- `Likely` = strong structural evidence, but not a live execution trace.
- `Unresolved` = not enough evidence or not directly reachable.

---

## 6) Execution Flow Analysis

| Flow | Main files | Core transition | End state | Notes |
|---|---|---|---|---|
| Boot / startup | artifacts/api-server/src/index.ts | reconcileStuckJobs() + fixDeadRootPaths() + app.listen() | Server ready | Startup reconciliation and dead-root repair happen before traffic. |
| Auth / ownership | artifacts/api-server/src/app.ts; middlewares/requireAuth.ts; middlewares/requireProjectAccess.ts | Clerk session -> req.userId -> project ownership checks | Authorized handler | No per-role RBAC, but every project-scoped route verifies ownership. |
| Discovery | artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx -> artifacts/api-server/src/routes/discovery.ts -> lib/discovery-adapters.ts -> lib/scanner/src/* | Resolve source, validate path, enqueue heavyJobQueue, runDiscovery() | discovery_sessions row + optional imported project | Background work is in-process and uses a bounded queue. |
| Project scan | artifacts/dashboard/src/pages/ProjectDetail.tsx / Projects.tsx -> routes/projects.ts -> lib/scan-runner.ts | POST /projects/:id/scan -> scan_jobs row -> runScanJob() | scan_jobs result + graph/entities/metrics/events | Job execution is fire-and-forget and guarded against unhandled rejections. |
| AI chat | artifacts/dashboard/src/pages/AiChat.tsx -> routes/ai.ts -> lib/ai-orchestrator/src/agents/chat-agent.ts | Load project context -> Groq -> parse JSON -> persist session/messages/pending changes | ai_chat_sessions/messages + optional pending changes | Pending writes are gated by explicit apply-changes. |
| AI analyze/review | routes/ai.ts -> analyzeScan()/reviewCode() | Build project context -> LLM -> audit + events | audit_logs + events rows | Context cache is invalidated after writes. |
| Workflow orchestration | routes/workflows.ts + routes/ai.ts -> workflow-orchestrator.ts | Read current phase -> model decision -> validateDecision -> executeDecision | workflow_executions + events + audit | Linear phase ordering is enforced. |
| Tasks | artifacts/dashboard/src/pages/Tasks.tsx -> routes/tasks.ts -> ai-orchestrator task agent | Create/execute/retry/rollback/logs | tasks/task_logs/events/audit | Execution claims are atomic; AI execution requires key + rate limit. |
| Graph / knowledge | artifacts/dashboard/src/pages/Graph.tsx -> routes/graph.ts -> lib/knowledge-engine/src/* | Fetch entities/relationships -> impact/path/neighborhood/summary | Read-only graph views | Semantics and provenance are exposed alongside raw edges. |
| Rules / metrics / events | pages Rules/Metrics/Events -> routes/rules.ts/routes/metrics.ts/routes/events.ts | CRUD + evaluation + time-series + log access | DB updates and derived views | Ownership checks are explicit and consistent. |
| Git / export | GitPanel + routes/git.ts | status/log/config/commit/push/export | Repo integration side effects | GitHub token stored encrypted; push injects token at call time. |

### Main flows
- **Boot/startup:** reconcile stuck jobs and repair deleted temp-root projects before traffic.
- **Discovery:** source resolution → safety checks → background queue → session state → import.
- **Scan:** enqueue scan job, run file walk/rules/graph/metrics, update graph + metrics + events.
- **AI chat / analyze / review / task / workflow:** build context, call Groq, parse schema, persist outputs, emit audit/events.
- **Graph / metrics / events / rules / tasks / workflows:** read/write domain state through Drizzle and ownership checks.
- **Git/export:** status/log/config/commit/push/export with encrypted token storage.

### Confirmed operational detail
- Discovery and scan jobs are **fire-and-forget** and bound by a shared in-memory queue.
- AI writes are guarded with validation and cache invalidation.
- `recordAudit()` is intentionally best-effort and does not block the user mutation.

---

## 7) Documentation Gap Analysis

| Document | Observation | Status |
|---|---|---|
| docs/EXECUTION_ALIGNMENT_REPORT.md | Outdated counts (595-file archive) versus current archive (722 files). | stale |
| docs/PLACEHOLDER_REGISTER.md | Some placeholder markers remain accurate, but several 'gap' items are now implemented in code. | partly stale |
| docs/PR_BACKLOG.md | Backlog is broadly aligned, but some closed items still read as open in older snapshots. | partly stale |
| docs/completion-plan.md | Best macro roadmap doc; aligned with the layered architecture currently in code. | aligned |
| docs/fact-record.md | Closest doc mirror of repository truth; still documentation, not authority. | aligned but non-authoritative |
| replit.md | Operational instructions are broadly correct; used as support, not source of truth. | supporting |

### Key mismatches
- Older reports count **595** files; the current archive contains **722** files.
- Several backlog and placeholder documents are partially stale because the code has moved forward.
- The best-aligned docs are the roadmap/fact register style files, but they remain documentation, not authority.
- Historical assets and memory docs are useful context, but not proof of current behavior.

---

## 8) Code Quality Assessment

### Strong points
- Clear layering and separation of concerns.
- Zod validation at contract boundaries.
- Ownership checks on project/session-scoped routes.
- Startup reconciliation for stuck jobs and dead temp-root paths.
- Security-conscious file and git tool wrappers.
- Provenance and correlation IDs are present across several trace surfaces.
- Generated contracts reduce client/server drift.

### Anti-patterns / weak points
- Large route files carry substantial business logic.
- In-process queue for heavy work is not durable.
- Audit is not transactional.
- The “fast” LLM model constant is effectively dormant.
- Historical/doc-only directories are large enough to confuse future reviews if not quarantined.

### Dependency/coupling note
The API server is well-composed, but it still concentrates orchestration, persistence, and domain workflow logic in a single process. That is acceptable for this stage, but it is not yet the architecture of a durable distributed worker system.

---

## 9) Technical Debt Report

1. **Durability debt** — background jobs are in-memory.
2. **Trace debt** — audit writes can fail without failing the user mutation.
3. **Contract operational debt** — generated surfaces need continuous drift enforcement.
4. **Doc/archive debt** — historical files are numerous and can be mistaken for active truth.
5. **Sandbox debt** — `artifacts/mockup-sandbox` is a separate surface that may outlive its purpose.
6. **Model policy debt** — `MODEL_FAST` no longer differs from `MODEL_POWERFUL`.

---

## 10) Completion Assessment

| Subsystem | Completion | Why | Evidence |
|---|---|---|---|
| Core backend runtime | High (≈90%) | Entry, auth, routes, jobs, scans, AI flows, graph, metrics, audit all exist; biggest gap is durability of background work. | api-server/src/*, db schema, scanner, ai-orchestrator |
| Contract surfaces | Very high (≈95%) | OpenAPI → orval → Zod → React Query client is wired, and route count matches spec count. | lib/api-spec, lib/api-zod, lib/api-client-react, scripts/check-codegen-drift.ts |
| Data model | Very high (≈95%) | 17 tables cover projects, scans, graph, tasks, workflows, events, audit, chats, credentials, plugins. | lib/db/src/schema/* |
| Scanner / knowledge graph | High (≈85%) | File walking, rule matching, graph extraction, metrics, provenance queries/inference are implemented and tested. | lib/scanner, lib/knowledge-engine |
| AI orchestration | High (≈85%) | Chat, task, scan analysis, code review, workflow orchestration, parsing, Groq gateway, tools all exist. | lib/ai-orchestrator |
| Dashboard UX | Medium-high (≈80%) | Pages exist for all major flows, and they consume generated hooks, but some areas are thin compared with backend depth. | artifacts/dashboard/src/pages/* |
| Operational hardening | Medium (≈70%) | Security checks, auth, rate limiting, queue bounds, startup reconciliation exist; durability and transactional traceability remain partial. | api-server/lib, app.ts, index.ts |

### Overall view
- **Implementation completeness:** high in the core backend and contract layers.
- **Testing completeness:** moderate-to-high; there are 32 test files but runtime execution was not run in this pass.
- **Documentation completeness:** high volume, but mixed freshness.
- **Operational completeness:** good for a single-process internal tool, incomplete for durable heavy-job execution.

---

## 11) Risk Assessment

| Risk | Severity | Impact | Evidence | Initial fix |
|---|---|---|---|---|
| In-memory heavy job queue | High | Queued discovery/scan work is lost on process restart; not horizontally durable. | job-queue.ts, discovery.ts, projects.ts | Persist jobs or move to a worker/queue backend. |
| Best-effort audit writes | High | Successful business mutation may not leave an audit row if audit insert fails. | lib/audit.ts | Make audit transactional or at least expose failures to observability. |
| Fast model alias collapsed | Medium | MODEL_FAST currently equals MODEL_POWERFUL, so the intended cheap/faster path is dormant. | groq-client.ts | Reintroduce a smaller reliable model or remove the misleading constant. |
| Legacy / historical sprawl | Low | attached_assets and .agents contain many historical records that can mislead future reviews. | attached_assets/, .agents/ | Keep quarantined as historical context; do not treat as runtime truth. |
| Standalone mockup sandbox | Low | Separate preview server appears isolated from the main product and can be mistaken for production surface. | artifacts/mockup-sandbox/ | Document as sandbox/sidecar or remove if unused. |
| Generated-contract drift risk | Medium | Generated clients/schemas are only as correct as codegen and drift checks; a broken pipeline would desync UI/backend contracts. | api-spec, api-zod, api-client-react, scripts/check-codegen-drift.ts | Keep drift gate in CI and enforce regeneration on spec edits. |

### Highest priority
The top blocker is the lack of durable background processing. If the process restarts after accepting a discovery/scan job, the queued closure is lost even though the DB may already show a session/job row. That is the clearest place where the visible state can diverge from the real state.

---

## 12) Missing Components

- Durable job runner / external queue / worker process.
- Transactional or otherwise guaranteed audit trace path.
- A distinct smaller LLM model for the fast path, or removal of the misleading alias.
- Stronger quarantine/removal strategy for historical artifacts and sandbox surfaces.
- Runtime execution verification from a live environment, if you want trace claims beyond static analysis.

---

## 13) Development Roadmap

### Epic A — Job durability and execution reliability
1. Externalize or persist the queue.
2. Add worker process semantics.
3. Reconcile pending/queued jobs after restart.
4. Make failure states explicit in UI and API.

### Epic B — Trace and audit correctness
1. Tighten audit/event correlation.
2. Decide whether audit is best-effort or transactional.
3. Ensure one logical operation can be reconstructed end-to-end.

### Epic C — Contract and generated surfaces
1. Keep OpenAPI / Zod / React client drift gates enforced.
2. Fail CI on any mismatch.
3. Keep generated packages versioned with the spec.

### Epic D — Surface cleanup
1. Quarantine historical assets.
2. Document or retire the mockup sandbox.
3. Remove legacy backup files once no longer needed.

### Epic E — Model policy
1. Restore a true fast model path or remove the misleading constant.
2. Keep retry/circuit-breaker behavior explicit.

---

## 14) PR Backlog

### PR-01 — Durable background jobs
**Goal:** move discovery/scan from in-memory fire-and-forget to durable queued execution.  
**Files:** `artifacts/api-server/src/lib/job-queue.ts`, `routes/discovery.ts`, `routes/projects.ts`, `lib/scan-runner.ts`, startup reconciliation.  
**Acceptance:** jobs survive restart or are resumable; UI reflects durable states; no lost job closures.

### PR-02 — Audit/trace guarantees
**Goal:** ensure critical operations always leave a trace or fail visibly.  
**Files:** `lib/audit.ts`, routes that mutate project/task/workflow/discovery state, event creation helpers.  
**Acceptance:** every critical mutation has predictable audit/event/correlation coverage.

### PR-03 — LLM model policy cleanup
**Goal:** restore an actual fast path or remove the false distinction.  
**Files:** `lib/ai-orchestrator/src/groq-client.ts`, related tests.  
**Acceptance:** no misleading constant; fallback behavior is intentional and tested.

### PR-04 — Historical surface quarantine
**Goal:** reduce confusion from archival/sandbox content.  
**Files:** `attached_assets/*`, `.agents/memory/*`, `artifacts/mockup-sandbox/*`, stale docs.  
**Acceptance:** active runtime truth is clearly separated from historical context.

### PR-05 — Contract drift hardening
**Goal:** keep generated contracts aligned with OpenAPI and runtime routes.  
**Files:** `lib/api-spec/*`, `lib/api-zod/*`, `lib/api-client-react/*`, `scripts/check-codegen-drift.ts`.  
**Acceptance:** CI fails on drift; generated outputs always regenerate cleanly.

### PR-06 — Optional runtime verification pass
**Goal:** capture live traces to upgrade some static findings to runtime-confirmed.  
**Files:** test harness and operational scripts.  
**Acceptance:** validated boot, scan, discovery, AI, and export flows from a live environment.

| PR | Target | Dependency | Test focus |
|---|---|---|---|
| PR-01 | Durable jobs | none before it | restart / queue / status reconciliation |
| PR-02 | Audit guarantees | PR-01 optional | trace completeness / correlation |
| PR-03 | LLM policy | none | agent fallback behavior |
| PR-04 | Surface cleanup | none | docs / archive segregation |
| PR-05 | Contract drift | none | codegen diff / generated files |
| PR-06 | Runtime verification | core runtime stable | integration smoke tests |

---

## 15) Final Engineering Verdict

**Verdict:** the repository is a real multi-layer engineering platform with a credible core, not a scaffold.  
The architecture is strongest in contracts, persistence, scanner/knowledge graph separation, AI orchestration, and dashboard wiring.  
The biggest unresolved engineering gap is **durable execution** for heavy background work.  
The second biggest gap is **trace certainty** for auditability.  
If those two are fixed, the rest of the system is already much closer to a complete operational platform than a prototype.


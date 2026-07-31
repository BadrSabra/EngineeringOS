# EngineeringOS — Forensic Engineering Analysis

**Scope:** all files in the uploaded repository archive. **Code is treated as the source of truth**; documentation and attached artifacts are used only for comparison and provenance.

## 1) Executive Summary

- Total files analyzed: **697**.
- Runtime source files: **282**.
- Generated code files: **148**.
- Historical / evidence assets: **179**.
- Tests: **32**.
- Documentation and memory notes: **44**.
- OpenAPI paths: **54**; route declarations in api-server: **77**; DB tables: **15 schema modules / 17 tables**.

The repository is not a single app. It is a multi-layer platform composed of:

- a contract surface (`lib/api-spec`, `lib/api-zod`, `lib/api-client-react`),
- a persistence layer (`lib/db`),
- static analysis / graph extraction (`lib/scanner`, `lib/knowledge-engine`),
- AI orchestration (`lib/ai-orchestrator`),
- a hardened runtime API (`artifacts/api-server`),
- a dashboard (`artifacts/dashboard`),
- a mockup preview sandbox (`artifacts/mockup-sandbox`),
- and a large evidence/history/documentation layer (`docs`, `.agents/memory`, `attached_assets`).

The strongest part of the system is the **contract + server hardening stack**: schemas, auth, audit, event emission, rate limiting, and file/path guards are all explicit and generally consistent. The highest risk sits in the **AI/discovery/scan pipeline** because it combines LLM calls, file-system operations, scan orchestration, and mutable state.


## 2) System Architecture

### Package / layer map

|Layer|Main paths|Role|Health|
|---|---|---|---|
|Contracts|lib/api-spec, lib/api-zod, lib/api-client-react|OpenAPI source + generated runtime/client schemas|Mostly solid; generation drift must be watched|
|Data|lib/db|Drizzle schema + DB connection|Solid core; many tables and enums already in place|
|Static analysis|lib/scanner|Project walk, rule matching, graph extraction, metrics|Functional and substantial|
|Semantic inference|lib/knowledge-engine|Graph queries, pathing, layered views|Functional; depends on graph quality|
|AI orchestration|lib/ai-orchestrator|Groq gateway, prompts, parsing, tools, agents|Mature but highest drift risk|
|Backend runtime|artifacts/api-server|Express app, auth, routes, jobs, audit, plugin runtime|Most operationally complete layer|
|UI|artifacts/dashboard|Operational dashboard and workflows|Good breadth, but some surfaces are still read-heavy|
|Sandbox|artifacts/mockup-sandbox|Preview generator for mockups|Reference / preview surface|
|Governance|docs, .agents/memory, attached_assets|Truth records, plans, historical evidence|Useful, but some docs are stale|


### Dependency direction

- `dashboard` → `api-client-react` → generated client + fetch wrapper.

- `api-server` → `db`, `api-zod`, `scanner`, `knowledge-engine`, `ai-orchestrator`.

- `ai-orchestrator` → `db` and local schemas/prompts/tools; it never owns persistence.

- `knowledge-engine` and `scanner` are read/compute layers; they do not own API routes.

- `api-spec/openapi.yaml` is the generation source for `api-zod` and `api-client-react`.

- `docs` and `attached_assets` are comparison / evidence layers only.


## 3) Layer-by-Layer Analysis

### Contracts

The OpenAPI spec currently exposes **54 paths**. The api-server implements **77 route declarations** across the route files, which means the runtime surface is wider than the spec in some places and must remain code-generated carefully. The `codegen` and `check-codegen-drift` scripts explicitly enforce that `lib/api-zod/src/generated` and `lib/api-client-react/src/generated` stay in sync with `lib/api-spec/openapi.yaml`.

### Persistence

`lib/db/src/schema/*` defines the core domain: projects, rules, workflows, tasks, events, metrics, graph entities/relationships, task logs, plugins, audit logs, discovery sessions, scan jobs, AI chat sessions, and AI provider credentials. This is the real state backbone of the product.

### Scanner

`lib/scanner/src/graph-extractor.ts` is the knowledge-graph heart of static analysis. It walks TypeScript and Python, produces entities, relationships, evidence, provenance, and heuristic fallbacks. `rule-matcher.ts` and `metrics-calc.ts` give the scan pipeline business value beyond raw extraction.

### Knowledge engine

`lib/knowledge-engine/src/queries.ts` and `inference.ts` expose typed traversal, neighborhood, shortest path, impact, semantic neighborhood, layered view, provenance annotation, cluster detection, and summary computation. It is a derived layer; correctness depends on graph quality.

### AI orchestration

The AI layer is built around `groq-client.ts`, `context-builder.ts`, `parsing.ts`, `tools/file-tools.ts`, `tools/git-tools.ts`, and the agent modules. This layer is robustly defended with schemas and bounded retries, but it is also where hidden coupling accumulates fastest.

### API server

The server is the most complete runtime layer. `app.ts` hardens the process with etag disabling, proxy trust, helmet, rate limiting, Clerk integration, body limits, cache-control, and a central error handler. `index.ts` performs startup reconciliation/migrations before listening.

### Dashboard

The dashboard is broad and operational: projects, discovery wizard, graph, tasks, workflows, rules, events, metrics, and AI chat. It consumes generated clients and does not own business state.


## 4) File-by-File Analysis

A full file inventory for all **697** files is provided in the CSV artifact. The important file classes are:

- **Live core runtime**: 258 files.

- **Generated code**: 148 files.

- **Historical / evidence assets**: 179 files.

- **Tests**: 32 files.

- **Docs / memory**: 44 files.


#### High-value runtime files

|File|Role|Why it matters|
|---|---|---|
|artifacts/api-server/src/app.ts|Server bootstrap + hardening|Owns auth, security, cache policy, body limits, global error handling|
|artifacts/api-server/src/index.ts|Process entrypoint|Runs reconciliation and startup migrations before listen|
|artifacts/api-server/src/routes/ai.ts|AI control plane|Chat, apply changes, Groq key, analysis, review, workflow orchestration|
|artifacts/api-server/src/routes/discovery.ts|Discovery pipeline|Source resolution, project import, discovery sessions|
|artifacts/api-server/src/routes/projects.ts|Project lifecycle|Create/update/delete/scan/summary and job handoff|
|artifacts/api-server/src/routes/tasks.ts|Task lifecycle|Execute/retry/rollback and logs|
|artifacts/api-server/src/routes/workflows.ts|Workflow lifecycle|CRUD + execution state transitions|
|artifacts/api-server/src/routes/graph.ts|Knowledge graph API|Traversal, path, evidence, subgraph, layered views|
|artifacts/api-server/src/routes/git.ts|Git integration|Status/log/commit/push and token handling|
|lib/ai-orchestrator/src/agents/workflow-orchestrator.ts|Workflow decision engine|Model decision validation and controlled execution|
|lib/ai-orchestrator/src/context-builder.ts|Prompt context assembler|Builds the project context every agent sees|
|lib/scanner/src/graph-extractor.ts|Graph extraction core|Produces the runtime knowledge graph|
|lib/knowledge-engine/src/queries.ts|Graph query layer|Paths, impact, neighborhood, provenance views|
|lib/db/src/schema/index.ts|DB schema barrel|Defines the real data model surface|


#### File-level hotspots and notable gaps

- `artifacts/api-server/src/routes/ai.ts`: process-local orchestration lock and per-project rate limiting are intentionally local; they become incorrect in a multi-instance deployment.

- `artifacts/api-server/src/lib/job-queue.ts` + `job-reconciliation.ts`: good crash recovery for a single process, but still in-memory orchestration.

- `artifacts/api-server/src/lib/path-validation.ts`: strong safety boundary, but the temp-path bypass is a deliberate special-case that must remain tightly scoped.

- `lib/ai-orchestrator/src/context-builder.ts`: context caching improves latency, but any stale/ordering bug here affects every AI response.

- `lib/ai-orchestrator/src/groq-client.ts`: the provider gateway is mature, but provider model availability and retry semantics remain a live risk surface.

- `artifacts/mockup-sandbox/src/.generated/mockup-components.ts` and `artifacts/mockup-sandbox/mockupPreviewPlugin.ts`: preview tooling only; not part of product runtime.


## 5) Execution Flow Analysis

### Boot / runtime entry

`artifacts/api-server/src/index.ts` → `app.ts` → `routes/index.ts` → route modules.

Before traffic is accepted, `reconcileStuckJobs()` and `fixDeadRootPaths()` run. This is a clear signal that the system expects crashes or interrupted jobs and tries to self-heal.


### Discovery → scan → graph flow

`routes/discovery.ts` resolves a source via `discovery-adapters.ts`, creates discovery sessions and/or imports, then `projects.ts` and `scan-runner.ts` take over for full scans. `scan-runner.ts` performs file walking, rule matching, graph extraction, metrics computation, audit writes, event writes, and plugin dispatch.


### AI chat / apply-changes flow

`routes/ai.ts` loads project context via `buildProjectContext()`, calls `chat()` in the orchestrator, stores chat sessions/messages, manages pending changes, and applies user-approved changes with explicit filesystem writes. `file-tools.ts` is the security boundary for read/list/search/write proposals.


### Task / workflow flow

Tasks are created and executed in `routes/tasks.ts`; workflows are created and transitioned in `routes/workflows.ts`; the AI orchestrator can also generate workflow decisions through the AI route. Events, logs, and audit rows are used to keep state visible to the UI and subsequent requests.


### Graph / knowledge flow

`routes/graph.ts` is a thin semantic/query facade over `knowledge-engine`, which in turn reads the graph tables from `db`.


### Git flow

`routes/git.ts` stores encrypted GitHub tokens, reads status/log/config, commits/pushes, and can trigger scans. It is security-sensitive because it combines authentication, token handling, and repository mutation.


## 6) Documentation Gap Analysis

The documentation layer contains useful truth records, but several documents are stale relative to the current archive.

- `docs/EXECUTION_ALIGNMENT_REPORT.md` claims **595 files**, **49 OpenAPI paths**, and **62 route declarations**; the current archive has **697 files**, **54 OpenAPI paths**, and **77 route declarations**.

- `docs/PR_BACKLOG.md`, `docs/PLACEHOLDER_REGISTER.md`, and `docs/fact-record.md` are useful but should be treated as historical alignment notes, not as final truth without revalidation.

- `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md` is the strongest document in the set conceptually, but it still needs code-based re-verification against the current tree.

- `docs/ai-orchestrator-*` correctly describe the AI layer as a layered control surface, and their main value is traceability rather than authority over the code.


## 7) Code Quality Assessment

|Dimension|Assessment|Evidence|
|---|---|---|
|Validation|Strong|Zod schemas throughout API and AI layer; strict parsing in many entrypoints|
|Security|Strong|Auth middleware, path validation, token encryption, rate limiting, cache-control, redaction|
|Separation of concerns|Good|Routes delegate to libs; scanner/engine/orchestrator are separated|
|Coupling|Moderate|Many layers depend on DB schemas and generated contracts; expected but tight|
|Cohesion|Good|Most modules have one clear job|
|Hidden dependencies|Present|Process-local locks, in-memory queues, context cache, rate-limit counters|
|Testability|Good but uneven|Core libs have tests; dashboard is lighter on tests than server/lib code|
|Generated drift risk|High|OpenAPI → api-zod/api-client-react generation must stay synchronized|


## 8) Technical Debt Report

1. **Cross-instance correctness debt**: in-memory orchestration locks and rate limiting are safe only in a single process.

2. **Codegen coupling debt**: the OpenAPI contract must stay synchronized with generated schemas/clients.

3. **Historical artifact bloat**: `attached_assets` contains many large historical reports, zips, and screenshots that are not runtime.

4. **Sandbox duplication**: `artifacts/mockup-sandbox` duplicates a large UI primitive set for preview purposes.

5. **Context freshness debt**: the AI context builder must remain aligned with DB reality and ordering rules.


## 9) Completion Assessment

|Part|Completion|Reason|
|---|---|---|
|DB schema / persistence|90%|Core tables and enums are present; models are broad and connected|
|Runtime API server|80%|Broad route coverage, hardening, audit, and startup recovery already exist|
|Contract generation|85%|OpenAPI + generated Zod/client surfaces are in place, but drift guard is essential|
|Scanner|75%|Static extraction, rules, metrics, provenance are present; still depth-sensitive|
|Knowledge engine|75%|Useful graph query/inference layer, but depends on graph quality|
|AI orchestrator|70%|Agents, prompts, parsing, tools, schemas, and tests exist; provider/runtime drift risk remains|
|Dashboard|65%|Breadth is there, but some surfaces are mostly consumption/UI and some workflows are still shallow|
|Discovery pipeline|60%|Adapters and sessions exist, but source resolution/import behavior is a key risk area|
|Git integration|65%|Useful and security-aware, but token/push/scan coupling remains sensitive|
|Documentation truth|55%|Important but stale in places; needs revalidation against the current tree|


## 10) Risk Assessment

|Risk|Severity|Why|
|---|---|---|
|LLM/provider failures or drift|High|AI layer is central and touches state, parsing, and user-visible actions|
|Discovery source resolution / temp clones|High|Can create dead project roots or broken imports|
|Scan runner correctness|High|Feeds graph, metrics, events, audit, and plugin hooks|
|Workflow phase correctness|High|State machine logic must never accept invalid transitions|
|Cross-process contention|Medium-High|Current locking/rate-limiting is process-local|
|Generated contract drift|Medium-High|API spec changes must regenerate clients/schemas|
|Historical docs confusion|Medium|Old reports can mislead unless revalidated|


## 11) Missing Components

- Distributed locks or a DB-backed mutex for AI/workflow orchestration.

- Cross-instance shared rate limiting for LLM calls.

- More explicit runtime support for long-running / resumable jobs beyond in-process queue semantics.

- More comprehensive integration tests spanning discovery → scan → graph → UI refresh.

- Revalidation and consolidation of stale truth documents.


## 12) Development Roadmap

### Epic A — Truth & contract stabilization

Revalidate OpenAPI, generated Zod/client code, truth-flow matrix, and current docs against the real tree.

### Epic B — Runtime hardening

Strengthen AI, discovery, scan, and workflow execution boundaries for concurrency, rate limiting, and failure recovery.

### Epic C — Graph intelligence

Deepen graph extraction, provenance, layered subgraphs, and semantic query confidence.

### Epic D — Product UX

Make the dashboard reflect the actual runtime truth more directly, with better refresh and failure visibility.


## 13) PR Backlog

|PR|Goal|Files|Risk|
|---|---|---|---|
|PR-01|Truth baseline sync|Reconcile docs/truth registers with current tree and generated surfaces|docs/*, attached truth records|High|
|PR-02|OpenAPI / generated client drift guard|Lock in regeneration checks and fix any stale schema output|lib/api-spec, lib/api-zod, lib/api-client-react, scripts/check-codegen-drift.ts|High|
|PR-03|AI context & cache correctness|Ensure context ordering/freshness; harden cache invalidation and rate limits|lib/ai-orchestrator/src/context-builder.ts, artifacts/api-server/src/routes/ai.ts|High|
|PR-04|Discovery resolution hardening|Make source adapters and project import paths fully deterministic|artifacts/api-server/src/lib/discovery-adapters.ts, routes/discovery.ts, path-validation.ts|High|
|PR-05|Scan pipeline durability|Improve scan runner recovery, provenance, and event/audit consistency|artifacts/api-server/src/lib/scan-runner.ts, job-queue.ts, job-reconciliation.ts, graph-provenance.ts|High|
|PR-06|Workflow state machine hardening|Make phase ordering and transitions stricter and better tested|lib/ai-orchestrator/src/agents/workflow-orchestrator.ts, routes/workflows.ts|High|
|PR-07|Git integration safety|Harden token handling, push/commit flows, and scan side-effects|artifacts/api-server/src/routes/git.ts, credentials-crypto.ts|Medium-High|
|PR-08|Graph query and provenance depth|Improve layered view, observed-runtime subgraph, and evidence annotation|lib/knowledge-engine/src/*, routes/graph.ts, scanner|Medium|
|PR-09|Dashboard truth surfacing|Make UI reflect actual failures, refresh, and audit/event state better|artifacts/dashboard/src/pages/*|Medium|
|PR-10|Integration smoke tests|End-to-end tests for discovery → scan → graph → AI → apply|server/lib tests and dashboard flows|High|


Parallelizable work: PR-02, PR-07, PR-08, PR-09. Strictly ordered work: PR-01 before everything else that depends on current truth; PR-03/04/05/06 before broad UX polish; PR-10 after the main runtime paths are stable.


## 14) Final Engineering Verdict

The repository is a **real, multi-layer engineering platform** with a strong contract-first and audit-first backbone. It is not a prototype. The code already contains production-grade patterns: validated schemas, generated clients, bounded queues, reconciliation, provenance, security hardening, and explicit workflow/state handling. The main gaps are not in the existence of the architecture but in **cross-layer correctness under drift, concurrency, and evolving truth documents**.

The center of gravity is the **AI + discovery + scan + graph loop**. That is where product value and most risk both live. The project is far enough along that the right next step is not rediscovery; it is **stabilization, drift closure, and end-to-end hardening**.


### File-by-file appendix

See the CSV inventory for all 697 files with category, live status, role guess, line count, imports, exports, TODO hits, and incoming internal dependency count: `EngineeringOS_file_inventory_v2.csv`.

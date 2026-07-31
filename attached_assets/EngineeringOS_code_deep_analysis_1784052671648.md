# EngineeringOS — Code Deep Analysis

> Focus: implementation-level reading of the code paths that actually drive the platform.

## 1) What the codebase is, structurally

EngineeringOS is not a single app. The implementation is split into:

- `lib/db`: canonical data model and enums
- `lib/api-spec` + `lib/api-zod` + `lib/api-client-react`: contract-first API layer and generated clients
- `lib/scanner`: source analysis engine
- `lib/knowledge-engine`: pure graph traversal/inference
- `lib/ai-orchestrator`: model gateway, schema parsing, prompt orchestration
- `artifacts/api-server`: HTTP API + job execution + auth + persistence
- `artifacts/dashboard`: operator UI

The important point is that the code already reflects a multi-layer platform, not a prototype with one backend and one frontend.

## 2) Root-level enforcement and build shape

### `package.json`
- Enforces pnpm only.
- `codegen:check` guards against contract drift in generated clients/schemas.
- `build` is contract-first: codegen → typecheck → build.
- This is strong evidence that the platform treats the OpenAPI spec as the source of truth.

### `replit.md`
- Documents runtime ports, env requirements, and the layered architecture.
- It also states an important access policy: `/api/*` is authenticated except health, and `requireProjectAccess` is the main ownership gate for project-scoped routes.

## 3) HTTP server hardening

### `artifacts/api-server/src/app.ts`
The server is not bare Express. It already includes:

- ETag disabled to avoid stale conditional responses for per-user dynamic API data.
- Clerk proxy mounting before other routes.
- `trust proxy = 1` to make rate limiting use the real client IP behind Replit’s proxy.
- `helmet`
- rate limiting
- structured request logging
- body size limits
- Clerk auth middleware with host-based publishable key resolution

This is a mature operational baseline. The main risk is not missing middleware; the risk is uneven route-level authorization coverage later in the API.

### `artifacts/api-server/src/middlewares/requireAuth.ts`
- In production/test it enforces session presence.
- In test mode it injects a synthetic user so route tests exercise business logic instead of auth plumbing.
- It is session authentication only, not authorization.

### `artifacts/api-server/src/middlewares/requireProjectAccess.ts`
- This is the real ownership gate for `:projectId` routes.
- It returns:
  - `400` for missing projectId
  - `404` if no project row exists
  - `403` if the project belongs to someone else
- It also exposes `loadProjectByIdForUser` for routes where `projectId` is in query/body rather than path params.

That is a solid pattern. The remaining issue is route completeness: project ownership checks need to be applied consistently everywhere `projectId` is used indirectly.

## 4) Database model: the system’s real backbone

### `lib/db/src/schema/*.ts`
The schema layer is one of the strongest parts of the project.

#### Core tables
- `projects`
- `tasks`
- `rules`
- `workflows` / `workflow_executions`
- `events`
- `metrics`
- `graph_entities` / `graph_relationships`
- `audit_logs`
- `scan_jobs`
- `discovery_sessions`
- `plugins`
- `ai_chats`

#### Important design choices
- Foreign keys are present for the main graph between projects, tasks, workflows, metrics, events, scans.
- Domain enums are explicit: status, severity, source type, entity type, build status, etc.
- Many operational records include `correlationId`, which is excellent for traceability across audit/event/metrics/task rows.
- `graph_entities` and `graph_relationships` carry provenance data, which is important for trust and explainability.

### Strongest schema facts
- `scan_jobs` gives the scan pipeline first-class lifecycle state.
- `discovery_sessions` stores source type, config, steps, result, imported project ID.
- `audit_logs` is broad enough to capture user/system/plugin changes.
- `workflow_executions` separates a workflow definition from execution history.

### Structural gap visible in schema
The schema is good, but some routes still do not consistently exploit the full structure. In other words, the model exists, but some execution paths are still catching up to it.

## 5) Discovery pipeline: this is real, not a mock

### `artifacts/api-server/src/lib/discovery-adapters.ts`
Discovery is implemented as a source-adapter registry:

- `LOCAL_FOLDER`
- `GIT_REPOSITORY`
- `WORKSPACE_PROJECT`
- `ARCHIVE_UPLOAD` — stub
- `REMOTE_FILESYSTEM` — stub
- `DOCKER_VOLUME` — stub

Supported adapters already do meaningful work:
- local path normalization
- git clone with optional credentials and branch support
- workspace project lookup through the DB

This is a strong architectural choice because it keeps `routes/discovery.ts` independent from source-type specifics.

### `artifacts/api-server/src/routes/discovery.ts`
The discovery route is one of the most important code paths in the system.

It does all of this:
1. Validates input
2. Resolves the source into a local path
3. Rejects dangerous paths
4. Creates a `discovery_sessions` row
5. Queues async discovery work via the bounded job queue
6. Exposes session polling
7. Exposes summary retrieval
8. Imports a discovered project in a transaction
9. Emits metrics, graph seeds, tasks, events
10. Writes audit trail after commit

#### Discovery logic quality
The route contains:
- file path validation against system directories
- cleanup of temporary clones
- idempotency/concurrency control on import
- a transaction that inserts project + claims the session + inserts initial metrics/tasks/events
- support for discovery progress steps

#### What is still partial
The discovery system is strong, but some source types are still only capability stubs. That means the platform is designed for wider intake than it can yet fully execute.

## 6) Scan execution pipeline: one of the most mature areas

### `artifacts/api-server/src/routes/projects.ts`
The project scan route no longer does heavy work inline.
It:
- creates a `scan_jobs` row
- flips the project to `scanning`
- returns immediately
- lets polling handle completion

That is the right shape for scalability.

### `artifacts/api-server/src/lib/job-queue.ts`
- Bounded concurrency job queue with global limit = 2.
- Prevents discovery + scan bursts from saturating the event loop.
- It is simple and correct for in-process heavy work.

### `artifacts/api-server/src/lib/job-reconciliation.ts`
- On startup, it finds orphaned `queued` / `running` jobs and marks them failed.
- It also resets projects stuck in `scanning`.
- Discovery sessions stuck in `discovering` are marked error.

This is excellent operational hygiene for a single-process in-memory queue design.

### `artifacts/api-server/src/lib/scan-runner.ts`
This file is a core truth source.

It performs:
1. project load
2. rule loading
3. file walk
4. rule matching
5. metric calculation
6. atomic DB transaction:
   - create tasks from matched rules
   - update rule hit counts
   - extract and persist graph entities
   - persist graph relationships
   - insert metrics
   - restore project status to active
   - emit scan event
7. post-commit audit
8. post-commit plugin dispatch

#### What is especially strong
- Uses a single correlation ID across the operation.
- Handles plugin dispatch outside the transaction, so plugins cannot rollback scan success.
- Treats audit as best-effort telemetry, not a source of user-facing failure.
- Protects against duplicate task creation by checking existing rule tasks.

#### What to watch
- The transaction is large and highly coupled. That is good for integrity, but it means any new side-effect added here must be reviewed carefully for rollback semantics.

## 7) Task/workflow/event model: explicit and operational

### `artifacts/api-server/src/routes/tasks.ts`
Tasks are more than CRUD:
- list / create / get / update / delete
- execute
- retry
- rollback
- logs
- state transitions

The route uses project ownership checks for every task path through the task’s project link. That is good.

### `artifacts/api-server/src/routes/workflows.ts`
Workflows are also modeled as operational objects:
- create/list/get/delete
- start/stop
- list executions
- phase management
- concurrency-safe start via transactional claim

The start flow is particularly strong because it prevents double-start races with a conditional update inside a transaction.

### `lib/db/src/schema/events.ts`
Events are a real audit/event bus in DB form:
- project-linked
- task-linked
- workflow-linked
- payload and severity
- correlation ID

This gives the system a proper event narrative.

## 8) Knowledge graph layer: pure and useful

### `lib/scanner/src/graph-extractor.ts`
The scanner layer extracts entities and relationships from source trees.

### `lib/knowledge-engine/src/queries.ts` and `inference.ts`
This layer is intentionally pure:
- compute centrality
- detect clusters
- summary statistics
- shortest path / neighborhood / impact queries

This is good design: the knowledge engine is separated from persistence and from extraction.

The key limitation is that graph quality depends heavily on upstream extraction quality. The engine itself is clean; the bottleneck is how much signal the scanner can extract.

## 9) Scanner quality and extraction depth

### `lib/scanner/src/file-walker.ts`
The walker handles project file enumeration and root discovery. This is foundational because everything else depends on it.

### `lib/scanner/src/rule-matcher.ts`
Rules are pattern-based and output severity-aware matches.

### `lib/scanner/src/metrics-calc.ts`
Metrics are derived from:
- file structure
- test/config/doc presence
- rule violations
- oversized files
- overall architecture heuristics

This is intentionally heuristic. It is useful, but it is not a substitute for real verification.

### `lib/scanner/src/python-extractor.ts`
This is a strong implementation detail:
- uses a real Python subprocess
- parses Python with the stdlib `ast` module
- batches all Python files into one process
- has timeout and failure handling

That is much better than regex-based Python parsing.

### `lib/scanner/src/python-ast-script.py`
The embedded script is careful:
- top-level defs only
- class methods captured
- private-by-convention names skipped
- one broken file does not abort the whole batch

This shows a thoughtful extraction design.

## 10) AI orchestration: architecturally good, operationally guarded

### `lib/ai-orchestrator/src/groq-client.ts`
This is a proper provider gateway:
- request building
- timeout
- retry policy
- error classification
- non-streaming completion handling
- no raw SDK errors escape

### `lib/ai-orchestrator/src/parsing.ts`
Very important file.
- Strips fences and commentary
- Extracts JSON
- Validates via Zod
- Returns fallback instead of throwing

That is the right design for model uncertainty.

### `lib/ai-orchestrator/src/context-builder.ts`
Builds prompt context from:
- project
- recent tasks
- latest metrics
- graph snapshot
- recent events

This is a real operational context builder, not just a prompt string holder.

### `lib/ai-orchestrator/src/agents/*`
The agent layer is separated by responsibility:
- chat
- task execution
- scan analysis
- code review
- workflow orchestration

This is good separation, but the robustness of the whole layer still depends on schema discipline and prompt contract hygiene.

## 11) Dashboard code: more complete than it looks

### `artifacts/dashboard/src/App.tsx`
- Routing is split between public landing and protected app routes.
- Clerk gating is applied at the route level.
- Shell wraps authenticated pages.

### `artifacts/dashboard/src/components/layout/Shell.tsx` and `Sidebar.tsx`
- There is a real operator shell with navigation, search field, status indicator, and logout.
- Navigation reflects the platform model: projects, tasks, rules, workflows, events, metrics, graph, AI assistant.

### Pages
- `Projects`, `ProjectDetail`, `Tasks`, `Rules`, `Workflows`, `Events`, `Metrics`, `Graph`, `AiChat`, `DiscoverProjectWizard`

The UI is not blank. Several pages have real data fetching and interactive filters.  
However, some placeholders remain in layout/input components and in the discover wizard / assistant surfaces. The app is functionally usable, but not yet polished enough to be considered fully production-hardened.

## 12) Code-level gaps that matter most

### A. Source-type coverage is incomplete
Discovery supports six source types architecturally, but only a subset is fully implemented.

### B. Authorization coverage is uneven
Ownership checks are strong in project routes and in many task/workflow paths, but indirect projectId flows still need uniform auditing.

### C. Graph extraction depth is still limited
The graph engine is good, but extraction is still mostly structural. More semantic richness is possible.

### D. UI needs consistency work
The dashboard is functional, but some screens still feel like “operational views under construction” rather than a fully finished command center.

### E. AI boundary needs continued hardening
Parsing, schema enforcement, and prompt contracts are already present; the remaining work is quality assurance and edge-case coverage.

## 13) Practical build order from the code

1. Tighten route authorization completeness.
2. Finish the source adapters for discovery.
3. Increase scanner fidelity and graph provenance depth.
4. Add stronger runtime tests around job reconciliation and atomic scan/import flows.
5. Harden AI prompt contracts and failure fallbacks.
6. Remove remaining dashboard placeholders and align UX with actual backend states.
7. Add regression tests that assert the contract-generated client remains in sync with OpenAPI.

## 14) Bottom line

The codebase already contains a genuine multi-layer engineering platform:

- strong schema backbone
- real discovery pipeline
- bounded heavy-job execution
- transactional scan/import flows
- auditable events and correlation IDs
- pure knowledge inference
- guarded AI orchestration
- meaningful operator UI

The remaining work is not “build the product from zero.”  
It is “finish the platform contract, close the incomplete adapters, deepen the extraction quality, and standardize the UI/authorization behavior across every route.”

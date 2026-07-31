# EngineeringOS Forensic Analysis Report

## Scope note
This report applies the analysis prompt to the project archive in `EngineeringOS-main (95).zip` and the prompt PDF itself. I focused on the files the prompt prioritizes first: `artifacts/api-server/src/**`, `artifacts/dashboard/src/**`, `lib/ai-orchestrator/src/**`, `lib/scanner/src/**`, `lib/knowledge-engine/src/**`, `lib/db/src/schema/**`, `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`, `docs/*`, `.agents/memory/*`, `.github/workflows/*`, and `scripts/*`. I also sampled the most important supporting files inside those trees.  
Where evidence is incomplete, I mark the item as `غير محسوم` instead of guessing.

## 1) Executive summary
- The repository is a real monorepo with a working runtime stack, not just a design document set. It contains an Express API server, a React dashboard, a Drizzle/Postgres data layer, a scanner pipeline, a knowledge-engine layer, and an AI orchestration layer.
- The execution path is real and layered: `src/index.ts` bootstraps the API server, checks for schema push, ensures encryption keys, reconciles stuck jobs, fixes dead root paths, then starts the listener.
- The main architectural trust boundary is ownership scoping by `ownerId` and Clerk session auth. `requireAuth` + `requireProjectAccess`/`loadProjectByIdForUser` are present and used in the routes that matter.
- The OpenAPI spec, generated Zod schemas, and generated React client exist, and the repo has drift-check scripts plus CI jobs specifically guarding contract drift.
- The biggest remaining operational risk is durability of async work: job queue work is process-local and crash-recovery is handled by reconciliation rather than a durable external queue.
- The documents are explicitly split into current truth vs historical logs: `docs/architecture.md` is the current baseline, while `docs/completion-plan.md` and `docs/fact-record.md` are historical logs. The repo itself says so.
- I did not find an obvious route/spec path mismatch from the route list and OpenAPI path list; that is a textual inference from the extracted lists, not a full semantic diff.

## 2) File inventory and impact map
Approximate archive scale:
- Total archive entries: `1008`
- `artifacts/api-server`: `81` files
- `artifacts/dashboard`: `94` files
- `lib/ai-orchestrator`: `52` files
- `lib/scanner`: `15` files
- `lib/knowledge-engine`: `8` files
- `lib/api-spec`: `3` files
- `lib/api-zod`: `169` files
- `lib/api-client-react`: `8` files
- `lib/db`: `21` files
- `docs`: `17` files
- `.agents/memory`: `43` files
- `scripts`: `9` files
- `attached_assets`: large historical/auxiliary corpus; not treated as the live runtime baseline unless imported by runtime code

Tests found:
- `44` test files total across api-server, dashboard, ai-orchestrator, scanner, and knowledge-engine.

High-impact files actually reviewed:
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/config.ts`
- `artifacts/api-server/src/middlewares/requireAuth.ts`
- `artifacts/api-server/src/middlewares/requireProjectAccess.ts`
- `artifacts/api-server/src/lib/discovery-adapters.ts`
- `artifacts/api-server/src/lib/discovery-runner.ts`
- `artifacts/api-server/src/lib/scan-runner.ts`
- `artifacts/api-server/src/lib/job-queue.ts`
- `artifacts/api-server/src/lib/job-reconciliation.ts`
- `artifacts/api-server/src/lib/graph-provenance.ts`
- `artifacts/api-server/src/lib/plugin-runtime.ts`
- `artifacts/api-server/src/routes/*.ts`
- `lib/db/src/schema/*.ts`
- `lib/scanner/src/*.ts`
- `lib/knowledge-engine/src/*.ts`
- `lib/ai-orchestrator/src/*.ts`
- `lib/api-spec/openapi.yaml`
- `scripts/check-codegen-drift.ts`
- `scripts/validate-truth-flow.ts`
- `scripts/verify-setup.sh`
- `.github/workflows/ci.yml`
- `docs/architecture.md`
- `docs/RUNTIME_EXECUTION_MATRIX.md`
- `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md`
- `docs/PR_BACKLOG.md`
- `docs/completion-plan.md`
- `docs/fact-record.md`
- several `.agents/memory/*.md` notes tied to auth, discovery, job durability, codegen drift, and scanner behavior

## 3) Package map and dependency direction
Observed dependency direction:
- `lib/db` is the persistence foundation.
- `lib/api-spec` is the API contract source of truth.
- `lib/api-zod` and `lib/api-client-react` are generated contract consumers.
- `lib/scanner` reads files and produces graph/metrics evidence.
- `lib/knowledge-engine` performs traversal and inference over graph data.
- `lib/ai-orchestrator` provides provider registry, prompt composition, parsing, tool policy, and workflow/chat logic.
- `artifacts/api-server` composes everything into HTTP routes and background execution.
- `artifacts/dashboard` is the user-facing SPA and consumes generated client/types.

This direction is consistent with the architecture doc and with the code imports. I did not find any `lib/*` package importing from `artifacts/*`, which matches the documented one-way dependency rule.

## 4) Project goal and scope
The active system is an engineering analysis / operational truth platform. The runtime surface supports:
- project discovery and scanning
- task, rule, workflow, event, metrics, graph, plugin, and AI routes
- ownership-scoped access to per-project data
- generated contract-based API consumption in the dashboard
- truth-checking and codegen-drift checks

The prompt’s required distinction between “what is real” and “what is just documentation” is reflected in the repo itself:
- `docs/architecture.md` is presented as the current baseline
- `docs/completion-plan.md` and `docs/fact-record.md` are explicitly historical logs
- `docs/PR_BACKLOG.md` is a current execution backlog
- `.agents/memory/*.md` are operational notes that help explain why the code is shaped the way it is, but they are not above the code

## 5) Architecture as implemented
The current runtime shape is:

`Dashboard -> API Server -> DB / Scanner / Knowledge Engine / AI Orchestrator`

The API server is the hub. It mounts:
- `healthRouter`
- `discoveryRouter`
- `projectsRouter`
- `tasksRouter`
- `rulesRouter`
- `workflowsRouter`
- `eventsRouter`
- `metricsRouter`
- `graphRouter`
- `pluginsRouter`
- `dashboardRouter`
- `aiRouter`
- `gitRouter`
- `uploadRouter`

The startup path in `src/index.ts` is strong evidence of the actual boot sequence:
1. establish cache invalidation channel
2. assert schema exists
3. ensure AI credential encryption key
4. reconcile stuck jobs
5. fix dead root paths
6. start listening
7. start stale job sweep after successful bind

## 6) Layer analysis
### API layer
Real and implemented. Express 5 routes exist for projects, tasks, rules, workflows, events, metrics, graph, plugins, discovery, upload, git, dashboard, AI, and health.

### Auth / middleware layer
Real and implemented. `requireAuth` attaches `authContext` and supports a test bypass. `requireProjectAccess` and `loadProjectByIdForUser` enforce 404/403 semantics based on ownership.

### Service layer
Present in both `api-server/src/lib` and `api-server/src/services`. The service layer is not cosmetic: it contains job queue logic, reconciliation, discovery helpers, path validation, plugin runtime, audit, and credentials crypto.

### DB / persistence layer
Real and strongly structured. Drizzle schemas exist for all major runtime entities.

### Discovery / scanner layer
Real. The discovery adapters resolve local folder, git repo, workspace project, and archive upload. Unsupported source types are explicitly marked unavailable.

### Knowledge graph / inference layer
Real. The knowledge engine exposes pure traversal and inference functions over graph entities and relationships.

### AI orchestration layer
Real. Provider registry, parsing, prompt composition, workflow/chat/task execution, and gating logic all exist.

### Frontend / dashboard layer
Real. The dashboard is a routed React SPA with shell/layout and domain pages.

### Generated contract layer
Real. OpenAPI → generated Zod schemas and React client are present, and the repo has drift guards.

### Scripts / ops layer
Real. The repository has explicit scripts for codegen drift, truth validation, and setup verification, plus CI checks.

## 7) Major components and what they do
### Startup / boot
- `src/index.ts` is responsible for fail-fast startup checks and queue/reconciliation setup.
- `src/app.ts` handles security middleware, body size limits, no-store header on `/api`, health route precedence, Clerk mounting, and error translation.

### Auth / scoping
- `requireAuth` is the authentication gate.
- `requireProjectAccess`, `requireProjectWriteAccess`, and `loadProjectByIdForUser` are the ownership gates.
- Write access is blocked for archived projects.

### Discovery
- `discovery-adapters.ts` defines supported/unsupported source adapters and resolves them into local root paths.
- `discovery.ts` exposes source capability listing and discovery/import routes.
- Unsupported adapters are treated as explicit 501 cases, not silent failures.

### Scan pipeline
- `scan-runner.ts` and related helpers are the scan execution core.
- `scanner` package performs file walking, rule matching, graph extraction, and metrics calculation.
- `graph-provenance.ts` and the knowledge-engine make scan output traceable.

### AI
- `ai-orchestrator` is not a thin stub; it contains clients, provider registry, prompt builders, parsing, schemas, and agent orchestration.
- The chat agent has explicit tool limits, tool policies, and parse-failure handling.
- Workflow orchestration has a metrics gate that prevents advance/complete when the project metrics are unverified.

### Dashboard
- The dashboard routes map to Projects, ProjectDetail, Tasks, Rules, Workflows, Events, Metrics, Graph, and AiChat.
- Query cache invalidation on user change is implemented in the app shell.

## 8) Execution path findings
### API server startup
Confirmed from `src/index.ts`:
- schema sentinel check on `projects` table
- `ensureEncryptionKey()`
- `reconcileStuckJobs()`
- `fixDeadRootPaths()`
- `app.listen(...)`
- `startStaleJobSweep()`

### Route mounting
Confirmed from `routes/index.ts`:
- discovery comes before projects
- then tasks, rules, workflows, events, metrics, graph, plugins, dashboard, ai, git, upload

### Route coverage
Observed route list is broad and consistent with the OpenAPI path list. The route tree includes:
- projects / tasks / rules / workflows
- events / metrics / graph
- discovery / upload / git / plugins
- dashboard / ai / health

### Dashboard routing
The dashboard uses Wouter routes and Clerk gating. Signed-out users land on the landing page; signed-in users are routed into the shell.

## 9) Data and storage
### Actual tables found
- `projects`
- `rules`
- `workflows`
- `workflow_executions`
- `tasks`
- `task_logs`
- `events`
- `metrics`
- `graph_entities`
- `graph_relationships`
- `scan_jobs`
- `discovery_sessions`
- `ai_chat_sessions`
- `ai_chat_messages`
- `ai_provider_credentials`
- `audit_logs`
- `uploads`
- `rate_limit_windows`
- `plugins`

### Key relationships
- `tasks.projectId` → `projects.id` (cascade)
- `tasks.ruleId` → `rules.id` (set null)
- `tasks.workflowId` → `workflows.id` (set null)
- `events.projectId` → `projects.id` (cascade)
- `events.taskId` → `tasks.id` (set null)
- `events.workflowId` → `workflows.id` (set null)
- `workflows.projectId` → `projects.id` (cascade)
- `workflowExecutions.workflowId` → `workflows.id` (cascade)
- `scan_jobs.projectId` → `projects.id` (cascade)
- `discovery_sessions.importedProjectId` → `projects.id` (set null)
- `graph_entities.projectId` → `projects.id` (cascade)
- `graph_entities.scanJobId` → `scan_jobs.id` (set null)
- `graph_relationships.sourceId` / `targetId` → `graph_entities.id` (cascade)
- `graph_relationships.projectId` → `projects.id` (cascade)
- `graph_relationships.scanJobId` → `scan_jobs.id` (set null)
- `ai_chat_sessions.projectId` → `projects.id` (cascade)
- `ai_chat_messages.sessionId` → `ai_chat_sessions.id` (cascade)
- `metrics.projectId` → `projects.id` (cascade)
- `audit_logs.projectId` → `projects.id` (set null)
- `ai_provider_credentials` has no FK, but does have a unique `(ownerId, provider)` constraint
- `rate_limit_windows` uses composite primary key `(projectId, windowBucket)`

### Important storage properties
- `metrics` is intentionally append-only time-series, not one-row-per-project.
- `uploads` persists upload metadata so discovery survives process restart.
- `rate_limit_windows` is DB-backed so rate limiting is shared across instances.
- `audit_logs` preserves history even if the project is deleted.

## 10) Auth and security
The implemented model is ownership-scoped single-tenant-per-user, not roles-based multi-tenant access.

Evidence:
- `requireAuth` checks Clerk session and bypasses only in test mode.
- `requireProjectAccess` returns 404 when the project does not exist and 403 when it belongs to another user.
- `requireProjectWriteAccess` blocks archived project mutation with 403.
- `app.ts` disables ETags because dynamic per-user API data should not return bodyless 304s to fetch-based clients.
- Clerk proxy middleware is only active in production.
- The server validates and encrypts AI provider credentials.
- Discovery adapters redact credentials from git clone failures.

## 11) AI / orchestration / providers
Real and non-trivial:
- provider registry exists
- Groq / DeepSeek / OpenRouter / Gemini support is present in the orchestrator layer
- prompt builders and parsing are separated
- tool policy gates provider/tool access
- chat agent has hard limits for iterations and tool calls
- parse failures are surfaced as structured failures instead of silently degrading
- workflow orchestration blocks advancement when metrics are unverified

This is an implementation layer, not a placeholder design.

## 12) Discovery / scanner / knowledge engine
### Discovery
- supported source types: LOCAL_FOLDER, GIT_REPOSITORY, WORKSPACE_PROJECT, ARCHIVE_UPLOAD
- unsupported source types: REMOTE_FILESYSTEM, DOCKER_VOLUME
- unsupported types are explicitly surfaced as unavailable, with 501 behavior in the adapter layer

### Scanner
- file walking supports many languages and has truncation caps instead of crashing on large repos
- rule matching uses safe regex compilation and caps global/per-file matches
- graph extraction uses AST where possible and heuristic fallback where necessary
- metrics calculation is structural and explicit about being heuristic
- scanner versioning is tracked in `SCANNER_VERSION`

### Knowledge engine
- provides BFS-style impact, shortest path, neighborhood, semantic neighborhood, evidence bundling, layered graph summaries, and provenance-aware annotation
- the functions are pure and async where DB-backed, which matches the architecture’s “read/derive” role

## 13) API spec and generated types
Observed:
- `lib/api-spec/openapi.yaml` exists
- generated Zod client/types are committed
- generated React client is committed
- `scripts/check-codegen-drift.ts` regenerates and checks for diffs
- CI runs parse-check → codegen drift check → typecheck → tests

Inference from extracted path list:
- the OpenAPI paths and route files align closely
- I did not identify an obvious path-level drift from the raw lists

## 14) Tests
Tests are present in all main runtime areas:
- api-server route and lib tests
- dashboard page tests
- ai-orchestrator tests
- scanner tests
- knowledge-engine tests

This means the repo does not suffer from the “no tests” failure mode.  
What I did not verify in this session:
- full pass/fail status of the whole suite
- coverage thresholds
- whether every test is a true regression/contract/integration test rather than a shallow smoke/unit check

## 15) CI / build / bootstrap
### Root scripts
- `codegen`
- `codegen:check`
- `validate`
- `truth:validate`
- `build`
- `typecheck:libs`
- `typecheck`
- `test`

### CI workflow
`ci.yml` has:
- a contract-drift job for OpenAPI/generated artifacts
- a validate job that runs parse-check, codegen drift, typecheck, and tests

### Setup verification
`scripts/verify-setup.sh` checks:
- node_modules
- Clerk secrets
- DATABASE_URL
- API healthz
- dashboard reachability
- DB schema push sentinel

This is exactly the kind of bootstrap/probe layer the prompt asked to inspect.

## 16) Documents and runtime logs
### Current baseline / truth-bearing
- `docs/architecture.md`
- `docs/RUNTIME_EXECUTION_MATRIX.md`
- `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md`
- `docs/PR_BACKLOG.md`

### Historical logs
- `docs/completion-plan.md`
- `docs/fact-record.md`

### Operational notes
- `.agents/memory/*.md` contains many focused notes about job durability, auth scoping, discovery, codegen drift, scanner extraction, provenance, and AI provider behavior.

### What the documents themselves say
- architecture doc: current truth baseline
- runtime matrix: current execution alignment
- completion-plan/fact-record: historical logs
- PR backlog: current work queue
- memory notes: helpful, but lower priority than code/tests

## 17) Contradictions and alignment checks
### Confirmed alignment
- Route list matches OpenAPI path list at the path level.
- Startup bootstrap logic is backed by code, not just docs.
- Ownership scoping is enforced in middleware and route implementations.
- The generated contract layer is guarded by codegen-drift and CI.

### Historical vs current distinction
- `completion-plan.md` and `fact-record.md` are clearly historical by their own banners.
- They should not be used as the current baseline when they conflict with code or architecture docs.

### Remaining explicit risk
- Async work durability is intentionally limited by the in-process job queue model; reconciliation mitigates it, but does not turn it into a durable queue.

## 18) Root-cause analysis of the main risks
### A. Job durability / reconciliation
- Symptom: jobs can be lost mid-flight on process crash.
- Immediate cause: queue is in-process.
- Root cause: no durable external queue is used.
- Evidence: startup/reconciliation comments, queue docs, and the repo’s own risk notes.
- Remediation order: keep reconciliation, harden claim ordering, and only then consider durable queueing if product requirements demand it.

### B. Discovery unsupported sources
- Symptom: some source types are disabled.
- Immediate cause: server-side file access / Docker access is not available in this deployment.
- Root cause: environment limitation, not code failure.
- Evidence: discovery adapter definitions and source capability registry.
- Remediation order: leave honest 501 behavior unless deployment capabilities change.

### C. Contract drift
- Symptom: spec/generated/server mismatch would break clients.
- Immediate cause: editing OpenAPI without regeneration.
- Root cause: generated surfaces are committed and must stay in sync.
- Evidence: `check-codegen-drift.ts`, CI workflow, and generated directories.
- Remediation order: regenerate, then commit generated artifacts, then keep CI guards.

### D. Auth / scoping bypass
- Symptom: a user could read or modify another user’s project.
- Immediate cause: missing ownership check.
- Root cause: routes need explicit project resolution from path/body/query.
- Evidence: `requireProjectAccess`, `loadProjectByIdForUser`, and route-level use.
- Remediation order: ensure every project-scoped route uses the ownership helper before any data fetch or mutation.

## 19) Quality assessment
- Architecture quality: جيد جدًا
- Organization between packages: جيد جدًا
- Documentation quality: جيد، with a clear historical/current split
- Code quality: جيد إلى جيد جدًا based on explicit guards, validation, and small separation of concerns
- Test quality: جيد، with broad presence across core layers
- Maintainability: جيد
- Scalability: متوسط إلى جيد; in-process queue remains the main limiter
- Security: جيد
- Production readiness: جيد، but depends on operational discipline around queue durability and contract drift
- API contract consistency: جيد جدًا
- Data layer correctness: جيد جدًا
- Discovery / graph maturity: جيد
- AI orchestration maturity: جيد

## 20) Gap register
### Confirmed or explicit gaps
1. In-process queue durability remains a real operational risk.
2. Unsupported discovery sources exist by design.
3. Historical docs exist and can be mistaken for current truth if read without the banners.
4. Some runtime features rely on heuristics when full provenance data is missing.
5. Contract drift is guarded, but still a risk if CI is bypassed.

### Not confirmed as gaps
- I did not confirm a route/spec mismatch.
- I did not confirm missing tables for the main runtime entities.
- I did not confirm absence of tests in the live repo.
- I did not confirm a missing auth layer; the opposite is present.

## 21) Implementation readiness
The codebase is far beyond a skeleton. The strongest signs of readiness are:
- explicit startup checks
- schema push guard
- ownership-scoped access control
- generated API contract pipeline
- CI drift guard
- broad test presence
- historical-vs-current documentation discipline

The main reason it is not “fully finished” is not lack of structure; it is the ordinary operational edge cases that remain in any real system: queue durability, unsupported environment features, and keeping generated artifacts synchronized.

## 22) Files reviewed appendix
### Prompt PDF
- `برومبت تحليل EngineeringOS.pdf`

### Runtime / bootstrap
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/config.ts`
- `scripts/check-codegen-drift.ts`
- `scripts/validate-truth-flow.ts`
- `scripts/verify-setup.sh`
- `.github/workflows/ci.yml`

### Auth / security
- `artifacts/api-server/src/middlewares/requireAuth.ts`
- `artifacts/api-server/src/middlewares/requireProjectAccess.ts`
- `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`

### Discovery / scanner / graph
- `artifacts/api-server/src/lib/discovery-adapters.ts`
- `artifacts/api-server/src/lib/discovery-runner.ts`
- `artifacts/api-server/src/lib/scan-runner.ts`
- `artifacts/api-server/src/lib/graph-provenance.ts`
- `lib/scanner/src/index.ts`
- `lib/scanner/src/file-walker.ts`
- `lib/scanner/src/graph-extractor.ts`
- `lib/scanner/src/metrics-calc.ts`
- `lib/scanner/src/rule-matcher.ts`
- `lib/knowledge-engine/src/index.ts`
- `lib/knowledge-engine/src/queries.ts`
- `lib/knowledge-engine/src/inference.ts`

### AI
- `lib/ai-orchestrator/src/index.ts`
- `lib/ai-orchestrator/src/context-builder.ts`
- `lib/ai-orchestrator/src/agents/chat-agent.ts`
- `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts`
- `artifacts/api-server/src/routes/ai/index.ts`
- `artifacts/api-server/src/routes/ai/chat.ts`
- `artifacts/api-server/src/routes/ai/analysis.ts`
- `artifacts/api-server/src/routes/ai/providers.ts`
- `artifacts/api-server/src/routes/ai/tasks.ts`
- `artifacts/api-server/src/routes/ai/workflows.ts`

### DB / contracts
- `lib/db/src/schema/*.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/*`
- `lib/api-client-react/src/generated/*`

### Dashboard
- `artifacts/dashboard/src/App.tsx`
- `artifacts/dashboard/src/pages/*.tsx`

### Docs
- `docs/architecture.md`
- `docs/RUNTIME_EXECUTION_MATRIX.md`
- `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md`
- `docs/PR_BACKLOG.md`
- `docs/completion-plan.md`
- `docs/fact-record.md`

### Memory notes
- selected `.agents/memory/*.md` tied to auth, discovery, scanner, queue durability, codegen drift, and AI orchestration

## 23) Final check against the prompt
- High-impact files were prioritized first: yes
- Distinction between facts, supported inferences, and uncertainty: yes
- Historical docs separated from current baseline: yes
- Root causes emphasized over symptoms: yes
- No unsupported invented layers: yes
- No evidence-free claim of completion: yes
- Remaining uncertainty explicitly marked: yes

# EngineeringOS Forensic Engineering Audit

## Scope
- Repository snapshot analyzed statically: **789 files**.
- Top-level counts: artifacts **228**, lib **256**, attached_assets **230**, docs **15**, .agents **39**, scripts **8**.
- Category breakdown used for inventory: Runtime Path **230**, Generated **170**, Documentation **285**, Configuration **36**, Source of Truth **20**, Test Path **33**, Tooling/Script **9**.

## 1) Executive summary
The codebase is a monorepo centered on an Express API server (`artifacts/api-server`), a React dashboard (`artifacts/dashboard`), and three foundational libraries: scanner, knowledge engine, and AI orchestrator. The runtime entry is `artifacts/api-server/src/index.ts:1-38`, which starts the server after startup reconciliation and root-path repair. The API server mounts the route bundle from `artifacts/api-server/src/routes/index.ts:1-34`, and the dashboard boots through `artifacts/dashboard/src/App.tsx:1-189`.

I could not run pnpm-based build/tests in this environment because `pnpm` is not installed and `node_modules` are absent, so all completion and test claims below are static-only and marked accordingly.

## 2) Repository scope and master inventory
Primary runtime areas:
- API server: `artifacts/api-server/src/index.ts`, `app.ts`, `routes/*`, `lib/*`, `middlewares/*`, `scripts/seed-provenance.ts`.
- Dashboard: `artifacts/dashboard/src/*`.
- Shared libraries: `lib/scanner`, `lib/knowledge-engine`, `lib/ai-orchestrator`, `lib/db`, `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`.
- Tooling: `scripts/*`, root package/tsconfig/workspace config, `.github/workflows/ci.yml`.
- Historical/supporting evidence: `docs/*`, `.agents/memory/*`, `attached_assets/*`.

Full file-by-file inventory is exported to `EngineeringOS_inventory.csv`.

## 3) System architecture (actual)
Layer map:
1. **Configuration / contract layer** — root configs, `lib/api-spec/openapi.yaml`, `lib/db/src/schema/*`, `artifacts/api-server/src/config.ts`.
2. **Runtime API layer** — `artifacts/api-server/src/app.ts`, `index.ts`, `routes/*`, `middlewares/*`, `lib/*`.
3. **Analysis / inference layer** — `lib/scanner`, `lib/knowledge-engine`, `lib/ai-orchestrator`.
4. **Presentation layer** — `artifacts/dashboard/src/*`.
5. **Derived/generated layer** — `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`.
6. **Tooling / bootstrap layer** — `scripts/*`, CI, workspace configs.

The main directional dependency is one-way: UI → API client → OpenAPI/Zod; API runtime → DB/scanner/knowledge-engine/AI; libraries do not import from `artifacts/*` except through deliberate package boundaries in app/runtime code.

## 4) Critical file-by-file analysis
### API server entry and bootstrap
- `artifacts/api-server/src/index.ts:1-38` starts listening after `reconcileStuckJobs()`, `fixDeadRootPaths()`, and logs queue stats.
- `artifacts/api-server/src/app.ts:19-138` configures `helmet`, global rate limiting, `pino-http`, CORS, body-size caps, Clerk middleware, no-store headers, health route, auth-gated API routes, and the centralized error handler.

### Core runtime controls
- `artifacts/api-server/src/lib/job-queue.ts:1-114` implements bounded in-process concurrency with `heavyJobQueue = new JobQueue(2)`.
- `artifacts/api-server/src/lib/job-reconciliation.ts:1-...` (startup sweeper) re-enqueues queued jobs and marks interrupted jobs failed.
- `artifacts/api-server/src/lib/startup-migrations.ts:1-60` repairs dead temp root paths.
- `artifacts/api-server/src/lib/db-rate-limiter.ts:1-91` enforces per-project LLM limits in PostgreSQL (`LLM_RATE_LIMIT = 20`).

### Scanner / graph / inference
- `lib/scanner/src/file-walker.ts:1-240` recursively walks a project with caps on depth, file count, and content size.
- `lib/scanner/src/graph-extractor.ts:1-...` extracts entities/relationships from TypeScript and Python sources.
- `lib/scanner/src/metrics-calc.ts:1-206` computes score dimensions from scan output.
- `lib/knowledge-engine/src/queries.ts:1-...` and `inference.ts:1-260` provide pure graph traversal and derived metrics.

### AI orchestration
- `lib/ai-orchestrator/src/groq-client.ts:1-...` handles provider calls, retries, and circuit-breaking.
- `lib/ai-orchestrator/src/parsing.ts:1-112` normalizes model JSON output and degrades to fallbacks.
- `lib/ai-orchestrator/src/context-builder.ts` (not fully quoted here) constructs project context from DB.
- `lib/ai-orchestrator/src/agents/*` implement chat, scan, review, task, and workflow agents.

### Presentation
- `artifacts/dashboard/src/App.tsx:1-189` wires Clerk, wouter routes, and React Query.
- `artifacts/dashboard/src/lib/api-fetch.ts:1-64` centralizes fetch error handling.
- Page surface exists for Projects, Tasks, Rules, Workflows, Events, Metrics, Graph, AI Chat, and Landing/Sign In/Sign Up.

## 5) End-to-end execution flow analysis
### Discovery
`POST /api/projects/discover` in `artifacts/api-server/src/routes/discovery.ts:133-221` resolves source adapters, validates root paths, creates a discovery session, and enqueues `runDiscovery()` on the shared heavy queue. `discovery-adapters.ts:1-205` supports local folders and git repositories, while unsupported adapter types are surfaced as explicit 501-style unsupported responses in the source registry.

### Project scan
`POST /api/projects/:projectId/scan` in `routes/projects.ts` (see route registration in `lib/api-spec/openapi.yaml:109-128`) creates a queued job; `scan-runner.ts` walks the repo, matches rules, computes metrics, extracts graph data, writes tasks/metrics/events/audit, and returns the project to active on failure.

### AI chat
`POST /api/ai/chat` in `routes/ai.ts:455-648` validates request shape, checks ownership, enforces DB-backed per-project rate limits, loads history, blocks while apply-changes holds the advisory lock, builds context, runs the chat agent, persists messages, and returns pending file changes in-memory to the client.

### Apply changes
`POST /api/ai/chat/apply-changes` in `routes/ai.ts:920-...` validates paths, writes files through the root-path validator, records audit/event data, and invalidates project context cache.

### Workflow orchestration
`POST /api/ai/workflows/:workflowId/orchestrate` in `routes/ai.ts:1205-1320` fetches workflow state, parses phases, rate-limits per project, builds context, asks the orchestrator for a decision, validates it, advances or completes within the database, and emits corresponding events/audit entries.

### Task execution
`POST /api/ai/tasks/:taskId/execute` in `routes/ai.ts:1335-1509` claims the task, runs the task agent, updates state, logs output, and emits `TaskCompleted`/`TaskVerifying` events.

## 6) Documentation gap analysis
Most top-level docs are aligned with code surfaces, but one notable mismatch is the LLM rate limit: `docs/architecture.md:95` says a configurable default of 10 req/min, while the current DB limiter in `artifacts/api-server/src/lib/db-rate-limiter.ts:22-23` enforces 20 calls/minute. That is a **Conflicting / Obsolete** doc-to-code point.

Another notable difference is that `docs/architecture.md` describes a 5-minute cached project context (`docs/architecture.md:146`), while the current runtime code path should be verified directly in `lib/ai-orchestrator/src/context-builder.ts` before treating that cache duration as authoritative. In this static pass, that remains **Unresolved** until the exact cache constants are re-read.

## 7) Code quality & structural assessment
1. **Fail-open rate limiter** — `db-rate-limiter.ts:56-75` returns allowed on unexpected DB errors. This favors availability, but it permits bursts beyond policy during DB trouble. Severity: Medium.
2. **Best-effort audit writes** — `audit.ts:42-62` intentionally swallows audit insert failures after the main mutation commits. This avoids user-facing failures but can drop traceability. Severity: Medium.
3. **Process-local queues** — `job-queue.ts:1-114` is in-memory. Restart recovery exists, but anything actively running is not resumable. Severity: High for durability.
4. **Generated surfaces are large** — `lib/api-zod/src/generated/*` and `lib/api-client-react/src/generated/*` are derived and should be treated as rebuildable artifacts, not hand-edited sources. Severity: Low/Medium for drift risk.
5. **Static-only verification** — runtime/test status is unresolved because the toolchain is not installed in this snapshot.

## 8) Technical debt report
- Dependence on in-process job execution plus DB reconciliation is workable but fragile under multi-instance or long-running jobs.
- Several defensive fallbacks intentionally fail open or degrade silently; these are good for UX but reduce strictness.
- Many `.agents/memory/*` and `attached_assets/*` files are historical evidence, but they widen the repository surface and complicate auditing.

## 9) Completion assessment matrix
- **API runtime**: 85% confirmed by code structure; test completion unresolved.
- **Scanner**: 80% confirmed structurally; test completion unresolved.
- **Knowledge engine**: 85% confirmed structurally; test completion unresolved.
- **AI orchestrator**: 80% confirmed structurally; test completion unresolved.
- **Dashboard**: 80% confirmed structurally; build/test completion unresolved.
- **Generated client/schema layer**: 90% structurally complete, because it is generated from OpenAPI and committed.
- **Tooling / truth scripts**: 75% confirmed; runtime validation unresolved due missing pnpm.

Any component below 80% should be treated as needing follow-up work, especially the tooling/runtime verification surface.

## 10) Risk register
- **R-01 In-process job durability** — a crash can drop active jobs; reconciliation can only mark/reenqueue known DB rows. Evidence: `job-queue.ts:1-114`, `job-reconciliation.ts:1-27`. Severity: High.
- **R-02 Audit trace loss** — best-effort audit logging can miss entries if the audit insert fails. Evidence: `audit.ts:42-62`. Severity: Medium.
- **R-03 Fail-open limiter** — DB hiccups bypass project LLM limits. Evidence: `db-rate-limiter.ts:56-75`. Severity: Medium.
- **R-04 Static verification gap** — no installed pnpm/node_modules in this snapshot prevents live build/test confirmation. Severity: High for audit confidence.

## 11) Missing components list
- Runtime-confirmed build/test results.
- Full dynamic validation of the dashboard and API server.
- Direct confirmation of cache duration and context-builder constants.
- Any multi-instance durability strategy beyond the current in-process queue + reconciliation pattern.

## 12) Development roadmap
1. Stabilize verification tooling so the repo can be built and tested in a clean environment.
2. Tighten the audit/observability path so failed audit writes are surfaced more explicitly.
3. Decide whether the in-process queue/reconciliation model is sufficient for future scale.
4. Reconcile documentation constants with code constants, especially rate limits and cache windows.
5. Keep generated surfaces on strict codegen-only workflow.

## 13) PR backlog
- **PR-1**: Verification bootstrap — make setup/build/test runnable from a clean clone.
- **PR-2**: Observability hardening — surface audit and limiter failures as explicit operational signals.
- **PR-3**: Durability upgrade — optional persistent queue if multi-instance or restart resilience becomes mandatory.
- **PR-4**: Doc/code reconciliation — update docs or code for rate limits and any cached-context claims.
- **PR-5**: Generated-artifact drift guard — strengthen codegen drift checks and CI enforcement.

## 14) Meta-verification
Randomly rechecked: `artifacts/api-server/src/index.ts:1-38`, `app.ts:19-138`, `routes/index.ts:1-34`, `db-rate-limiter.ts:22-23`, `audit.ts:42-62`. The cited lines support the claims above.

## 15) Final verdict
The repository is a coherent monorepo with a clear runtime spine and strong evidence of deliberate layering. The strongest implementation areas are the API server bootstrap, job reconciliation, scanner, and generated contract surfaces. The main unresolved item is live runtime confirmation; the main risk is the in-process job model combined with fail-open / best-effort fallback behavior.

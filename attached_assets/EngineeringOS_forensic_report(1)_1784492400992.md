# EngineeringOS — Forensic Engineering Report

## 1) Executive Summary
Confirmed from code: this is a pnpm monorepo with a clear runtime core in `artifacts/api-server`, a React control plane in `artifacts/dashboard`, and supporting libraries for DB, scanner, knowledge graph, AI orchestration, and OpenAPI-derived client/schema generation. The system is not a vague prototype: the API server has real route handlers, DB-backed state, background job reconciliation, audit/event logging, and several guarded AI flows.

The main asymmetry is between the operational core and the surrounding documentary surface. Most of the runtime stack is implemented and internally consistent, but some docs are stale, some feature areas are intentionally unsupported, and the mockup sandbox is effectively empty. The repo also contains many prior analysis artifacts in `attached_assets/` and `.agents/memory/`; those are useful context but not source of truth.

Because this environment has no installed dependencies, I could not execute build/test/typecheck commands. Everything below is therefore a static code-based forensic assessment, not a runtime verification.

Key confirmed findings:
1. `lib/api-spec/openapi.yaml` is the contract source for generated API clients and Zod schemas.
2. `artifacts/api-server/src/index.ts` boots the server, reconciles orphaned jobs, and fixes dead temp root paths before listening.
3. `artifacts/api-server/src/lib/scan-runner.ts`, `discovery-runner.ts`, `job-queue.ts`, and `job-reconciliation.ts` form the execution backbone for scan/discovery workflows.
4. `lib/ai-orchestrator` is substantial and real: it builds context from DB state, parses model output, manages prompts/schemas, and exposes chat/task/scan/review/workflow agents.
5. `artifacts/dashboard` is a real routed UI, but `artifacts/mockup-sandbox` currently has no discovered mockup modules, so its preview surface is empty.
6. `replit.md` is partially stale: it understates how broadly project ownership checks are enforced in code and it misdescribes some discovery cleanup behavior.

## 2) Repository Scope and Inventory

### Package-level inventory
| package          |   files |   code |   tests |   docs |   generated |
|:-----------------|--------:|-------:|--------:|-------:|------------:|
| api-zod          |     160 |    158 |       0 |      0 |         156 |
| dashboard        |      89 |     80 |       0 |      0 |           0 |
| mockup-sandbox   |      69 |     63 |       0 |      0 |           1 |
| api-server       |      60 |     55 |      19 |      0 |           0 |
| ai-orchestrator  |      35 |     33 |       7 |      0 |           0 |
| db               |      19 |     17 |       0 |      0 |           0 |
| scanner          |      15 |     13 |       4 |      0 |           0 |
| knowledge-engine |       8 |      6 |       2 |      0 |           0 |
| scripts          |       8 |      4 |       0 |      0 |           0 |
| api-client-react |       7 |      5 |       0 |      0 |           2 |
| api-spec         |       3 |      1 |       0 |      0 |           1 |

### File categories
| category             |   files |
|:---------------------|--------:|
| attached_assets/docs |     201 |
| generated-zod        |     160 |
| dashboard            |      89 |
| mockup-sandbox       |      69 |
| api-server           |      60 |
| memory/docs          |      36 |
| ai-orchestrator      |      35 |
| db                   |      19 |
| scanner              |      15 |
| docs                 |      14 |
| root-config          |      12 |
| knowledge-engine     |       8 |
| scripts              |       8 |
| generated-client     |       7 |
| api-spec             |       3 |

### Runtime entrypoints and core surfaces
| ID   | Path / Scope                          | Type                     | Role                                                                        |
|:-----|:--------------------------------------|:-------------------------|:----------------------------------------------------------------------------|
| E1   | artifacts/api-server/src/index.ts     | API server bootstrap     | Starts Express app, runs startup reconciliation/migrations, binds listener. |
| E2   | artifacts/dashboard/src/main.tsx      | Dashboard bootstrap      | Mounts React app into `#root`.                                              |
| E3   | artifacts/mockup-sandbox/src/main.tsx | Mockup sandbox bootstrap | Preview server entry; presently has no discovered mockup components.        |
| E4   | lib/api-spec/openapi.yaml             | API contract source      | Feeds Orval code generation for zod/client outputs.                         |
| E5   | scripts/validate-truth-flow.ts        | Truth-flow drift gate    | Validates baseline matrix against schema source.                            |
| E6   | scripts/check-codegen-drift.ts        | Codegen drift gate       | Detects generated output drift from OpenAPI.                                |

## 3) System Architecture
The repo splits into these practical layers:
`api-server` (HTTP/runtime orchestration) → `db` (persistent state) → `scanner` (file/graph/metrics extraction) → `knowledge-engine` (DB-backed graph queries and inference) → `ai-orchestrator` (LLM context, prompts, parsing, tools, agents) → `dashboard` (interactive UI) with `api-spec`/`api-zod`/`api-client-react` providing OpenAPI-derived contract code. `scripts` act as CI/verification utilities, while `mockup-sandbox` is a separate preview surface.

Package dependency edges are concentrated and sensible: `api-server` consumes `db`, `scanner`, `knowledge-engine`, `ai-orchestrator`, `api-zod`, and `api-client-react`; `dashboard` consumes `api-client-react`; `ai-orchestrator` and `knowledge-engine` both consume `db`; `scripts` consume `db`, `scanner`, and `api-zod`.

## 4) Layer-by-Layer Analysis
| 0                   | 1                                                    | 2                                                                                                                              | 3                                        | 4                                                    | 5           | 6         |
|:--------------------|:-----------------------------------------------------|:-------------------------------------------------------------------------------------------------------------------------------|:-----------------------------------------|:-----------------------------------------------------|:------------|:----------|
| Bootstrap/runtime   | artifacts/api-server/src/index.ts, app.ts, config.ts | Express boot, security middleware, auth, routing, error handling, startup reconciliation.                                      | HTTP requests, env vars                  | API responses, job execution, DB writes              | High        | Confirmed |
| Persistence         | lib/db/src/**                                        | Drizzle schema and connection pool for projects, tasks, workflows, events, graph, metrics, scans, audit, plugins, credentials. | Postgres                                 | Typed tables and queries                             | High        | Confirmed |
| Scanner             | lib/scanner/src/**                                   | Walks files, matches rules, extracts graph, computes metrics, has Python AST path for Python source.                           | Filesystem files                         | Scanned files, matches, graph, metrics               | High        | Confirmed |
| Knowledge engine    | lib/knowledge-engine/src/**                          | Typed graph queries, shortest path, impact, layered graph views, provenance-aware inference.                                   | DB graph rows                            | Graph summaries, paths, neighborhoods                | Medium-High | Confirmed |
| AI orchestration    | lib/ai-orchestrator/src/**                           | Groq client wrapper, context builder, prompts, schemas, parsing, agent functions, file/git tools.                              | DB + project context + optional API keys | Structured agent outputs, pending changes, decisions | Medium-High | Confirmed |
| Dashboard UI        | artifacts/dashboard/src/**                           | Routed authenticated UI for projects/tasks/rules/workflows/events/metrics/graph/AI.                                            | React state + API hooks                  | User interactions, screen rendering                  | Medium-High | Confirmed |
| Contract generation | lib/api-spec, lib/api-zod, lib/api-client-react      | OpenAPI-first generation pipeline with drift check.                                                                            | openapi.yaml                             | Generated client + zod code                          | High        | Confirmed |
| Preview sandbox     | artifacts/mockup-sandbox/src/**                      | Component preview server.                                                                                                      | Generated module map                     | Preview rendering                                    | Low         | Confirmed |

### Layer assessment notes
- The runtime core is coherent and largely production-shaped.
- AI flows are guarded with rate limiting, API-key checks, ownership checks, and fallback parsing.
- The queue and orchestration locks are process-local, which is fine for a single instance but a real scaling boundary.
- The mockup sandbox is structurally present but functionally empty.

## 5) File-by-File Analysis
| ID   | Path / Scope                                                 | Type                  | Role / Evidence                                                                                                                                                                           |
|:-----|:-------------------------------------------------------------|:----------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| C1   | artifacts/api-server/src/index.ts                            | Bootstrap             | Runs `reconcileStuckJobs()` and `fixDeadRootPaths()` before `app.listen()`; startup is not passive.                                                                                       |
| C2   | artifacts/api-server/src/app.ts                              | HTTP shell            | Applies security middleware, Clerk, rate limiting, no-store caching, health route, auth gate, and centralized error handling.                                                             |
| C3   | artifacts/api-server/src/lib/scan-runner.ts                  | Scan engine           | Owns scan job lifecycle, project status flips, metrics, graph persistence, audit/event writes, cache invalidation, and plugin dispatch.                                                   |
| C4   | artifacts/api-server/src/lib/discovery-runner.ts             | Discovery engine      | Runs discovery steps, metadata detection, and result shaping; paired with adapters.                                                                                                       |
| C5   | artifacts/api-server/src/lib/discovery-adapters.ts           | Source adapters       | LOCAL_FOLDER and GIT_REPOSITORY are implemented; ARCHIVE_UPLOAD, REMOTE_FILESYSTEM, DOCKER_VOLUME are explicit unsupported stubs; WORKSPACE_PROJECT is implemented and ownership-checked. |
| C6   | artifacts/api-server/src/routes/ai.ts                        | AI API                | Implements Groq key storage, chat, apply-changes, scan analysis, code review, workflow orchestration, and task execution with rate limits and ownership checks.                           |
| C7   | lib/ai-orchestrator/src/context-builder.ts                   | Context builder       | Aggregates DB state into agent context with 30s TTL cache and partial-failure tolerance.                                                                                                  |
| C8   | lib/scanner/src/graph-extractor.ts                           | Graph extraction      | TypeScript AST + Python AST + heuristic extraction with provenance/evidence.                                                                                                              |
| C9   | lib/knowledge-engine/src/queries.ts                          | Graph queries         | BFS impact/path queries, neighborhoods, layered/provenance-aware accessors.                                                                                                               |
| C10  | artifacts/dashboard/src/App.tsx                              | UI router             | Protects routes, clears cached query data on user changes, and branches signed-in/out behavior.                                                                                           |
| C11  | artifacts/mockup-sandbox/src/.generated/mockup-components.ts | Generated preview map | Currently empty; this makes the sandbox effectively non-operational.                                                                                                                      |

## 6) Execution Flow Analysis
| Flow                   | Entry Point                                                            | Core path                                                                                                                                                      | Failure/short-circuit                                                          | State touched                                       |
|:-----------------------|:-----------------------------------------------------------------------|:---------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------|:----------------------------------------------------|
| Discovery              | POST /api/projects/discover                                            | Route validates source, resolves to local rootPath via adapters, persists session, enqueues background job, later runDiscovery populates graph/metrics/events. | Unsupported source types return 501.                                           | Session state, events, metrics, discovery table.    |
| Scan                   | POST /api/projects/:projectId/scan                                     | Route creates queued scan job, flips project to scanning, emits event, enqueues runScanJob.                                                                    | Queue overflow is bounded; failure writes are recorded.                        | scan_jobs, projects, events, metrics, graph, audit. |
| AI chat                | POST /api/ai/chat                                                      | Project ownership + rate limit + Groq key resolution + context builder + chat agent + optional session persistence.                                            | Rate limit 429, missing key 428, parse fallback.                               | ai_chats, messages, events, audit, context cache.   |
| Task execute           | POST /api/ai/tasks/:taskId/execute and POST /api/tasks/:taskId/execute | Two-layer path: direct route can trigger AI execution; task route handles state machine and can schedule AI execution on verifying.                            | Atomic claim prevents double-run; no key/rate limit short-circuit is explicit. | tasks, task_logs, events, audit.                    |
| Workflow orchestration | POST /api/ai/workflows/:workflowId/orchestrate and workflow routes     | AI proposes decision; validators reject invalid transitions; execution/advance/stop routes enforce atomic state changes.                                       | Conflict returns 409.                                                          | workflows, workflow_executions, events, audit.      |
| Git                    | GET/PUT/POST /api/projects/:projectId/git/* and /api/ai/github-token   | Git config/token storage, status/log/commit/push/export, guarded by ownership and write access where relevant.                                                 | Token redaction and command timeouts present.                                  | ai_provider_credentials, events, audit, scan jobs.  |
| Dashboard              | React route tree                                                       | Signed-in users see protected app shell; sign-out returns landing page; query cache is cleared on auth identity change.                                        | Client-side route guard redirects to /.                                        | React query cache only.                             |

### Runtime trace notes
- Scan/discovery jobs are explicitly asynchronous and bounded by `heavyJobQueue`.
- Job reconciliation at startup handles queued/running orphan states.
- AI task execution has a dual path: direct execution and auto-trigger from status changes.
- Workflow state transitions are guarded against concurrency conflicts.

## 7) Documentation Gap Analysis
| Document                              | Claim                                                         | Status vs code    | Evidence                                                                                                                                                 |
|:--------------------------------------|:--------------------------------------------------------------|:------------------|:---------------------------------------------------------------------------------------------------------------------------------------------------------|
| replit.md                             | Ownership scoping is only in projects.ts                      | Outdated          | Code now checks ownership widely via `loadProjectByIdForUser` and related middleware across tasks/rules/workflows/events/metrics/graph/AI/git/discovery. |
| replit.md                             | Git clones have no cleanup after scan                         | Outdated/mismatch | Discovery adapters return cleanup hooks and cleanupResolveResult removes temp dirs; startup also repairs dead root paths.                                |
| replit.md                             | WORKSPACE_PROJECT is a stub and archive upload is future-only | Partially stale   | WORKSPACE_PROJECT is implemented; ARCHIVE_UPLOAD/REMOTE_FILESYSTEM/DOCKER_VOLUME are still unsupported stubs.                                            |
| docs/ and attached analysis artifacts | Describe current state                                        | Not authoritative | Useful context, but the code is the source of truth and these files often reflect previous analysis iterations.                                          |

## 8) Code Quality Assessment
| Dimension             | Assessment   | Evidence                                                                                                      |
|:----------------------|:-------------|:--------------------------------------------------------------------------------------------------------------|
| Architecture cohesion | High         | The runtime core is split along sensible boundaries and the imports are mostly one-directional.               |
| Coupling              | Medium       | api-server depends on several libs, but coupling is expected and explicit.                                    |
| Dead/placeholder code | Medium       | Mockup sandbox generated map is empty; unsupported discovery source stubs exist by design.                    |
| Error handling        | High         | Many critical flows catch and downgrade failures rather than crash silently.                                  |
| State safety          | Medium-High  | Atomic claims and status guards are used in key flows, but some coordination is in-memory only.               |
| Test posture          | Medium       | There are many tests, but none were executed here.                                                            |
| Security posture      | Medium-High  | Auth, ownership checks, redaction, rate limiting, body limits, path checks, and command timeouts are present. |

## 9) Technical Debt Report
| ID   | Debt                                               | Type            | Impact                                              | Next action                                          |
|:-----|:---------------------------------------------------|:----------------|:----------------------------------------------------|:-----------------------------------------------------|
| D1   | Process-local queue/locks/cache                    | Operational     | Can break across multiple server instances.         | Shared queue/lock/store needed for horizontal scale. |
| D2   | Mockup sandbox empty                               | Structural      | Preview surface exists without content.             | Either populate or remove.                           |
| D3   | Unsupported discovery sources advertised in schema | Behavioral/docs | Schema lists more sources than deployment supports. | Either implement or narrow the contract.             |
| D4   | Docs drift                                         | Documentation   | Stale claims can mislead implementers.              | Refresh docs or mark them historical.                |
| D5   | No runtime verification in this environment        | Verification    | Cannot confirm build/test success here.             | Run CI commands and archive results.                 |

## 10) Completion Assessment
| Part                    | Estimated completion   | Reason                                                                                                                                         | Kind            |
|:------------------------|:-----------------------|:-----------------------------------------------------------------------------------------------------------------------------------------------|:----------------|
| API server core         | 85%                    | Substantial route/middleware/job machinery is implemented, with strong persistence and safety checks.                                          | Functional      |
| Scanner                 | 80%                    | File walking, rule matching, graph extraction, metrics, Python AST path, and tests exist.                                                      | Functional      |
| Knowledge engine        | 75%                    | Query/inference surface is real and provenance-aware; less visible on runtime integration than server core.                                    | Functional      |
| AI orchestrator         | 75%                    | Context builder, prompts, schemas, parsing, tool wrappers, and agents are implemented; still mostly in-process and dependent on external Groq. | Functional      |
| Dashboard UI            | 70%                    | Routed UI and auth shell exist, but completeness depends on the unexecuted front-end and backend wiring.                                       | Functional      |
| Mockup sandbox          | 20%                    | Entry point exists but generated module map is empty and no mockup files are present.                                                          | Structural only |
| Docs/analysis artifacts | 100% as artifacts      | Many reports and matrices exist, but they are secondary to code.                                                                               | Documentary     |

## 11) Risk Assessment
| ID   | Severity   | Risk                                       | Why it matters                                                                                                        | First fix                                                  |
|:-----|:-----------|:-------------------------------------------|:----------------------------------------------------------------------------------------------------------------------|:-----------------------------------------------------------|
| R1   | High       | Doc drift can mislead implementers         | replit.md says routes/ownership are incomplete, but code is broader; relying on docs would produce wrong assumptions. | Synchronize docs with code or label them historical.       |
| R2   | High       | Process-local queues/locks can split state | heavyJobQueue and workflow lock are per-process only; multiple instances can double-run jobs or orchestration.        | Introduce shared queue/lock or enforce single instance.    |
| R3   | Medium     | Generated preview surface is empty         | mockup sandbox currently has no discoverable mockup modules.                                                          | Either add mockups or remove the dead preview path.        |
| R4   | Medium     | Unsupported discovery sources return 501   | ARCHIVE_UPLOAD/REMOTE_FILESYSTEM/DOCKER_VOLUME are advertised in schema but not implemented.                          | Either implement or document as intentionally unsupported. |
| R5   | Medium     | Static analysis only                       | No test/build execution was performed in this environment.                                                            | Run pnpm install + build + test in CI and retain traces.   |

## 12) Missing Components
| ID   | Item                                                  | Evidence                                                                                                                                                                                          | Category                              |
|:-----|:------------------------------------------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:--------------------------------------|
| G1   | replit.md access note is stale                        | Document says ownership scoping is still limited to projects.ts, but code applies project ownership checks across tasks, rules, workflows, events, metrics, graph, AI, git, and discovery routes. | Documentation gap / mismatch          |
| G2   | Mockup sandbox is effectively empty                   | src/.generated/mockup-components.ts is empty and no src/components/mockups files exist, so the preview server has no actual mockups to render.                                                    | Runtime placeholder / missing content |
| G3   | Test execution not verified in this environment       | node_modules are absent, so build/test/typecheck could not be executed here; findings are static only.                                                                                            | Verification gap                      |
| G4   | Archive / remote / docker discovery sources are stubs | discovery-adapters marks ARCHIVE_UPLOAD, REMOTE_FILESYSTEM, and DOCKER_VOLUME unsupported with 501 responses.                                                                                     | Feature gap                           |
| G5   | Context cache and queue are process-local             | AI context cache, heavy job queue, and workflow orchestration lock are in-memory only; multi-instance deployments would need shared state or locks.                                               | Operational risk                      |

## 13) Development Roadmap
A practical order, based on blockage and risk:
1. Reconcile docs and contracts so engineers do not work from stale assumptions.
2. Decide the fate of the mockup sandbox and unsupported discovery sources.
3. Add or confirm CI execution for build/typecheck/test, then fix any failing paths.
4. Replace process-local coordination with shared coordination only if multi-instance deployment is required.
5. Expand tests around ownership, discovery cleanup, queue reconciliation, and AI apply-changes path guards.

## 14) PR Backlog
| PR    | Goal                                     | Scope                                                                                                                                            | Primary files        | Risk        |
|:------|:-----------------------------------------|:-------------------------------------------------------------------------------------------------------------------------------------------------|:---------------------|:------------|
| PR-01 | Docs/contract reconciliation             | Update replit.md and any mirrored docs to match real authorization and discovery behavior; flag historical claims explicitly.                    | docs only            | Low         |
| PR-02 | Mockup sandbox cleanup                   | Either seed real mockup components or remove/disable the empty preview surface; ensure generated module map is non-empty or the route is hidden. | mockup-sandbox       | Low-Med     |
| PR-03 | Operational hardening for multi-instance | Replace in-memory heavyJobQueue and workflow lock with shared coordination; define semantics for cache invalidation.                             | api-server + infra   | High        |
| PR-04 | Discovery source completion decision     | Implement ARCHIVE_UPLOAD/REMOTE_FILESYSTEM/DOCKER_VOLUME or hard-remove them from the schema/UI to prevent unsupported promises.                 | api-server + db + UI | Medium-High |
| PR-05 | Verification and traceability            | Run and gate build/test/typecheck, capture reports, and add missing integration traces for critical flows.                                       | scripts + CI         | High        |
| PR-06 | Coverage for stale edge cases            | Add/refresh tests for ownership enforcement, discovery cleanup, queue reconciliation, and AI apply-changes path guards.                          | api-server tests     | High        |

### PR traceability
| PR    | Scope                        | Files/area               | Risk     | Dependency                    |
|:------|:-----------------------------|:-------------------------|:---------|:------------------------------|
| PR-01 | Docs/contract reconciliation | docs + mirrored markdown | Low      | Documentation alignment       |
| PR-02 | Mockup sandbox cleanup       | mockup-sandbox           | Low-Med  | Empty preview map             |
| PR-03 | Operational hardening        | api-server runtime       | High     | Process-local coordination    |
| PR-04 | Discovery source decision    | api-server + db + UI     | Med-High | Unsupported source stubs      |
| PR-05 | Verification and gating      | scripts + CI             | High     | No runtime verification here  |
| PR-06 | Regression coverage          | api-server tests         | High     | Ownership/queue/AI edge cases |

## 15) Final Engineering Verdict
Confirmed verdict: the repository contains a real, layered engineering platform with a usable runtime core, not a hollow scaffold. The strongest parts are the API server, scanner, DB schema, AI orchestration, and generated OpenAPI contract pipeline. The weakest parts are the stale docs, the empty mockup sandbox, and the process-local coordination model that would need rework for multi-instance operation.

The correct next step is not to rediscover the architecture from scratch. The correct next step is to preserve the proven core, align the stale documentary surface with reality, decide the fate of intentionally unsupported surfaces, and then harden the remaining coordination and coverage gaps.
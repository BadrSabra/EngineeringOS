# EngineeringOS Forensic Engineering Audit

## 1) Executive Summary

This archive contains **807 files**. The live system is a pnpm monorepo with an Express API server, a React dashboard, a mockup sandbox, and shared libraries for persistence, scanning, graph queries, and AI orchestration. The dominant runtime spine is:

`dashboard → api-server → db/scanner/knowledge-engine/ai-orchestrator → generated clients/schemas → tests`.

The system is not a stub. The API server reconciles orphaned jobs and starts a stale-job sweep before listening (`artifacts/api-server/src/index.ts:10-37`). The dashboard consumes generated API clients plus a handwritten SSE hook for AI chat streaming (`lib/api-client-react/src/index.ts:1-24`, `lib/api-client-react/src/use-ai-chat-stream.ts:1-171`). The scan pipeline persists graph entities, metrics, events, and audit data (`artifacts/api-server/src/lib/scan-runner.ts:1-30, 146-180, 410-475`). AI routes persist chat, analysis, task execution, and workflow orchestration with rate limiting, cache invalidation, and audit/event emission (`artifacts/api-server/src/routes/ai/chat.ts:467-537`, `artifacts/api-server/src/routes/ai/analysis.ts:28-83`, `artifacts/api-server/src/routes/ai/tasks.ts:36-120`, `artifacts/api-server/src/routes/ai/workflows.ts:33-143`).

The clearest operational risks are both process-local durability limits: the job queue is in-memory (`artifacts/api-server/src/lib/job-queue.ts:1-114`) and the upload store is in-memory with TTL cleanup (`artifacts/api-server/src/lib/upload-store.ts:1-76`). A third risk is deliberate fail-open behavior in the DB-backed rate limiter (`artifacts/api-server/src/lib/db-rate-limiter.ts:36-89`).

## 2) Repository Scope and Master Inventory

**Totals**
- Total files: **807**
- Heuristic category counts:
  - Source of Truth: **259**
  - Runtime Path: **125**
  - Test Path: **33**
  - Configuration: **35**
  - Documentation: **133**
  - Generated: **169**
  - Tooling/Script: **9**
  - Excluded Asset: **44**
- Excluded from deep inspection:
  - Generated files: **169** (`generated/` and `/.generated/` trees)
  - Binary/asset or large files: **44**
  - Total excluded: **213**

A full machine-readable inventory is attached as `engineeringos_master_inventory.csv`. It includes every file with a stable `F-####` ID, path, category, and size.

## 3) System Architecture (Actual) & Layer Map

| Layer ID | Layer | Role (actual) | Evidence | Status |
|---|---|---|---|---|
| L-1 | Bootstrap / governance | Monorepo startup, codegen, validation gates, process wiring | `package.json` scripts (`preinstall`, `codegen`, `validate`, `truth:validate`, `build`), `scripts/validate-truth-flow.ts`, `scripts/check-codegen-drift.ts` | Confirmed |
| L-2 | API transport / auth | Express app, Clerk auth, request logging, rate limiting, body limits, route mounting | `artifacts/api-server/src/app.ts:1-123` | Confirmed |
| L-3 | API runtime / orchestration | Route handlers for projects/tasks/workflows/discovery/events/metrics/graph/plugins/upload/git/AI | `artifacts/api-server/src/routes/index.ts:1-30` | Confirmed |
| L-4 | Job execution / recovery | In-process queue, startup reconciliation, scan/discovery recovery | `artifacts/api-server/src/lib/job-queue.ts:1-114`, `artifacts/api-server/src/lib/job-reconciliation.ts:1-37, 61-164` | Confirmed |
| L-5 | Persistence | Drizzle schema + PG pool | `lib/db/src/index.ts:1-16`, `lib/db/src/schema/index.ts:1-15` | Confirmed |
| L-6 | Scanner / extraction | File walk, rule matching, graph extraction, metrics | `lib/scanner/src/index.ts:1-21`, `artifacts/api-server/src/lib/discovery-runner.ts:1-46`, `artifacts/api-server/src/lib/scan-runner.ts:1-30` | Confirmed |
| L-7 | Knowledge engine | Graph queries / inference, pure read layer | `lib/knowledge-engine/src/index.ts:1-63` | Confirmed |
| L-8 | AI orchestration | Groq/DeepSeek clients, context builder, agents, file/git tools | `lib/ai-orchestrator/src/index.ts:1-30`, `lib/ai-orchestrator/src/context-builder.ts:29-94`, `lib/ai-orchestrator/src/tools/file-tools.ts:1-17`, `lib/ai-orchestrator/src/tools/git-tools.ts:1-10` | Confirmed |
| L-9 | Dashboard UX | Protected React routes and operational pages | `artifacts/dashboard/src/App.tsx:1-189`, `artifacts/dashboard/src/pages/AiChat.tsx:1-41` | Confirmed |
| L-10 | Generated contract surface | OpenAPI-generated client + Zod | `lib/api-spec/orval.config.ts:19-53`, `lib/api-client-react/src/index.ts:1-24`, `lib/api-zod/src/index.ts:1-3` | Confirmed |
| L-11 | Historical evidence / docs | Architecture notes, backlog, truth-flow, prior reports | `docs/*.md`, `attached_assets/*` | Confirmed |

### Boundary notes
- The dashboard is mostly contract-driven, but it still uses a handwritten shared fetch wrapper for non-generated flows and error normalization (`artifacts/dashboard/src/lib/api-fetch.ts:1-64`, `artifacts/dashboard/src/pages/AiChat.tsx:21-23`).
- The AI file-system tools never directly write in the agent layer; writes become pending changes that are applied only through the server route (`lib/ai-orchestrator/src/tools/file-tools.ts:12-16`, `artifacts/api-server/src/routes/ai/chat.ts:475-537`).
- The knowledge engine is read-only by design (`lib/knowledge-engine/src/index.ts:1-10`).
- The runtime queue is intentionally process-local, which is a clear boundary choice rather than an accidental leak (`artifacts/api-server/src/lib/job-queue.ts:1-16, 43-53, 110-114`).

## 4) Detailed Layer-by-Layer Analysis

### L-2 / L-3 API transport and runtime
`artifacts/api-server/src/app.ts` sets `trust proxy`, helmet, rate limiting, pino HTTP logging, Clerk middleware, CORS, JSON/body limits, and mounts the router plus health endpoints (`artifacts/api-server/src/app.ts:41-116`). Route ordering is intentional in `artifacts/api-server/src/routes/index.ts:18-30` because discovery must precede `/projects/:projectId` matching.

### L-4 job execution / recovery
The queue is bounded to 2 concurrent jobs and never spills uncaught rejections out of the queue (`artifacts/api-server/src/lib/job-queue.ts:21-114`). Startup reconciliation recovers queued scan jobs and pending discovery sessions, while interrupted running jobs are either retried or marked failed (`artifacts/api-server/src/lib/job-reconciliation.ts:1-37, 61-164`). The entrypoint calls reconciliation before listening (`artifacts/api-server/src/index.ts:10-37`).

### L-5 persistence
`lib/db/src/index.ts:1-16` hard-requires `DATABASE_URL`, creates a PG pool, and exports a Drizzle DB with the schema bundle. Schema modules are centrally exported from `lib/db/src/schema/index.ts:1-15`, covering projects, rules, workflows, tasks, events, metrics, graph, task logs, plugins, audit logs, discovery, scan jobs, AI chats, AI provider credentials, and rate limits.

### L-6 scanner / extraction
The scanner exports four core operations: walk, match, graph extraction, and metrics (`lib/scanner/src/index.ts:1-21`). Discovery and scan runners both use these primitives, but discovery also performs metadata detection and step tracking (`artifacts/api-server/src/lib/discovery-runner.ts:37-46, 151-165`) while the scan runner persists graph/metrics/events and invalidates the AI context cache on completion/failure (`artifacts/api-server/src/lib/scan-runner.ts:146-180, 410-475`).

### L-7 knowledge engine
The knowledge engine is pure read-side logic over the graph tables. It exports path, neighborhood, impact, evidence, semantic neighborhood, and provenance-aware layered views (`lib/knowledge-engine/src/index.ts:1-63`).

### L-8 AI orchestration
The orchestration layer is split into provider clients, context building, parsing, prompts, tools, and agents. `buildProjectContext` uses 8 DB reads in a repeatable-read transaction and caches per project for 30 seconds (`lib/ai-orchestrator/src/context-builder.ts:29-94, 361-363`). `chat-agent` is a tool-calling loop with bounded iterations and pending file changes rather than immediate writes, while `file-tools` and `git-tools` keep shell usage out of the agent and constrain file access to the resolved project root (`lib/ai-orchestrator/src/tools/file-tools.ts:7-16`, `lib/ai-orchestrator/src/tools/git-tools.ts:4-10`). `groq-client` adds retries and timeout handling, and `task-agent` adds one extra retry on the specific NON_200 failure class (`lib/ai-orchestrator/src/agents/task-agent.ts:50-64`).

### L-9 dashboard UX
The dashboard uses Clerk + React Query + Wouter routing and exposes the major operational pages: Projects, Tasks, Rules, Workflows, Events, Metrics, Graph, and AI (`artifacts/dashboard/src/App.tsx:84-189`). `AiChat.tsx` consumes both generated hooks and a shared fetch helper for non-generated flows, and it renders pending file changes for user approval (`artifacts/dashboard/src/pages/AiChat.tsx:12-23, 90-195`).

## 5) Critical File-by-File Analysis (high-impact files)

| ID | Path | Type | Evidence | Status |
|---|---|---|---|---|
| F-001 | `artifacts/api-server/src/index.ts` | Runtime Path | Startup reconciliation + dead-root fix + stale-job sweep (`:10-37`) | Confirmed |
| F-002 | `artifacts/api-server/src/app.ts` | Runtime Path | Clerk/helmet/rate-limit/body limits/router mount (`:41-116`) | Confirmed |
| F-003 | `artifacts/api-server/src/routes/projects.ts` | Runtime Path | Project CRUD, scan enqueue, summary, scan jobs | Confirmed |
| F-004 | `artifacts/api-server/src/routes/tasks.ts` | Runtime Path | Task lifecycle, execute/retry/rollback/logs | Confirmed |
| F-005 | `artifacts/api-server/src/routes/workflows.ts` | Runtime Path | Workflow lifecycle and execution state machine | Confirmed |
| F-006 | `artifacts/api-server/src/routes/discovery.ts` | Runtime Path | Discovery source registry, import, session lifecycle | Confirmed |
| F-007 | `artifacts/api-server/src/routes/ai/chat.ts` | Runtime Path | Chat stream, session persistence, apply-changes gate, cache invalidation, audit/event emission | Confirmed |
| F-008 | `artifacts/api-server/src/routes/git.ts` | Runtime Path | Commit, push, status, log, export; push auto-queues scan (`:283-353`) | Confirmed |
| F-009 | `artifacts/api-server/src/lib/job-queue.ts` | Source of Truth | Bounded in-process queue, not durable (`:1-16, 43-53, 110-114`) | Confirmed |
| F-010 | `artifacts/api-server/src/lib/job-reconciliation.ts` | Source of Truth | Restart recovery rules (`:1-36, 61-164`) | Confirmed |
| F-011 | `artifacts/api-server/src/lib/rootpath-validator.ts` | Source of Truth | Stored rootPath fallback to workspace, request-scoped only | Confirmed |
| F-012 | `artifacts/api-server/src/lib/upload-store.ts` | Source of Truth | In-process upload store with TTL cleanup | Confirmed |
| F-013 | `artifacts/api-server/src/lib/db-rate-limiter.ts` | Source of Truth | DB-backed fixed-window limiter, fail-open on DB errors | Confirmed |
| F-014 | `lib/db/src/index.ts` | Source of Truth | Drizzle PG pool creation and schema export | Confirmed |
| F-015 | `lib/db/src/schema/index.ts` | Source of Truth | 15 schema modules exported, including rate limits and audit logs | Confirmed |
| F-016 | `lib/scanner/src/index.ts` | Source of Truth | Scan primitives export bundle | Confirmed |
| F-017 | `lib/knowledge-engine/src/index.ts` | Source of Truth | Pure graph query/inference surface | Confirmed |
| F-018 | `lib/ai-orchestrator/src/index.ts` | Source of Truth | Orchestrator public barrel | Confirmed |
| F-019 | `lib/api-spec/orval.config.ts` | Configuration | OpenAPI → generated client/Zod paths + post-processing | Confirmed |
| F-020 | `lib/api-client-react/src/use-ai-chat-stream.ts` | Runtime Path | Handwritten SSE client for chat stream | Confirmed |
| F-021 | `artifacts/dashboard/src/App.tsx` | Runtime Path | Route shell / auth / query client | Confirmed |
| F-022 | `artifacts/dashboard/src/pages/AiChat.tsx` | Runtime Path | AI UI with pending change approval | Confirmed |

## 6) End-to-End Execution Flow Analysis

### Capability: project discovery
| Path ID | Start | Intermediaries | End | State | Status |
|---|---|---|---|---|---|
| P-001 | `routes/discovery.ts` POST `/projects/discover` | adapter resolution → root validation → session insert → enqueue `runDiscovery` → `discovery-runner.ts` | discovery session persisted, project imported or errored | state-mutating | Confirmed |
| P-002 | `discovery-runner.ts` | `walkProject` → metadata detection → `matchRules` → `extractGraph` → `computeMetrics` → session update | discovery session `ready`/`error` | state-mutating | Confirmed |

### Capability: scan lifecycle
| Path ID | Start | Intermediaries | End | State | Status |
|---|---|---|---|---|---|
| P-003 | `routes/projects.ts` POST `/projects/:projectId/scan` | scan job row → project `scanning` → event `ProjectScanQueued` → `heavyJobQueue.enqueue(runScanJob)` | async scan job started | state-mutating | Confirmed |
| P-004 | `scan-runner.ts` | `walkProject` → `matchRules` → `extractGraph` → `computeMetrics` → persist metrics/entities/relationships/events/audit → invalidate context cache → plugin dispatch | project scan complete/fail | state-mutating | Confirmed |
| P-005 | `routes/git.ts` POST `/projects/:projectId/git/push` | git push → audit/event → fire-and-forget post-push scan | new scan job queued automatically | state-mutating | Confirmed |

### Capability: AI chat and apply changes
| Path ID | Start | Intermediaries | End | State | Status |
|---|---|---|---|---|---|
| P-006 | `routes/ai/chat.ts` POST `/ai/chat` / `/stream` | project access → rate limit → rootPath resolution → advisory apply lock check → context build → model call → chat session/messages persisted | assistant response plus pending changes | mixed | Confirmed |
| P-007 | `routes/ai/chat.ts` POST `/ai/chat/apply-changes` | root/root escape checks → sensitive-file block → write files → audit `ai_executed` → invalidate cache → event `AiChangesApplied` | file writes applied, 200/207 | state-mutating | Confirmed |

### Capability: task/workflow orchestration
| Path ID | Start | Intermediaries | End | State | Status |
|---|---|---|---|---|---|
| P-008 | `routes/tasks.ts` POST `/tasks/:taskId/execute` and `/api/ai/tasks/:taskId/execute` | ownership check → rate limit → optimistic claim → context build → task-agent → logs/audit/events | task completed/failed or parse error | state-mutating | Confirmed |
| P-009 | `routes/workflows.ts` and `routes/ai/workflows.ts` | workflow state checks → phase validation → advisory lock → orchestrator → audit/events | workflow advanced or rejected | state-mutating | Confirmed |

## 7) Documentation Gap Analysis

| Doc claim | Code evidence | Classification |
|---|---|---|
| `docs/ai-orchestrator-gap-analysis.md` says AI apply-changes was missing event emission/invalidation | `artifacts/api-server/src/routes/ai/chat.ts:505-530` now emits `AiChangesApplied` and invalidates cache | Obsolete |
| `docs/truth-flow-pr-review-plan.md` says in-process queue durability is the main runtime risk | `artifacts/api-server/src/lib/job-queue.ts:1-16, 43-53, 110-114` and `job-reconciliation.ts:1-36` confirm it is in-process and restart-sensitive | Match |
| `docs/RUNTIME_EXECUTION_MATRIX.md` marks major surfaces as aligned | Runtime route tree and schema exports confirm those surfaces exist (`routes/index.ts:1-30`, `lib/db/src/schema/index.ts:1-15`) | Match |
| `docs/truth-flow-pr-checklist.md` wants dashboard consumption through generated clients only | `artifacts/dashboard/src/pages/AiChat.tsx:21-23` and `artifacts/dashboard/src/lib/api-fetch.ts:1-64` show a handwritten shared fetch wrapper still exists | Partially implemented / Conflicting |
| `docs/EXECUTION_ALIGNMENT_REPORT.md` says OpenAPI → route → DB → audit → frontend → generated client exists | `lib/api-spec/orval.config.ts:19-53`, `routes/*`, `lib/db/src/schema/*`, `artifacts/dashboard/src/*`, `lib/api-client-react/src/generated/*` support the chain | Match |

## 8) Code Quality & Structural Assessment

### Structural weaknesses
1. **In-process durability limit** — `job-queue.ts` is process-local, so hard restarts lose in-flight closures. Severity: **High**.
2. **Upload store is ephemeral** — `upload-store.ts` depends on the process and a TTL; multi-instance deployments need shared storage. Severity: **Medium**.
3. **Rate limiter fail-open** — DB issues allow AI requests through rather than blocking them. Severity: **Medium**.
4. **Root path fallback can mask stale project state** — `rootpath-validator.ts` falls back to workspace root on inaccessible paths. Severity: **Medium**.
5. **AI context cache is short-lived but in-process** — mitigated by invalidation, but cross-process consistency is not guaranteed. Severity: **Medium**.

### Evidence of defensive engineering
- Transactional, repeatable-read context reads (`context-builder.ts:51-94`).
- Advisory locks around scan/apply/orchestrate paths (`scan-runner.ts:60-74`, `ai/chat.ts:467-537`, `ai/workflows.ts:86-109`).
- Explicit path traversal and sensitive-file checks in AI apply (`ai/chat.ts:479-499`).
- Structured errors and audit/event emission at mutation boundaries (`routes/*`).

## 9) Technical Debt Report

The debt is concentrated in operational hardening rather than core business logic:
- durable queueing,
- shared upload storage,
- optional cross-process cache coherence,
- scaling the fixed-window rate limiter,
- removing remaining handwritten dashboard fetch paths if the contract layer is intended to be the sole dashboard API surface.

## 10) Completion Assessment Matrix

| Component | Completion % | Implementation | Test | Documentation | Integration | Operational | Confidence |
|---|---:|---:|---:|---:|---:|---:|---|
| Contract/spec/codegen layer | 96% | complete | strong | strong | strong | strong | Confirmed |
| DB schema/persistence | 90% | strong | good | strong | strong | strong | Confirmed |
| API runtime | 90% | strong | good | strong | strong | strong | Confirmed |
| Discovery/scan pipeline | 88% | strong | good | strong | strong | medium | Confirmed |
| Knowledge engine | 92% | strong | good | good | strong | strong | Confirmed |
| AI orchestration | 86% | strong | good | medium | strong | medium | Confirmed |
| Dashboard UX | 84% | strong | good | medium | strong | strong | Confirmed |
| Governance / truth validation | 90% | strong | good | strong | strong | strong | Confirmed |

No component is below 80% in the current static read, so no below-threshold rescue plan is required.

## 11) Risk Register

| ID | Risk | Root cause | Impact | Likelihood | Exploitability | Severity | Evidence |
|---|---|---|---|---|---|---|---|
| R-001 | Lost or orphaned async jobs on process death | in-process job queue + closures | scans/discovery/AI work can be delayed or lost until reconciliation | Medium | N/A | High | `job-queue.ts:1-16, 43-53, 110-114`; `job-reconciliation.ts:1-36` |
| R-002 | Temporary uploads can vanish across restart or scale-out | in-process upload store | archive discovery can fail after restart / multi-instance | Medium | N/A | Medium | `upload-store.ts:1-13, 28-76` |
| R-003 | Rate-limit enforcement can degrade open | DB error path returns `allowed: true` | AI request volume may spike during DB faults | Medium | Medium (authenticated) | Medium | `db-rate-limiter.ts:57-89` |
| R-004 | Project root fallback can mask deleted temp clones | workspace fallback on inaccessible root | AI file tools may operate on the fallback workspace instead of the original clone | Medium | Medium (authenticated) | Medium | `rootpath-validator.ts:36-103` |
| R-005 | Context cache can briefly serve stale state | 30s in-process TTL | AI context can lag across processes or during rapid concurrent writes | Medium | N/A | Medium | `context-builder.ts:29-35, 42-50, 361-363` |

## 12) Missing Components List

- Durable background job queue / worker.
- Shared upload storage for archive discovery.
- Cross-process cache invalidation channel.
- Cluster-grade sliding-window rate limiter.
- Optional cross-tab AI state synchronization.

## 13) Development Roadmap

### Epic A — Durability hardening
- Externalize job queue.
- Externalize upload storage.
- Add stronger recovery semantics for interruption points.

### Epic B — Consistency and scaling
- Add cross-process cache invalidation.
- Upgrade rate limiter semantics if deployment expands.

### Epic C — Contract tightening
- Reduce the remaining handwritten dashboard fetch paths where feasible.
- Preserve generated client drift checks.

## 14) PR Backlog

| Order | PR | Objective | Files | Depends on | Risks | Tests |
|---|---|---|---|---|---|---|
| 1 | PR-D1 | Externalize or durable-ify async work | `job-queue.ts`, `job-reconciliation.ts`, startup wiring | none | R-001 | queue/reconciliation tests |
| 2 | PR-D2 | Replace in-process upload store | `upload-store.ts`, discovery upload routes | PR-D1 optional | R-002 | archive discovery tests |
| 3 | PR-D3 | Add cross-process invalidation | `context-builder.ts`, scan/apply/task/workflow mutation paths | none | R-005 | cache coherence tests |
| 4 | PR-D4 | Harden AI routing under DB failures | `db-rate-limiter.ts`, health surfacing | none | R-003 | rate-limit failure tests |
| 5 | PR-D5 | Remove remaining dashboard fetch duplication where practical | `dashboard/src/lib/api-fetch.ts`, `AiChat.tsx`, any git panel equivalents | none | contract drift | UI/route parity tests |

## 15) Meta-Verification

Five re-checks were performed against the source:
1. `artifacts/api-server/src/index.ts:10-37` — startup reconciliation and stale-job sweep.
2. `artifacts/api-server/src/routes/git.ts:283-353` — push queues a post-push scan.
3. `artifacts/api-server/src/routes/ai/chat.ts:467-537` — apply-changes blocks sensitive files, writes files, emits event, invalidates cache.
4. `artifacts/api-server/src/lib/job-queue.ts:1-114` — bounded in-process queue.
5. `docs/truth-flow-pr-checklist.md:10-18, 72-80` — baseline/derived/historical/runtime governance model.

**Self-confidence score:** 0.87

## 16) Final Engineering Verdict

The repository is a functioning multi-layer system with real runtime behavior, not a documentation-only scaffold. The strongest evidence is the end-to-end chain from contract generation to API runtime to persistence to dashboard consumption, plus recovery logic for interrupted work. The main unresolved engineering debt is operational durability: the queue and upload store are still process-local, and the AI context path intentionally tolerates transient inconsistency in exchange for responsiveness. Those are implementation trade-offs, not missing architecture.

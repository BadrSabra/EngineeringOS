# Forensic Engineering Audit — EngineeringOS

## Executive Summary

The repository is not a stub. It contains a coherent, mostly implemented stack:
- API server (`artifacts/api-server`)
- Dashboard (`artifacts/dashboard`)
- shared libraries for DB, scanning, AI orchestration, API client, Zod/spec generation, and knowledge queries
- governance scripts for codegen drift, truth-flow validation, setup verification, and post-merge sync

The core runtime path is real and end-to-end:
`dashboard → api-server routes → db / scanner / ai-orchestrator / knowledge-engine → events & audit → generated API client/spec`.

The main engineering risks are concentrated in three places:
1. **In-process bounded queues** that explicitly lose queued jobs on restart.
2. **Process-local orchestration locks** that are safe in one Node process but not durable/distributed.
3. **A docs-coverage heuristic** in the plugin runtime that is still a TODO instead of real docstring/JSDoc extraction.

A precise spec/runtime comparison found **4 code-only AI endpoints** not present in the OpenAPI contract:
- `GET /ai/deepseek-key`
- `PUT /ai/deepseek-key`
- `DELETE /ai/deepseek-key`
- `GET /ai/active-provider`

Everything else in the observed route set matched the OpenAPI surface after path normalization.

## Repository Scope and Master Inventory

Full inventory created separately:
- `EngineeringOS_master_inventory.csv`
- **757 files** inventoried
- unique IDs: `F-0001` … `F-0757`

Top-level distribution:
- `(root)`: 281
- `lib/api-zod`: 161
- `artifacts/dashboard`: 89
- `artifacts/mockup-sandbox`: 69
- `artifacts/api-server`: 60
- `lib/ai-orchestrator`: 36
- `lib/db`: 19
- `lib/scanner`: 15
- `lib/api-client-react`: 8
- `lib/knowledge-engine`: 8
- `scripts`: 8
- `lib/api-spec`: 3

Heuristic classification totals:
- Documentation: 272
- Runtime Path: 251
- Source of Truth: 242
- Generated: 160
- Configuration: 87
- Test Path: 32
- Tooling/Script: 9
- Placeholder: 2
- Legacy/Dead: 1
- Other: 1

## System Architecture (Actual) & Layer Map

| Layer ID | Layer | Role | Representative Files | Status |
|---|---|---|---|---|
| L-1 | Presentation | Clerk-protected UI, routing, cache invalidation, client state | `artifacts/dashboard/src/App.tsx`, `main.tsx`, pages/components | Core |
| L-2 | API Gateway / HTTP Surface | Express bootstrap, auth, body limits, cache policy, router wiring | `artifacts/api-server/src/index.ts`, `src/app.ts`, `src/routes/index.ts` | Core |
| L-3 | Feature Routes / Orchestration | discovery, tasks, workflows, graph, metrics, plugins, git, AI | `artifacts/api-server/src/routes/*.ts` | Core |
| L-4 | Domain / AI Orchestration | model calls, parsing, decisions, workflow execution rules | `lib/ai-orchestrator/src/*` | Core |
| L-5 | Scanner / Graph Extraction | AST-driven graph/provenance extraction, metrics, source matching | `lib/scanner/src/*` | Core |
| L-6 | Knowledge Engine | read-only graph query / inference utilities | `lib/knowledge-engine/src/*` | Core |
| L-7 | Persistence | DB connection, schema access, transactions | `lib/db/src/index.ts`, `artifacts/api-server/src/lib/*` | Core |
| L-8 | Spec / Generated Contracts | OpenAPI, generated client, generated Zod schema | `lib/api-spec/*`, `lib/api-zod/*`, `lib/api-client-react/*` | Core |
| L-9 | Governance / Tooling | drift checks, truth validation, setup, merge automation | `scripts/*` | Supporting |

Boundary observations:
- UI does not talk to DB directly; it goes through API/client.
- API routes own mutation/validation and are the main state-changing layer.
- AI orchestration is isolated in `lib/ai-orchestrator`; route handlers call it.
- Scanner is structurally separate from workflow execution.
- Governance scripts are present and actively checked in scripts/CI flows.

## Detailed Layer-by-Layer Analysis

### Presentation
The dashboard is not a placeholder shell. It wires Clerk auth, query caching, and route-level screens. The UI includes project discovery, graph, workflows, tasks, rules, events, metrics, AI chat, and git panels. Some inputs still show placeholder copy, but the navigation and data hooks are real.

### API / HTTP Surface
The server bootstrap is coherent:
`index.ts → fixDeadRootPaths() → app.ts → route mounting → listen`.
The app enforces auth on `/api`, configures CORS/body parsing, and installs a central error handler.

### Feature Routes / Orchestration
This is the strongest area. Discovery, AI chat/apply, workflow orchestration, task execution, graph, metrics, plugins, and git actions are all implemented as route-level flows with validation and auditing hooks.

### AI Orchestration
The AI layer is robust:
- model clients include retries/circuit-breaking and parsing fallback
- chat/task/scan/workflow agents return parse failure markers rather than crashing
- workflow orchestration validates transitions and blocks illegal advances

### Scanner / Graph Extraction
This is a real analysis pipeline, not a mock:
- TypeScript and Python AST extraction
- provenance and evidence capture
- graph merge/dedup
- metrics computation
- runtime/heuristic relation typing

### Knowledge Engine
The knowledge engine is a pure read layer for graph-related reasoning and queries. It is structurally simpler than the scanner and routes.

### Persistence
DB initialization is guarded by `DATABASE_URL`, and the route layer performs state changes through the shared DB module and transactional patterns.

### Spec / Generated Contracts
The OpenAPI contract and generated clients are mostly aligned with routes. One meaningful drift exists in the AI surface: DeepSeek key and active-provider endpoints exist in code but not in the spec.

### Governance / Tooling
The repository includes operational quality gates:
- codegen drift check
- truth-flow validation
- setup verification
- merge/post-merge automation

## Critical File-by-File Analysis

| ID | Path | Actual Role | Impact |
|---|---|---|---|
| C-01 | `artifacts/api-server/src/index.ts` | startup entrypoint, launches server after dead-root-path repair | high |
| C-02 | `artifacts/api-server/src/app.ts` | HTTP bootstrap, auth, CORS, routing, error handling | high |
| C-03 | `artifacts/api-server/src/routes/index.ts` | central route composition | high |
| C-04 | `artifacts/api-server/src/routes/ai.ts` | AI chat, apply, task execute, workflow orchestration, provider key mgmt | critical |
| C-05 | `artifacts/api-server/src/routes/discovery.ts` | project discovery and queueing | critical |
| C-06 | `artifacts/api-server/src/lib/job-queue.ts` | bounded in-memory queue with explicit restart loss | critical |
| C-07 | `artifacts/api-server/src/lib/path-validation.ts` | blocks dangerous root paths and validates project roots | high |
| C-08 | `artifacts/api-server/src/lib/startup-migrations.ts` | repairs dead root paths at boot | medium |
| C-09 | `artifacts/api-server/src/lib/plugin-runtime.ts` | plugin execution and docs heuristic | medium |
| C-10 | `lib/ai-orchestrator/src/parsing.ts` | structured output parsing with fallback | high |
| C-11 | `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts` | workflow decisions and transition enforcement | high |
| C-12 | `lib/scanner/src/graph-extractor.ts` | AST graph extraction and provenance merge | high |
| C-13 | `lib/scanner/src/python-ast-script.py` | Python AST worker script | high |
| C-14 | `lib/db/src/index.ts` | DB connection guard and Drizzle setup | high |
| C-15 | `artifacts/dashboard/src/App.tsx` | authenticated UI routing and cache invalidation | high |
| C-16 | `scripts/check-codegen-drift.ts` | generated-code consistency gate | medium |
| C-17 | `scripts/validate-truth-flow.ts` | truth-flow contract validation | medium |

## End-to-End Execution Flow Analysis

| Flow | Start | Main Path | End | Status |
|---|---|---|---|---|
| Discovery → Scan → Graph | dashboard discovery page → `/api/projects/discover` | root-path validation → discovery job enqueue → scanner AST/provenance extraction → graph + metrics persistence | graph/metrics/events available to UI | complete |
| Chat → Pending Changes → Apply | AI chat UI → `/api/ai/chat` | model call → structured parse → pending changes / decision payload → `/api/ai/apply-changes` | state mutation + audit/event traces | complete |
| Task Execute → Verify → Audit | task UI or scheduler → `/api/ai/tasks/:taskId/execute` | task decision → execution → result storage/verification → audit record | task lifecycle update | complete |
| Workflow Start → Advance → Fail/Retry | workflow UI → `/api/ai/workflows/:workflowId/orchestrate` | decision validation → phase transition checks → metrics gate → execution or rejection | workflow state update or guarded failure | complete, but multi-instance lock is process-local |

Failure handling:
- parse failures are surfaced as structured route errors, not silent crashes
- unsupported discovery adapters return HTTP 501
- unsafe root paths are blocked
- queue overflow/backpressure is explicit
- some audit/telemetry writes are best-effort and do not block the user path

## Documentation Gap Analysis

| Item | Doc / Spec Status | Code Status | Discrepancy |
|---|---|---|---|
| Core API routes | documented in OpenAPI | implemented | Match |
| GitHub token management | documented in OpenAPI | implemented | Match |
| Groq provider key management | documented in OpenAPI | implemented | Match |
| DeepSeek key management | not in OpenAPI | implemented in code | Implemented but Undocumented |
| Active provider endpoint | not in OpenAPI | implemented in code | Implemented but Undocumented |
| Docs coverage for plugins | doc promises richer docs extraction | current code uses heuristic density + TODO | Missing / partial |
| In-memory queue durability | docs acknowledge queue limitations | code confirms restart loss | Match / exposed risk |
| Placeholder UI copy | visible in screens | functional UI still present | Implemented but rough |

Concrete spec drift:
- code-only routes: `GET/PUT/DELETE /ai/deepseek-key`, `GET /ai/active-provider`

## Code Quality & Structural Assessment

Structural weaknesses:
1. **In-memory queue durability loss** — `High/Blocker` for queued jobs after restart.
2. **Process-local orchestration lock** — `High` for multi-instance deployments.
3. **Heuristic docs coverage** — `Medium` because it can misreport plugin coverage.
4. **Spec drift in AI endpoints** — `Medium` because generated clients/docs will miss these routes.
5. **Placeholder copy in UI** — `Low/Medium` because it weakens clarity but does not break runtime.
6. **Legacy backup config** (`tsconfig.base.json.bak`) — `Low`, noise only.
7. **Temporary manual scan script** (`scripts/trigger-scan.mts`) — `Low/Medium`, operational convenience but not core runtime.

Evidence highlights:
- `job-queue.ts` explicitly warns jobs are lost on restart.
- `plugin-runtime.ts` contains a TODO to replace the docs heuristic.
- `workflow-orchestrator.ts` uses a process-local in-flight set and notes distributed locking is needed for multi-instance safety.
- `ai.ts` includes endpoints absent from the spec.

## Technical Debt Report

Top debt items:
- replace in-memory queue with durable queue
- introduce distributed lock / advisory lock for workflow/task orchestration
- replace docs heuristic with actual docstring/JSDoc extraction
- align OpenAPI spec and generated client with code-only AI provider endpoints
- reduce placeholder copy and stale temp tooling

## Completion Assessment Matrix

| Component | Implementation | Tests | Docs | Integration | Operational | Completion |
|---|---|---|---|---|---|---|
| API server | complete | good | good | complete | partial (queue durability) | 88% |
| Dashboard | complete | moderate | good | complete | partial (placeholder UX) | 84% |
| AI orchestration | complete | good | good | complete | mostly complete | 90% |
| Scanner / graph extraction | complete | moderate | good | complete | good | 88% |
| Knowledge engine | complete | limited | moderate | complete | good | 82% |
| Persistence / DB | complete | moderate | good | complete | good | 86% |
| Governance scripts | complete | moderate | good | complete | good | 85% |
| Plugin runtime docs coverage | partial | limited | partial | partial | partial | 55% |

Components below 80%:
- Plugin runtime docs coverage
- Some UI polish surfaces
- Durable execution semantics for queued jobs under restart / horizontal scaling

## Risk Register

| ID | Risk | Severity | Impact | Root Cause | How to test |
|---|---|---|---|---|---|
| R-01 | queued jobs lost on restart | Blocker | discovery / scan / automation loss | in-memory queue | enqueue jobs, restart process, observe loss |
| R-02 | multi-instance orchestration collision | High | duplicate or conflicting workflow/task execution | process-local lock only | run two workers against same workflow |
| R-03 | docs coverage misreporting | Medium | wrong plugin/runtime completeness signals | heuristic docs detection | compare heuristic vs actual docstrings |
| R-04 | spec drift for AI provider endpoints | Medium | generated client and docs incomplete | code path not mirrored in OpenAPI | diff route list vs schema |
| R-05 | temp/placeholder UX copy | Low | user confusion | incomplete polish | manual UX review |

## Missing Components List

- durable job queue / queue persistence
- distributed lock for orchestration
- real documentation coverage extractor
- OpenAPI coverage for code-only AI endpoints
- UI polish for placeholder text and token inputs
- removal of legacy backup config and temporary scripts

## Development Roadmap

### Epic 1 — Durability and concurrency hardening
Features:
- replace in-memory queue with durable queue
- add process-safe orchestration lock
- add restart recovery semantics

### Epic 2 — Contract synchronization
Features:
- add missing AI endpoints to OpenAPI
- regenerate client/schema
- add drift test for route parity

### Epic 3 — Evidence-quality improvements
Features:
- replace docs heuristic with actual extraction
- improve plugin coverage scoring
- add fixture-based tests

### Epic 4 — UX cleanup
Features:
- remove placeholder copy
- align form labels and defaults
- improve error-state guidance

## PR Backlog

| PR | Type | Files | Depends on | Acceptance Criteria |
|---|---|---|---|---|
| PR-01 | Fix | `artifacts/api-server/src/lib/job-queue.ts`, routes using it | none | queued jobs survive restart or are durably persisted |
| PR-02 | Fix/Structural | `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts`, task/workflow routes | PR-01 | single-flight execution works across instances |
| PR-03 | Fix | `artifacts/api-server/src/routes/ai.ts`, `lib/api-spec/openapi.yaml`, generated client | none | spec matches all AI endpoints |
| PR-04 | Technical | `lib/api-client-react`, `lib/api-zod` | PR-03 | client regeneration passes drift check |
| PR-05 | Structural | `artifacts/api-server/src/lib/plugin-runtime.ts`, scanner/doc extraction code | none | docs coverage uses actual extracted docs |
| PR-06 | Test | governance scripts + route parity tests | PR-03 | drift failure is reproducible and blocking |
| PR-07 | Documentation | `docs/*` | none | docs list all live endpoints and limitations |
| PR-08 | Fix/UX | dashboard screens with placeholder copy | none | placeholder copy removed or replaced |

## Final Engineering Verdict

This repository is **substantially implemented** and has a real production-shaped architecture. It is not merely scaffold code. The strongest evidence is the end-to-end chain from dashboard to API routes to scanner/AI/orchestration/persistence, plus the generated contract and governance scripts.

The system is **not fully operationally hardened** yet because restart durability and distributed orchestration safety remain unfinished. The highest-value next step is to remove the in-memory queue assumption and make the workflow/task execution path durable and instance-safe.


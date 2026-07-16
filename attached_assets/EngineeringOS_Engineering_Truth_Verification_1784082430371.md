# EngineeringOS — Engineering Truth Verification

**Date:** 2026-07-15  
**Scope:** full 562-file imported archive, static verification only.

## What was verified

- Rebuilt the full file inventory from the imported archive.
- Classified every file into one lifecycle status: `implemented`, `generated`, `prototype`, `archived-evidence`, or `control-doc`.
- Traced the architecture through the contract, data, execution, analysis, knowledge, AI, UI, prototype, evidence, and control layers.
- Checked the critical runtime path by reading the core server, scanner, knowledge, AI, and DB modules directly.
- Cross-checked the current fact-record and completion-plan documents against the codebase.

## Truth hierarchy used

1. `docs/fact-record.md` — current architectural truth record.
2. `docs/completion-plan.md` — intended sequencing and phase model.
3. Live source code in `artifacts/` and `lib/`.
4. Generated outputs in `lib/api-zod` and `lib/api-client-react`.
5. `attached_assets/` archived evidence and prior analysis artifacts.
6. `.agents/memory/` decision notes and prior design choices.

## Inventory snapshot

| Category | Files |
|---|---:|
| implemented | 211 |
| generated | 123 |
| archived-evidence | 118 |
| prototype | 68 |
| control-doc | 42 |

| Layer | Files |
|---|---:|
| contract | 126 |
| evidence | 118 |
| ui | 87 |
| prototype | 68 |
| execution | 50 |
| control | 42 |
| ai | 30 |
| data | 18 |
| analysis | 15 |
| knowledge | 8 |

### Structural facts

- Repository files: **562**
- OpenAPI paths: **48**
- OpenAPI operations: **59**
- OpenAPI schemas: **63**
- DB tables: **16**
- Dashboard pages: **15**
- API-server route modules: **13**
- API-server route tests: **12**
- Test files across the repo: **27**

## What the verification shows

### 1) The project is a real governed platform

The runtime spine is present and coherent: contract, DB schema, scanner, knowledge queries, AI orchestrator, API server, and dashboard all exist as separate layers. This is not a demo shell.

### 2) The contract-first boundary is real

`lib/api-spec/openapi.yaml` drives generated schema/client code in `lib/api-zod` and `lib/api-client-react`, and the repo has a dedicated drift check (`scripts/check-codegen-drift.ts`) plus root `codegen:check`.

### 3) Ownership scoping is the main architectural guardrail

`requireProjectAccess` / `loadProjectByIdForUser` are used across project-scoped routes, and the deeper route set (`tasks`, `rules`, `workflows`, `events`, `metrics`, `graph`, `ai`) now consistently checks ownership before returning data or mutating state.

### 4) Scan/discovery execution is hardened

`job-queue.ts` bounds concurrency, `job-reconciliation.ts` repairs orphaned jobs after restart, and `scan-runner.ts` performs heavy work out of band and keeps the scan atomic.

### 5) The scanner and knowledge layers are substantive

The scanner is not regex-only: TS/JS graph extraction is AST-based, Python uses a batched real-`ast` subprocess, and the knowledge engine computes graph summaries plus traversal-based impact/path queries.

### 6) AI is schema-gated, not free-form

The AI layer uses prompt builders, zod schemas, safe parsing/fallback, and a workflow state machine that validates model suggestions before execution.

## Deepest gaps still visible

- Discovery still has unsupported source types in the adapter registry; those branches are explicit stubs rather than real capability.
- The project-scoping model is only as strong as every route helper call and every future route added to the server.
- The platform depends on codegen drift checks staying green; any OpenAPI edit that is not regenerated is a real integrity break.
- UI quality is now mostly a reflection problem: it must continue mirroring the actual backend truth rather than inventing simplified behavior.
- Several archived analysis documents still contain historical notes; they are useful evidence, but they are not the source of truth.

## Highest-priority files to keep under control

| file | role | gap | risk |
| --- | --- | --- | --- |
| artifacts/api-server/src/app.ts | API server module | Security defaults must stay aligned with auth/proxy behavior. | Misconfigured middleware affects every request. |
| artifacts/api-server/src/lib/job-reconciliation.ts | Server service/helper | Only handles stuck rows at boot, not mid-flight crashes after boot. | Without reconciliation, projects can remain stuck in scanning/discovering. |
| artifacts/api-server/src/lib/audit.ts | Server service/helper | Audit failures are non-blocking by design; compliance requirements would change this. | Telemetry may miss a row during audit-store outage. |
| artifacts/api-server/src/lib/discovery-adapters.ts | Server service/helper | Three discovery source types are still stubs/501-capabilities. | Discovery onboarding is incomplete until remaining adapters exist. |
| artifacts/api-server/src/lib/job-queue.ts | Server service/helper | Queue is in-memory only; process restart drops pending work. | Unbounded concurrency or restart loss would destabilize scans. |
| artifacts/api-server/src/lib/scan-runner.ts | Server service/helper | Relies on downstream scanner/orchestrator correctness for full fidelity. | A regression here can wedge scanning or leave partial state if atomicity breaks. |
| artifacts/api-server/src/routes/ai.ts | HTTP route | Large surface area; route comments show a couple of placeholder annotations that should be kept honest. | AI actions can mutate many tables and must preserve project ownership, audit, and schema validation. |
| artifacts/api-server/src/routes/discovery.ts | HTTP route | Source handling still has future-capability branches and import atomicity edge cases. | Discovery is the widest ingestion surface; small bugs fan out into tasks, graph, and metrics. |
| artifacts/api-server/src/routes/events.ts | HTTP route | Query parsing currently supplements generated schemas for correlationId. | Events are the trace backbone; scoping mistakes create data leaks. |
| artifacts/api-server/src/routes/graph.ts | HTTP route | Query-size caps and ownership lookup must stay aligned with generated params. | Graph endpoints can become expensive or leak cross-project topology if filters slip. |
| artifacts/api-server/src/routes/metrics.ts | HTTP route | Global latest view must remain constrained to owned projects only. | Metrics leakage would undermine tenant isolation. |
| artifacts/api-server/src/routes/projects.ts | HTTP route | Must stay in sync with ownership middleware and generated request bodies. | Project scoping bugs expose or mutate another user’s data. |
| artifacts/api-server/src/routes/tasks.ts | HTTP route | Depends on project lookup helper for every query/body projectId path. | Task access-control mistakes leak work across projects. |
| artifacts/api-server/src/routes/workflows.ts | HTTP route | Workflow state machine must remain aligned with AI orchestrator decisions. | Workflow control flow bugs can corrupt execution state. |
| lib/ai-orchestrator/src/agents/chat-agent.ts | AI agent / workflow | Depends on groq-client and schema stability. | Conversation errors should degrade, not crash. |

## PR execution order after verification

**PR-0 — Lock contract truth**
- Files: `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`, `scripts/check-codegen-drift.ts`
- Exit criteria: codegen is deterministic, drift check is green, no duplicate exports, contract and generated outputs stay in sync.

**PR-1 — Finish data integrity and ownership**
- Files: `lib/db/src/schema/*`, `artifacts/api-server/src/middlewares/requireProjectAccess.ts`, `artifacts/api-server/src/routes/projects.ts`, `tasks.ts`, `rules.ts`, `workflows.ts`, `events.ts`, `metrics.ts`, `graph.ts`, `ai.ts`
- Exit criteria: every project-scoped read/write path verifies ownership and all FK / nullability decisions match runtime behavior.

**PR-2 — Harden execution spine**
- Files: `artifacts/api-server/src/app.ts`, `src/lib/job-queue.ts`, `src/lib/job-reconciliation.ts`, `src/lib/scan-runner.ts`, `src/lib/audit.ts`, `src/lib/plugin-runtime.ts`
- Exit criteria: scans and discovery jobs remain bounded, recoverable, auditable, and restart-safe.

**PR-3 — Close discovery source coverage**
- Files: `artifacts/api-server/src/lib/discovery-adapters.ts`, `artifacts/api-server/src/routes/discovery.ts`, discovery tests
- Exit criteria: source types are either fully supported or explicitly deferred with tested capability responses.

**PR-4 — Deepen scanner fidelity**
- Files: `lib/scanner/src/*`
- Exit criteria: AST extraction, Python fallback, rule matching, and metrics are all covered by tests and known failure modes.

**PR-5 — Promote the knowledge layer**
- Files: `lib/knowledge-engine/src/*`, graph route integration
- Exit criteria: impact/path/summary queries remain efficient, bounded, and aligned with graph schema.

**PR-6 — Stabilize AI orchestration**
- Files: `lib/ai-orchestrator/src/*`, `artifacts/api-server/src/routes/ai.ts`
- Exit criteria: parsing, schema validation, workflow decisions, and client error handling remain deterministic.

**PR-7 — Reconcile traceability and dashboard truth**
- Files: `events`, `metrics`, `task_logs`, `audit`, dashboard pages/components
- Exit criteria: UI always reflects backend state and traceability is queryable end-to-end.

## Boundary note on counts

The exact split between `implemented` and `control-doc` can shift by one or two files depending on whether you count workspace manifests and helper scripts as runtime implementation or control metadata. The important truth is unchanged: the runtime core exists, the generated layer exists, the prototype layer exists, and the evidence archive is substantial.

## Deliverables

- CSV inventory: `EngineeringOS_Engineering_Truth_Verification.csv`
- Markdown report: `EngineeringOS_Engineering_Truth_Verification.md`

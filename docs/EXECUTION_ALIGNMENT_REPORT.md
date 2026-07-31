# EngineeringOS — Execution Alignment Report

> آخر تحديث: 2026-07-15. مولَّد من مسح أرشيف كامل (595 ملف).

## Scope and inventory
- Total files in archive: **595**
- Top-level distribution: artifacts 212, lib 203, attached_assets 137, .agents 21, scripts 6, docs 4
- OpenAPI paths: **49**
- Route declarations in api-server: **62**
- DB tables discovered: **17**
- Dashboard pages: **15**
- Test files: **29**

## High-confidence architecture read
EngineeringOS is a multi-layer platform, not a single app. The repository splits into: contract surfaces, runtime API, data schema, scanner/graph intelligence, AI orchestration, dashboard UX, and governance/docs.

## Execution status by layer
| Layer | Purpose | Status | Evidence | Next move |
|---|---|---:|---|---|
| Contract / spec | OpenAPI + generated Zod + generated React client | **Complete** | openapi.yaml, api-zod/generated, api-client-react/generated | Keep drift gates on CI; regeneration is already wired. |
| Data layer | Drizzle schema with 17 tables | **Mostly complete** | lib/db/src/schema/*.ts | FK/constraint depth and migration governance still deserve a dedicated pass. |
| API runtime | Express server + auth + ownership + audit | **Mostly complete** | artifacts/api-server/src/app.ts, routes/*, middlewares/*, lib/audit.ts | Durable queue and some UX-specific error surfacing remain partial. |
| Discovery / scan | Workspace discovery, adapters, path validation, scan runner | **Mostly complete** | routes/discovery.ts, lib/discovery-adapters.ts, path-validation.ts, scan-runner.ts | The pipeline is real; final polish is in edge-case handling and queue durability. |
| Scanner | File walk, rule matching, graph extraction, metrics | **Complete** | lib/scanner/src/* | This is a functioning analysis engine, not a stub. |
| Knowledge engine | Graph queries and inference | **Complete** | lib/knowledge-engine/src/* | Query and inference layers are present and tested. |
| AI orchestration | Chat, task, scan, review, workflow agents | **Mostly complete** | lib/ai-orchestrator/src/*, routes/ai.ts | Depends on provider availability and defensive parsing; more hardening can still be done. |
| Dashboard | Projects, discovery, tasks, rules, workflows, graph, metrics, AI | **Mostly complete** | artifacts/dashboard/src/pages/* | UX still has placeholder copy/examples and some state-machine edges to smooth. |
| Governance / truth | Fact record, completion plan, truth-flow validation | **Complete** | docs/*, scripts/validate-truth-flow.ts, scripts/check-codegen-drift.ts | Now functioning as an enforcement layer, not just documentation. |

## OpenAPI → route → handler → DB → audit → frontend → generated client → tests
The endpoint set is structurally aligned: every OpenAPI path in `lib/api-spec/openapi.yaml` has a matching runtime route in `artifacts/api-server/src/routes/*.ts`, and there are corresponding generated Zod/client artifacts under `lib/api-zod/src/generated` and `lib/api-client-react/src/generated`. The repo also includes route-level tests, so the chain is not just descriptive.

## Main features and runtime posture
| Feature | UI | DB | Events/Audit | Tests | Status |
|---|---|---|---|---|---|
| Projects | Projects page + detail page | projectsTable | events/metrics/tasks linkage | yes | **strong** |
| Discovery | DiscoverProjectWizard | discoverySessionsTable + projectsTable | discovery steps + scan jobs | yes | **strong** |
| Tasks | Tasks page | tasksTable + taskLogsTable | task events + logs | yes | **strong** |
| Rules | Rules page | rulesTable | evaluation events | yes | **strong** |
| Workflows | Workflows page | workflowsTable + workflowExecutionsTable | workflow events | yes | **strong** |
| Events | Events page | eventsTable | central event stream | yes | **strong** |
| Metrics | Metrics page | metricsTable | time-series records | yes | **strong** |
| Graph | Graph page | graphEntitiesTable + graphRelationshipsTable | graph-derived summaries | yes | **strong** |
| Plugins | Plugins page | pluginsTable | enable/disable audit | yes | **medium** |
| AI Chat / Groq key | AiChat page | aiChatSessionsTable + aiChatMessagesTable + aiProviderCredentialsTable | chat/task/review/workflow events | yes | **medium** |
| Security / auth | SignIn / SignUp + shell hardening | - | auth middleware + helmet + rate limit + no-store | n/a | **strong** |
| Governance | Docs + validation gates | - | truth flow / codegen drift scripts | n/a | **strong** |

## Gaps that still matter
- The in-process job queue is still memory-bound; it is good for throttling but not durable recovery.
- Some UI surfaces still use example/placeholder text and generic fallback copy, especially in discovery and AI chat entry points.
- The truth register and completion plan are now enforcement-aware, but they still need periodic synchronization as code evolves.
- A few comments/symbols in the codebase use the words mock/placeholder/temporary as implementation notes; those should be cataloged, not ignored.

## Quantitative placeholder scan
- Marker hits in the full archive: **255**
- Marker distribution: Mock 75, Placeholder 51, return null 46, throw new Error 45, return undefined 14, Stub 12, Temporary 5, Fake 4, Not Implemented 2, TODO 1

## Hot files that deserve review
- `artifacts/api-server/src/routes/discovery.ts` — 12 marker hits
- `artifacts/dashboard/src/pages/AiChat.tsx` — 8 marker hits
- `artifacts/api-server/src/lib/discovery-adapters.test.ts` — 7 marker hits
- `artifacts/dashboard/src/components/ui/chart.tsx` — 7 marker hits
- `lib/api-client-react/src/custom-fetch.ts` — 7 marker hits
- `artifacts/api-server/src/lib/discovery-adapters.ts` — 6 marker hits
- `artifacts/api-server/src/middlewares/requireProjectAccess.ts` — 6 marker hits
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — 5 marker hits
- `artifacts/dashboard/src/pages/Rules.tsx` — 5 marker hits
- `artifacts/api-server/src/routes/ai.test.ts` — 4 marker hits
- `lib/scanner/src/graph-extractor.ts` — 4 marker hits
- `artifacts/api-server/src/lib/path-validation.ts` — 3 marker hits
- `artifacts/api-server/src/lib/scan-runner.ts` — 3 marker hits
- `artifacts/api-server/src/routes/projects.test.ts` — 3 marker hits
- `artifacts/dashboard/src/components/ui/form.tsx` — 3 marker hits
- `artifacts/dashboard/src/pages/Graph.tsx` — 3 marker hits
- `artifacts/dashboard/src/pages/Workflows.tsx` — 3 marker hits
- `artifacts/dashboard/vite.config.ts` — 3 marker hits
- `artifacts/api-server/src/config.ts` — 2 marker hits
- `artifacts/api-server/src/lib/credentials-crypto.ts` — 2 marker hits

## Recommended next PR sequence
1. Lock the runtime chain with a matrix that verifies every important endpoint across OpenAPI, handler, DB, audit, client and tests.
2. Replace remaining UI fallback/placeholder copy with state-specific messaging.
3. Decide whether the job queue needs a durable backend; if yes, add persistence and replay.
4. Keep the truth register and completion plan aligned with every new PR.
5. Add a dead-code / unused-export sweep after the architecture stabilizes.

## Important interpretation note
Several files in `attached_assets/` are archived analyses, inventories, and generated reports. They are part of the repository evidence trail but not the runtime surface.

# EngineeringOS — Technical Audit Report

> Scope: This report consolidates the findings discussed in the conversation and organizes them by file/folder, with each issue described under: **ثغرة / دليل / أثر / أولوية**.

## Summary

The repository is architecturally strong and well-structured as a monorepo, but it has several high-risk gaps:
- API contract drift between OpenAPI, generated client, and server routes.
- Missing authentication/authorization and perimeter hardening.
- No visible test suite for the core scanner/workflow/discovery logic.
- Graph identity is too coarse in persistence, which can merge unrelated entities.
- Several data models are broader than the implementation that populates them.
- Some dashboard/query paths rely on in-memory aggregation and will not scale well.

---

## Root / Workspace

### `package.json`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Workspace/build discipline is good, but generated artifacts are not clearly tied into the main build flow. | The root scripts enforce `typecheck` and `build`, but code generation for API client / Zod artifacts lives separately under `lib/api-spec/package.json`. | Schema or OpenAPI changes can drift from generated outputs if codegen is not run consistently. | High |
| Preinstall policy is restrictive by design, but depends on correct pnpm availability in every environment. | `preinstall` blocks npm/yarn and expects pnpm. | Good for consistency, but can break onboarding in environments where pnpm is not preinstalled. | Medium |

### `pnpm-workspace.yaml`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Dependency policy is present, but workspace-wide regeneration is still manual. | Workspace structure is defined, but no automatic regeneration gate was found in the main root flow. | Higher chance of stale generated clients/schemas after spec changes. | High |

### `replit.md`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| The architecture relies on OpenAPI as source of truth, but the same source-of-truth discipline is not enforced at runtime. | The project documentation describes OpenAPI → Zod → React Query generation, but runtime setup does not appear to rebind client base URLs automatically. | Documentation and runtime can diverge, producing broken integration despite correct docs. | High |

---

## API Contract Layer

### `lib/api-spec/openapi.yaml`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| API paths appear to include `/api` in the spec itself. | The spec defines routes with `/api/...` prefixes. | If codegen also prepends `/api`, clients will target incorrect double-prefixed URLs. | Critical |
| The contract is broader than the implementation in some places. | Spec includes a richer set of operations than some routes appear to fully implement. | Clients may be generated for endpoints that are incomplete or behave differently from expectations. | High |

### `lib/api-spec/orval.config.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Base URL is configured as `/api` while the spec already contains `/api`. | `baseUrl: "/api"` is set here. | Generated client paths become `/api/api/...`, which can break all requests. | Critical |
| Codegen is isolated from runtime deployment. | Config exists, but no evidence of it being coupled to server build/start lifecycle. | Drift between contract and generated code can persist unnoticed. | High |

### `lib/api-client-react/src/generated/api.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Generated endpoints contain double `/api` prefix. | Client paths were observed as `/api/api/healthz`, `/api/api/projects`, etc. | Frontend requests may fail outright or hit non-existent endpoints. | Critical |
| Generated client depends on consistent external initialization. | The file exposes generated query hooks but relies on proper base URL/auth setup elsewhere. | Missing initialization causes silent integration failures. | High |

### `lib/api-client-react/src/custom-fetch.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Runtime base URL and auth token wiring exist but are not visibly used. | `setBaseUrl(...)` and `setAuthTokenGetter(...)` exist. | The app can be configured correctly in theory, but the hooks may still point to the wrong endpoint if initialization is omitted. | High |
| Client has auth hooks but the server does not expose matching auth enforcement. | Fetch wrapper supports Authorization header injection. | Gives a false sense of security; client is ready for auth, server is not. | Medium |

### `lib/api-client-react/src/index.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Duplicate export lines indicate generated or merged residue. | The same generated exports appear repeated. | Signals weak artifact hygiene and can hide build/runtime confusion later. | Low |

---

## API Server Layer

### `artifacts/api-server/src/app.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Core hardening middleware is missing. | Logging, CORS, JSON parsing, route mounting, and error handling are present, but no clear helmet/rate-limit layer was observed. | Exposure to brute-force, request flooding, and common header-based hardening gaps. | High |
| Error responses may leak internals. | Central error handler returns `{ error: message }` for 500-level failures. | Internal exception details may be exposed to clients. | High |
| The app is organized, but resilience features are sparse. | No visible auth, CSRF, request size limits, or origin restrictions beyond default CORS. | Lower production readiness. | High |

### `artifacts/api-server/src/lib/logger.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Logging is strong, but logging alone is not security. | Authorization, cookie, and set-cookie redaction are present. | Good audit hygiene, but does not replace auth or perimeter security. | Medium |

### `artifacts/api-server/src/routes/projects.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Graph entity identity is too coarse. | Persistence keys were observed to rely on `${type}::${name}`. | Different files with same type/name can collide and be merged incorrectly. | Critical |
| Project scan runs in the request path and can be heavy. | Scan workflow performs file walking, matching, graph extraction, and metrics in-line. | Performance degradation and request timeouts on large repos. | High |
| Summary/scan logic aggregates heavily in memory. | The route computes summaries after loading broad sets of records and scan results. | Scaling issues as projects/events/tasks grow. | High |

### `artifacts/api-server/src/routes/discovery.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Discovery confidence is heuristic, not strongly validated. | Confidence appears to be derived from presence of fields such as name/language/framework/runtime. | Reported confidence may be misleadingly high. | Medium |
| Architecture detection is simplified. | Detectors classify broadly into monorepo/microservices/monolith. | Real-world architectures may be misclassified or oversimplified. | Medium |
| Import pipeline creates seed data, not full reconstruction. | It writes project/session/event/metrics and some stubs, but not a full graph or workflow orchestration. | Discovery is useful but not autonomous end-to-end. | High |

### `artifacts/api-server/src/routes/tasks.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Task execution is more of a validation engine than an agent executor. | Execution checks patterns/files and updates state/logs; agent behavior is not fully realized. | The “AI task” promise is only partially implemented. | High |
| Rollback is operational, not truly reversible. | Rollback updates task state and logs events rather than undoing code changes. | Misleading semantics for users expecting true rollback behavior. | Medium |
| Workflow/task state handling is partial. | Several states exist, but transitions are not a fully enforced state machine. | Possible inconsistent states over time. | Medium |

### `artifacts/api-server/src/routes/workflows.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Workflow engine is incomplete relative to the schema. | Routes support create/start/stop/list executions, but phase-by-phase orchestration is limited. | Workflows are more administrative than autonomous. | High |
| Stop path can emit a synthetic execution response. | A fallback execution object is returned even when a running execution may not exist. | Response can diverge from persisted state. | Medium |

### `artifacts/api-server/src/routes/metrics.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Latest metrics retrieval is N+1-like. | Projects are loaded and then latest metrics are queried per project. | Fine for small data, inefficient at scale. | High |

### `artifacts/api-server/src/routes/graph.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Graph queries rely on broad fetching plus in-memory filtering. | Entities and relationships are gathered and filtered in the application layer. | Graph endpoints may slow down sharply as graph size grows. | High |

### `artifacts/api-server/src/routes/plugins.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Plugin bootstrap is request-time seeded. | Default plugin entries are inserted when first requested and a memory flag is used. | Race-prone in multi-instance deployments; not ideal for deterministic bootstrapping. | Medium |

### `artifacts/api-server/src/routes/dashboard.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Dashboard aggregates too much in one go. | Loads projects, tasks, recent events, rules, and metrics together. | Good for small datasets, but increasingly expensive with real usage. | High |

---

## Scanner Layer

### `lib/scanner/src/file-walker.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| File traversal is bounded, but depth and size limits may skip relevant content in large repos. | The walker avoids large folders and caps file size/depth. | Prevents runaway scans, but may under-scan complex repositories. | Medium |
| Fallback behavior can be risky if used directly. | The walker can fall back to process CWD in some situations. | If called without validation, it can scan the wrong root. | Medium |

### `lib/scanner/src/rule-matcher.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Rule matching is guarded, but remains regex-heavy and heuristic-based. | It caps pattern length and handles invalid regexes. | Safer than raw regex use, but still susceptible to false positives/negatives. | Low |

### `lib/scanner/src/graph-extractor.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Graph extraction is narrower than its stated ambition. | Comments indicate extends/implements/calls support, but actual extraction observed was mostly imports/exports/API routes. | The knowledge graph is less rich than expected. | High |
| Entity identity appears underspecified. | Downstream persistence does not incorporate path deeply enough. | Name collisions across files can corrupt relationships. | Critical |

### `lib/scanner/src/metrics-calc.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Produced metrics do not fully match DB schema expectations. | Calculator returns scores like security/maintainability/reliability/performance/technicalDebt/lintIssues, while schema expects fields like architectureScore and testCoverage. | Metrics storage and dashboard semantics diverge. | High |
| Test coverage is not computed despite schema support. | Schema includes coverage fields, but scanner output does not populate them. | Reported quality remains incomplete. | High |

---

## Database Schema Layer

### `lib/db/src/schema/metrics.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Schema expects more metrics than scanner currently generates. | Fields such as `architectureScore`, `testCoverage`, `testsPassed`, `testsTotal`, `buildStatus` are present. | Data model overpromises relative to implementation. | High |

### `lib/db/src/schema/tasks.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Task schema is richer than current task runtime. | Fields include `prompt`, `agentResponse`, `verificationResult`, `phase`, `workflowId`. | The system is ready for deeper AI/task orchestration, but the runtime does not fully exploit it. | High |

### `lib/db/src/schema/workflows.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Workflow schema outpaces execution logic. | It supports phases and executions, but routes do not implement a complete phase engine. | Orchestration remains partial. | High |

### `lib/db/src/schema/graph.ts`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Graph schema is solid, but upstream identity choice undermines it. | The schema supports entity/relationship metadata and project scoping. | If identities are collapsed by name, graph quality drops despite a good schema. | High |

---

## Dashboard / Frontend Layer

### `artifacts/dashboard/src/App.tsx`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| App structure is solid, but functionality depends heavily on backend contract correctness. | Routes and pages are organized, but API client contract issues remain unresolved. | The UI can appear healthy while requests fail underneath. | High |

### `artifacts/dashboard/src/components/Shell.tsx`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Search UI appears presentational more than functional. | Search box exists, but no clear global search behavior was observed. | User-facing affordance may not actually do anything meaningful yet. | Medium |

### `artifacts/dashboard/src/pages/Graph.tsx`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Graph visualization is not a semantic layout engine. | Nodes are distributed by derived numeric positions rather than graph topology. | Visualization is useful, but not a true exploration tool. | Medium |

### `artifacts/dashboard/src/pages/Events.tsx`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Filters/search affordances may not be fully wired. | UI elements are present, but some behavior appears partial. | Users may see controls that do not materially change results. | Medium |

### `artifacts/dashboard/src/pages/Workflows.tsx`
| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| Workflow UI implies more automation than the backend currently delivers. | Buttons and pipeline language exist, but orchestration is not fully realized. | Product messaging can outpace real functionality. | Medium |

---

## Integration / Operational Risks

| ثغرة | دليل | أثر | أولوية |
|---|---|---|---|
| No visible test suite for core logic. | No `.test.ts` or `.spec.ts` files were observed in the inspected content. | Discovery/scanner/workflow regressions can ship unnoticed. | Critical |
| No README in the root. | Root documentation was noted missing. | Onboarding and operational clarity suffer. | Medium |
| No clear auth/authorization layer. | Server routes do not show auth middleware or role checks. | High exposure if the system is used beyond local/internal use. | Critical |
| No clear rate limiting / hardening layer. | No helmet/rate limit/request-size controls were observed. | Greater abuse and stability risk. | High |
| Some routes perform heavy work inline. | Scan/discovery/dashboard metrics do substantial work in request handlers. | Latency and timeout risk under load. | High |
| Contract drift is the largest systemic risk. | Spec, generated client, and server base path are not aligned. | Frontend/backend integration can fail broadly. | Critical |

---

## Overall Priority Map

### Critical
- `/api` double-prefix mismatch in contract generation.
- Graph identity collision risk (`type::name`).
- No auth/authz on server routes.
- No visible tests for core engine.

### High
- Missing hardening middleware.
- Metrics/schema mismatch.
- Dashboard and metrics N+1 / in-memory aggregation risks.
- Workflow engine incomplete relative to schema.
- Discovery is seed-like, not full reconstruction.

### Medium
- Heuristic confidence and architecture classification.
- Request-time plugin seed pattern.
- Search/filter UI partial wiring.
- Runner/walker bounding may skip content.

### Low
- Duplicate export residue in generated index.
- Logging hygiene is good, but not a full security control.

---

## Final Assessment

The repository is structurally strong and has real platform substance, but it is not production-complete. The biggest blockers are:

1. API contract drift.
2. Missing security perimeter.
3. No test suite for critical logic.
4. Graph identity model too coarse.
5. Execution engine richer in schema than in runtime.

The project is best described as:

**a well-architected platform skeleton with meaningful functional depth, but with several critical consistency and production-hardening gaps still open.**

# EngineeringOS — Deepest Structural Analysis

## 1) What the project actually is

EngineeringOS is not a single application. It is a **multi-layer engineering control plane** for software projects. The codebase contains a true stack of concerns:

1. **Contract/spec layer** — the API contract is defined first and treated as source of truth.
2. **Generated integration layer** — client hooks and Zod schemas are generated from the contract.
3. **Domain/storage layer** — Drizzle schemas define projects, discovery sessions, scan jobs, tasks, workflows, events, metrics, graph, AI chats, audit logs, plugins.
4. **Scanner layer** — file walk, rule matching, graph extraction, metrics calculation.
5. **Knowledge layer** — graph traversal, impact analysis, clustering, summary inference.
6. **AI orchestration layer** — prompts, schemas, parsing resilience, workflow decisions, task execution, code review, scan analysis.
7. **Execution layer** — Express server, background job queue, reconciliation, access control, audit, plugin hooks.
8. **Presentation layer** — dashboard pages that expose the operational state.
9. **Evidence / memory layer** — `.agents/memory`, `docs/`, and `attached_assets/` preserve decisions and proof of progress.

This matters because the project should be judged as a **system of proof + execution**, not a UI product with a backend attached.

## 2) Inventory reality

- Total files in archive: **562**
- Distinct directories: **53**
- Named areas in inventory: **14**
- Status split:
  - implemented: **210**
  - generated: **123**
  - prototype: **69**
  - archived evidence: **118**
  - decision logs: **21**
  - source of truth files: **3**

### Area distribution

| area             |   files |   implemented |   generated |   prototype |   evidence |   source_truth |   control_docs |
|:-----------------|--------:|--------------:|------------:|------------:|-----------:|---------------:|---------------:|
| evidence-archive |     118 |             0 |           0 |           0 |        118 |              0 |              0 |
| generated-zod    |     117 |             0 |         117 |           0 |          0 |              0 |              0 |
| dashboard        |      88 |            88 |           0 |           0 |          0 |              0 |              0 |
| mockup-sandbox   |      69 |             0 |           0 |          69 |          0 |              0 |              0 |
| api-server       |      51 |            51 |           0 |           0 |          0 |              0 |              0 |
| ai-orchestrator  |      30 |            30 |           0 |           0 |          0 |              0 |              0 |
| decision-log     |      21 |             0 |           0 |           0 |          0 |              0 |              0 |
| db-schema        |      18 |            18 |           0 |           0 |          0 |              0 |              0 |
| workspace-config |      16 |             0 |           0 |           0 |          0 |              0 |              0 |
| scanner          |      15 |            15 |           0 |           0 |          0 |              0 |              0 |
| knowledge-engine |       8 |             8 |           0 |           0 |          0 |              0 |              0 |
| generated-client |       6 |             0 |           6 |           0 |          0 |              0 |              0 |
| contract-spec    |       3 |             0 |           0 |           0 |          0 |              3 |              0 |
| docs             |       2 |             0 |           0 |           0 |          0 |              0 |              2 |

Interpretation: the codebase is dominated by **three realities at once** — executable code, generated code, and archived evidence. That means the main challenge is not “write everything from zero”; it is **separating active truth from historical evidence and keeping generated layers in sync**.

## 3) The true source-of-truth stack

### A. Contract truth

The only source-of-truth contract is `lib/api-spec/openapi.yaml`. It defines **48 paths**, **59 operations**, and **63 schemas**. The root `package.json` enforces codegen and drift checking from that spec. This is the backbone of the whole system.

The generated layers (`lib/api-zod/src/generated/*` and `lib/api-client-react/src/generated/*`) are not independent business logic. They are contract derivatives. That means any endpoint or shape change must be judged first as a contract change, not as a UI or route change.

### B. Data truth

The DB layer is not a handful of tables. It is the actual platform state model:

- `projects` — ownership, status, rootPath, quality score
- `discovery_sessions` — autonomous onboarding lifecycle and source resolution
- `scan_jobs` — asynchronous scanning and job result/failure tracking
- `tasks` — execution work items, retries, verification state, correlation tracing
- `workflows` and `workflow_executions` — orchestration state machine
- `graph_entities` and `graph_relationships` — extracted knowledge graph
- `metrics` — quality snapshot per project scan
- `events` — operational event stream
- `audit_logs` — immutable-ish change history
- `task_logs` — task execution trace
- `plugins` — extensibility surface
- `ai_chat_sessions` and `ai_chat_messages` — conversational ops memory

The important inference: the platform is built around **traceability of operations**, not only CRUD records.

### C. Execution truth

`artifacts/api-server` is the runtime spine. It contains:
- auth middleware,
- project access middleware,
- discovery source adapters,
- bounded job queue,
- startup reconciliation,
- scan runner,
- route handlers,
- audit logging,
- plugin runtime dispatch.

The server is deliberately structured so heavy work leaves the request thread, and any orphaned in-progress jobs are cleaned up on startup.

## 4) What the execution layer proves

### Discovery is no longer a simple form
`artifacts/api-server/src/lib/discovery-adapters.ts` shows a source-adapter architecture. `LOCAL_FOLDER` and `GIT_REPOSITORY` are enabled. `WORKSPACE_PROJECT` is a stub, and `ARCHIVE_UPLOAD`, `REMOTE_FILESYSTEM`, `DOCKER_VOLUME` are still future/unsupported paths. That means discovery is already **multi-source by design**, but not fully universal in implementation.

### Scan is atomic
`artifacts/api-server/src/lib/scan-runner.ts` makes the scan into a proper unit of work:
- status moves from queued → running → completed/failed,
- file walk, rule matching, graph extraction, metrics, and project status restoration happen in one transactional block,
- audit and plugin hooks are outside the transaction by design so they do not destroy a completed scan.

This is a major maturity signal: the system now treats scan as a **transactional domain operation**, not just a script.

### Ownership is enforced, but unevenly
`artifacts/api-server/src/middlewares/requireProjectAccess.ts` and helper use across routes show a strong single-owner model. Project-scoped routes check the owner before data exposure. Some routes read projectId from params, others from query/body, so the implementation uses both middleware and explicit helper calls.

The key point: **project isolation is a real invariant**, not just a UI convention.

### Background work is bounded
`artifacts/api-server/src/lib/job-queue.ts` caps heavy jobs at concurrency 2, preventing uncontrolled scan/discovery bursts from starving the process. `job-reconciliation.ts` makes startup deterministic after crashes by marking orphaned jobs failed and restoring project state. That is a real operational design, not a placeholder.

## 5) What the scanner and knowledge layer really do

The scanner is more than file discovery:
- `file-walker` enumerates project content,
- `rule-matcher` detects policy hits,
- `graph-extractor` creates entities and relationships,
- `metrics` converts scan facts into a quality score.

The knowledge engine then turns extracted graph data into:
- impact traversal,
- shortest path analysis,
- clustering,
- graph summaries,
- derived ranking signals.

The deeper architectural conclusion: the project is trying to transform repositories into a **navigable semantic graph** with operational consequences, not just search results.

## 6) What the AI layer actually is

`lib/ai-orchestrator` is not a chat toy. It is a controlled inference layer with:
- prompt builders,
- Zod schemas,
- parsing resilience,
- fallback decisions,
- workflow decision validation,
- specific agents for chat, scan analysis, code review, task execution, and workflow orchestration.

The key safety design is that model output is **never trusted directly**:
- parse → schema validate → fallback if invalid,
- workflow proposals are validated against actual phase state before any transition is executed.

This is the difference between “LLM-assisted” and “LLM-governed”.

## 7) The UI is already operational, not decorative

The dashboard exposes:
- Projects
- Project detail / telemetry
- Tasks
- Rules
- Workflows
- Events
- Metrics
- Graph
- AI chat
- Discover Project wizard

The strongest signal is that the Projects page has already been reworked around **Discover Project** instead of a simple registration form. That matches the architectural direction: autonomous onboarding, then scan, then stateful operational review.

## 8) The file families that matter most

### Highest-trust source files
- `lib/api-spec/openapi.yaml`
- `lib/db/src/schema/*`
- `lib/scanner/src/*`
- `lib/knowledge-engine/src/*`
- `lib/ai-orchestrator/src/*`
- `artifacts/api-server/src/*`
- `artifacts/dashboard/src/pages/*`

### Evidence / decision layers
- `.agents/memory/*`
- `docs/fact-record.md`
- `docs/completion-plan.md`
- `attached_assets/*`

The evidence layer is not noise. It explains why specific architecture decisions were made and how older assumptions were superseded.

## 9) The deepest gaps still visible

1. **Discovery completeness is not total**  
   Some source types remain stubs or future-only. Multi-source onboarding is architecturally real, but not universal in execution.

2. **Generated-code dependency is strong**  
   Contract drift is a real risk because a large surface is generated. The codebase already mitigates this with drift checks, but the project will stay fragile if spec changes are made casually.

3. **Evidence freshness matters**  
   Several attached analysis docs are historical proof, not current truth. The practical rule is: treat `docs/fact-record.md` and the actual code as higher authority than older attached reports.

4. **The system’s depth is uneven**  
   Some parts are fully operational, others are intentionally staged. The project is mature in core execution, but not yet fully complete across every surface.

## 10) The correct completion sequence

The safe order is still inside-out:

1. finish data invariants and any remaining ownership gaps,
2. harden execution paths,
3. deepen scanner and graph extraction,
4. make knowledge queries stronger,
5. tighten AI orchestration,
6. unify audit/events/task logs/metrics correlation,
7. expand regression tests,
8. then let the UI reflect the finished truth,
9. finish documentation last.

## 11) Final judgment

EngineeringOS is already a **governed engineering platform** with real operational depth. Its hardest problem is not “building something visible”; it is **closing the remaining asymmetries** between:
- contract and runtime,
- runtime and evidence,
- generated code and handwritten source,
- onboarding intent and fully supported source types.

In other words: the project is structurally real. The remaining work is about making every layer obey the same truth model.

## 12) High-value focus files for the next pass

- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/db/src/schema/index.ts`
- `lib/db/src/schema/projects.ts`
- `lib/db/src/schema/discovery.ts`
- `lib/db/src/schema/tasks.ts`
- `lib/db/src/schema/workflows.ts`
- `lib/db/src/schema/graph.ts`
- `lib/db/src/schema/metrics.ts`
- `lib/scanner/src/graph-extractor.ts`
- `lib/scanner/src/python-extractor.ts`
- `lib/knowledge-engine/src/queries.ts`
- `lib/knowledge-engine/src/inference.ts`
- `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts`
- `lib/ai-orchestrator/src/parsing.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/lib/discovery-adapters.ts`
- `artifacts/api-server/src/lib/job-queue.ts`
- `artifacts/api-server/src/lib/job-reconciliation.ts`
- `artifacts/api-server/src/lib/scan-runner.ts`
- `artifacts/api-server/src/middlewares/requireProjectAccess.ts`
- `artifacts/api-server/src/routes/discovery.ts`
- `artifacts/api-server/src/routes/projects.ts`
- `artifacts/api-server/src/routes/tasks.ts`
- `artifacts/api-server/src/routes/workflows.ts`
- `artifacts/api-server/src/routes/graph.ts`
- `artifacts/api-server/src/routes/ai.ts`
- `artifacts/dashboard/src/pages/Projects.tsx`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx`
- `artifacts/dashboard/src/pages/ProjectDetail.tsx`
- `artifacts/dashboard/src/pages/AiChat.tsx`


# EngineeringOS — Truth Register + Critical PR Roadmap

## Executive snapshot
- Total files: **562**
- Implemented: **210**
- Generated: **123**
- Archived evidence: **118**
- Prototype: **69**
- Decision log: **21**
- Workspace config: **16**
- Source of truth: **3**
- Control docs: **2**

## Critical-path rule
Work inside-out in this order: contract/spec → data integrity → backend execution → scanner/graph → knowledge layer → AI orchestration → traceability → UI → handoff.

## PR roadmap ordered by the true critical path
### PR-0 — Lock architectural truth and stop contract drift
Goal: Make the contract/spec/doc truth chain self-consistent and enforce codegen drift checks.
Files:
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/api-spec/package.json`
- `docs/fact-record.md`
- `docs/completion-plan.md`
- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
Validation: typecheck, targeted tests, and a drift check against the spec or parent layer.
Rollback: revert only this PR’s layer; do not mix with a higher layer.

### PR-1 — Finish data integrity and project-scoping at the backend boundary
Goal: Make every project-scoped read/write enforce ownership and constraints before any higher-level flow expands.
Files:
- `lib/db/src/schema/projects.ts`
- `lib/db/src/schema/tasks.ts`
- `lib/db/src/schema/workflows.ts`
- `lib/db/src/schema/events.ts`
- `lib/db/src/schema/scan_jobs.ts`
- `artifacts/api-server/src/middlewares/requireProjectAccess.ts`
- `artifacts/api-server/src/routes/projects.ts`
- `artifacts/api-server/src/routes/tasks.ts`
- `artifacts/api-server/src/routes/workflows.ts`
- `artifacts/api-server/src/routes/rules.ts`
- `artifacts/api-server/src/routes/events.ts`
- `artifacts/api-server/src/routes/metrics.ts`
- `artifacts/api-server/src/routes/graph.ts`
- `artifacts/api-server/src/routes/ai.ts`
Validation: typecheck, targeted tests, and a drift check against the spec or parent layer.
Rollback: revert only this PR’s layer; do not mix with a higher layer.

### PR-2 — Harden execution spine: discovery, queueing, scan runner, reconciliation
Goal: Ensure the backend can ingest, enqueue, reconcile, and replay project execution without manual repair.
Files:
- `artifacts/api-server/src/lib/discovery-adapters.ts`
- `artifacts/api-server/src/lib/job-queue.ts`
- `artifacts/api-server/src/lib/job-reconciliation.ts`
- `artifacts/api-server/src/lib/scan-runner.ts`
- `artifacts/api-server/src/lib/plugin-runtime.ts`
- `artifacts/api-server/src/routes/discovery.ts`
- `artifacts/api-server/src/routes/plugins.ts`
Validation: typecheck, targeted tests, and a drift check against the spec or parent layer.
Rollback: revert only this PR’s layer; do not mix with a higher layer.

### PR-3 — Deepen scanner fidelity and graph extraction
Goal: Turn the scanner into a robust fact extractor with predictable edge-case handling and regression tests.
Files:
- `lib/scanner/src/file-walker.ts`
- `lib/scanner/src/rule-matcher.ts`
- `lib/scanner/src/graph-extractor.ts`
- `lib/scanner/src/python-extractor.ts`
- `lib/scanner/src/metrics-calc.ts`
- `lib/scanner/src/python-ast-script.ts`
- `lib/scanner/src/python-ast-script.py`
- `lib/scanner/src/__tests__/file-walker.test.ts`
- `lib/scanner/src/__tests__/rule-matcher.test.ts`
- `lib/scanner/src/__tests__/graph-extractor.test.ts`
- `lib/scanner/src/__tests__/metrics-calc.test.ts`
Validation: typecheck, targeted tests, and a drift check against the spec or parent layer.
Rollback: revert only this PR’s layer; do not mix with a higher layer.

### PR-4 — Promote graph to a real knowledge layer
Goal: Make graph-derived answers stable, queryable, and semantically consistent with the extractor output.
Files:
- `lib/knowledge-engine/src/inference.ts`
- `lib/knowledge-engine/src/queries.ts`
- `lib/knowledge-engine/src/types.ts`
- `lib/knowledge-engine/src/index.ts`
- `lib/knowledge-engine/src/__tests__/inference.test.ts`
- `lib/knowledge-engine/src/__tests__/queries.test.ts`
- `lib/db/src/schema/graph.ts`
Validation: typecheck, targeted tests, and a drift check against the spec or parent layer.
Rollback: revert only this PR’s layer; do not mix with a higher layer.

### PR-5 — Harden AI orchestration and parsing resilience
Goal: Make AI behavior schema-locked, parse-safe, and recoverable under malformed or partial model output.
Files:
- `lib/ai-orchestrator/src/groq-client.ts`
- `lib/ai-orchestrator/src/parsing.ts`
- `lib/ai-orchestrator/src/context-builder.ts`
- `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts`
- `lib/ai-orchestrator/src/agents/chat-agent.ts`
- `lib/ai-orchestrator/src/agents/task-agent.ts`
- `lib/ai-orchestrator/src/agents/scan-analyst.ts`
- `lib/ai-orchestrator/src/agents/code-reviewer.ts`
- `lib/ai-orchestrator/src/prompts/*.ts`
- `lib/ai-orchestrator/src/schemas/*.ts`
- `lib/ai-orchestrator/src/__tests__/groq-client.test.ts`
- `lib/ai-orchestrator/src/__tests__/parsing.test.ts`
- `lib/ai-orchestrator/src/__tests__/schemas.test.ts`
- `lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts`
Validation: typecheck, targeted tests, and a drift check against the spec or parent layer.
Rollback: revert only this PR’s layer; do not mix with a higher layer.

### PR-6 — Unify audit, events, metrics, and task logs into one trace model
Goal: Create one traceable operational story across execution, state changes, and audit.
Files:
- `lib/db/src/schema/audit_logs.ts`
- `lib/db/src/schema/events.ts`
- `lib/db/src/schema/metrics.ts`
- `lib/db/src/schema/task_logs.ts`
- `artifacts/api-server/src/lib/audit.ts`
- `artifacts/api-server/src/routes/events.ts`
- `artifacts/api-server/src/routes/metrics.ts`
- `artifacts/api-server/src/routes/tasks.ts`
Validation: typecheck, targeted tests, and a drift check against the spec or parent layer.
Rollback: revert only this PR’s layer; do not mix with a higher layer.

### PR-7 — Bring dashboard in line with backend truth
Goal: Expose the real backend state and prevent the UI from drifting into a simplified or stale model.
Files:
- `artifacts/dashboard/src/App.tsx`
- `artifacts/dashboard/src/components/layout/Shell.tsx`
- `artifacts/dashboard/src/components/layout/Sidebar.tsx`
- `artifacts/dashboard/src/pages/*`
- `lib/api-client-react/src/generated/*`
- `lib/api-zod/src/generated/*`
- `artifacts/mockup-sandbox/src/*`
Validation: typecheck, targeted tests, and a drift check against the spec or parent layer.
Rollback: revert only this PR’s layer; do not mix with a higher layer.

## Full register
The full file-by-file register is provided in the CSV artifact linked below.

## Highest-priority files (P0)
| path | role | status | next action |
|---|---|---:|---|
| `lib/ai-orchestrator/src/__tests__/groq-client.test.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/__tests__/parsing.test.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/__tests__/schemas.test.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/agents/chat-agent.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/agents/code-reviewer.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/agents/scan-analyst.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/agents/task-agent.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/context-builder.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/errors.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/groq-client.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/index.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/parsing.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/prompts/chat.prompt.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/prompts/index.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/prompts/review.prompt.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/prompts/scan.prompt.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/prompts/task.prompt.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/prompts/workflow.prompt.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/schemas/chat.schema.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/schemas/code-review.schema.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/schemas/context.schema.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/schemas/index.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/schemas/scan.schema.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/schemas/task.schema.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `lib/ai-orchestrator/src/schemas/workflow.schema.ts` | AI orchestration / prompt contracts | implemented | Harden prompts, schemas, parsing, and workflow fallbacks |
| `artifacts/api-server/src/lib/audit.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/discovery-adapters.test.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/discovery-adapters.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/job-queue.test.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/job-queue.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/job-reconciliation.test.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/job-reconciliation.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/logger.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/plugin-runtime.test.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/plugin-runtime.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/lib/scan-runner.ts` | server runtime / domain services | implemented | Stress queue, adapter, and reconciliation behavior |
| `artifacts/api-server/src/middlewares/.gitkeep` | API middleware / access control | implemented | Validate auth/project-scoping across every entrypoint |
| `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` | API middleware / access control | implemented | Validate auth/project-scoping across every entrypoint |
| `artifacts/api-server/src/middlewares/requireAuth.test.ts` | API middleware / access control | implemented | Validate auth/project-scoping across every entrypoint |
| `artifacts/api-server/src/middlewares/requireAuth.ts` | API middleware / access control | implemented | Validate auth/project-scoping across every entrypoint |
| `artifacts/api-server/src/middlewares/requireProjectAccess.ts` | API middleware / access control | implemented | Validate auth/project-scoping across every entrypoint |
| `artifacts/api-server/src/routes/ai.test.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/ai.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/dashboard.test.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/dashboard.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/discovery.test.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/discovery.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/events.test.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/events.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/graph.test.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/graph.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/health.test.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/health.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/index.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/metrics.test.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/metrics.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/plugins.test.ts` | API route implementation | implemented | Run route-level access-control and integration tests |
| `artifacts/api-server/src/routes/plugins.ts` | API route implementation | implemented | Run route-level access-control and integration tests |

## Notes on interpretation
- `implemented` means code exists, not that the whole flow is production-locked.
- `generated` means the file is derived and must stay synchronized with `openapi.yaml`.
- `archived-evidence` and `decision-log` are provenance, not execution truth.
- `prototype` means useful for understanding direction, not for promotion without a hardening PR.
- `source-of-truth` and `control-doc` must remain synchronized with reality or they become misleading.

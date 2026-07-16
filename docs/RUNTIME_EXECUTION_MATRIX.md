# EngineeringOS — Runtime Execution Matrix

> آخر تحديث: 2026-07-15. مرتبط بـ PR 02 (Execution Alignment Inventory).

| Feature | UI | API | DB | Events | Audit | Tests | Status | Evidence |
|---|---|---|---|---|---|---|---|---|
| Projects | Projects / ProjectDetail | projects.ts | projectsTable, scanJobsTable, eventsTable, metricsTable | scan + lifecycle events | recordAudit | projects.test.ts | **Aligned** | routes/projects.ts, lib/db/src/schema/projects.ts, artifacts/dashboard/src/pages/Projects.tsx |
| Discovery | DiscoverProjectWizard | discovery.ts | discoverySessionsTable, projectsTable, scanJobsTable | discovery session events | recordAudit | discovery.test.ts | **Aligned** | routes/discovery.ts, lib/db/src/schema/discovery.ts, dashboard/pages/DiscoverProjectWizard.tsx |
| Tasks | Tasks | tasks.ts | tasksTable, taskLogsTable, eventsTable | task lifecycle events | recordAudit | tasks.test.ts | **Aligned** | routes/tasks.ts, lib/db/src/schema/tasks.ts, lib/db/src/schema/task_logs.ts |
| Rules | Rules | rules.ts | rulesTable, eventsTable | rule evaluation events | recordAudit | rules.test.ts | **Aligned** | routes/rules.ts, lib/db/src/schema/rules.ts, dashboard/pages/Rules.tsx |
| Workflows | Workflows | workflows.ts | workflowsTable, workflowExecutionsTable, eventsTable | workflow lifecycle events | recordAudit | workflows.test.ts | **Aligned** | routes/workflows.ts, lib/db/src/schema/workflows.ts |
| Events | Events | events.ts | eventsTable | central event stream | read-only | events.test.ts | **Aligned** | routes/events.ts, lib/db/src/schema/events.ts, dashboard/pages/Events.tsx |
| Metrics | Metrics | metrics.ts | metricsTable | time-series metrics | read-only | metrics.test.ts | **Aligned** | routes/metrics.ts, lib/db/src/schema/metrics.ts, dashboard/pages/Metrics.tsx |
| Graph | Graph | graph.ts | graphEntitiesTable, graphRelationshipsTable | graph-derived summaries | read-only | graph.test.ts | **Aligned** | routes/graph.ts, lib/db/src/schema/graph.ts, dashboard/pages/Graph.tsx, lib/knowledge-engine/src/* |
| Plugins | Plugins | plugins.ts | pluginsTable | enable/disable audit | recordAudit | plugins.test.ts | **Aligned** | routes/plugins.ts, lib/db/src/schema/plugins.ts, dashboard/pages/Plugins surface |
| AI | AiChat | ai.ts | aiChatSessionsTable, aiChatMessagesTable, aiProviderCredentialsTable, tasksTable, workflowsTable, workflowExecutionsTable, eventsTable, taskLogsTable | chat/review/task/workflow events | recordAudit | ai.test.ts | **Aligned** | routes/ai.ts, lib/db/src/schema/ai_chats.ts, lib/db/src/schema/ai_provider_credentials.ts, dashboard/pages/AiChat.tsx |
| Security | SignIn / SignUp / Shell | app.ts + middleware | all tables scoped by ownerId | auth + request logs | audit on mutations | requireAuth.test.ts + route tests | **Aligned** | artifacts/api-server/src/app.ts, artifacts/api-server/src/middlewares/*.ts, artifacts/dashboard/src/pages/SignIn.tsx |
| Governance | Docs / scripts | truth:validate, codegen:check | n/a | n/a | n/a | scripts/* | **Aligned** | docs/fact-record.md, docs/completion-plan.md, scripts/validate-truth-flow.ts, scripts/check-codegen-drift.ts |

## Chain gaps to watch
- No OpenAPI route gaps were found in this archive scan.
- The main unresolved runtime risk is durability of async work (in-process job queue), not endpoint coverage.
- The main UX risk is placeholder/example copy in a few forms and fallbacks — tracked in `docs/PLACEHOLDER_REGISTER.md`.

## Tables discovered
aiChatMessagesTable, aiChatSessionsTable, aiProviderCredentialsTable, auditLogsTable, discoverySessionsTable, eventsTable, graphEntitiesTable, graphRelationshipsTable, metricsTable, pluginsTable, projectsTable, rulesTable, scanJobsTable, taskLogsTable, tasksTable, workflowExecutionsTable, workflowsTable

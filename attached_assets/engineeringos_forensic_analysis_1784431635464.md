# EngineeringOS — Forensic Engineering Analysis

Generated from static inspection of the uploaded project archive on 2026-07-19.
Code was treated as the source of truth; documents and assets were used only as supporting evidence or drift checks.

## 1. Executive Summary

EngineeringOS is a monorepo that already contains the full skeleton of an AI-assisted engineering platform: a contract-first API, a persistence layer, a scanner that extracts structure from repositories, a knowledge-engine for graph queries and inference, an AI orchestration layer with prompts/tools/parsers, an Express API server, and a React dashboard.
The core system is not a prototype shell. The code shows real end-to-end flows for discovery, scan jobs, graph extraction, metrics, tasks, rules, workflows, events, Git operations, and AI chat/apply flows.
The main completeness gaps are concentrated in breadth and hardening rather than basic existence: several discovery adapters are still marked coming-soon, some dashboard and UI subcomponents still carry placeholder text, generated contract surfaces are large and must stay in sync, and the AI layer still depends on bounded retries, prompt discipline, and cache invalidation to avoid stale or misleading outputs.
I did not execute the test suite in this pass; the assessment below is based on direct code and document inspection.

## 2. System Architecture

Inventory size: 703 files total; 276 code files, 32 test files, 174 text/markdown docs, 148 generated code/data files, and 183 historical assets.

### Top-level package map

| Area | Role in the system | Evidence from code |
|---|---|---|
| `lib/api-spec` | OpenAPI source contract and Orval generator entrypoint | `openapi.yaml`, `orval.config.ts`
| `lib/api-zod` | Generated runtime schemas for client/server contract enforcement | `src/generated/*`, `truth-flow-matrix.schema.ts`
| `lib/api-client-react` | Generated React Query client surface | `src/generated/api.ts`, `src/custom-fetch.ts`
| `lib/db` | Drizzle schema and database entrypoint | `src/index.ts`, `src/schema/*`
| `lib/scanner` | Repository walker, rule matcher, graph extractor, metrics calculator | `file-walker.ts`, `graph-extractor.ts`, `metrics-calc.ts`, `python-extractor.ts`
| `lib/knowledge-engine` | Pure query/inference layer on top of graph tables | `queries.ts`, `inference.ts`, `types.ts`
| `lib/ai-orchestrator` | LLM gateway, context builder, prompt builders, parsers, agents, file/git tools | `groq-client.ts`, `context-builder.ts`, `agents/*`, `tools/*`, `schemas/*`
| `artifacts/api-server` | Express runtime, auth, routes, job queue, scan runner, plugin runtime | `src/app.ts`, `src/routes/*`, `src/lib/*`, `src/middlewares/*`
| `artifacts/dashboard` | React dashboard for projects, discovery, tasks, rules, workflows, graph, metrics, events, AI | `src/pages/*`, `src/components/*`
| `artifacts/mockup-sandbox` | UI sandbox / component preview environment | `src/App.tsx`, generated mockup components
| `scripts` | Governance and drift checks | `check-codegen-drift.ts`, `validate-truth-flow.ts`, `trigger-scan.mts`

### Import graph summary

- `artifacts/api-server` → `db` (32 import sites)
- `artifacts/dashboard` → `api-client-react` (11 import sites)
- `artifacts/api-server` → `api-zod` (9 import sites)
- `artifacts/api-server` → `scanner` (6 import sites)
- `artifacts/api-server` → `ai-orchestrator` (4 import sites)
- `lib/knowledge-engine` → `db` (3 import sites)
- `lib/ai-orchestrator` → `db` (2 import sites)
- `artifacts/api-server` → `api-client-react` (1 import sites)
- `artifacts/api-server` → `knowledge-engine` (1 import sites)
- `scripts/trigger-scan.mts` → `db` (1 import sites)
- `scripts/trigger-scan.mts` → `scanner` (1 import sites)
- `scripts/validate-truth-flow.ts` → `api-zod` (1 import sites)

## 3. Layer-by-Layer Analysis

### Contract layer
OpenAPI is the primary API contract. The spec contains 54 paths and 77 route/method operations across projects, discovery, tasks, rules, workflows, events, metrics, graph, plugins, AI, Git, dashboard, and health endpoints. The generated `lib/api-zod` and `lib/api-client-react` surfaces are present and wired into runtime code, so the contract is not only documented; it is consumed.

### Persistence layer
The database layer defines concrete tables for projects, rules, workflows, tasks, events, metrics, graph entities/relationships, task logs, plugins, audit logs, discovery sessions, scan jobs, AI chat sessions/messages, and provider credentials. `lib/db/src/index.ts` wires Drizzle against `DATABASE_URL` and exports the schema wholesale.

### Scanner layer
The scanner is the structural analysis engine. `file-walker.ts` enforces file caps and ignores build artifacts; `rule-matcher.ts` matches rule patterns; `graph-extractor.ts` builds typed entities, relationships, and provenance; `metrics-calc.ts` computes score dimensions; `python-extractor.ts` uses an embedded Python AST script to avoid regex-only parsing for Python.

### Knowledge layer
The knowledge-engine is pure and read-only. It contains traversal queries, semantic-neighborhood queries, provenance annotation, shortest-path and impact queries, layered graph views, and in-memory inference for centrality, cluster detection, and layered summaries.

### AI orchestration layer
The AI layer is the most structurally complete custom subsystem. It has a Groq gateway with retry and circuit-breaker logic, a cached context builder, JSON parsing/validation, prompt builders for chat/review/scan/task/workflow, specialized agents, and file/git tool wrappers. The code strongly enforces that the model proposes structure and the code validates or executes it.

### API/runtime layer
The Express server provides auth, ownership scoping, project CRUD, scan job orchestration, discovery/import, tasks, rules, workflows, events, metrics, graph queries, Git integration, plugins, and AI endpoints. The runtime is not a thin proxy; it coordinates background jobs, audit logs, events, and cache invalidation.

### Presentation layer
The dashboard is a complete shell with routing, Clerk auth, a sidebar/shell layout, project pages, discovery wizard, AI chat, graph, metrics, rules, tasks, workflows, events, project details, and a Git panel. It is functional, but several components still show placeholder logic/text and rely on generated clients for correctness.

## 4. File-by-File Analysis

The following appendix inventories every file in the archive. Binary assets are listed by path and type; historical assets were not semantically opened one by one in the report text, but they are included in the inventory so nothing is omitted.

### .agents/
#### agent_assets_metadata.toml/
- `.agents/agent_assets_metadata.toml` — other — TOML config
#### memory/
- `.agents/memory/MEMORY.md` — memory-doc — - [Autonomous Project Discovery](discovery-feature.md) — correctness rules for d
- `.agents/memory/ai-orchestrator-gap-closure.md` — memory-doc — Gaps verified as already correct (false positives in executive table)
- `.agents/memory/ai-orchestrator-hardening.md` — memory-doc — ---
- `.agents/memory/ai-orchestrator-layer.md` — memory-doc — AI Orchestration Layer
- `.agents/memory/ai-tool-calling.md` — memory-doc — Architecture
- `.agents/memory/audit-fixes.md` — memory-doc — ---
- `.agents/memory/clerk-401-race-cookie-vs-bearer.md` — memory-doc — ---
- `.agents/memory/clerk-auth-testing.md` — memory-doc — ---
- `.agents/memory/completion-plan-stale-backlog.md` — memory-doc — ---
- `.agents/memory/context-cache-invalidation-rule.md` — memory-doc — Context cache invalidation rule
- `.agents/memory/dashboard-scoping-pr01.md` — memory-doc — Dashboard scoping — PR-01
- `.agents/memory/discovery-adapter-registry.md` — memory-doc — ---
- `.agents/memory/discovery-feature.md` — memory-doc — Rule: rootPath must be validated before discovery starts
- `.agents/memory/discovery-multi-source.md` — memory-doc — Rule
- `.agents/memory/drizzle-error-wrapping.md` — memory-doc — ---
- `.agents/memory/engineeringos-completion-plan.md` — memory-doc — ---
- `.agents/memory/fk-atomic-claim-ordering.md` — memory-doc — ---
- `.agents/memory/gap-analysis-fixes-batch1.md` — memory-doc — G-01 — Task priority query (context-builder.ts)
- `.agents/memory/gap-analysis-fixes-batch2.md` — memory-doc — G-11 — Context cache (context-builder.ts)
- `.agents/memory/git-ai-orchestrator-fixes.md` — memory-doc — Fixed bugs (from uploaded analysis doc)
- `.agents/memory/imported-project-clerk-secrets.md` — memory-doc — ---
- `.agents/memory/imported-project-workflow-failures.md` — memory-doc — ---
- `.agents/memory/knowledge-engine-bfs-depth.md` — memory-doc — ---
- `.agents/memory/knowledge-engine.md` — memory-doc — Knowledge Engine Package
- `.agents/memory/orval-openapi-codegen.md` — memory-doc — ---
- `.agents/memory/pr02-provenance-layer.md` — memory-doc — Rule
- `.agents/memory/pr04-discovery-hardening.md` — memory-doc — Discovery resolution hardening
- `.agents/memory/project-bootstrap.md` — memory-doc — Post-import bootstrap (EngineeringOS)
- `.agents/memory/project-ownership-scoping.md` — memory-doc — Project Ownership / Access-Scope Model
- `.agents/memory/scanner-ast-extraction.md` — memory-doc — ---
- `.agents/memory/testing-drift-checks.md` — memory-doc — ---
- `.agents/memory/trace-analysis.md` — memory-doc — What was done

### .gitattributes/
- `.gitattributes` — other — [no ext]

### .gitignore/
- `.gitignore` — other — [no ext]

### .npmrc/
- `.npmrc` — other — [no ext]

### .replit/
- `.replit` — other — [no ext]

### .replitignore/
- `.replitignore` — other — [no ext]

### artifacts/
#### api-server/
- `artifacts/api-server/.replit-artifact/artifact.toml` — source — TOML config
- `artifacts/api-server/build.mjs` — source — .mjs
- `artifacts/api-server/package.json` — source — package @workspace/api-server; scripts: dev, build, start, typecheck
- `artifacts/api-server/src/app.ts` — source — source module; exports: 
- `artifacts/api-server/src/config.ts` — source — source module; exports: loadConfig, getPort
- `artifacts/api-server/src/index.ts` — source — source module; exports: 
- `artifacts/api-server/src/lib/.gitkeep` — other — [no ext]
- `artifacts/api-server/src/lib/audit.ts` — source — server library; exports: recordAudit
- `artifacts/api-server/src/lib/credentials-crypto.ts` — source — server library; exports: getEncryptionKey, encryptApiKey, decryptApiKey
- `artifacts/api-server/src/lib/discovery-adapters.test.ts` — test — test file; approx test blocks: 50; exports: 
- `artifacts/api-server/src/lib/discovery-adapters.ts` — source — server library; exports: redactUrlCredentials, isResolveError, resolveSource, cleanupResolveResult
- `artifacts/api-server/src/lib/graph-provenance.ts` — source — server library; exports: provenanceFromEntity, provenanceFromRelationship, manualProvenance
- `artifacts/api-server/src/lib/job-queue.test.ts` — test — test file; approx test blocks: 5; exports: delay, waitUntilIdle
- `artifacts/api-server/src/lib/job-queue.ts` — source — server library; exports: JobQueue
- `artifacts/api-server/src/lib/job-reconciliation.test.ts` — test — test file; approx test blocks: 7; exports: insertProject
- `artifacts/api-server/src/lib/job-reconciliation.ts` — source — server library; exports: reconcileScanJobs, reconcileDiscoverySessions, reconcileStuckJobs
- `artifacts/api-server/src/lib/logger.ts` — source — server library; exports: 
- `artifacts/api-server/src/lib/path-validation.test.ts` — test — test file; approx test blocks: 28; exports: 
- `artifacts/api-server/src/lib/path-validation.ts` — source — server library; exports: validateRootPath, verifyProjectRoot
- `artifacts/api-server/src/lib/plugin-runtime.test.ts` — test — test file; approx test blocks: 26; exports: baseCtx, entity
- `artifacts/api-server/src/lib/plugin-runtime.ts` — source — server library; exports: dispatchOnScanComplete
- `artifacts/api-server/src/lib/project-error.test.ts` — test — test file; approx test blocks: 35; exports: mockApiError, networkError
- `artifacts/api-server/src/lib/scan-runner.ts` — source — server library; exports: runScanJob, performScan, addToNameIndex
- `artifacts/api-server/src/lib/startup-migrations.ts` — source — server library; exports: fixDeadRootPaths
- `artifacts/api-server/src/middlewares/.gitkeep` — other — [no ext]
- `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` — source — Express middleware; exports: getClerkProxyHost, clerkProxyMiddleware
- `artifacts/api-server/src/middlewares/requireAuth.test.ts` — test — test file; approx test blocks: 8; exports: fakeReq, fakeRes
- `artifacts/api-server/src/middlewares/requireAuth.ts` — source — Express middleware; exports: requireAuth, optionalAuth, attachAuthContext
- `artifacts/api-server/src/middlewares/requireProjectAccess.ts` — source — Express middleware; exports: requireProjectAccess, requireProjectWriteAccess, loadOwnedProject, loadProjectByIdForUser
- `artifacts/api-server/src/routes/ai.test.ts` — test — test file; approx test blocks: 33; exports: insertProject, insertTask, insertWorkflow
- `artifacts/api-server/src/routes/ai.ts` — source — API route module; endpoints: GET /ai/groq-key; PUT /ai/groq-key; DELETE /ai/groq-key; POST /ai/chat
- `artifacts/api-server/src/routes/dashboard.test.ts` — test — test file; approx test blocks: 19; exports: insertProject, insertTask, insertEvent, insertMetric, insertRule
- `artifacts/api-server/src/routes/dashboard.ts` — source — API route module; endpoints: GET /dashboard
- `artifacts/api-server/src/routes/discovery.test.ts` — test — test file; approx test blocks: 47; exports: fakeResult, insertReadySession, cleanupSessionAndProject
- `artifacts/api-server/src/routes/discovery.ts` — source — API route module; endpoints: GET /discovery/sources; POST /projects/discover; GET /projects/discover/:discoveryId; GET /projects/discover/:discoveryId/summary
- `artifacts/api-server/src/routes/events.test.ts` — test — test file; approx test blocks: 12; exports: insertProject, insertEvent
- `artifacts/api-server/src/routes/events.ts` — source — API route module; endpoints: GET /events
- `artifacts/api-server/src/routes/git.ts` — source — API route module; endpoints: GET /ai/github-token; PUT /ai/github-token; DELETE /ai/github-token; GET /projects/:projectId/git/config
- `artifacts/api-server/src/routes/graph.test.ts` — test — test file; approx test blocks: 47; exports: insertProject, cleanupProject, seedTriangle, seedLayeredEdges, seedLayeredWithProvenance, insertOtherUserProject
- `artifacts/api-server/src/routes/graph.ts` — source — API route module; endpoints: GET /graph/entities; GET /graph/relationships; GET /graph/entities/:entityId/neighbors; GET /graph/impact
- `artifacts/api-server/src/routes/health.test.ts` — test — test file; approx test blocks: 3; exports: 
- `artifacts/api-server/src/routes/health.ts` — source — API route module; endpoints: GET /healthz
- `artifacts/api-server/src/routes/index.ts` — source — API route module
- `artifacts/api-server/src/routes/metrics.test.ts` — test — test file; approx test blocks: 7; exports: insertProject, cleanupProject, insertOtherUserProject
- `artifacts/api-server/src/routes/metrics.ts` — source — API route module; endpoints: GET /metrics; GET /metrics/latest
- `artifacts/api-server/src/routes/plugins.test.ts` — test — test file; approx test blocks: 4; exports: 
- `artifacts/api-server/src/routes/plugins.ts` — source — API route module; endpoints: GET /plugins; POST /plugins/:pluginId/enable; POST /plugins/:pluginId/disable
- `artifacts/api-server/src/routes/projects.test.ts` — test — test file; approx test blocks: 26; exports: makeTempScanDir, removeTempDir, insertProject, cleanupProject, waitForScanJob
- `artifacts/api-server/src/routes/projects.ts` — source — API route module; endpoints: GET /projects; POST /projects; GET /projects/:projectId; PATCH /projects/:projectId
- `artifacts/api-server/src/routes/rules.test.ts` — test — test file; approx test blocks: 26; exports: insertRule, insertProject, cleanup
- `artifacts/api-server/src/routes/rules.ts` — source — API route module; endpoints: GET /rules; POST /rules; GET /rules/:ruleId; PATCH /rules/:ruleId
- `artifacts/api-server/src/routes/tasks.test.ts` — test — test file; approx test blocks: 11; exports: insertProject, cleanupProject, createTask, insertOtherUserProject
- `artifacts/api-server/src/routes/tasks.ts` — source — API route module; endpoints: GET /tasks; POST /tasks; GET /tasks/:taskId; PATCH /tasks/:taskId
- `artifacts/api-server/src/routes/workflows.test.ts` — test — test file; approx test blocks: 5; exports: insertProject, cleanupProject, createStartedWorkflow
- `artifacts/api-server/src/routes/workflows.ts` — source — API route module; endpoints: GET /workflows; POST /workflows; GET /workflows/:workflowId; DELETE /workflows/:workflowId
- `artifacts/api-server/src/scripts/seed-provenance.ts` — source — source module; exports: entityIdFor, main, addEdge
- `artifacts/api-server/src/types/express.d.ts` — source — source module; exports: 
- `artifacts/api-server/tsconfig.json` — source — JSON config/data; keys: extends, compilerOptions, include, references
- `artifacts/api-server/vitest.config.ts` — source — .ts
#### dashboard/
- `artifacts/dashboard/.replit-artifact/artifact.toml` — source — TOML config
- `artifacts/dashboard/components.json` — source — JSON config/data; keys: $schema, style, rsc, tsx, tailwind
- `artifacts/dashboard/index.html` — source — .html
- `artifacts/dashboard/package.json` — source — package @workspace/dashboard; scripts: dev, build, serve, typecheck
- `artifacts/dashboard/public/favicon.svg` — other — image asset (.svg)
- `artifacts/dashboard/public/logo.svg` — other — image asset (.svg)
- `artifacts/dashboard/public/robots.txt` — other — User-agent: *
- `artifacts/dashboard/src/App.tsx` — source — source module; exports: HomeRedirect, ProtectedRoute, AppShell, Router, ClerkQueryClientCacheInvalidator, ClerkProviderWithRoutes
- `artifacts/dashboard/src/components/GitPanel.tsx` — source — UI component; exports: FileBadge, NotAGitRepo
- `artifacts/dashboard/src/components/layout/Shell.tsx` — source — UI component; exports: Shell
- `artifacts/dashboard/src/components/layout/Sidebar.tsx` — source — UI component; exports: operatorInitials, Sidebar
- `artifacts/dashboard/src/components/ui/accordion.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/alert-dialog.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/alert.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/aspect-ratio.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/avatar.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/badge.tsx` — source — UI component; exports: Badge
- `artifacts/dashboard/src/components/ui/breadcrumb.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/button-group.tsx` — source — UI component; exports: ButtonGroup, ButtonGroupText, ButtonGroupSeparator
- `artifacts/dashboard/src/components/ui/button.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/calendar.tsx` — source — UI component; exports: Calendar, CalendarDayButton
- `artifacts/dashboard/src/components/ui/card.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/carousel.tsx` — source — UI component; exports: useCarousel
- `artifacts/dashboard/src/components/ui/chart.tsx` — source — UI component; exports: useChart, getPayloadConfigFromPayload
- `artifacts/dashboard/src/components/ui/checkbox.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/collapsible.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/command.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/context-menu.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/dialog.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/drawer.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/dropdown-menu.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/empty.tsx` — source — UI component; exports: Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent
- `artifacts/dashboard/src/components/ui/field.tsx` — source — UI component; exports: FieldSet, FieldLegend, FieldGroup, Field, FieldContent, FieldLabel
- `artifacts/dashboard/src/components/ui/form.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/hover-card.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/input-group.tsx` — source — UI component; exports: InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea
- `artifacts/dashboard/src/components/ui/input-otp.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/input.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/item.tsx` — source — UI component; exports: ItemGroup, ItemSeparator, Item, ItemMedia, ItemContent, ItemTitle
- `artifacts/dashboard/src/components/ui/kbd.tsx` — source — UI component; exports: Kbd, KbdGroup
- `artifacts/dashboard/src/components/ui/label.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/menubar.tsx` — source — UI component; exports: MenubarMenu, MenubarGroup, MenubarPortal, MenubarRadioGroup, MenubarSub
- `artifacts/dashboard/src/components/ui/navigation-menu.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/pagination.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/popover.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/progress.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/radio-group.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/resizable.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/scroll-area.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/select.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/separator.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/sheet.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/sidebar.tsx` — source — UI component; exports: useSidebar, SidebarProvider, Sidebar, SidebarTrigger, SidebarRail, SidebarInset
- `artifacts/dashboard/src/components/ui/skeleton.tsx` — source — UI component; exports: Skeleton
- `artifacts/dashboard/src/components/ui/slider.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/sonner.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/spinner.tsx` — source — UI component; exports: Spinner
- `artifacts/dashboard/src/components/ui/switch.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/table.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/tabs.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/textarea.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/toast.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/toaster.tsx` — source — UI component; exports: Toaster
- `artifacts/dashboard/src/components/ui/toggle-group.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/toggle.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/components/ui/tooltip.tsx` — source — UI component; exports: 
- `artifacts/dashboard/src/hooks/use-mobile.tsx` — source — source module; exports: useIsMobile
- `artifacts/dashboard/src/hooks/use-toast.ts` — source — source module; exports: genId, dispatch, toast, useToast, reducer
- `artifacts/dashboard/src/index.css` — source — .css
- `artifacts/dashboard/src/lib/clerk.ts` — source — server library; exports: stripBase
- `artifacts/dashboard/src/lib/utils.ts` — source — server library; exports: cn
- `artifacts/dashboard/src/main.tsx` — source — source module; exports: 
- `artifacts/dashboard/src/pages/AiChat.tsx` — source — UI page; exports: describeAiError, parseSources, PendingChangesCard, toggleExpand, MessageBubble, GroqKeyCard
- `artifacts/dashboard/src/pages/Dashboard.tsx` — source — UI page; exports: 
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — source — UI page; exports: fmt, scoreColor, severityBadge, extractApiError, StepIcon, ReportRow
- `artifacts/dashboard/src/pages/Events.tsx` — source — UI page; exports: 
- `artifacts/dashboard/src/pages/Graph.tsx` — source — UI page; exports: runForceLayout, nodeColor, nodeRadius, nodeOpacity, edgeOpacity
- `artifacts/dashboard/src/pages/Landing.tsx` — source — UI page; exports: 
- `artifacts/dashboard/src/pages/Metrics.tsx` — source — UI page; exports: 
- `artifacts/dashboard/src/pages/ProjectDetail.tsx` — source — UI page; exports: 
- `artifacts/dashboard/src/pages/Projects.tsx` — source — UI page; exports: 
- `artifacts/dashboard/src/pages/Rules.tsx` — source — UI page; exports: 
- `artifacts/dashboard/src/pages/SignIn.tsx` — source — UI page; exports: 
- `artifacts/dashboard/src/pages/SignUp.tsx` — source — UI page; exports: 
- `artifacts/dashboard/src/pages/Tasks.tsx` — source — UI page; exports: TaskLogsPanel
- `artifacts/dashboard/src/pages/Workflows.tsx` — source — UI page; exports: CreateWorkflowModal, ExecutionHistory
- `artifacts/dashboard/src/pages/not-found.tsx` — source — UI page; exports: 
- `artifacts/dashboard/tsconfig.json` — source — JSON config/data; keys: extends, include, exclude, compilerOptions, references
- `artifacts/dashboard/vite.config.ts` — source — .ts
#### mockup-sandbox/
- `artifacts/mockup-sandbox/.replit-artifact/artifact.toml` — source — TOML config
- `artifacts/mockup-sandbox/components.json` — source — JSON config/data; keys: $schema, style, rsc, tsx, tailwind
- `artifacts/mockup-sandbox/index.html` — source — .html
- `artifacts/mockup-sandbox/mockupPreviewPlugin.ts` — source — .ts
- `artifacts/mockup-sandbox/package.json` — source — package @workspace/mockup-sandbox; scripts: dev, build, preview, typecheck
- `artifacts/mockup-sandbox/src/.generated/mockup-components.ts` — generated — generated source; exports: 
- `artifacts/mockup-sandbox/src/App.tsx` — source — source module; exports: _resolveComponent, PreviewRenderer, loadComponent, getBasePath, getPreviewExamplePath, Gallery
- `artifacts/mockup-sandbox/src/components/ui/accordion.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/alert.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/avatar.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/badge.tsx` — source — UI component; exports: Badge
- `artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/button-group.tsx` — source — UI component; exports: ButtonGroup, ButtonGroupText, ButtonGroupSeparator
- `artifacts/mockup-sandbox/src/components/ui/button.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/calendar.tsx` — source — UI component; exports: Calendar, CalendarDayButton
- `artifacts/mockup-sandbox/src/components/ui/card.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/carousel.tsx` — source — UI component; exports: useCarousel
- `artifacts/mockup-sandbox/src/components/ui/chart.tsx` — source — UI component; exports: useChart, getPayloadConfigFromPayload
- `artifacts/mockup-sandbox/src/components/ui/checkbox.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/collapsible.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/command.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/context-menu.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/dialog.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/drawer.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/empty.tsx` — source — UI component; exports: Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent
- `artifacts/mockup-sandbox/src/components/ui/field.tsx` — source — UI component; exports: FieldSet, FieldLegend, FieldGroup, Field, FieldContent, FieldLabel
- `artifacts/mockup-sandbox/src/components/ui/form.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/hover-card.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/input-group.tsx` — source — UI component; exports: InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea
- `artifacts/mockup-sandbox/src/components/ui/input-otp.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/input.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/item.tsx` — source — UI component; exports: ItemGroup, ItemSeparator, Item, ItemMedia, ItemContent, ItemTitle
- `artifacts/mockup-sandbox/src/components/ui/kbd.tsx` — source — UI component; exports: Kbd, KbdGroup
- `artifacts/mockup-sandbox/src/components/ui/label.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/menubar.tsx` — source — UI component; exports: MenubarMenu, MenubarGroup, MenubarPortal, MenubarRadioGroup, MenubarSub
- `artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/pagination.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/popover.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/progress.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/radio-group.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/resizable.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/select.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/separator.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/sheet.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/sidebar.tsx` — source — UI component; exports: useSidebar, SidebarProvider, Sidebar, SidebarTrigger, SidebarRail, SidebarInset
- `artifacts/mockup-sandbox/src/components/ui/skeleton.tsx` — source — UI component; exports: Skeleton
- `artifacts/mockup-sandbox/src/components/ui/slider.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/sonner.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/spinner.tsx` — source — UI component; exports: Spinner
- `artifacts/mockup-sandbox/src/components/ui/switch.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/table.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/tabs.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/textarea.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/toast.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/toaster.tsx` — source — UI component; exports: Toaster
- `artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/toggle.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/components/ui/tooltip.tsx` — source — UI component; exports: 
- `artifacts/mockup-sandbox/src/hooks/use-mobile.tsx` — source — source module; exports: useIsMobile
- `artifacts/mockup-sandbox/src/hooks/use-toast.ts` — source — source module; exports: genId, dispatch, toast, useToast, reducer
- `artifacts/mockup-sandbox/src/index.css` — source — .css
- `artifacts/mockup-sandbox/src/lib/utils.ts` — source — server library; exports: cn
- `artifacts/mockup-sandbox/src/main.tsx` — source — source module; exports: 
- `artifacts/mockup-sandbox/tsconfig.json` — source — JSON config/data; keys: extends, include, exclude, compilerOptions
- `artifacts/mockup-sandbox/vite.config.ts` — source — .ts

### attached_assets/
#### ENGINEERINGOS_EXECUTION_ALIGNMENT_REPORT_1784147505317.md/
- `attached_assets/ENGINEERINGOS_EXECUTION_ALIGNMENT_REPORT_1784147505317.md` — asset — EngineeringOS — Execution Alignment Report
#### ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION(2)_(2)_1784143389784.md/
- `attached_assets/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION(2)_(2)_1784143389784.md` — asset — ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION
#### ENGINEERINGOS_PLACEHOLDER_REGISTER_1784147505353.md/
- `attached_assets/ENGINEERINGOS_PLACEHOLDER_REGISTER_1784147505353.md` — asset — EngineeringOS — Placeholder Register
#### ENGINEERINGOS_RUNTIME_EXECUTION_MATRIX_1784147505400.md/
- `attached_assets/ENGINEERINGOS_RUNTIME_EXECUTION_MATRIX_1784147505400.md` — asset — EngineeringOS — Runtime Execution Matrix
#### EngineeringOS_Audit_Report_1783641389270.md/
- `attached_assets/EngineeringOS_Audit_Report_1783641389270.md` — asset — EngineeringOS — تقرير تدقيق فني نهائي
#### EngineeringOS_Audit_Report_Expanded_1783642792349.md/
- `attached_assets/EngineeringOS_Audit_Report_Expanded_1783642792349.md` — asset — EngineeringOS — Technical Audit Report
#### EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md/
- `attached_assets/EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md` — asset — EngineeringOS — التقرير الموحّد المتعمّق
#### EngineeringOS_Engineering_Truth_Verification_1784082430324.csv/
- `attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430324.csv` — asset — .csv
#### EngineeringOS_Engineering_Truth_Verification_1784082430371.md/
- `attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430371.md` — asset — EngineeringOS — Engineering Truth Verification
#### EngineeringOS_Execution_Plan_1783831261195.pdf/
- `attached_assets/EngineeringOS_Execution_Plan_1783831261195.pdf` — asset — PDF asset
#### EngineeringOS_Executive_Build_Directive_v1_1783912619169.md/
- `attached_assets/EngineeringOS_Executive_Build_Directive_v1_1783912619169.md` — asset — EngineeringOS — وثيقة تنفيذية للبناء
#### EngineeringOS_File_Inventory_Complete(1)_1783706911845.md/
- `attached_assets/EngineeringOS_File_Inventory_Complete(1)_1783706911845.md` — asset — EngineeringOS — فهرس الملفات الكامل
#### EngineeringOS_File_by_File_Fact_Record_1783725698283.md/
- `attached_assets/EngineeringOS_File_by_File_Fact_Record_1783725698283.md` — asset — EngineeringOS — سجل حقيقة منظّم ملفًا ملفًا
#### EngineeringOS_Implementation_Document_1783726156016.md/
- `attached_assets/EngineeringOS_Implementation_Document_1783726156016.md` — asset — EngineeringOS — وثيقة التنفيذ التفصيلية للمشروع
#### EngineeringOS_Master_Truth_Register_(1)_1784077194501.xlsx/
- `attached_assets/EngineeringOS_Master_Truth_Register_(1)_1784077194501.xlsx` — asset — XLSX asset
#### EngineeringOS_Plan_1783818095882.pdf/
- `attached_assets/EngineeringOS_Plan_1783818095882.pdf` — asset — PDF asset
#### EngineeringOS_Project_1783718452179.pdf/
- `attached_assets/EngineeringOS_Project_1783718452179.pdf` — asset — PDF asset
#### EngineeringOS_Truth_Flow_Matrix.schema_1784143389669.ts/
- `attached_assets/EngineeringOS_Truth_Flow_Matrix.schema_1784143389669.ts` — asset — .ts
#### EngineeringOS_Truth_Flow_Matrix_1784143389833.json/
- `attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389833.json` — asset — JSON config/data; keys: title, version, description, nodes
#### EngineeringOS_Truth_Flow_Matrix_1784143389882.ts/
- `attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389882.ts` — asset — .ts
#### EngineeringOS_Truth_Flow_PR_Checklist_1784143389929.md/
- `attached_assets/EngineeringOS_Truth_Flow_PR_Checklist_1784143389929.md` — asset — Truth Flow Matrix — PR-ready Checklist
#### EngineeringOS_Truth_Register_Full_(1)_1784081699025.csv/
- `attached_assets/EngineeringOS_Truth_Register_Full_(1)_1784081699025.csv` — asset — .csv
#### EngineeringOS_Truth_Register_Full_1784081611461.csv/
- `attached_assets/EngineeringOS_Truth_Register_Full_1784081611461.csv` — asset — .csv
#### EngineeringOS_Truth_Register_and_PR_Roadmap_(1)_1784081698974.md/
- `attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_(1)_1784081698974.md` — asset — EngineeringOS — Truth Register + Critical PR Roadmap
#### EngineeringOS_Truth_Register_and_PR_Roadmap_1784081611536.md/
- `attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_1784081611536.md` — asset — EngineeringOS — Truth Register + Critical PR Roadmap
#### EngineeringOS_analysis_report(2)_(1)_1784047036210.md/
- `attached_assets/EngineeringOS_analysis_report(2)_(1)_1784047036210.md` — asset — EngineeringOS — تحليل شامل للملفّات والطبقات
#### EngineeringOS_api_zod_index_export_diff_1784143389744.txt/
- `attached_assets/EngineeringOS_api_zod_index_export_diff_1784143389744.txt` — asset — Add to lib/api-zod/src/index.ts
#### EngineeringOS_architecture_analysis_report_1784040976647.md/
- `attached_assets/EngineeringOS_architecture_analysis_report_1784040976647.md` — asset — EngineeringOS — التحليل المعماري الشامل للأرشيف
#### EngineeringOS_archive_entries_1784040976692.csv/
- `attached_assets/EngineeringOS_archive_entries_1784040976692.csv` — asset — .csv
#### EngineeringOS_archive_entries_1784041152876.csv/
- `attached_assets/EngineeringOS_archive_entries_1784041152876.csv` — asset — .csv
#### EngineeringOS_code_deep_analysis_1784052671648.md/
- `attached_assets/EngineeringOS_code_deep_analysis_1784052671648.md` — asset — EngineeringOS — Code Deep Analysis
#### EngineeringOS_code_deep_analysis_1784052762652.md/
- `attached_assets/EngineeringOS_code_deep_analysis_1784052762652.md` — asset — EngineeringOS — Code Deep Analysis
#### EngineeringOS_current_analysis_report_1784052671601.md/
- `attached_assets/EngineeringOS_current_analysis_report_1784052671601.md` — asset — EngineeringOS — التحليل الشامل الحالي للأرشيف
#### EngineeringOS_current_analysis_report_1784052762572.md/
- `attached_assets/EngineeringOS_current_analysis_report_1784052762572.md` — asset — EngineeringOS — التحليل الشامل الحالي للأرشيف
#### EngineeringOS_deep_analysis_report_1783800987828.md/
- `attached_assets/EngineeringOS_deep_analysis_report_1783800987828.md` — asset — EngineeringOS — Deep Analysis Report
#### EngineeringOS_deep_dive_analysis_v2_1784152351310.md/
- `attached_assets/EngineeringOS_deep_dive_analysis_v2_1784152351310.md` — asset — EngineeringOS — Deep Dive Analysis v2
#### EngineeringOS_deepest_analysis_report(1)_(2)_1784154247108.md/
- `attached_assets/EngineeringOS_deepest_analysis_report(1)_(2)_1784154247108.md` — asset — EngineeringOS — Deepest Analysis Report
#### EngineeringOS_deepest_analysis_report_(1)_1784081611576.md/
- `attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081611576.md` — asset — EngineeringOS — Deepest Structural Analysis
#### EngineeringOS_deepest_analysis_report_(1)_1784081699061.md/
- `attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081699061.md` — asset — EngineeringOS — Deepest Structural Analysis
#### EngineeringOS_file_inventory_(1)_1783729892809.csv/
- `attached_assets/EngineeringOS_file_inventory_(1)_1783729892809.csv` — asset — .csv
#### EngineeringOS_file_inventory_current_1784052671527.csv/
- `attached_assets/EngineeringOS_file_inventory_current_1784052671527.csv` — asset — .csv
#### EngineeringOS_file_inventory_current_1784052762450.csv/
- `attached_assets/EngineeringOS_file_inventory_current_1784052762450.csv` — asset — .csv
#### EngineeringOS_file_inventory_full(2)_1783988496247.csv/
- `attached_assets/EngineeringOS_file_inventory_full(2)_1783988496247.csv` — asset — .csv
#### EngineeringOS_file_inventory_full_1783800987783.csv/
- `attached_assets/EngineeringOS_file_inventory_full_1783800987783.csv` — asset — .csv
#### EngineeringOS_file_inventory_v2_1784427571850.csv/
- `attached_assets/EngineeringOS_file_inventory_v2_1784427571850.csv` — asset — .csv
#### EngineeringOS_file_inventory_v2_1784427972718.csv/
- `attached_assets/EngineeringOS_file_inventory_v2_1784427972718.csv` — asset — .csv
#### EngineeringOS_forensic_engineering_report_v2_1784427571793.md/
- `attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427571793.md` — asset — EngineeringOS — Forensic Engineering Analysis
#### EngineeringOS_forensic_engineering_report_v2_1784427972668.md/
- `attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427972668.md` — asset — EngineeringOS — Forensic Engineering Analysis
#### EngineeringOS_full_analysis_report_1783988496190.md/
- `attached_assets/EngineeringOS_full_analysis_report_1783988496190.md` — asset — EngineeringOS — التحليل الشامل للمشروع
#### EngineeringOS_full_file_inventory(1)_1784040976594.csv/
- `attached_assets/EngineeringOS_full_file_inventory(1)_1784040976594.csv` — asset — .csv
#### EngineeringOS_full_file_inventory(1)_1784041152926.csv/
- `attached_assets/EngineeringOS_full_file_inventory(1)_1784041152926.csv` — asset — .csv
#### EngineeringOS_minimum_path_to_vision_(1)_1783830867380.md/
- `attached_assets/EngineeringOS_minimum_path_to_vision_(1)_1783830867380.md` — asset — EngineeringOS — استخراج المشروع والحد الأدنى للوصول إلى الرؤية
#### EngineeringOS_minimum_path_to_vision_1783830816710.md/
- `attached_assets/EngineeringOS_minimum_path_to_vision_1783830816710.md` — asset — EngineeringOS — استخراج المشروع والحد الأدنى للوصول إلى الرؤية
#### EngineeringOS_operational_status_record_1783912104506.md/
- `attached_assets/EngineeringOS_operational_status_record_1783912104506.md` — asset — السجل التشغيلي الرسمي — الاستيراد / البنية / التشغيل
#### EngineeringOS_project_analysis_report(1)_1783729892769.md/
- `attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md` — asset — EngineeringOS — تقرير تحليل المشروع وخطة الاستكمال
#### EngineeringOS_provenance_registry_linked_1783911530593.json/
- `attached_assets/EngineeringOS_provenance_registry_linked_1783911530593.json` — asset — JSON file
#### EngineeringOS_provenance_registry_seed_1783911530658.json/
- `attached_assets/EngineeringOS_provenance_registry_seed_1783911530658.json` — asset — JSON file
#### EngineeringOS_replit_execution_directive_1783800987701.json/
- `attached_assets/EngineeringOS_replit_execution_directive_1783800987701.json` — asset — JSON config/data; keys: project, mission, execution_order, global_rules, tasks
#### EngineeringOS_replit_execution_directive_1783800987743.md/
- `attached_assets/EngineeringOS_replit_execution_directive_1783800987743.md` — asset — EngineeringOS — Execution Directive for Replit Agent
#### EngineeringOS_series14_truth_matrix_1783966531635.md/
- `attached_assets/EngineeringOS_series14_truth_matrix_1783966531635.md` — asset — EngineeringOS — السلسلة 14
#### EngineeringOS_series15_deep_evidence_1783966531578.md/
- `attached_assets/EngineeringOS_series15_deep_evidence_1783966531578.md` — asset — EngineeringOS — السلسلة 15
#### EngineeringOS_series16_truth_matrix_(1)_1783966531512.md/
- `attached_assets/EngineeringOS_series16_truth_matrix_(1)_1783966531512.md` — asset — EngineeringOS — السلسلة 16
#### EngineeringOS_series17_deep_analysis_1783966531444.md/
- `attached_assets/EngineeringOS_series17_deep_analysis_1783966531444.md` — asset — EngineeringOS — السلسلة 17: التحليل العميق بالأدلة من داخل الكود والملفات
#### EngineeringOS_series18_status_register_(1)_1783966531375.md/
- `attached_assets/EngineeringOS_series18_status_register_(1)_1783966531375.md` — asset — EngineeringOS — السلسلة 18: سجل حالة طبقي بالأدلة من داخل الكود والملفات
#### EngineeringOS_series19_control_plane_evidence_1783966531303.md/
- `attached_assets/EngineeringOS_series19_control_plane_evidence_1783966531303.md` — asset — EngineeringOS — السلسلة 19: أدلة التحكم التشغيلي والطبقة الذاتية التحقق
#### EngineeringOS_series20_status_register_1783966531239.md/
- `attached_assets/EngineeringOS_series20_status_register_1783966531239.md` — asset — EngineeringOS — السلسلة 20
#### EngineeringOS_series21_deep_status_1783966531177.md/
- `attached_assets/EngineeringOS_series21_deep_status_1783966531177.md` — asset — EngineeringOS — السلسلة 21
#### EngineeringOS_series22_second_wave_analysis_1783966531113.md/
- `attached_assets/EngineeringOS_series22_second_wave_analysis_1783966531113.md` — asset — EngineeringOS — السلسلة 22
#### EngineeringOS_series23_self_verifying_architecture_1783966531049.md/
- `attached_assets/EngineeringOS_series23_self_verifying_architecture_1783966531049.md` — asset — EngineeringOS — السلسلة 23: البنية الذاتية التحقق والأدلة التشغيلية
#### EngineeringOS_series24_deep_evidence_1783966530990.md/
- `attached_assets/EngineeringOS_series24_deep_evidence_1783966530990.md` — asset — EngineeringOS — السلسلة التالية: تحليل عميق بالأدلة من داخل الكود والملفات
#### EngineeringOS_series25_truth_register_1783966530939.md/
- `attached_assets/EngineeringOS_series25_truth_register_1783966530939.md` — asset — EngineeringOS — السلسلة 25: سجل حالة طبقي بالأدلة من داخل الكود والملفات
#### EngineeringOS_series26_boundary_analysis_1783966530884.md/
- `attached_assets/EngineeringOS_series26_boundary_analysis_1783966530884.md` — asset — EngineeringOS — السلسلة 26
#### EngineeringOS_series27_failure_semantics_1783966530824.md/
- `attached_assets/EngineeringOS_series27_failure_semantics_1783966530824.md` — asset — EngineeringOS — السلسلة 27
#### EngineeringOS_series28_traceability_mesh_1783966530766.md/
- `attached_assets/EngineeringOS_series28_traceability_mesh_1783966530766.md` — asset — EngineeringOS — السلسلة 28: شبكة التتبّع، الحالة، والحوكمة التشغيلية
#### EngineeringOS_series29_trust_boundary_register_1783966530702.md/
- `attached_assets/EngineeringOS_series29_trust_boundary_register_1783966530702.md` — asset — EngineeringOS — سلسلة 29: سجل حدود الثقة والحوكمة
#### EngineeringOS_series30_release_handoff_audit_1783966530642.md/
- `attached_assets/EngineeringOS_series30_release_handoff_audit_1783966530642.md` — asset — EngineeringOS — السلسلة 30
#### EngineeringOS_series31_release_handoff_audit_1783966530586.md/
- `attached_assets/EngineeringOS_series31_release_handoff_audit_1783966530586.md` — asset — EngineeringOS — السلسلة 31: تدقيق تسليم وتشغيل
#### EngineeringOS_series32_phase_conformance_audit_1783966530537.md/
- `attached_assets/EngineeringOS_series32_phase_conformance_audit_1783966530537.md` — asset — EngineeringOS — السلسلة 32: تدقيق الالتزام بالخطة المرحلية
#### EngineeringOS_series33_provenance_authority_graph_1783966530470.md/
- `attached_assets/EngineeringOS_series33_provenance_authority_graph_1783966530470.md` — asset — EngineeringOS — السلسلة 33: خريطة السلطة والتتبّع (Provenance Authority Graph)
#### EngineeringOS_status_record_(1)_1783980758791.md/
- `attached_assets/EngineeringOS_status_record_(1)_1783980758791.md` — asset — سجل الحالة الرسمي لمشروع EngineeringOS
#### EngineeringOS_status_register_(1)_1783818095824.md/
- `attached_assets/EngineeringOS_status_register_(1)_1783818095824.md` — asset — سجل الحالة الرسمي — EngineeringOS
#### EngineeringOS_status_register_final_1783902107873.md/
- `attached_assets/EngineeringOS_status_register_final_1783902107873.md` — asset — EngineeringOS — سجل حالة رسمي نهائي
#### EngineeringOS_task_backlog_1783800987875.json/
- `attached_assets/EngineeringOS_task_backlog_1783800987875.json` — asset — JSON file
#### EngineeringOS_truth_checklist_1784322972343.md/
- `attached_assets/EngineeringOS_truth_checklist_1784322972343.md` — asset — Checklist مراجعة نهائية — تثبيت الحقيقة المرجعية
#### EngineeringOS_truth_checklist_1784326108247.md/
- `attached_assets/EngineeringOS_truth_checklist_1784326108247.md` — asset — Checklist مراجعة نهائية — تثبيت الحقيقة المرجعية
#### EngineeringOS_truth_register_current_1783825680736.md/
- `attached_assets/EngineeringOS_truth_register_current_1783825680736.md` — asset — EngineeringOS — سجل حقيقة تشغيلي مُحدّث
#### Engineering_Os_Fact_Record_1783718570175.pdf/
- `attached_assets/Engineering_Os_Fact_Record_1783718570175.pdf` — asset — PDF asset
#### Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf/
- `attached_assets/Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf` — asset — PDF asset
#### Engineering_Os_Phased_Completion_Plan_1783718452216.pdf/
- `attached_assets/Engineering_Os_Phased_Completion_Plan_1783718452216.pdf` — asset — PDF asset
#### Pasted---1783906604381_1783906604385.txt/
- `attached_assets/Pasted---1783906604381_1783906604385.txt` — asset — | الطبقة                                           | الحالة                   | 
#### Pasted---1783956390496_1783956390501.txt/
- `attached_assets/Pasted---1783956390496_1783956390501.txt` — asset — 1) `lib/ai-orchestrator/src/context-builder.ts`
#### Pasted---1784163447147_1784163447161.txt/
- `attached_assets/Pasted---1784163447147_1784163447161.txt` — asset — 1) الملف الأهم: `artifacts/api-server/src/lib/job-reconciliation.ts`
#### Pasted---1784163799356_1784163799366.txt/
- `attached_assets/Pasted---1784163799356_1784163799366.txt` — asset — | #  | الفجوة                                                                   
#### Pasted---1784230995192_1784230995203.txt/
- `attached_assets/Pasted---1784230995192_1784230995203.txt` — asset — | السيناريو                                                                     
#### Pasted---1784231528183_1784231528198.txt/
- `attached_assets/Pasted---1784231528183_1784231528198.txt` — asset — | السيناريو                                                                     
#### Pasted---1784232069146_1784232069153.txt/
- `attached_assets/Pasted---1784232069146_1784232069153.txt` — asset — | السيناريو                             | الملف                                 
#### Pasted---1784348446604_1784348446608.txt/
- `attached_assets/Pasted---1784348446604_1784348446608.txt` — asset — منهجية التحليل
#### Pasted---1784389595241_1784389595255.txt/
- `attached_assets/Pasted---1784389595241_1784389595255.txt` — asset — ما أراه ناقصًا في التحليل السابق
#### Pasted--1--1784078393552_1784078393558.txt/
- `attached_assets/Pasted--1--1784078393552_1784078393558.txt` — asset — سلسلة 1 — تثبيت الحقيقة ثم تنفيذ العمود الفقري
#### Pasted--Backlog-Execution-Backlog-v1-0--1783975284276_1783975284279.txt/
- `attached_assets/Pasted--Backlog-Execution-Backlog-v1-0--1783975284276_1783975284279.txt` — asset — السلسلة الثانية عشرة
#### Pasted--Code-Review-Plan-Groq-Scope-Save-API--1784175594438_1784175594440.txt/
- `attached_assets/Pasted--Code-Review-Plan-Groq-Scope-Save-API--1784175594438_1784175594440.txt` — asset — خطة مراجعة كود (Code Review Plan)
#### Pasted--Discovery-Layer--1783988471815_1783988471818.txt/
- `attached_assets/Pasted--Discovery-Layer--1783988471815_1783988471818.txt` — asset — المرحلة 1 — إعادة تصميم عقد الاكتشاف (Discovery Contract)
#### Pasted--EngineeringOS--1784145653787_1784145653789.txt/
- `attached_assets/Pasted--EngineeringOS--1784145653787_1784145653789.txt` — asset — الخلاصة التنفيذية
#### Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt/
- `attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt` — asset — EngineeringOS — Autonomous Project Discovery & Onboarding
#### Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt/
- `attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt` — asset — EngineeringOS — Autonomous Project Discovery & Onboarding
#### Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784168_1784168977036.txt/
- `attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784168_1784168977036.txt` — asset — EngineeringOS — PR Backlog عملي (File-by-File)
#### Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784169_1784169315352.txt/
- `attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784169_1784169315352.txt` — asset — EngineeringOS — PR Backlog عملي (File-by-File)
#### Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784154335102.txt/
- `attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784154335102.txt` — asset — EngineeringOS — PR-by-PR Execution Pack for Replit AI
#### Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784155079326.txt/
- `attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784155079326.txt` — asset — EngineeringOS — PR-by-PR Execution Pack for Replit AI
#### Pasted--GROQ-API-KEY-JavaScript-Groq--1784088277237_1784088277243.txt/
- `attached_assets/Pasted--GROQ-API-KEY-JavaScript-Groq--1784088277237_1784088277243.txt` — asset — PR Title
#### Pasted--Git-AI-Orchestrator-lib-ai-orchestrator-src-tools-git-_1784347517831.txt/
- `attached_assets/Pasted--Git-AI-Orchestrator-lib-ai-orchestrator-src-tools-git-_1784347517831.txt` — asset — أدوات Git داخل الـ AI Orchestrator
#### Pasted--Knowledge-Graph-2-0--1784165514922_1784165514926.txt/
- `attached_assets/Pasted--Knowledge-Graph-2-0--1784165514922_1784165514926.txt` — asset — قائمة تنفيذ تقنية مختصرة لـ Knowledge Graph 2.0 داخل المشروع
#### Pasted--Knowledge-Graph-2-0-Checklist-File--1784165546932_1784165546935.txt/
- `attached_assets/Pasted--Knowledge-Graph-2-0-Checklist-File--1784165546932_1784165546935.txt` — asset — Knowledge Graph 2.0 — Checklist تنفيذ مباشر
#### Pasted--PR--1784040954263_1784040954267.txt/
- `attached_assets/Pasted--PR--1784040954263_1784040954267.txt` — asset — خطة PR متسلسلة لتحويل التحليل إلى تنفيذ فعلي
#### Pasted--PR-01-Sync-OpenAPI-with-runtime-graph-surface-files-li_1784234215782.txt/
- `attached_assets/Pasted--PR-01-Sync-OpenAPI-with-runtime-graph-surface-files-li_1784234215782.txt` — asset — **PR-01 — Sync OpenAPI with runtime graph surface**
#### Pasted--PR-03-Micro-Backlog-Contract-Layer-Stabilization-1-3--_1784158287520.txt/
- `attached_assets/Pasted--PR-03-Micro-Backlog-Contract-Layer-Stabilization-1-3--_1784158287520.txt` — asset — PR-03 Micro Backlog — Contract Layer Stabilization
#### Pasted--PR-1-Hardening-Contract-Alignment-for-projects-ts-proj_1784052905584.txt/
- `attached_assets/Pasted--PR-1-Hardening-Contract-Alignment-for-projects-ts-proj_1784052905584.txt` — asset — PR 1 — Hardening & Contract Alignment for `projects.ts`
#### Pasted--PR-Backlog-EngineeringOS-1-Scoping-ownership-integrity_1784154359481.txt/
- `attached_assets/Pasted--PR-Backlog-EngineeringOS-1-Scoping-ownership-integrity_1784154359481.txt` — asset — PR Backlog — EngineeringOS
#### Pasted--PR-Backlog-EngineeringOS-Execution-Alignment--17841474_1784147452495.txt/
- `attached_assets/Pasted--PR-Backlog-EngineeringOS-Execution-Alignment--17841474_1784147452495.txt` — asset — PR Backlog — EngineeringOS Execution Alignment
#### Pasted--PR-Title-fix-ai-chat-surface-AI-request-failures-and-r_1784130154946.txt/
- `attached_assets/Pasted--PR-Title-fix-ai-chat-surface-AI-request-failures-and-r_1784130154946.txt` — asset — PR Title
#### Pasted--PR-Title-fix-discovery-Classify-Project-Loading-Failur_1784086246178.txt/
- `attached_assets/Pasted--PR-Title-fix-discovery-Classify-Project-Loading-Failur_1784086246178.txt` — asset — PR Title
#### Pasted--PR-app-ts--1784047027177_1784047027183.txt/
- `attached_assets/Pasted--PR-app-ts--1784047027177_1784047027183.txt` — asset — PR 1 — `app.ts`
#### Pasted--PR-app-ts--1784047927706_1784047927710.txt/
- `attached_assets/Pasted--PR-app-ts--1784047927706_1784047927710.txt` — asset — PR 1 — `app.ts`
#### Pasted--PR-discovery-ts-PR-1-Discovery--1783996178319_1783996178325.txt/
- `attached_assets/Pasted--PR-discovery-ts-PR-1-Discovery--1783996178319_1783996178325.txt` — asset — سلسلة PR متسلسلة منطقية تبدأ بـ `discovery.ts`
#### Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993953832.txt/
- `attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993953832.txt` — asset — مهام PR متسلسلة لـ `lib/ai-orchestrator`
#### Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993967887.txt/
- `attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993967887.txt` — asset — مهام PR متسلسلة لـ `lib/ai-orchestrator`
#### Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839950_1783995013203.txt/
- `attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839950_1783995013203.txt` — asset — مهام PR متسلسلة لـ `lib/ai-orchestrator`
#### Pasted--PR-title-Harden-auth-context-and-prepare-project-scope_1784044908893.txt/
- `attached_assets/Pasted--PR-title-Harden-auth-context-and-prepare-project-scope_1784044908893.txt` — asset — PR title
#### Pasted--PR-title-Hardening-discovery-ts-into-a-deterministic-o_1784053152915.txt/
- `attached_assets/Pasted--PR-title-Hardening-discovery-ts-into-a-deterministic-o_1784053152915.txt` — asset — PR title
#### Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt/
- `attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt` — asset — 3 - Sync Fact Record & Architecture Docs
#### Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt/
- `attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt` — asset — 3 - Sync Fact Record & Architecture Docs
#### Pasted--artifacts-api-server-src-routes-ai-ts-lib-ai-orchestra_1784388540189.txt/
- `attached_assets/Pasted--artifacts-api-server-src-routes-ai-ts-lib-ai-orchestra_1784388540189.txt` — asset — الصورة الفعلية للطبقة
#### Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783996711676.txt/
- `attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783996711676.txt` — asset — سلسلة PR متسلسلة منطقية تبدأ بـ `discovery.ts`
#### Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783997082105.txt/
- `attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783997082105.txt` — asset — سلسلة PR متسلسلة منطقية تبدأ بـ `discovery.ts`
#### Pasted--lib-ai-orchestrator--1783993997216_1783993997218.txt/
- `attached_assets/Pasted--lib-ai-orchestrator--1783993997216_1783993997218.txt` — asset — خطة تعديل كود مباشرة لـ `lib/ai-orchestrator`
#### Pasted--lib-db-test-script--1784159470823_1784159470827.txt/
- `attached_assets/Pasted--lib-db-test-script--1784159470823_1784159470827.txt` — asset — الترتيب المقترح
#### Pasted--onboarding-o-1783988399961_1783988399964.txt/
- `attached_assets/Pasted--onboarding-o-1783988399961_1783988399964.txt` — asset — ما الذي يعنيه هذا معماريًا
#### Pasted--src-context-builder-ts-src-schemas-context-schema-1784_1784305372706.txt/
- `attached_assets/Pasted--src-context-builder-ts-src-schemas-context-schema-1784_1784305372706.txt` — asset — .
#### Pasted--test--1784245726594_1784245726598.txt/
- `attached_assets/Pasted--test--1784245726594_1784245726598.txt` — asset — راجعت الشجرة الفعلية، وهذه نسخة تنفيذية ملفًا ملفًا مبنية على الملفات الموجودة ا
#### Pasted--test--1784245803493_1784245803497.txt/
- `attached_assets/Pasted--test--1784245803493_1784245803497.txt` — asset — راجعت الشجرة الفعلية، وهذه نسخة تنفيذية ملفًا ملفًا مبنية على الملفات الموجودة ا
#### Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt/
- `attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt` — asset — 7 - Upgrade Dashboard to Operational UI
#### Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783798897613.txt/
- `attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783798897613.txt` — asset — 7 - Upgrade Dashboard to Operational UI
#### Pasted-PR-Title-security-ai-Harden-User-Scoped-Groq-Credential_1784127290653.txt/
- `attached_assets/Pasted-PR-Title-security-ai-Harden-User-Scoped-Groq-Credential_1784127290653.txt` — asset — PR Title
#### Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt/
- `attached_assets/Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt` — asset — 6 - Deepen Graph, Scanner & Discovery
#### Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٣-٠٣٥٣١٨_1783904118069.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٣٥٣١٨_1783904118069.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٣-٠٤٠٥١١_1783904724118.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٠٥١١_1783904724118.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٣-٠٤٤٤٢٨_1783907108840.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٤٤٢٨_1783907108840.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٣-٠٥٠١٣٨_1783908128704.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥٠١٣٨_1783908128704.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٣-٠٥١٤٥٤_1783908924873.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٤٥٤_1783908924873.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٣-٠٥١٩٤٨_1783909201747.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٩٤٨_1783909201747.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٦-٠٧٣٧٤٤_1784176683628.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٦-٠٧٣٧٤٤_1784176683628.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤١_1784216000977.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤١_1784216000977.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤٦_1784216000942.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤٦_1784216000942.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٨-٠١٠٨١٠_1784326132441.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠١٠٨١٠_1784326132441.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٠٢_1784344398002.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٠٢_1784344398002.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٢_1784344397966.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٢_1784344397966.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٦_1784344397931.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٦_1784344397931.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٨-٠٦١٩١٠_1784344762476.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٩١٠_1784344762476.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥١٧_1784424954601.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥١٧_1784424954601.png` — asset — image asset (.png)
#### Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥٢١_1784424954559.png/
- `attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥٢١_1784424954559.png` — asset — image asset (.png)
#### agents_(1)_1783564013722.zip/
- `attached_assets/agents_(1)_1783564013722.zip` — asset — ZIP asset
#### ai_orchestrator_deep_dive_(1)_1783994021466.md/
- `attached_assets/ai_orchestrator_deep_dive_(1)_1783994021466.md` — asset — lib/ai-orchestrator — deep dive
#### artifacts_(7)_(1)_1783564013761.zip/
- `attached_assets/artifacts_(7)_(1)_1783564013761.zip` — asset — ZIP asset
#### git_(2)_1783564013691.zip/
- `attached_assets/git_(2)_1783564013691.zip` — asset — ZIP asset
#### gitattributes_1783564013915.txt/
- `attached_assets/gitattributes_1783564013915.txt` — asset — attached_assets/Agent-Execution-Guide_1783558968243.zip filter=lfs diff=lfs merg
#### gitignore_(1)_1783564013965.txt/
- `attached_assets/gitignore_(1)_1783564013965.txt` — asset — See https://docs.github.com/en/get-started/getting-started-with-git/ignoring-files for more about ignoring files.
#### lib_(7)_(1)_1783564013810.zip/
- `attached_assets/lib_(7)_(1)_1783564013810.zip` — asset — ZIP asset
#### node_modules_(2)_1783564014266.zip/
- `attached_assets/node_modules_(2)_1783564014266.zip` — asset — ZIP asset
#### npmrc_(2)_1783564014024.txt/
- `attached_assets/npmrc_(2)_1783564014024.txt` — asset — auto-install-peers=false
#### package_(1)_(7)_1783564014328.json/
- `attached_assets/package_(1)_(7)_1783564014328.json` — asset — JSON config/data; keys: name, version, license, scripts, private
#### pnpm-lock.yaml_(3)_1783564014392.txt/
- `attached_assets/pnpm-lock.yaml_(3)_1783564014392.txt` — asset — lockfileVersion: '9.0'
#### pnpm-workspace.yaml_(3)_1783564014449.txt/
- `attached_assets/pnpm-workspace.yaml_(3)_1783564014449.txt` — asset — ============================================================================
#### pr-backlog-ai-orchestrator_1784306020062.md/
- `attached_assets/pr-backlog-ai-orchestrator_1784306020062.md` — asset — AI Orchestrator — PR Backlog (file-by-file)
#### replit_(13)_1783564014085.md/
- `attached_assets/replit_(13)_1783564014085.md` — asset — [Project name]
#### replit_(2)_1783564014509.txt/
- `attached_assets/replit_(2)_1783564014509.txt` — asset — modules = ["nodejs-24", "postgresql-16"]
#### replitignore_1783564014569.txt/
- `attached_assets/replitignore_1783564014569.txt` — asset — The format of this file is identical to `.dockerignore`.
#### scripts_(8)_1783564013865.zip/
- `attached_assets/scripts_(8)_1783564013865.zip` — asset — ZIP asset
#### tsconfig.base_(2)_(1)_1783564014142.json/
- `attached_assets/tsconfig.base_(2)_(1)_1783564014142.json` — asset — JSON config/data; keys: compilerOptions
#### tsconfig_(7)_1783564014202.json/
- `attached_assets/tsconfig_(7)_1783564014202.json` — asset — JSON config/data; keys: extends, compileOnSave, files, references
#### تحليل_EngineeringOS_1783804577785.docx/
- `attached_assets/تحليل_EngineeringOS_1783804577785.docx` — asset — DOCX asset
#### خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx/
- `attached_assets/خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx` — asset — DOCX asset

### docs/
#### ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md/
- `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md` — doc — ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION
#### EXECUTION_ALIGNMENT_REPORT.md/
- `docs/EXECUTION_ALIGNMENT_REPORT.md` — doc — EngineeringOS — Execution Alignment Report
#### PLACEHOLDER_REGISTER.md/
- `docs/PLACEHOLDER_REGISTER.md` — doc — EngineeringOS — Placeholder Register
#### PR_BACKLOG.md/
- `docs/PR_BACKLOG.md` — doc — PR Backlog — EngineeringOS Execution Alignment
#### RUNTIME_EXECUTION_MATRIX.md/
- `docs/RUNTIME_EXECUTION_MATRIX.md` — doc — EngineeringOS — Runtime Execution Matrix
#### ai-orchestrator-executive-table.md/
- `docs/ai-orchestrator-executive-table.md` — doc — AI Orchestrator — جدول تنفيذي
#### ai-orchestrator-forensic-analysis.md/
- `docs/ai-orchestrator-forensic-analysis.md` — doc — AI Orchestrator — Forensic Reverse Engineering Report
#### ai-orchestrator-gap-analysis.md/
- `docs/ai-orchestrator-gap-analysis.md` — doc — AI Orchestrator — Request Lifecycle Gap Analysis
#### ai-orchestrator-trace-analysis.md/
- `docs/ai-orchestrator-trace-analysis.md` — doc — AI Orchestrator — Trace-by-Trace Analysis
#### completion-plan.md/
- `docs/completion-plan.md` — doc — EngineeringOS — Phased Completion Plan
#### fact-record.md/
- `docs/fact-record.md` — doc — EngineeringOS — سجل حقيقة منظّم ملفًا ملفًا
#### pr-backlog-ai-orchestrator.md/
- `docs/pr-backlog-ai-orchestrator.md` — doc — AI Orchestrator — PR Backlog (file-by-file)
#### truth-flow-pr-checklist.md/
- `docs/truth-flow-pr-checklist.md` — doc — Truth Flow Matrix — PR-ready Checklist
#### truth-flow-pr-review-plan.md/
- `docs/truth-flow-pr-review-plan.md` — doc — خطة المراجعة التنفيذية — تثبيت الحقيقة المرجعية

### lib/
#### ai-orchestrator/
- `lib/ai-orchestrator/package.json` — source — package @workspace/ai-orchestrator; scripts: test, test:watch, test:coverage
- `lib/ai-orchestrator/src/__tests__/chat-agent.test.ts` — test — test file; approx test blocks: 9; exports: makeContext
- `lib/ai-orchestrator/src/__tests__/file-tools.test.ts` — test — test file; approx test blocks: 6; exports: mockCallback
- `lib/ai-orchestrator/src/__tests__/groq-client.test.ts` — test — test file; approx test blocks: 13; exports: 
- `lib/ai-orchestrator/src/__tests__/parsing.test.ts` — test — test file; approx test blocks: 16; exports: 
- `lib/ai-orchestrator/src/__tests__/schemas.test.ts` — test — test file; approx test blocks: 64; exports: 
- `lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts` — test — test file; approx test blocks: 60; exports: 
- `lib/ai-orchestrator/src/agents/chat-agent.ts` — source — agent module; exports: requiresToolExecution, toolCacheKey, fallbackChatOutput, chat
- `lib/ai-orchestrator/src/agents/code-reviewer.ts` — source — agent module; exports: fallbackCodeReview, reviewCode
- `lib/ai-orchestrator/src/agents/scan-analyst.ts` — source — agent module; exports: fallbackScanAnalysis, analyzeScan
- `lib/ai-orchestrator/src/agents/task-agent.ts` — source — agent module; exports: fallbackTaskOutput, executeTask
- `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts` — source — agent module; exports: fallbackDecision, rejectedDecision, decide, validateDecision, executeDecision, orchestrateWorkflow
- `lib/ai-orchestrator/src/context-builder.test.ts` — test — test file; approx test blocks: 13; exports: makeChain, makeProject, makeMetric, makeScanJob
- `lib/ai-orchestrator/src/context-builder.ts` — source — source module; exports: invalidateContextCache, buildProjectContext
- `lib/ai-orchestrator/src/errors.ts` — source — source module; exports: GroqClientError
- `lib/ai-orchestrator/src/groq-client.ts` — source — source module; exports: retryDelayMs, sleep, getCircuit, circuitCheck, circuitRecord, getClient
- `lib/ai-orchestrator/src/index.ts` — source — source module; exports: 
- `lib/ai-orchestrator/src/parsing.ts` — source — source module; exports: extractJson
- `lib/ai-orchestrator/src/prompts/chat.prompt.ts` — source — source module; exports: buildChatSystemPrompt
- `lib/ai-orchestrator/src/prompts/index.ts` — source — source module; exports: 
- `lib/ai-orchestrator/src/prompts/review.prompt.ts` — source — source module; exports: buildCodeReviewSystemPrompt, buildCodeReviewUserPrompt
- `lib/ai-orchestrator/src/prompts/scan.prompt.ts` — source — source module; exports: buildScanAnalystSystemPrompt, buildScanAnalystUserPrompt
- `lib/ai-orchestrator/src/prompts/task.prompt.ts` — source — source module; exports: buildTaskAgentSystemPrompt, buildTaskAgentUserPrompt
- `lib/ai-orchestrator/src/prompts/workflow.prompt.ts` — source — source module; exports: buildWorkflowSystemPrompt, buildWorkflowUserPrompt
- `lib/ai-orchestrator/src/schemas/chat.schema.ts` — source — schema module; exports: 
- `lib/ai-orchestrator/src/schemas/code-review.schema.ts` — source — schema module; exports: 
- `lib/ai-orchestrator/src/schemas/context.schema.ts` — source — schema module; exports: 
- `lib/ai-orchestrator/src/schemas/index.ts` — source — schema module; exports: 
- `lib/ai-orchestrator/src/schemas/scan.schema.ts` — source — schema module; exports: 
- `lib/ai-orchestrator/src/schemas/task.schema.ts` — source — schema module; exports: 
- `lib/ai-orchestrator/src/schemas/workflow.schema.ts` — source — schema module; exports: parseWorkflowPhases
- `lib/ai-orchestrator/src/tools/file-tools.ts` — source — source module; exports: escapeRegex, safePath, executeFileTool
- `lib/ai-orchestrator/src/tools/git-tools.ts` — source — source module; exports: safeGit, executeGitTool
- `lib/ai-orchestrator/tsconfig.json` — source — JSON config/data; keys: extends, compilerOptions, references, include
- `lib/ai-orchestrator/vitest.config.ts` — source — .ts
#### api-client-react/
- `lib/api-client-react/package.json` — source — package @workspace/api-client-react
- `lib/api-client-react/src/custom-fetch.ts` — source — source module; exports: setBaseUrl, setAuthTokenGetter, isRequest, resolveMethod, isUrl, applyBaseUrl
- `lib/api-client-react/src/generated/api.schemas.ts` — generated — generated source; exports: 
- `lib/api-client-react/src/generated/api.ts` — generated — generated source; exports: getGetHealthUrl, getHealth, getGetHealthQueryKey, getListProjectsUrl, listProjects, getListProjectsQueryKey
- `lib/api-client-react/src/index.ts` — source — source module; exports: 
- `lib/api-client-react/src/project-error.ts` — source — source module; exports: classifyProjectError, isRetryableProjectError, emitProjectLoadFailed
- `lib/api-client-react/tsconfig.json` — source — JSON config/data; keys: extends, compilerOptions, include
#### api-spec/
- `lib/api-spec/openapi.yaml` — source — OpenAPI spec; paths=54; schemas=77
- `lib/api-spec/orval.config.ts` — source — .ts
- `lib/api-spec/package.json` — source — package @workspace/api-spec; scripts: codegen
#### api-zod/
- `lib/api-zod/package.json` — source — package @workspace/api-zod
- `lib/api-zod/src/generated/api.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiApplyChangesRequest.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiApplyChangesRequestChangesItem.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiApplyChangesResult.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiApplyChangesResultResultsItem.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiChatMessage.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiChatMessageRole.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiChatOutput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiChatRequest.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiChatSession.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiCodeIssue.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiCodeIssueSeverity.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiCodeIssueType.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiCodeReview.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiCodeReviewVerdict.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiOrchestrateRequest.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiOrchestrationDecision.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiOrchestrationDecisionAction.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiPendingChange.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiReviewRequest.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiReviewRequestFileContents.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiScanAnalysis.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiScanInsight.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiScanInsightCategory.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/aiScanInsightSeverity.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/createProjectInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/createRuleInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/createTaskInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/createWorkflowInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/dashboardOverview.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItem.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItemTrend.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/dashboardOverviewTaskStatusBreakdown.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/dashboardOverviewTopRulesItem.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/deleteGroqKey200.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoveryGraphSummaryData.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoveryGraphSummaryDataEntitiesByType.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoveryGraphSummaryDataFilesByLanguage.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoveryOptions.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoveryReport.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoveryRuleViolationItem.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoverySessionStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoverySessionStatusStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoverySourceCapability.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoverySourceConfig.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoverySourceConfigCredentials.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoveryStepItem.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/discoveryStepItemStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/entityType.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/evaluateRuleRequest.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/event.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/eventPayload.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/eventSeverity.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/failWorkflowPhaseInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphEntityImpact404.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphEntityImpactParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphEntityNeighbors200.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphEntityNeighbors404.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphEvidence403.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphEvidence404.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphPathParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphRuntimeSubgraph403.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphRuntimeSubgraph404.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphSemanticNeighborhood400.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphSemanticNeighborhood403.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphSemanticNeighborhood404.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphSemanticNeighborhoodParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphSubgraph400.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphSubgraph403.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphSubgraph404.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getGraphSubgraphParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/getLatestMetricsParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphCentralityScore.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphEdgeType.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphEntity.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphEntityMetadata.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphEvidence.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphEvidenceBundle.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphEvidenceKind.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphEvidenceResponse.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphImpactHop.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphImpactResult.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphLayerCounts.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphPathResult.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphPathStep.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphProvenance.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphRelationship.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphRelationshipMetadata.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphRuntimeSubgraph.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphSemanticNeighborhood.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphSubgraph.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphSubgraphFilters.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphSubgraphLayered.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphSummary.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphSummaryEntitiesByType.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/graphSummaryRelationsByType.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/groqKeyStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/healthStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/healthStatusStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/importProjectInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/importProjectInputOverrides.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/index.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/listAiChatSessionsParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/listEventsParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/listGraphEntitiesParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/listGraphRelationshipsParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/listMetricsParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/listRulesParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/listTasksParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/listWorkflowsParams.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/metricRecord.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/metricRecordBuildStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/plugin.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/pluginCapabilitiesItem.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/pluginProjectRequest.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/project.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/projectStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/projectSummary.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/projectSummaryTaskCounts.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/rule.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/ruleEvaluationResult.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/ruleEvaluationResultMatchesItem.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/ruleSeverity.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/saveGroqKeyInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/scanJob.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/scanJobStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/scanResult.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/sourceType.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/startDiscoveryInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/task.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/taskLog.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/taskLogLevel.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/taskLogMetadata.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/taskPriority.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/taskStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/updateProjectInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/updateProjectInputStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/updateRuleInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/updateTaskInput.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/verificationResult.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/verificationResultStepsItem.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/workflow.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/workflowExecution.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/workflowPhase.ts` — generated — generated source; exports: 
- `lib/api-zod/src/generated/types/workflowStatus.ts` — generated — generated source; exports: 
- `lib/api-zod/src/index.ts` — source — source module; exports: 
- `lib/api-zod/src/truth-flow-matrix.schema.ts` — source — source module; exports: safeValidateTruthFlowMatrix, validateTruthFlowMatrix, assertTruthFlowMatrix, safeValidateCurrentTruthFlowMatrix, validateCurrentTruthFlowMatrix, assertCurrentTruthFlowMatrix
- `lib/api-zod/tsconfig.json` — source — JSON config/data; keys: extends, compilerOptions, include
#### db/
- `lib/db/drizzle.config.ts` — source — .ts
- `lib/db/package.json` — source — package @workspace/db; scripts: push, push-force
- `lib/db/src/index.ts` — source — source module; exports: 
- `lib/db/src/schema/ai_chats.ts` — source — schema module; exports: 
- `lib/db/src/schema/ai_provider_credentials.ts` — source — schema module; exports: 
- `lib/db/src/schema/audit_logs.ts` — source — schema module; exports: 
- `lib/db/src/schema/discovery.ts` — source — schema module; exports: 
- `lib/db/src/schema/events.ts` — source — schema module; exports: 
- `lib/db/src/schema/graph.ts` — source — schema module; exports: 
- `lib/db/src/schema/index.ts` — source — schema module; exports: 
- `lib/db/src/schema/metrics.ts` — source — schema module; exports: 
- `lib/db/src/schema/plugins.ts` — source — schema module; exports: 
- `lib/db/src/schema/projects.ts` — source — schema module; exports: 
- `lib/db/src/schema/rules.ts` — source — schema module; exports: 
- `lib/db/src/schema/scan_jobs.ts` — source — schema module; exports: 
- `lib/db/src/schema/task_logs.ts` — source — schema module; exports: 
- `lib/db/src/schema/tasks.ts` — source — schema module; exports: 
- `lib/db/src/schema/workflows.ts` — source — schema module; exports: 
- `lib/db/tsconfig.json` — source — JSON config/data; keys: extends, compilerOptions, include
#### knowledge-engine/
- `lib/knowledge-engine/package.json` — source — package @workspace/knowledge-engine; scripts: test, test:watch
- `lib/knowledge-engine/src/__tests__/inference.test.ts` — test — test file; approx test blocks: 14; exports: entity, rel
- `lib/knowledge-engine/src/__tests__/queries.test.ts` — test — test file; approx test blocks: 24; exports: insertProject, cleanupProject, seedChain
- `lib/knowledge-engine/src/index.ts` — source — source module; exports: 
- `lib/knowledge-engine/src/inference.ts` — source — source module; exports: computeCentrality, detectClusters, find, union, computeGraphSummary, rankEdgesByConfidence
- `lib/knowledge-engine/src/queries.ts` — source — source module; exports: buildProvenanceSummary, computeLayerStats, fetchOutgoing, fetchEntitiesByIds, getImpactedEntities, getShortestPath
- `lib/knowledge-engine/src/types.ts` — source — source module; exports: 
- `lib/knowledge-engine/tsconfig.json` — source — JSON config/data; keys: extends, compilerOptions, references, include
#### scanner/
- `lib/scanner/package.json` — source — package @workspace/scanner; scripts: test, test:watch, test:coverage
- `lib/scanner/src/__tests__/file-walker.test.ts` — test — test file; approx test blocks: 12; exports: 
- `lib/scanner/src/__tests__/graph-extractor.test.ts` — test — test file; approx test blocks: 41; exports: 
- `lib/scanner/src/__tests__/metrics-calc.test.ts` — test — test file; approx test blocks: 12; exports: 
- `lib/scanner/src/__tests__/rule-matcher.test.ts` — test — test file; approx test blocks: 10; exports: 
- `lib/scanner/src/file-walker.ts` — source — source module; exports: walkDir, walkProject
- `lib/scanner/src/graph-extractor.ts` — source — source module; exports: resolveRelativeImport, matchImportToEntity, dirname, pythonImportCandidates, matchPythonImportToEntity, classifyRelationType
- `lib/scanner/src/index.ts` — source — source module; exports: 
- `lib/scanner/src/metrics-calc.ts` — source — source module; exports: getDimension, computeTestCoverage, computeArchitectureScore, computeMetrics, clamp
- `lib/scanner/src/python-ast-script.py` — other — .py
- `lib/scanner/src/python-ast-script.ts` — source — source module; exports: 
- `lib/scanner/src/python-extractor.ts` — source — source module; exports: getScriptPath, extractPythonBatch
- `lib/scanner/src/rule-matcher.ts` — source — source module; exports: safeCompileRegex, countOccurrences, matchRule, matchRules, checkPatternInFiles
- `lib/scanner/tsconfig.json` — source — JSON config/data; keys: extends, compilerOptions, include
- `lib/scanner/vitest.config.ts` — source — .ts

### package.json/
- `package.json` — other — package workspace; scripts: preinstall, codegen, codegen:check, truth:validate

### pnpm-lock.yaml/
- `pnpm-lock.yaml` — other — YAML config

### pnpm-workspace.yaml/
- `pnpm-workspace.yaml` — other — YAML config

### replit.md/
- `replit.md` — other — EngineeringOS

### scripts/
#### check-codegen-drift.ts/
- `scripts/check-codegen-drift.ts` — script — .ts
#### package.json/
- `scripts/package.json` — other — package @workspace/scripts; scripts: hello, check-codegen-drift, validate-truth-flow, typecheck
#### post-merge.sh/
- `scripts/post-merge.sh` — script — Shell script
#### src/
- `scripts/src/hello.ts` — script — source module; exports: 
#### trigger-scan.mts/
- `scripts/trigger-scan.mts` — other — .mts
#### tsconfig.json/
- `scripts/tsconfig.json` — other — JSON config/data; keys: extends, compilerOptions, include
#### validate-truth-flow.ts/
- `scripts/validate-truth-flow.ts` — script — .ts
#### verify-setup.sh/
- `scripts/verify-setup.sh` — script — Shell script

### tsconfig.base.json/
- `tsconfig.base.json` — other — JSON config/data; keys: compilerOptions

### tsconfig.base.json.bak/
- `tsconfig.base.json.bak` — other — .bak

### tsconfig.json/
- `tsconfig.json` — other — JSON config/data; keys: extends, compileOnSave, files, references

## 5. Execution Flow Analysis

### Discovery flow
Entry: dashboard wizard → `POST /projects/discover` in `artifacts/api-server/src/routes/discovery.ts` → source adapter resolution in `lib/discovery-adapters.ts` → `walkProject` / `matchRules` / `extractGraph` / `computeMetrics` → discovery session update → project import and event/audit writes.

### Scan flow
Entry: project scan endpoint in `routes/projects.ts` → queued background scan job in `lib/job-queue.ts` → `lib/scan-runner.ts` performs file walk, rule matching, graph extraction, metrics, DB writes, events, audit, and cache invalidation.

### Chat flow
Entry: `POST /ai/chat` in `routes/ai.ts` → project ownership check and Groq key resolution → `buildProjectContext` → `chat()` agent → parse → persist chat session/messages → optional tool execution and pending changes queue → client apply step → cache invalidation.

### Task execution flow
Entry: task route in `routes/tasks.ts` → project ownership load → rule/file scanning or task execution logic → task logs + events + audit writes → dashboard refresh via generated client.

### Workflow advancement flow
Entry: workflow routes in `routes/workflows.ts` → workflow execution row load/update → AI orchestrator `orchestrateWorkflow()` / `validateDecision()` / `executeDecision()` → events and audit recording → client polling/update.

### Apply / commit flow
Entry: AI apply endpoint in `routes/ai.ts` and Git endpoints in `routes/git.ts` → safe-path validation or Git command execution → file writes / git commit / push → audit and refresh invalidation. The code clearly separates proposed changes from applied changes.

### Error / retry / refresh flow
The runtime consistently favors fail-closed validation and fail-open job cleanup: Groq requests retry only for transient failures; scan jobs and discovery sessions are reconciled on startup; invalid workflow transitions are downgraded to wait; ownership failures return deterministic HTTP errors; the dashboard invalidates query caches after mutating operations.

## 6. Documentation Gap Analysis

The repository contains a large amount of design and forensic documentation, but several docs are historical snapshots rather than authoritative runtime truth. The code itself is more authoritative than the prose in these files.

| Doc family | What it appears to claim | What the code currently shows | Status |
|---|---|---|---|
| `docs/completion-plan.md`, `docs/fact-record.md` | phased hardening and closed gaps | many of the listed hardening measures are present in current code: ownership scoping, audit actor propagation, context cache invalidation, startup job reconciliation, generated contract drift checks | mostly aligned, but historical and cumulative
| `docs/ai-orchestrator-*` | trace analysis and gap closure for AI layer | AI layer code reflects a hardened design: prompt/schema separation, fallback parsing, tool wrappers, context cache, circuit breaker, ownership checks | broadly aligned
| `docs/PR_BACKLOG.md`, `docs/pr-backlog-ai-orchestrator.md` | execution backlog | backlog is useful but some items are already implemented in code; needs regular pruning against current source | partly stale
| `docs/PLACEHOLDER_REGISTER.md` | known placeholder inventory | placeholder-like markers still exist in the UI and discovery adapter layer, so the register still has live relevance | still relevant

## 7. Code Quality Assessment

Strengths:
The code uses strict schemas, explicit ownership checks, bounded retries, safe path handling, SQL query scoping, startup reconciliation, and typed generated clients. There is a strong bias toward making state transitions explicit and traceable.

Weaknesses:
There are still placeholder/stub areas, especially in discovery adapters and some dashboard/UI controls. The generated surface is large, which makes drift a maintenance risk. Several large files coordinate multiple responsibilities, which raises coupling even when the logic is correct.

Antipatterns and debt signals observed directly in the code:
single-file orchestration modules that combine validation, persistence, and event emission; placeholder UI text; coming-soon adapter stubs; cached context that requires careful invalidation; and generated artifacts that must be kept in lockstep with the OpenAPI source.

## 8. Technical Debt Report

1. Discovery feature breadth is incomplete: `ARCHIVE_UPLOAD`, `REMOTE_FILESYSTEM`, and `DOCKER_VOLUME` adapters are explicitly stubbed as coming soon.
2. UI polish debt remains: placeholder text and helper copy exist in several dashboard components and generated UI primitives.
3. Contract drift risk remains high because generated clients/schemas are numerous and must stay synchronized with `openapi.yaml`.
4. AI context freshness depends on invalidation discipline; stale context is a real failure mode if a mutation forgets to bust the cache.
5. Some route modules are large and multi-purpose, which makes ownership, event emission, and audit consistency harder to maintain.

## 9. Completion Assessment

| Area | Completion estimate | Why |
|---|---:|---|
| API contract + codegen | 90% | OpenAPI, generated Zod/client surfaces, drift checks, and runtime integration all exist.
| DB/persistence | 90% | Broad schema coverage and a unified DB entrypoint exist; data model is substantial.
| Scanner | 82% | File walking, matching, extraction, metrics, provenance, and Python AST parsing are implemented; some source adapters and heuristics remain partial.
| Knowledge-engine | 85% | Query and inference layers are present and pure; this layer looks structurally mature.
| AI orchestrator | 85% | Context builder, parsing, prompts, tool wrappers, and agents exist; freshness and prompt discipline are still critical constraints.
| API runtime | 83% | Routes, auth, ownership, jobs, plugins, Git, and AI orchestration are all wired; breadth is good and hardening is ongoing.
| Dashboard | 78% | The app shell and major pages exist; several components still show placeholders and depend heavily on generated client stability.
| Documentation/governance | 80% | There is a lot of governance material, but it includes historical and partially stale snapshots that must be reconciled with code.

## 10. Risk Assessment

Highest-risk areas:
1. Freshness and consistency of AI context under concurrent mutation.
2. Discovery adapter incompleteness for non-local/non-git source types.
3. Contract drift between source OpenAPI and generated client/schema outputs.
4. Multi-responsibility route modules that can silently diverge in event/audit behavior.
5. Placeholder UI and stubbed adapters creating a false sense of completion.

## 11. Missing Components

The codebase still lacks full implementations for several advertised discovery source types, and some UI/service surfaces are intentionally partial. The main missing items visible in code are: full archive-upload discovery flow, remote filesystem discovery flow, Docker volume discovery flow, more exhaustive semantic/provenance enrichment in some graph paths, and full removal of placeholder copy in the dashboard.

## 12. Development Roadmap

Suggested order from the current code state:
1. Close discovery adapter stubs and the corresponding UI/validation paths.
2. Harden AI context freshness and mutation-to-refresh guarantees everywhere mutating state can change.
3. Keep contract generation drift-free by treating OpenAPI and generated outputs as a single unit.
4. Tighten dashboard placeholder surfaces and any remaining partial UI behaviors.
5. Expand graph/provenance depth and knowledge-engine semantics once the core flows are stable.

## 13. PR Backlog

| PR | Focus | Main files | Acceptance criteria |
|---|---|---|---|
| PR-01 | Discovery adapter completion | `artifacts/api-server/src/lib/discovery-adapters.ts`, `routes/discovery.ts`, discovery wizard UI | all source types resolve or fail with explicit reason; no silent stub paths remain in user-visible flows |
| PR-02 | AI freshness guarantees | `lib/ai-orchestrator/src/context-builder.ts`, `artifacts/api-server/src/routes/ai.ts`, relevant mutation paths | every write invalidates the right cache and emits a traceable event/audit record |
| PR-03 | UI placeholder cleanup | dashboard pages/components with placeholder copy | user-facing placeholders removed or converted into deliberate empty states |
| PR-04 | Contract drift tightening | `lib/api-spec/openapi.yaml`, generated outputs, drift scripts | generated clients/schemas always match the spec and CI blocks drift |
| PR-05 | Graph/provenance enrichment | scanner, knowledge-engine, graph routes | runtime graph evidence and provenance are more complete and consistently surfaced |

## 14. Final Engineering Verdict

EngineeringOS is already a real system with a real contract layer, persistence layer, scan pipeline, AI orchestration layer, and UI. It is not a blank scaffold.
The remaining work is primarily about removing the partial/placeholder edges, keeping generated contracts synchronized, and tightening freshness and traceability so the platform cannot lie about its own state.
From a structural standpoint, the strongest core is the combination of `scanner` + `knowledge-engine` + `ai-orchestrator` + `api-server`; the largest operational risk is stale or incomplete state crossing between those layers.

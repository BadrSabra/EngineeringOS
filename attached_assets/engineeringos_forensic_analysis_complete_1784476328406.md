# EngineeringOS — التحليل الهندسي الجنائي الشامل

هذا التقرير مبني على **فحص ساكن كامل للأرشيف المرفوع**. الكود هو المرجع الأساسي للحقيقة، وتم استخدام الوثائق والأصول فقط للمقارنة والتحقق وكشف الدَّرْفْت التاريخي.

- إجمالي الملفات داخل الأرشيف: **703**
- ملفات الكود/التنفيذ/الاختبارات: **425**
- ملفات الكود المصدر (TS/TSX/MTS/MJS/PY): **245**
- ملفات التوليد (`generated` و `.generated`): **148**
- ملفات الاختبار: **32**
- ملفات الوثائق Markdown: **110**
- ملفات الأصول/البيانات: **113**
- ملفات الإعداد/التهيئة: **49**
- ملفات الذاكرة/المذكرات الداخلية: **32**

## 1. Executive Summary

المشروع ليس scaffold فارغًا؛ بل يضم بالفعل منظومة متكاملة نسبيًا تتكون من:
- `lib/api-spec` كمصدر عقد API الأولي (`openapi.yaml`) مع Orval codegen.
- `lib/api-zod` و `lib/api-client-react` كطبقتي توليد للعقود والعميل.
- `lib/db` كمخطط Drizzle/PostgreSQL فعلي.
- `lib/scanner` كـ file-walker / rule matcher / graph extractor / metrics calculator.
- `lib/knowledge-engine` كطبقة queries/inference فوق graph tables.
- `lib/ai-orchestrator` كغلاف Groq + context builder + prompts + agents + tools + parsing.
- `artifacts/api-server` كخادم Express مع auth/ownership/audit/jobs/routes.
- `artifacts/dashboard` كواجهة React/Vite تضم صفحات المشاريع/الاستكشاف/المهام/القواعد/السير/graph/metrics/AI.
- `artifacts/mockup-sandbox` كساحة UI منفصلة.

أهم النتائج البنيوية:
1. توجد **مجازفة drift** حقيقية بين OpenAPI والـ routes: رُصدت **10 endpoints** في الكود غير موجودة في `openapi.yaml`، بينما لا توجد endpoints موصوفة في الـ spec وغير موجودة في التنفيذ.
2. طبقة discovery حقيقية لكنها **غير مكتملة** في بعض source types: `ARCHIVE_UPLOAD` و`REMOTE_FILESYSTEM` و`DOCKER_VOLUME` ما تزال stubs صريحة في `discovery-adapters.ts` و/أو واجهة discovery.
3. طبقة AI orchestration ناضجة بنيويًا لكنها حساسة لـ **context freshness**, parsing fallback, وbounded retries.
4. لا يظهر من التحليل الساكن وجود كود داخلي “يتيم” غير مستورد داخل الحزم الأساسية؛ جميع ملفات التنفيذ تقريبًا إما entrypoints أو barrels أو مستوردة ضمن الجراف الداخلي.
5. عدد الملفات الفعلي في الأرشيف (**762**) أكبر بكثير من أرقام بعض الوثائق التاريخية (مثل fact-record الذي يذكر 427)، ما يعني أن جزءًا من الوثائق أصبح **historical snapshot** لا يطابق حالة الأرشيف الحالية.

## 2. System Architecture

| الطبقة / الحزمة | الدور الحقيقي | الدليل من الكود |
|---|---|---|
| `lib/api-spec` | مصدر العقد وcodegen entrypoint | `openapi.yaml`, `orval.config.ts`, `package.json` |
| `lib/api-zod` | Zod schemas المولدة | `src/generated/*` |
| `lib/api-client-react` | React Query client المولد | `src/generated/*`, `custom-fetch.ts` |
| `lib/db` | Drizzle schema + DB bootstrap | `src/schema/*`, `src/index.ts` |
| `lib/scanner` | تحليل الملفات وبناء graph | `file-walker.ts`, `rule-matcher.ts`, `graph-extractor.ts`, `metrics-calc.ts`, `python-extractor.ts` |
| `lib/knowledge-engine` | queries + inference على graph | `queries.ts`, `inference.ts`, `types.ts` |
| `lib/ai-orchestrator` | provider gateway + prompts + agents + tools | `groq-client.ts`, `context-builder.ts`, `agents/*`, `tools/*`, `schemas/*` |
| `artifacts/api-server` | Express runtime | `app.ts`, `index.ts`, `routes/*`, `middlewares/*`, `lib/*` |
| `artifacts/dashboard` | React dashboard | `App.tsx`, `pages/*`, `components/*` |
| `artifacts/mockup-sandbox` | sandbox/UI preview | `App.tsx`, `.generated/*` |
| `scripts` | governance and drift gates | `validate-truth-flow.ts`, `check-codegen-drift.ts`, `trigger-scan.mts` |

### Package dependency graph
- `@workspace/api-server` → `@workspace/db`: 33 import site(s)
- `@workspace/dashboard` → `@workspace/api-client-react`: 11 import site(s)
- `@workspace/api-server` → `@workspace/api-zod`: 9 import site(s)
- `@workspace/api-server` → `@workspace/scanner`: 6 import site(s)
- `@workspace/api-server` → `@workspace/ai-orchestrator`: 4 import site(s)
- `@workspace/knowledge-engine` → `@workspace/db`: 3 import site(s)
- `@workspace/ai-orchestrator` → `@workspace/db`: 2 import site(s)
- `@workspace/api-server` → `@workspace/api-client-react`: 1 import site(s)
- `@workspace/api-server` → `@workspace/knowledge-engine`: 1 import site(s)
- `@workspace/scripts` → `@workspace/db`: 1 import site(s)
- `@workspace/scripts` → `@workspace/scanner`: 1 import site(s)
- `@workspace/scripts` → `@workspace/api-zod`: 1 import site(s)

### Top-level directory distribution
- `lib`: 236 file(s)
- `artifacts`: 217 file(s)
- `attached_assets`: 183 file(s)
- `.agents`: 33 file(s)
- `docs`: 14 file(s)
- `scripts`: 8 file(s)
- `.gitattributes`: 1 file(s)
- `.gitignore`: 1 file(s)
- `.npmrc`: 1 file(s)
- `.replit`: 1 file(s)
- `.replitignore`: 1 file(s)
- `package.json`: 1 file(s)
- `pnpm-lock.yaml`: 1 file(s)
- `pnpm-workspace.yaml`: 1 file(s)
- `replit.md`: 1 file(s)
- `tsconfig.base.json`: 1 file(s)
- `tsconfig.base.json.bak`: 1 file(s)
- `tsconfig.json`: 1 file(s)

## 3. Layer-by-Layer Analysis

### Contract / codegen layer
`lib/api-spec/openapi.yaml` هو المصدر العقدي المركزي. منه تُولَّد `lib/api-zod/src/generated/*` و`lib/api-client-react/src/generated/*` عبر Orval. الكود الجاهز يثبت أن contract-first ليس ادعاءً؛ إنه جزء من سلسلة البناء الفعلية.

### Persistence layer
`lib/db/src/schema/*.ts` يعرّف الجداول الفعلية: projects, rules, workflows, tasks, task_logs, events, metrics, graph_entities, graph_relationships, plugins, audit_logs, discovery_sessions, scan_jobs, ai_chat_sessions, ai_chat_messages, ai_provider_credentials. `lib/db/src/index.ts` يربط Drizzle بـ `DATABASE_URL` ويُصدر `db` و`pool`.

### Scanner layer
`lib/scanner` ينفذ مسار التحليل البنيوي: walk → rule match → graph extract → metrics. وجود `python-ast-script.py`/`.ts` يثبت أن تحليل Python ليس regex-only؛ هناك bridge إلى AST فعلي.

### Knowledge engine
`lib/knowledge-engine` يقدّم queries pure على graph المخزّن، مع inference في الذاكرة (centrality, cluster detection, layered summaries). هذه الطبقة لا تكتب في DB.

### AI orchestration
`lib/ai-orchestrator` طبقة ناضجة بنيويًا: Groq gateway، parsing/validation، context builder، five agents، prompt builders، file/git tools. هي القلب الذكي للمنظومة، لكنها تعتمد بشدة على صلاحية السياق ووضوح الـ prompt والـ schema.

### API/runtime
`artifacts/api-server` يجمع auth, ownership scoping, audit, queueing, startup reconciliation, route orchestration, discovery/scan, graph, tasks, workflows, metrics, AI, plugins, git. هذا ليس proxy رقيقًا؛ بل runtime coordinator.

### Presentation
`artifacts/dashboard` يقدّم shell/router و16 صفحة أساسية تقريبًا للـ projects/discovery/tasks/rules/workflows/events/metrics/graph/AI. UI مكتمل وظيفيًا أكثر منه بصريًا، لكن توجد placeholder strings وبعض أسطح تحتاج صقلًا.

## 4. File-by-File Analysis

تم تضمين **كل ملف** في الأرشيف في الملحق التالي، مصنّفًا حسب المجلد الأعلى. لكل ملف سطر واحد يبيّن النوع، الدور الحقيقي، حالة الاستخدام، والاعتماديات الداخلية الأبرز.

### `.agents/`
- `.agents/agent_assets_metadata.toml` — agent-metadata; role: agent metadata; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/MEMORY.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/ai-orchestrator-gap-closure.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Gaps verified as already correct (false positives in executive table)
- `.agents/memory/ai-orchestrator-hardening.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/ai-orchestrator-layer.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: AI Orchestration Layer
- `.agents/memory/ai-tool-calling.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Architecture
- `.agents/memory/audit-fixes.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/clerk-401-race-cookie-vs-bearer.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/clerk-auth-testing.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/completion-plan-stale-backlog.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/context-cache-invalidation-rule.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Context cache invalidation rule
- `.agents/memory/dashboard-scoping-pr01.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Dashboard scoping — PR-01
- `.agents/memory/discovery-adapter-registry.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/discovery-feature.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Rule: rootPath must be validated before discovery starts
- `.agents/memory/discovery-multi-source.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Rule
- `.agents/memory/drizzle-error-wrapping.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/engineeringos-completion-plan.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/fk-atomic-claim-ordering.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/gap-analysis-fixes-batch1.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: G-01 — Task priority query (context-builder.ts)
- `.agents/memory/gap-analysis-fixes-batch2.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: G-11 — Context cache (context-builder.ts)
- `.agents/memory/git-ai-orchestrator-fixes.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Fixed bugs (from uploaded analysis doc)
- `.agents/memory/imported-project-clerk-secrets.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/imported-project-workflow-failures.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/knowledge-engine-bfs-depth.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/knowledge-engine.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Knowledge Engine Package
- `.agents/memory/orval-openapi-codegen.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/pr02-provenance-layer.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Rule
- `.agents/memory/pr04-discovery-hardening.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Discovery resolution hardening
- `.agents/memory/project-bootstrap.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Post-import bootstrap (EngineeringOS)
- `.agents/memory/project-ownership-scoping.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Project Ownership / Access-Scope Model
- `.agents/memory/scanner-ast-extraction.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/testing-drift-checks.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium
- `.agents/memory/trace-analysis.md` — memory-doc; role: memory note / persistent analysis memo; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: What was done

### `artifacts/`
- `artifacts/api-server/.replit-artifact/artifact.toml` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/api-server/build.mjs` — code; role: supporting file; status: entrypoint; depends on: —; depended by: 0; importance: medium; confidence: high
- `artifacts/api-server/package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/api-server/src/app.ts` — code; role: Express app bootstrap; status: imported by runtime code; depends on: —; depended by: 1; importance: high; confidence: high
- `artifacts/api-server/src/config.ts` — code; role: runtime config; status: imported by runtime code; depends on: —; depended by: 1; importance: high; confidence: high
- `artifacts/api-server/src/index.ts` — code; role: server process entrypoint; status: entrypoint; depends on: artifacts/api-server/src/app.ts, artifacts/api-server/src/config.ts, artifacts/api-server/src/lib/job-reconciliation.ts; depended by: 0; importance: high; confidence: high
- `artifacts/api-server/src/lib/.gitkeep` — other; role: server-side service / helper; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/lib/audit.ts` — code; role: server-side service / helper; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/lib/credentials-crypto.ts` — code; role: server-side service / helper; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/lib/discovery-adapters.test.ts` — test; role: server-side service / helper; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/lib/discovery-adapters.ts` — code; role: server-side service / helper; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/lib/graph-provenance.ts` — code; role: server-side service / helper; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/lib/job-queue.test.ts` — test; role: server-side service / helper; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/lib/job-queue.ts` — code; role: server-side service / helper; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/lib/job-reconciliation.test.ts` — test; role: server-side service / helper; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/lib/job-reconciliation.ts` — code; role: server-side service / helper; status: imported by runtime code; depends on: —; depended by: 1; importance: high; confidence: high
- `artifacts/api-server/src/lib/logger.ts` — code; role: server-side service / helper; status: imported by runtime code; depends on: —; depended by: 2; importance: high; confidence: high
- `artifacts/api-server/src/lib/path-validation.test.ts` — test; role: server-side service / helper; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/lib/path-validation.ts` — code; role: server-side service / helper; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/lib/plugin-runtime.test.ts` — test; role: server-side service / helper; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/lib/plugin-runtime.ts` — code; role: server-side service / helper; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/lib/project-error.test.ts` — test; role: server-side service / helper; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/lib/scan-runner.ts` — code; role: server-side service / helper; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/lib/startup-migrations.ts` — code; role: server-side service / helper; status: imported by runtime code; depends on: artifacts/api-server/src/lib/logger.ts; depended by: 1; importance: high; confidence: high
- `artifacts/api-server/src/middlewares/.gitkeep` — other; role: Express middleware; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` — code; role: Express middleware; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/middlewares/requireAuth.test.ts` — test; role: Express middleware; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/middlewares/requireAuth.ts` — code; role: Express middleware; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/middlewares/requireProjectAccess.ts` — code; role: Express middleware; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/ai.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/ai.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/dashboard.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/dashboard.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/discovery.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/discovery.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/events.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/events.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/git.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/graph.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/graph.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/health.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/health.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/index.ts` — code; role: server process entrypoint; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: high
- `artifacts/api-server/src/routes/metrics.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/metrics.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/plugins.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/plugins.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/projects.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/projects.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/rules.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/rules.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/tasks.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/tasks.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/routes/workflows.test.ts` — test; role: HTTP route handler; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `artifacts/api-server/src/routes/workflows.ts` — code; role: HTTP route handler; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/scripts/seed-provenance.ts` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/src/types/express.d.ts` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/api-server/tsconfig.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/api-server/vitest.config.ts` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/.replit-artifact/artifact.toml` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/components.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/index.html` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/public/favicon.svg` — asset/data; role: supporting file; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .svg
- `artifacts/dashboard/public/logo.svg` — asset/data; role: supporting file; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .svg
- `artifacts/dashboard/public/robots.txt` — asset/data; role: supporting file; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `artifacts/dashboard/src/App.tsx` — code; role: frontend router / app shell; status: imported by runtime code; depends on: —; depended by: 1; importance: medium; confidence: high
- `artifacts/dashboard/src/components/GitPanel.tsx` — code; role: dashboard component; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/layout/Shell.tsx` — code; role: layout shell component; status: leaf/support; depends on: artifacts/dashboard/src/components/layout/Sidebar.tsx; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/layout/Sidebar.tsx` — code; role: layout shell component; status: imported by runtime code; depends on: —; depended by: 1; importance: high; confidence: high
- `artifacts/dashboard/src/components/ui/accordion.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/alert-dialog.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/alert.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/aspect-ratio.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/avatar.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/badge.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/breadcrumb.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/button-group.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/button.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/calendar.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/card.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/carousel.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/chart.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/checkbox.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/collapsible.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/command.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/context-menu.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/dialog.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/drawer.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/dropdown-menu.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/empty.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/field.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/form.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/hover-card.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/input-group.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/input-otp.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/input.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/item.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/kbd.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/label.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/menubar.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/navigation-menu.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/pagination.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/popover.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/progress.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/radio-group.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/resizable.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/scroll-area.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/select.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/separator.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/sheet.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/sidebar.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/skeleton.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/slider.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/sonner.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/spinner.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/switch.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/table.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/tabs.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/textarea.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/toast.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/toaster.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/toggle-group.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/toggle.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/components/ui/tooltip.tsx` — code; role: UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/hooks/use-mobile.tsx` — code; role: React hook; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/src/hooks/use-toast.ts` — code; role: React hook; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/src/index.css` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/src/lib/clerk.ts` — code; role: dashboard helper; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/src/lib/utils.ts` — code; role: dashboard helper; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/src/main.tsx` — code; role: frontend entrypoint; status: entrypoint; depends on: artifacts/dashboard/src/App.tsx; depended by: 0; importance: medium; confidence: high
- `artifacts/dashboard/src/pages/AiChat.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/Dashboard.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — code; role: React page; status: imported by runtime code; depends on: —; depended by: 1; importance: high; confidence: high
- `artifacts/dashboard/src/pages/Events.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/Graph.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/Landing.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/Metrics.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/ProjectDetail.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/Projects.tsx` — code; role: React page; status: leaf/support; depends on: artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/Rules.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/SignIn.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/SignUp.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/Tasks.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/Workflows.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/src/pages/not-found.tsx` — code; role: React page; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `artifacts/dashboard/tsconfig.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/dashboard/vite.config.ts` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/.replit-artifact/artifact.toml` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/components.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/index.html` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/mockupPreviewPlugin.ts` — code; role: supporting file; status: imported by runtime code; depends on: —; depended by: 1; importance: medium; confidence: high
- `artifacts/mockup-sandbox/package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/.generated/mockup-components.ts` — generated-code; role: generated mockup component surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: medium; confidence: high; generated output
- `artifacts/mockup-sandbox/src/App.tsx` — code; role: sandbox app shell; status: imported by runtime code; depends on: artifacts/mockup-sandbox/src/.generated/mockup-components.ts; depended by: 1; importance: medium; confidence: high
- `artifacts/mockup-sandbox/src/components/ui/accordion.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/alert.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/avatar.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/badge.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/button-group.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/button.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/calendar.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/card.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/carousel.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/chart.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/checkbox.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/collapsible.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/command.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/context-menu.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/dialog.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/drawer.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/empty.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/field.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/form.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/hover-card.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/input-group.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/input-otp.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/input.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/item.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/kbd.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/label.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/menubar.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/pagination.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/popover.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/progress.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/radio-group.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/resizable.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/select.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/separator.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/sheet.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/sidebar.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/skeleton.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/slider.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/sonner.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/spinner.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/switch.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/table.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/tabs.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/textarea.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/toast.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/toaster.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/toggle.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/components/ui/tooltip.tsx` — code; role: sandbox UI primitive; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/hooks/use-mobile.tsx` — code; role: sandbox hook; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/hooks/use-toast.ts` — code; role: sandbox hook; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/index.css` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/lib/utils.ts` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/src/main.tsx` — code; role: sandbox entrypoint; status: entrypoint; depends on: artifacts/mockup-sandbox/src/App.tsx; depended by: 0; importance: medium; confidence: high
- `artifacts/mockup-sandbox/tsconfig.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `artifacts/mockup-sandbox/vite.config.ts` — code; role: supporting file; status: leaf/support; depends on: artifacts/mockup-sandbox/mockupPreviewPlugin.ts; depended by: 0; importance: medium; confidence: medium

### `attached_assets/`
- `attached_assets/ENGINEERINGOS_EXECUTION_ALIGNMENT_REPORT_1784147505317.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Execution Alignment Report
- `attached_assets/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION(2)_(2)_1784143389784.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION
- `attached_assets/ENGINEERINGOS_PLACEHOLDER_REGISTER_1784147505353.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Placeholder Register
- `attached_assets/ENGINEERINGOS_RUNTIME_EXECUTION_MATRIX_1784147505400.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Runtime Execution Matrix
- `attached_assets/EngineeringOS_Audit_Report_1783641389270.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — تقرير تدقيق فني نهائي
- `attached_assets/EngineeringOS_Audit_Report_Expanded_1783642792349.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Technical Audit Report
- `attached_assets/EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — التقرير الموحّد المتعمّق
- `attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430324.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430371.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Engineering Truth Verification
- `attached_assets/EngineeringOS_Execution_Plan_1783831261195.pdf` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .pdf
- `attached_assets/EngineeringOS_Executive_Build_Directive_v1_1783912619169.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — وثيقة تنفيذية للبناء
- `attached_assets/EngineeringOS_File_Inventory_Complete(1)_1783706911845.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — فهرس الملفات الكامل
- `attached_assets/EngineeringOS_File_by_File_Fact_Record_1783725698283.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — سجل حقيقة منظّم ملفًا ملفًا
- `attached_assets/EngineeringOS_Implementation_Document_1783726156016.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — وثيقة التنفيذ التفصيلية للمشروع
- `attached_assets/EngineeringOS_Master_Truth_Register_(1)_1784077194501.xlsx` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .xlsx
- `attached_assets/EngineeringOS_Plan_1783818095882.pdf` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .pdf
- `attached_assets/EngineeringOS_Project_1783718452179.pdf` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .pdf
- `attached_assets/EngineeringOS_Truth_Flow_Matrix.schema_1784143389669.ts` — code; role: historical evidence / exported artifact; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389833.json` — config/doc; role: historical evidence / exported artifact; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389882.ts` — code; role: historical evidence / exported artifact; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/EngineeringOS_Truth_Flow_PR_Checklist_1784143389929.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Truth Flow Matrix — PR-ready Checklist
- `attached_assets/EngineeringOS_Truth_Register_Full_(1)_1784081699025.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_Truth_Register_Full_1784081611461.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_(1)_1784081698974.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Truth Register + Critical PR Roadmap
- `attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_1784081611536.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Truth Register + Critical PR Roadmap
- `attached_assets/EngineeringOS_analysis_report(2)_(1)_1784047036210.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — تحليل شامل للملفّات والطبقات
- `attached_assets/EngineeringOS_api_zod_index_export_diff_1784143389744.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/EngineeringOS_architecture_analysis_report_1784040976647.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — التحليل المعماري الشامل للأرشيف
- `attached_assets/EngineeringOS_archive_entries_1784040976692.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_archive_entries_1784041152876.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_code_deep_analysis_1784052671648.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Code Deep Analysis
- `attached_assets/EngineeringOS_code_deep_analysis_1784052762652.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Code Deep Analysis
- `attached_assets/EngineeringOS_current_analysis_report_1784052671601.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — التحليل الشامل الحالي للأرشيف
- `attached_assets/EngineeringOS_current_analysis_report_1784052762572.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — التحليل الشامل الحالي للأرشيف
- `attached_assets/EngineeringOS_deep_analysis_report_1783800987828.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Deep Analysis Report
- `attached_assets/EngineeringOS_deep_dive_analysis_v2_1784152351310.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Deep Dive Analysis v2
- `attached_assets/EngineeringOS_deepest_analysis_report(1)_(2)_1784154247108.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Deepest Analysis Report
- `attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081611576.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Deepest Structural Analysis
- `attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081699061.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Deepest Structural Analysis
- `attached_assets/EngineeringOS_file_inventory_(1)_1783729892809.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_file_inventory_current_1784052671527.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_file_inventory_current_1784052762450.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_file_inventory_full(2)_1783988496247.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_file_inventory_full_1783800987783.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_file_inventory_v2_1784427571850.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_file_inventory_v2_1784427972718.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427571793.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Forensic Engineering Analysis
- `attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427972668.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Forensic Engineering Analysis
- `attached_assets/EngineeringOS_full_analysis_report_1783988496190.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — التحليل الشامل للمشروع
- `attached_assets/EngineeringOS_full_file_inventory(1)_1784040976594.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_full_file_inventory(1)_1784041152926.csv` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .csv
- `attached_assets/EngineeringOS_minimum_path_to_vision_(1)_1783830867380.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — استخراج المشروع والحد الأدنى للوصول إلى الرؤية
- `attached_assets/EngineeringOS_minimum_path_to_vision_1783830816710.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — استخراج المشروع والحد الأدنى للوصول إلى الرؤية
- `attached_assets/EngineeringOS_operational_status_record_1783912104506.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: السجل التشغيلي الرسمي — الاستيراد / البنية / التشغيل
- `attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — تقرير تحليل المشروع وخطة الاستكمال
- `attached_assets/EngineeringOS_provenance_registry_linked_1783911530593.json` — config/doc; role: historical evidence / exported artifact; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/EngineeringOS_provenance_registry_seed_1783911530658.json` — config/doc; role: historical evidence / exported artifact; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/EngineeringOS_replit_execution_directive_1783800987701.json` — config/doc; role: historical evidence / exported artifact; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/EngineeringOS_replit_execution_directive_1783800987743.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Execution Directive for Replit Agent
- `attached_assets/EngineeringOS_series14_truth_matrix_1783966531635.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 14
- `attached_assets/EngineeringOS_series15_deep_evidence_1783966531578.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 15
- `attached_assets/EngineeringOS_series16_truth_matrix_(1)_1783966531512.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 16
- `attached_assets/EngineeringOS_series17_deep_analysis_1783966531444.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 17: التحليل العميق بالأدلة من داخل الكود والملفات
- `attached_assets/EngineeringOS_series18_status_register_(1)_1783966531375.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 18: سجل حالة طبقي بالأدلة من داخل الكود والملفات
- `attached_assets/EngineeringOS_series19_control_plane_evidence_1783966531303.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 19: أدلة التحكم التشغيلي والطبقة الذاتية التحقق
- `attached_assets/EngineeringOS_series20_status_register_1783966531239.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 20
- `attached_assets/EngineeringOS_series21_deep_status_1783966531177.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 21
- `attached_assets/EngineeringOS_series22_second_wave_analysis_1783966531113.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 22
- `attached_assets/EngineeringOS_series23_self_verifying_architecture_1783966531049.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 23: البنية الذاتية التحقق والأدلة التشغيلية
- `attached_assets/EngineeringOS_series24_deep_evidence_1783966530990.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة التالية: تحليل عميق بالأدلة من داخل الكود والملفات
- `attached_assets/EngineeringOS_series25_truth_register_1783966530939.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 25: سجل حالة طبقي بالأدلة من داخل الكود والملفات
- `attached_assets/EngineeringOS_series26_boundary_analysis_1783966530884.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 26
- `attached_assets/EngineeringOS_series27_failure_semantics_1783966530824.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 27
- `attached_assets/EngineeringOS_series28_traceability_mesh_1783966530766.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 28: شبكة التتبّع، الحالة، والحوكمة التشغيلية
- `attached_assets/EngineeringOS_series29_trust_boundary_register_1783966530702.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — سلسلة 29: سجل حدود الثقة والحوكمة
- `attached_assets/EngineeringOS_series30_release_handoff_audit_1783966530642.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 30
- `attached_assets/EngineeringOS_series31_release_handoff_audit_1783966530586.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 31: تدقيق تسليم وتشغيل
- `attached_assets/EngineeringOS_series32_phase_conformance_audit_1783966530537.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 32: تدقيق الالتزام بالخطة المرحلية
- `attached_assets/EngineeringOS_series33_provenance_authority_graph_1783966530470.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — السلسلة 33: خريطة السلطة والتتبّع (Provenance Authority Graph)
- `attached_assets/EngineeringOS_status_record_(1)_1783980758791.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: سجل الحالة الرسمي لمشروع EngineeringOS
- `attached_assets/EngineeringOS_status_register_(1)_1783818095824.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: سجل الحالة الرسمي — EngineeringOS
- `attached_assets/EngineeringOS_status_register_final_1783902107873.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — سجل حالة رسمي نهائي
- `attached_assets/EngineeringOS_task_backlog_1783800987875.json` — config/doc; role: historical evidence / exported artifact; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/EngineeringOS_truth_checklist_1784322972343.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Checklist مراجعة نهائية — تثبيت الحقيقة المرجعية
- `attached_assets/EngineeringOS_truth_checklist_1784326108247.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: Checklist مراجعة نهائية — تثبيت الحقيقة المرجعية
- `attached_assets/EngineeringOS_truth_register_current_1783825680736.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — سجل حقيقة تشغيلي مُحدّث
- `attached_assets/Engineering_Os_Fact_Record_1783718570175.pdf` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .pdf
- `attached_assets/Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .pdf
- `attached_assets/Engineering_Os_Phased_Completion_Plan_1783718452216.pdf` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .pdf
- `attached_assets/Pasted---1783906604381_1783906604385.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted---1783956390496_1783956390501.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted---1784163447147_1784163447161.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted---1784163799356_1784163799366.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted---1784230995192_1784230995203.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted---1784231528183_1784231528198.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted---1784232069146_1784232069153.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted---1784348446604_1784348446608.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted---1784389595241_1784389595255.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--1--1784078393552_1784078393558.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--Backlog-Execution-Backlog-v1-0--1783975284276_1783975284279.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--Code-Review-Plan-Groq-Scope-Save-API--1784175594438_1784175594440.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--Discovery-Layer--1783988471815_1783988471818.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--EngineeringOS--1784145653787_1784145653789.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784168_1784168977036.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784169_1784169315352.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784154335102.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784155079326.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--GROQ-API-KEY-JavaScript-Groq--1784088277237_1784088277243.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--Git-AI-Orchestrator-lib-ai-orchestrator-src-tools-git-_1784347517831.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--Knowledge-Graph-2-0--1784165514922_1784165514926.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--Knowledge-Graph-2-0-Checklist-File--1784165546932_1784165546935.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR--1784040954263_1784040954267.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-01-Sync-OpenAPI-with-runtime-graph-surface-files-li_1784234215782.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-03-Micro-Backlog-Contract-Layer-Stabilization-1-3--_1784158287520.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-1-Hardening-Contract-Alignment-for-projects-ts-proj_1784052905584.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-Backlog-EngineeringOS-1-Scoping-ownership-integrity_1784154359481.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-Backlog-EngineeringOS-Execution-Alignment--17841474_1784147452495.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-Title-fix-ai-chat-surface-AI-request-failures-and-r_1784130154946.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-Title-fix-discovery-Classify-Project-Loading-Failur_1784086246178.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-app-ts--1784047027177_1784047027183.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-app-ts--1784047927706_1784047927710.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-discovery-ts-PR-1-Discovery--1783996178319_1783996178325.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993953832.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993967887.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839950_1783995013203.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-title-Harden-auth-context-and-prepare-project-scope_1784044908893.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--PR-title-Hardening-discovery-ts-into-a-deterministic-o_1784053152915.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--artifacts-api-server-src-routes-ai-ts-lib-ai-orchestra_1784388540189.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783996711676.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783997082105.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--lib-ai-orchestrator--1783993997216_1783993997218.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--lib-db-test-script--1784159470823_1784159470827.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--onboarding-o-1783988399961_1783988399964.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--src-context-builder-ts-src-schemas-context-schema-1784_1784305372706.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--test--1784245726594_1784245726598.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted--test--1784245803493_1784245803497.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783798897613.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted-PR-Title-security-ai-Harden-User-Scoped-Groq-Credential_1784127290653.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٣٥٣١٨_1783904118069.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٠٥١١_1783904724118.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٤٤٢٨_1783907108840.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥٠١٣٨_1783908128704.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٤٥٤_1783908924873.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٩٤٨_1783909201747.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٦-٠٧٣٧٤٤_1784176683628.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤١_1784216000977.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤٦_1784216000942.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠١٠٨١٠_1784326132441.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٠٢_1784344398002.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٢_1784344397966.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٦_1784344397931.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٩١٠_1784344762476.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥١٧_1784424954601.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥٢١_1784424954559.png` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .png
- `attached_assets/agents_(1)_1783564013722.zip` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .zip
- `attached_assets/ai_orchestrator_deep_dive_(1)_1783994021466.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: lib/ai-orchestrator — deep dive
- `attached_assets/artifacts_(7)_(1)_1783564013761.zip` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .zip
- `attached_assets/git_(2)_1783564013691.zip` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .zip
- `attached_assets/gitattributes_1783564013915.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/gitignore_(1)_1783564013965.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/lib_(7)_(1)_1783564013810.zip` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .zip
- `attached_assets/node_modules_(2)_1783564014266.zip` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .zip
- `attached_assets/npmrc_(2)_1783564014024.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/package_(1)_(7)_1783564014328.json` — config/doc; role: historical evidence / exported artifact; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/pnpm-lock.yaml_(3)_1783564014392.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/pnpm-workspace.yaml_(3)_1783564014449.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/pr-backlog-ai-orchestrator_1784306020062.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: AI Orchestrator — PR Backlog (file-by-file)
- `attached_assets/replit_(13)_1783564014085.md` — doc; role: historical evidence / exported artifact; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: [Project name]
- `attached_assets/replit_(2)_1783564014509.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/replitignore_1783564014569.txt` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .txt
- `attached_assets/scripts_(8)_1783564013865.zip` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .zip
- `attached_assets/tsconfig.base_(2)_(1)_1783564014142.json` — config/doc; role: historical evidence / exported artifact; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/tsconfig_(7)_1783564014202.json` — config/doc; role: historical evidence / exported artifact; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `attached_assets/تحليل_EngineeringOS_1783804577785.docx` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .docx
- `attached_assets/خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx` — asset/data; role: historical evidence / exported artifact; status: evidence / archive asset; depends on: —; depended by: 0; importance: low; confidence: medium; asset type: .docx

### `docs/`
- `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium-high; confidence: medium; heading: ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION
- `docs/EXECUTION_ALIGNMENT_REPORT.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Execution Alignment Report
- `docs/PLACEHOLDER_REGISTER.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Placeholder Register
- `docs/PR_BACKLOG.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium-high; confidence: medium; heading: PR Backlog — EngineeringOS Execution Alignment
- `docs/RUNTIME_EXECUTION_MATRIX.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS — Runtime Execution Matrix
- `docs/ai-orchestrator-executive-table.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: AI Orchestrator — جدول تنفيذي
- `docs/ai-orchestrator-forensic-analysis.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: AI Orchestrator — Forensic Reverse Engineering Report
- `docs/ai-orchestrator-gap-analysis.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: AI Orchestrator — Request Lifecycle Gap Analysis
- `docs/ai-orchestrator-trace-analysis.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: AI Orchestrator — Trace-by-Trace Analysis
- `docs/completion-plan.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium-high; confidence: medium; heading: EngineeringOS — Phased Completion Plan
- `docs/fact-record.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium-high; confidence: medium; heading: EngineeringOS — سجل حقيقة منظّم ملفًا ملفًا
- `docs/pr-backlog-ai-orchestrator.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium-high; confidence: medium; heading: AI Orchestrator — PR Backlog (file-by-file)
- `docs/truth-flow-pr-checklist.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium-high; confidence: medium; heading: Truth Flow Matrix — PR-ready Checklist
- `docs/truth-flow-pr-review-plan.md` — doc; role: governance / analysis document; status: historical/reference; depends on: —; depended by: 0; importance: medium-high; confidence: medium; heading: خطة المراجعة التنفيذية — تثبيت الحقيقة المرجعية

### `lib/`
- `lib/ai-orchestrator/package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/ai-orchestrator/src/__tests__/chat-agent.test.ts` — test; role: supporting file; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/ai-orchestrator/src/__tests__/file-tools.test.ts` — test; role: supporting file; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/ai-orchestrator/src/__tests__/groq-client.test.ts` — test; role: Groq provider gateway; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/ai-orchestrator/src/__tests__/parsing.test.ts` — test; role: LLM response parser; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/ai-orchestrator/src/__tests__/schemas.test.ts` — test; role: supporting file; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts` — test; role: supporting file; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/ai-orchestrator/src/agents/chat-agent.ts` — code; role: LLM agent; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/agents/code-reviewer.ts` — code; role: LLM agent; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/agents/scan-analyst.ts` — code; role: LLM agent; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/agents/task-agent.ts` — code; role: LLM agent; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts` — code; role: LLM agent; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/context-builder.test.ts` — test; role: project-context builder; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/ai-orchestrator/src/context-builder.ts` — code; role: project-context builder; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/errors.ts` — code; role: error taxonomy; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/groq-client.ts` — code; role: Groq provider gateway; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/index.ts` — code; role: orchestrator barrel export; status: entrypoint; depends on: —; depended by: 0; importance: high; confidence: high
- `lib/ai-orchestrator/src/parsing.ts` — code; role: LLM response parser; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/prompts/chat.prompt.ts` — code; role: prompt builder; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/prompts/index.ts` — code; role: orchestrator barrel export; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: high
- `lib/ai-orchestrator/src/prompts/review.prompt.ts` — code; role: prompt builder; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/prompts/scan.prompt.ts` — code; role: prompt builder; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/prompts/task.prompt.ts` — code; role: prompt builder; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/prompts/workflow.prompt.ts` — code; role: prompt builder; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/schemas/chat.schema.ts` — code; role: runtime validation schema; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/schemas/code-review.schema.ts` — code; role: runtime validation schema; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/schemas/context.schema.ts` — code; role: runtime validation schema; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/schemas/index.ts` — code; role: orchestrator barrel export; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: high
- `lib/ai-orchestrator/src/schemas/scan.schema.ts` — code; role: runtime validation schema; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/schemas/task.schema.ts` — code; role: runtime validation schema; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/schemas/workflow.schema.ts` — code; role: runtime validation schema; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/tools/file-tools.ts` — code; role: tool executor; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/src/tools/git-tools.ts` — code; role: tool executor; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/ai-orchestrator/tsconfig.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/ai-orchestrator/vitest.config.ts` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/api-client-react/package.json` — config/doc; role: client wrapper; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/api-client-react/src/custom-fetch.ts` — code; role: client wrapper; status: imported by runtime code; depends on: —; depended by: 1; importance: medium; confidence: high
- `lib/api-client-react/src/generated/api.schemas.ts` — generated-code; role: generated React Query client surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-client-react/src/generated/api.ts` — generated-code; role: generated React Query client surface; status: generated / consumed by package; depends on: lib/api-client-react/src/generated/api.schemas.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-client-react/src/index.ts` — code; role: client wrapper; status: entrypoint; depends on: lib/api-client-react/src/custom-fetch.ts, lib/api-client-react/src/generated/api.schemas.ts, lib/api-client-react/src/generated/api.ts; depended by: 0; importance: medium; confidence: high
- `lib/api-client-react/src/project-error.ts` — code; role: client wrapper; status: imported by runtime code; depends on: —; depended by: 1; importance: medium; confidence: high
- `lib/api-client-react/tsconfig.json` — config/doc; role: client wrapper; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/api-spec/openapi.yaml` — config/doc; role: source API contract; status: build / environment config; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/api-spec/orval.config.ts` — code; role: codegen config for generated clients/schemas; status: entrypoint; depends on: —; depended by: 0; importance: high; confidence: high
- `lib/api-spec/package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/api-zod/package.json` — config/doc; role: contract types; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/api-zod/src/generated/api.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiApplyChangesRequest.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiApplyChangesRequestChangesItem.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiApplyChangesRequestChangesItem.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiApplyChangesResult.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiApplyChangesResultResultsItem.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiApplyChangesResultResultsItem.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiChatMessage.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiChatMessageRole.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiChatMessageRole.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiChatOutput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiChatMessage.ts, lib/api-zod/src/generated/types/aiPendingChange.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiChatRequest.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiChatSession.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiCodeIssue.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiCodeIssueSeverity.ts, lib/api-zod/src/generated/types/aiCodeIssueType.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiCodeIssueSeverity.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiCodeIssueType.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiCodeReview.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiCodeIssue.ts, lib/api-zod/src/generated/types/aiCodeReviewVerdict.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiCodeReviewVerdict.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiOrchestrateRequest.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiOrchestrationDecision.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiOrchestrationDecisionAction.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiOrchestrationDecisionAction.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiPendingChange.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiReviewRequest.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiReviewRequestFileContents.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiReviewRequestFileContents.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiScanAnalysis.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiScanInsight.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiScanInsight.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiScanInsightCategory.ts, lib/api-zod/src/generated/types/aiScanInsightSeverity.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiScanInsightCategory.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/aiScanInsightSeverity.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/createProjectInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/createRuleInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/ruleSeverity.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/createTaskInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/taskPriority.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/createWorkflowInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/workflowPhase.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/dashboardOverview.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItem.ts, lib/api-zod/src/generated/types/dashboardOverviewTaskStatusBreakdown.ts, lib/api-zod/src/generated/types/dashboardOverviewTopRulesItem.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItem.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItemTrend.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItemTrend.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/dashboardOverviewTaskStatusBreakdown.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/dashboardOverviewTopRulesItem.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/deleteGroqKey200.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoveryGraphSummaryData.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/discoveryGraphSummaryDataEntitiesByType.ts, lib/api-zod/src/generated/types/discoveryGraphSummaryDataFilesByLanguage.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoveryGraphSummaryDataEntitiesByType.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoveryGraphSummaryDataFilesByLanguage.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoveryOptions.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoveryReport.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/discoveryGraphSummaryData.ts, lib/api-zod/src/generated/types/discoveryRuleViolationItem.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoveryRuleViolationItem.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoverySessionStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/discoverySessionStatusStatus.ts, lib/api-zod/src/generated/types/discoveryStepItem.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoverySessionStatusStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoverySourceCapability.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/sourceType.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoverySourceConfig.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/discoverySourceConfigCredentials.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoverySourceConfigCredentials.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoveryStepItem.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/discoveryStepItemStatus.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/discoveryStepItemStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/entityType.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 3; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/evaluateRuleRequest.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/event.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/eventPayload.ts, lib/api-zod/src/generated/types/eventSeverity.ts; depended by: 3; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/eventPayload.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/eventSeverity.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/failWorkflowPhaseInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphEntityImpact404.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphEntityImpactParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphEntityNeighbors200.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEntity.ts, lib/api-zod/src/generated/types/graphRelationship.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphEntityNeighbors404.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphEvidence403.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphEvidence404.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphPathParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphRuntimeSubgraph403.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphRuntimeSubgraph404.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphSemanticNeighborhood400.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphSemanticNeighborhood403.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphSemanticNeighborhood404.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphSemanticNeighborhoodParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphSubgraph400.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphSubgraph403.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphSubgraph404.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getGraphSubgraphParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/getLatestMetricsParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphCentralityScore.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphEdgeType.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphEntity.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/entityType.ts, lib/api-zod/src/generated/types/graphEntityMetadata.ts, lib/api-zod/src/generated/types/graphProvenance.ts; depended by: 9; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphEntityMetadata.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphEvidence.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEvidenceKind.ts; depended by: 3; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphEvidenceBundle.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEvidence.ts, lib/api-zod/src/generated/types/graphRelationship.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphEvidenceKind.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphEvidenceResponse.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEntity.ts, lib/api-zod/src/generated/types/graphEvidenceBundle.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphImpactHop.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEntity.ts, lib/api-zod/src/generated/types/graphRelationship.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphImpactResult.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEntity.ts, lib/api-zod/src/generated/types/graphImpactHop.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphLayerCounts.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphPathResult.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphPathStep.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphPathStep.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEntity.ts, lib/api-zod/src/generated/types/graphRelationship.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphProvenance.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 3; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphRelationship.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEdgeType.ts, lib/api-zod/src/generated/types/graphEvidence.ts, lib/api-zod/src/generated/types/graphProvenance.ts; depended by: 8; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphRelationshipMetadata.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphRuntimeSubgraph.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEntity.ts, lib/api-zod/src/generated/types/graphRelationship.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphSemanticNeighborhood.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEntity.ts, lib/api-zod/src/generated/types/graphRelationship.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphSubgraph.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphEntity.ts, lib/api-zod/src/generated/types/graphRelationship.ts, lib/api-zod/src/generated/types/graphSubgraphFilters.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphSubgraphFilters.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphSubgraphLayered.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphLayerCounts.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphSummary.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/graphCentralityScore.ts, lib/api-zod/src/generated/types/graphSummaryEntitiesByType.ts, lib/api-zod/src/generated/types/graphSummaryRelationsByType.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphSummaryEntitiesByType.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/graphSummaryRelationsByType.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/groqKeyStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/healthStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/healthStatusStatus.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/healthStatusStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/importProjectInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/importProjectInputOverrides.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/importProjectInputOverrides.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/index.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/aiApplyChangesRequest.ts, lib/api-zod/src/generated/types/aiApplyChangesRequestChangesItem.ts, lib/api-zod/src/generated/types/aiApplyChangesResult.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/listAiChatSessionsParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/listEventsParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/listGraphEntitiesParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/entityType.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/listGraphRelationshipsParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/listMetricsParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/listRulesParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/ruleSeverity.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/listTasksParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/taskPriority.ts, lib/api-zod/src/generated/types/taskStatus.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/listWorkflowsParams.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/metricRecord.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/metricRecordBuildStatus.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/metricRecordBuildStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/plugin.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/pluginCapabilitiesItem.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/pluginCapabilitiesItem.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/pluginProjectRequest.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/project.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/projectStatus.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/projectStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/projectSummary.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/event.ts, lib/api-zod/src/generated/types/metricRecord.ts, lib/api-zod/src/generated/types/projectSummaryTaskCounts.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/projectSummaryTaskCounts.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/rule.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/ruleSeverity.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/ruleEvaluationResult.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/ruleEvaluationResultMatchesItem.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/ruleEvaluationResultMatchesItem.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/ruleSeverity.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 5; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/saveGroqKeyInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/scanJob.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/scanJobStatus.ts, lib/api-zod/src/generated/types/scanResult.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/scanJobStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/scanResult.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/sourceType.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 3; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/startDiscoveryInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/discoveryOptions.ts, lib/api-zod/src/generated/types/discoverySourceConfig.ts, lib/api-zod/src/generated/types/sourceType.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/task.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/taskPriority.ts, lib/api-zod/src/generated/types/taskStatus.ts, lib/api-zod/src/generated/types/verificationResult.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/taskLog.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/taskLogLevel.ts, lib/api-zod/src/generated/types/taskLogMetadata.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/taskLogLevel.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/taskLogMetadata.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/taskPriority.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 5; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/taskStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 4; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/updateProjectInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/updateProjectInputStatus.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/updateProjectInputStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/updateRuleInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/ruleSeverity.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/updateTaskInput.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/taskPriority.ts, lib/api-zod/src/generated/types/taskStatus.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/verificationResult.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/verificationResultStepsItem.ts; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/verificationResultStepsItem.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 2; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/workflow.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/workflowPhase.ts, lib/api-zod/src/generated/types/workflowStatus.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/workflowExecution.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: lib/api-zod/src/generated/types/workflowStatus.ts; depended by: 1; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/workflowPhase.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 3; importance: high; confidence: high; generated output
- `lib/api-zod/src/generated/types/workflowStatus.ts` — generated-code; role: generated Zod contract surface; status: generated / consumed by package; depends on: —; depended by: 3; importance: high; confidence: high; generated output
- `lib/api-zod/src/index.ts` — code; role: contract types; status: leaf/support; depends on: lib/api-zod/src/generated/api.ts, lib/api-zod/src/generated/types/index.ts, lib/api-zod/src/truth-flow-matrix.schema.ts; depended by: 0; importance: medium; confidence: high
- `lib/api-zod/src/truth-flow-matrix.schema.ts` — code; role: contract types; status: imported by runtime code; depends on: —; depended by: 1; importance: medium; confidence: high
- `lib/api-zod/tsconfig.json` — config/doc; role: contract types; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/db/drizzle.config.ts` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/db/package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/db/src/index.ts` — code; role: database bootstrap / Drizzle entrypoint; status: entrypoint; depends on: —; depended by: 0; importance: medium; confidence: high
- `lib/db/src/schema/ai_chats.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/ai_provider_credentials.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/audit_logs.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/discovery.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/events.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/graph.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/index.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: high
- `lib/db/src/schema/metrics.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/plugins.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/projects.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/rules.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/scan_jobs.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/task_logs.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/tasks.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/src/schema/workflows.ts` — code; role: Drizzle schema / table definition; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/db/tsconfig.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/knowledge-engine/package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/knowledge-engine/src/__tests__/inference.test.ts` — test; role: in-memory graph inference; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/knowledge-engine/src/__tests__/queries.test.ts` — test; role: database-backed graph queries; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/knowledge-engine/src/index.ts` — code; role: knowledge-engine barrel export; status: entrypoint; depends on: —; depended by: 0; importance: high; confidence: high
- `lib/knowledge-engine/src/inference.ts` — code; role: in-memory graph inference; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/knowledge-engine/src/queries.ts` — code; role: database-backed graph queries; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/knowledge-engine/src/types.ts` — code; role: shared graph types; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/knowledge-engine/tsconfig.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/scanner/package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/scanner/src/__tests__/file-walker.test.ts` — test; role: repository walker; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/scanner/src/__tests__/graph-extractor.test.ts` — test; role: graph extractor; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/scanner/src/__tests__/metrics-calc.test.ts` — test; role: metrics calculator; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/scanner/src/__tests__/rule-matcher.test.ts` — test; role: rule matcher; status: test-only; depends on: —; depended by: 0; importance: high; confidence: high; verification file
- `lib/scanner/src/file-walker.ts` — code; role: repository walker; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/scanner/src/graph-extractor.ts` — code; role: graph extractor; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/scanner/src/index.ts` — code; role: scanner barrel export; status: entrypoint; depends on: —; depended by: 0; importance: high; confidence: high
- `lib/scanner/src/metrics-calc.ts` — code; role: metrics calculator; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/scanner/src/python-ast-script.py` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/scanner/src/python-ast-script.ts` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/scanner/src/python-extractor.ts` — code; role: Python AST bridge; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/scanner/src/rule-matcher.ts` — code; role: rule matcher; status: leaf/support; depends on: —; depended by: 0; importance: high; confidence: medium
- `lib/scanner/tsconfig.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium
- `lib/scanner/vitest.config.ts` — code; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: medium; confidence: medium

### `scripts/`
- `scripts/check-codegen-drift.ts` — code; role: governance / utility script; status: entrypoint; depends on: —; depended by: 0; importance: medium-high; confidence: high
- `scripts/package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium-high; confidence: medium
- `scripts/post-merge.sh` — other; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: medium-high; confidence: medium
- `scripts/src/hello.ts` — code; role: governance / utility script; status: entrypoint; depends on: —; depended by: 0; importance: medium-high; confidence: high
- `scripts/trigger-scan.mts` — code; role: governance / utility script; status: entrypoint; depends on: —; depended by: 0; importance: medium-high; confidence: high
- `scripts/tsconfig.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium-high; confidence: medium
- `scripts/validate-truth-flow.ts` — code; role: governance / utility script; status: entrypoint; depends on: —; depended by: 0; importance: medium-high; confidence: high
- `scripts/verify-setup.sh` — other; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: medium-high; confidence: medium

### `.gitattributes/`
- `.gitattributes` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium

### `.gitignore/`
- `.gitignore` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium

### `.npmrc/`
- `.npmrc` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium

### `.replit/`
- `.replit` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium; contains deployment settings and a shared env secret reference (redacted)

### `.replitignore/`
- `.replitignore` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium

### `package.json/`
- `package.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium

### `pnpm-lock.yaml/`
- `pnpm-lock.yaml` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium

### `pnpm-workspace.yaml/`
- `pnpm-workspace.yaml` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium

### `replit.md/`
- `replit.md` — doc; role: supporting file; status: historical/reference; depends on: —; depended by: 0; importance: medium; confidence: medium; heading: EngineeringOS

### `tsconfig.base.json/`
- `tsconfig.base.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium

### `tsconfig.base.json.bak/`
- `tsconfig.base.json.bak` — other; role: supporting file; status: leaf/support; depends on: —; depended by: 0; importance: low; confidence: medium

### `tsconfig.json/`
- `tsconfig.json` — config/doc; role: supporting file; status: build / environment config; depends on: —; depended by: 0; importance: medium; confidence: medium

## 5. Execution Flow Analysis

### Discovery flow
Entry: `routes/discovery.ts` → adapter resolution in `lib/discovery-adapters.ts` → path validation in `lib/path-validation.ts` → `scanner` → DB writes into discovery/graph/metrics/events/audit. يوجد 3 source types معلنة كـ coming soon، لذا التدفق مكتمل فقط للأنماط المدعومة فعلًا.

### Scan flow
Entry: `routes/projects.ts` و `scripts/trigger-scan.mts` → `lib/scan-runner.ts` → `scanner` → inserts into `graphEntitiesTable`, `graphRelationshipsTable`, `metricsTable`, `scanJobsTable`, `eventsTable` + `recordAudit` + plugin hook on completion.

### Chat flow
Entry: `routes/ai.ts` → `buildProjectContext()` → `chat()` في `chat-agent.ts` → `file-tools.ts` / `git-tools.ts` عند تفعيل الأدوات → parsing/validation → `pendingChanges` أو reply → apply path في AI route → audit/event/cache refresh.

### Task execution flow
Entry: `routes/tasks.ts` → `executeTask()` → prompt/context/parsing → taskLogs/events/audit → state refresh. الخطة واضحة لكن fallback behavior يعتمد على parsers والـ model output.

### Workflow advancement flow
Entry: `routes/workflows.ts` → `orchestrateWorkflow()` → `decide()` → `validateDecision()` → `executeDecision()` → workflowExecutions/events/audit. الأمان البنيوي موجود، لكن drift/metrics gates ما تزال تحتاج تثبيتًا أوسع.

### Apply / commit / push
Apply/commit/push paths موجودة فعلاً في `routes/ai.ts` و`routes/git.ts`. لكن route-level event emission ليست متجانسة؛ بعض write operations تسجل audit فقط، وبعضها يكتب events أيضًا.

### Error / retry / refresh
`groq-client.ts` يحتوي bounded retry/circuit logic. `AiChat.tsx` يحدّث local state وReact Query caches، لكن توجد حالات stale refresh معروفة في الدريفات السابقة لأن invalidate/refresh لا يغطي كل query جذريًا.

## 6. Documentation Gap Analysis

- `docs/fact-record.md` يتحدث عن **427** ملفًا ويصف حالة تاريخية أقدم؛ الأرشيف الحالي يحوي **762** ملفًا، لذا هذا المستند لم يعد baseline للحالة الراهنة.
- `docs/PLACEHOLDER_REGISTER.md` و`docs/EXECUTION_ALIGNMENT_REPORT.md` ما يزالان مفيدين كقوائم gaps، لكنهما snapshots تاريخية أكثر من كونهما truth source.
- `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md` هو الأقرب إلى constitution تشغيلية، لأنه يربط OpenAPI/DB/scanner/knowledge-engine/runtime/dashboard بمفهوم truth flow.
- `docs/ai-orchestrator-gap-analysis.md` يلتقط فعلًا نقاط ضعف دقيقة في lifecycle، خاصة freshness وapply/refresh وتوازن context builder.
- التنفيذ الحالي يثبت بعض ما تقوله الوثائق، ويخالف بعضها الآخر: spec/route drift، source-type stubs، وتضخم الأرشيف مقارنة بسجلات الحقائق القديمة.

## 7. Code Quality Assessment

- **Coupling:** moderate-to-high داخل `artifacts/api-server` بسبب route modules الكبيرة التي تجمع validation + persistence + audit + events + orchestration.
- **Cohesion:** جيدة نسبيًا في `lib/scanner` و`lib/knowledge-engine` و`lib/ai-orchestrator`، لأن كل حزمة لها مسئولية رئيسية واضحة.
- **Hidden dependencies:** `AI_CREDENTIALS_ENCRYPTION_KEY` في `.replit` و`DATABASE_URL` و`GROQ_API_KEY` و`VITE_CLERK_*` تشكل اعتماديات بيئية حاسمة.
- **Anti-patterns:** fallback/placeholder behaviors، وبعض routing by prefix في tool dispatch، والـ multi-responsibility route files.
- **Dead code / orphaned code:** لا يظهر orphan داخلي واضح تحت الفحص الساكن للـ imports، لكن هناك stubs صريحة وواجهات غير مكتملة.
- **Race / consistency risks:** context freshness، concurrent apply vs chat، startup reconciliation order، وأي path لا يلتزم بإبطال cache.

## 8. Technical Debt Report

- `artifacts/api-server/src/lib/discovery-adapters.ts` — hit: `coming soon`
- `artifacts/api-server/src/lib/discovery-adapters.ts` — hit: `coming soon`
- `artifacts/api-server/src/lib/discovery-adapters.ts` — hit: `coming soon`
- `artifacts/api-server/src/lib/plugin-runtime.ts` — hit: `TODO`
- `artifacts/api-server/src/routes/ai.test.ts` — hit: `stub`
- `artifacts/api-server/src/routes/ai.ts` — hit: `xxx`
- `artifacts/api-server/src/routes/discovery.ts` — hit: `Coming soon`
- `artifacts/api-server/src/routes/discovery.ts` — hit: `Coming soon`
- `artifacts/api-server/src/routes/discovery.ts` — hit: `Coming soon`
- `artifacts/api-server/src/routes/discovery.ts` — hit: `stub`
- `artifacts/dashboard/src/components/GitPanel.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/components/GitPanel.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/components/GitPanel.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/components/GitPanel.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/components/layout/Shell.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/components/layout/Shell.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/components/ui/command.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/components/ui/input.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/components/ui/select.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/components/ui/textarea.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/AiChat.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/AiChat.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/AiChat.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Events.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Graph.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Projects.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Tasks.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Workflows.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Workflows.tsx` — hit: `placeholder`
- `artifacts/dashboard/src/pages/Workflows.tsx` — hit: `placeholder`
- `artifacts/mockup-sandbox/src/components/ui/command.tsx` — hit: `placeholder`
- `artifacts/mockup-sandbox/src/components/ui/input.tsx` — hit: `placeholder`
- `artifacts/mockup-sandbox/src/components/ui/select.tsx` — hit: `placeholder`
- `artifacts/mockup-sandbox/src/components/ui/textarea.tsx` — hit: `placeholder`
- `lib/ai-orchestrator/src/__tests__/file-tools.test.ts` — hit: `stub`
- `lib/ai-orchestrator/src/context-builder.ts` — hit: `placeholder`
- `lib/ai-orchestrator/src/context-builder.ts` — hit: `placeholder`
- `lib/scanner/src/graph-extractor.ts` — hit: `stub`

### أبرز الديون التقنية
- discovery source adapters غير مكتملة لكل الأنماط.
- route/spec drift في 10 endpoints.
- UI placeholder copy في dashboard وGitPanel/Shell وبعض primitives.
- AI context freshness and cache invalidation.
- single-shot fallback behavior في بعض agents عند فشل النموذج.

## 9. Completion Assessment

| الجزء | التقدير | السبب |
|---|---:|---|
| OpenAPI + generated contracts | 90% | spec موجود + codegen + drift gate + generated client/Zod surfaces |
| DB / persistence | 88% | جداول متعددة وعلاقات ومخزن audit/events/graph/AI موجود |
| Scanner | 86% | file walker + rule matcher + graph extractor + Python bridge + metrics |
| Knowledge engine | 88% | pure queries/inference + layered graph views |
| AI orchestrator | 85% | gateway/context/prompt/parser/agents/tools موجودة لكن freshness/robustness حساسة |
| API runtime | 84% | auth/ownership/jobs/audit/routes/plugins/git/discovery موجودة لكن بعضها كبير ومختلط المسؤولية |
| Dashboard | 79% | الصفحات الأساسية موجودة، لكن توجد placeholder surfaces وrefresh sensitivity |
| Governance / docs | 72% | وثائق كثيرة، لكن بعضها historical snapshot وليس current truth |

## 10. Risk Assessment

1. **State drift** بين DB / filesystem / client cache / AI context.
2. **Contract drift** بين `openapi.yaml` والتنفيذ الفعلي.
3. **Partial discovery** لبعض source types.
4. **Silent fallback** في parsing أو decision validation.
5. **Stale documentation** قد يقود لاستنتاجات خاطئة لو اعتُمدت وحدها.

## 11. Missing Components

- اكتمل مسار discovery فقط للأنماط المدعومة فعليًا؛ الأنماط stubbed تحتاج تنفيذ.
- spec يحتاج إدراج endpoints الإضافية أو إزالة المسارات غير الموثقة.
- بعض write paths تحتاج event emission أكثر اتساقًا.
- dashboard يحتاج إزالة/تثبيت الـ placeholder copy وإكمال refresh invalidation.
- AI agents غير chat تحتاج retry/hardening أوسع في حالات الشبكة/429.

## 12. Development Roadmap

### Epic 1 — تثبيت العقد
أولوية عالية: إغلاق drift بين OpenAPI والـ routes، ثم إعادة توليد Zod/client surfaces والتحقق من CI.

### Epic 2 — إغلاق discovery stubs
إكمال `ARCHIVE_UPLOAD` و`REMOTE_FILESYSTEM` و`DOCKER_VOLUME` أو إعلانها صراحة في UX/API بدل stub soft-fail.

### Epic 3 — AI freshness and apply safety
توحيد invalidation + audit/event emission + refresh after apply/commit/push + تقليل silent fallback.

### Epic 4 — UX hardening
تنظيف placeholder text، وتثبيت refresh/query invalidation في dashboard، وتحسين error surfaces.

### Epic 5 — Governance cleanup
ترقية الوثائق التاريخية إلى archived references واضحة وفصلها عن truth baseline الحالي.

## 13. PR Backlog

| PR | الهدف | الملفات المستهدفة | الاعتماديات | المخاطر | معايير القبول |
|---|---|---|---|---|---|
| PR-01 | سد contract drift | `lib/api-spec/openapi.yaml`, `lib/api-zod`, `lib/api-client-react`, drift scripts | spec → generated outputs | كسر client/runtime إذا لم يُنسق | لا endpoints غير موثقة، و`check-codegen-drift` ينجح |
| PR-02 | إغلاق discovery stubs | `discovery.ts`, `discovery-adapters.ts`, wizard UI | PR-01 جزئيًا | خطأ UX إذا تبنت الأنماط قبل اكتمالها | كل source type إما مدعوم أو fail explicit |
| PR-03 | apply/refresh safety | `routes/ai.ts`, `routes/git.ts`, `AiChat.tsx`, cache keys | PR-02 | race/refresh regressions | invalidate/refresh لكل write path |
| PR-04 | AI fallback hardening | `groq-client.ts`, `parsing.ts`, agents | PR-03 | زيادة التعقيد | retries/parse failures surface clearly |
| PR-05 | docs truth cleanup | `docs/*`, `.agents/memory/*`, `attached_assets/*` | لا شيء | فقدان السياق التاريخي إن حُذف خطأ | تمييز current truth vs archived snapshots |

## 14. Final Engineering Verdict

المنظومة **حقيقية ومكتملة بنيويًا إلى حد كبير**: يوجد contract-first pipeline، persistence layer، scanner، knowledge-engine، AI orchestration، runtime API، وواجهة dashboard. لكن المشروع **ليس جاهزًا بعد كحقيقة تشغيلية نهائية** بسبب ثلاثة محاور: drift، partial discovery, وstate freshness.

الطبقات الأقوى هي: `scanner` + `knowledge-engine` + `ai-orchestrator` + `api-server`.
أكبر خطر عملي هو أن المشروع قد **يبدو متماسكًا في الواجهة والوثائق** بينما الحالة الفعلية قد تختلف بسبب stale context أو contract drift أو stubs غير مكتملة.

### Appendix A — Route/Spec drift (fact)
- OpenAPI paths: **54**
- OpenAPI operations: **67**
- Route declarations found in runtime code: **77**
- Route declarations not present in OpenAPI: **10**
  - `DELETE /api/ai/github-token`
  - `GET /api/ai/github-token`
  - `GET /api/projects/{projectId}/export`
  - `GET /api/projects/{projectId}/git/config`
  - `GET /api/projects/{projectId}/git/log`
  - `GET /api/projects/{projectId}/git/status`
  - `PATCH /api/projects/{projectId}/git/config`
  - `POST /api/projects/{projectId}/git/commit`
  - `POST /api/projects/{projectId}/git/push`
  - `PUT /api/ai/github-token`

### Appendix B — DB schema tables
- `` → `ai_chat_sessions`
- `` → `ai_chat_messages`
- `` → `ai_provider_credentials`
- `` → `audit_logs`
- `` → `discovery_sessions`
- `` → `events`
- `` → `graph_entities`
- `` → `graph_relationships`
- `` → `metrics`
- `` → `plugins`
- `` → `projects`
- `` → `rules`
- `` → `scan_jobs`
- `` → `task_logs`
- `` → `tasks`
- `` → `workflows`
- `` → `workflow_executions`

### Appendix C — Historical / placeholder / stub register
- `artifacts/api-server/src/lib/discovery-adapters.ts` — `coming soon`
- `artifacts/api-server/src/lib/discovery-adapters.ts` — `coming soon`
- `artifacts/api-server/src/lib/discovery-adapters.ts` — `coming soon`
- `artifacts/api-server/src/lib/plugin-runtime.ts` — `TODO`
- `artifacts/api-server/src/routes/ai.test.ts` — `stub`
- `artifacts/api-server/src/routes/ai.ts` — `xxx`
- `artifacts/api-server/src/routes/discovery.ts` — `Coming soon`
- `artifacts/api-server/src/routes/discovery.ts` — `Coming soon`
- `artifacts/api-server/src/routes/discovery.ts` — `Coming soon`
- `artifacts/api-server/src/routes/discovery.ts` — `stub`
- `artifacts/dashboard/src/components/GitPanel.tsx` — `placeholder`
- `artifacts/dashboard/src/components/GitPanel.tsx` — `placeholder`
- `artifacts/dashboard/src/components/GitPanel.tsx` — `placeholder`
- `artifacts/dashboard/src/components/GitPanel.tsx` — `placeholder`
- `artifacts/dashboard/src/components/layout/Shell.tsx` — `placeholder`
- `artifacts/dashboard/src/components/layout/Shell.tsx` — `placeholder`
- `artifacts/dashboard/src/components/ui/command.tsx` — `placeholder`
- `artifacts/dashboard/src/components/ui/input.tsx` — `placeholder`
- `artifacts/dashboard/src/components/ui/select.tsx` — `placeholder`
- `artifacts/dashboard/src/components/ui/textarea.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/AiChat.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/AiChat.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/AiChat.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Events.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Graph.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Projects.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Rules.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Tasks.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Workflows.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Workflows.tsx` — `placeholder`
- `artifacts/dashboard/src/pages/Workflows.tsx` — `placeholder`
- `artifacts/mockup-sandbox/src/components/ui/command.tsx` — `placeholder`
- `artifacts/mockup-sandbox/src/components/ui/input.tsx` — `placeholder`
- `artifacts/mockup-sandbox/src/components/ui/select.tsx` — `placeholder`
- `artifacts/mockup-sandbox/src/components/ui/textarea.tsx` — `placeholder`
- `lib/ai-orchestrator/src/__tests__/file-tools.test.ts` — `stub`
- `lib/ai-orchestrator/src/context-builder.ts` — `placeholder`
- `lib/ai-orchestrator/src/context-builder.ts` — `placeholder`
- `lib/scanner/src/graph-extractor.ts` — `stub`

### Appendix D — Notes on file inventory methodology
- كل ملف تم إدراجه في الملحق بناءً على path فعلي داخل الأرشيف.
- التصنيف يعتمد على المسار + محتوى أولي + import graph الداخلي.
- الأصول الثنائية لم تُفسَّر بصريًا إلا عبر الامتداد/الاسم لأن هذا فحص ساكن للأرشيف.
- أي وثيقة تحمل heading/summary قديمة عُدَّت reference/historical ما لم يثبت الكود أنها baseline current.
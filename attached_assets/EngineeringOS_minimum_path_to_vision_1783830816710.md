# EngineeringOS — استخراج المشروع والحد الأدنى للوصول إلى الرؤية

**المصدر:** EngineeringOS-main (20)(1).zip
**الغرض:** استخراج طبقات المشروع كاملة، ثم تحديد أقل التغييرات المطلوبة للوصول إلى الرؤية المقترحة مع الحفاظ على أكبر قدر من البنية الحالية.

## 1) ملخص سريع

- إجمالي العناصر داخل الأرشيف: **462**
- الملفات الفعلية (بدون المجلدات): **413**
- مسارات API في OpenAPI: **40**
- Schemas في OpenAPI: **48**
- Endpoints منفذة فعليًا في الخادم: **51**
- ملفات الاختبار: **14**

## 2) الخريطة الفعلية للمستودع

### الجذر
- `.gitattributes`
- `.gitignore`
- `.npmrc`
- `.replit`
- `.replitignore`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `replit.md`
- `tsconfig.base.json`
- `tsconfig.json`

### الحِزم الرئيسة حسب الحجم
- `artifacts/`: **195** ملفًا
- `lib/`: **140** ملفًا
- `attached_assets/`: **48** ملفًا
- `.agents/`: **12** ملفًا
- `scripts/`: **5** ملفًا
- `docs/`: **2** ملفًا

## 3) ما الذي يفعله كل جزء

### A. العقود والواجهات المولدة
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/api-spec/package.json`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/createProjectInput.ts`
- ... (89 ملفات مولدة إضافية)
- `lib/api-client-react/src/custom-fetch.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`

**الاستنتاج:** هذه الطبقة contract-first، وأي تغيير فيها يجب أن يمر عبر codegen.

### B. قاعدة البيانات
- `lib/db/src/index.ts`
- `lib/db/src/schema/audit_logs.ts`
- `lib/db/src/schema/discovery.ts`
- `lib/db/src/schema/events.ts`
- `lib/db/src/schema/graph.ts`
- `lib/db/src/schema/index.ts`
- `lib/db/src/schema/metrics.ts`
- `lib/db/src/schema/plugins.ts`
- `lib/db/src/schema/projects.ts`
- `lib/db/src/schema/rules.ts`
- `lib/db/src/schema/scan_jobs.ts`
- `lib/db/src/schema/task_logs.ts`
- `lib/db/src/schema/tasks.ts`
- `lib/db/src/schema/workflows.ts`

**الاستنتاج:** المنصة تملك جداول فعلية للمشاريع والمهام والقواعد وسير العمل والأحداث والقياسات وgraph والتدقيق والاكتشاف والـ scan jobs وسجلات المهام والplugins.

### C. محرك الفحص والتحليل
- `lib/scanner/src/__tests__/file-walker.test.ts`
- `lib/scanner/src/__tests__/graph-extractor.test.ts`
- `lib/scanner/src/__tests__/metrics-calc.test.ts`
- `lib/scanner/src/__tests__/rule-matcher.test.ts`
- `lib/scanner/src/file-walker.ts`
- `lib/scanner/src/graph-extractor.ts`
- `lib/scanner/src/index.ts`
- `lib/scanner/src/metrics-calc.ts`
- `lib/scanner/src/python-ast-script.py`
- `lib/scanner/src/python-ast-script.ts`
- `lib/scanner/src/python-extractor.ts`
- `lib/scanner/src/rule-matcher.ts`

**الاستنتاج:** يوجد file walker متعدد اللغات، rule matcher آمن، AST graph extractor لـ TS/JS، Python AST bridge، metrics calculator، واختبارات لهذه الطبقة.

### D. طبقة المعرفة
- `lib/knowledge-engine/src/index.ts`
- `lib/knowledge-engine/src/inference.ts`
- `lib/knowledge-engine/src/queries.ts`
- `lib/knowledge-engine/src/types.ts`

**الاستنتاج:** توجد طبقة استدلال جاهزة للـ impact analysis، shortest path، neighborhood، centrality، cluster detection، وgraph summary.

### E. خادم API
الملفات الأساسية:
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/config.ts`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/lib/audit.ts`
- `artifacts/api-server/src/lib/job-queue.test.ts`
- `artifacts/api-server/src/lib/job-queue.ts`
- `artifacts/api-server/src/lib/job-reconciliation.test.ts`
- `artifacts/api-server/src/lib/job-reconciliation.ts`
- `artifacts/api-server/src/lib/logger.ts`
- `artifacts/api-server/src/lib/plugin-runtime.test.ts`
- `artifacts/api-server/src/lib/plugin-runtime.ts`
- `artifacts/api-server/src/lib/scan-runner.ts`
- `artifacts/api-server/src/middlewares/.gitkeep`
- `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`
- `artifacts/api-server/src/middlewares/requireAuth.ts`
- `artifacts/api-server/src/routes/dashboard.ts`
- `artifacts/api-server/src/routes/discovery.test.ts`
- `artifacts/api-server/src/routes/discovery.ts`
- `artifacts/api-server/src/routes/events.ts`
- `artifacts/api-server/src/routes/graph.test.ts`
- `artifacts/api-server/src/routes/graph.ts`
- `artifacts/api-server/src/routes/health.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/routes/metrics.test.ts`
- `artifacts/api-server/src/routes/metrics.ts`
- ... (9 ملفات إضافية في نفس المسار)

**الأجزاء الأهم داخلها:**
- `dashboard.ts`: GET /dashboard
- `discovery.ts`: POST /projects/discover, GET /projects/discover/:discoveryId, GET /projects/discover/:discoveryId/summary, POST /projects/import
- `events.ts`: GET /events
- `graph.ts`: GET /graph/entities, GET /graph/relationships, GET /graph/entities/:entityId/neighbors, GET /graph/impact, GET /graph/path, GET /graph/summary/:projectId
- `health.ts`: GET /healthz
- `metrics.ts`: GET /metrics, GET /metrics/latest
- `plugins.ts`: GET /plugins, POST /plugins/:pluginId/enable, POST /plugins/:pluginId/disable
- `projects.ts`: GET /projects, POST /projects, GET /projects/:projectId, PATCH /projects/:projectId, DELETE /projects/:projectId, POST /projects/:projectId/scan, GET /projects/:projectId/scan-jobs/:jobId, GET /projects/:projectId/summary
- `rules.ts`: GET /rules, POST /rules, GET /rules/:ruleId, PATCH /rules/:ruleId, DELETE /rules/:ruleId, POST /rules/:ruleId/evaluate
- `tasks.ts`: GET /tasks, POST /tasks, GET /tasks/:taskId, PATCH /tasks/:taskId, DELETE /tasks/:taskId, POST /tasks/:taskId/execute, POST /tasks/:taskId/retry, POST /tasks/:taskId/rollback, GET /tasks/:taskId/logs
- `workflows.ts`: GET /workflows, POST /workflows, GET /workflows/:workflowId, DELETE /workflows/:workflowId, POST /workflows/:workflowId/start, POST /workflows/:workflowId/stop, GET /workflows/:workflowId/executions, POST /workflows/:workflowId/advance, POST /workflows/:workflowId/fail-phase, POST /workflows/:workflowId/executions/:executionId/retry-phase

**الاستنتاج:** الخادم يحتوي discovery onboarding، projects lifecycle، tasks lifecycle، workflows runtime، events stream، metrics، graph queries، plugins، dashboard summary، وhealth.

### F. لوحة التحكم
- `artifacts/dashboard/src/pages/Dashboard.tsx`
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx`
- `artifacts/dashboard/src/pages/Events.tsx`
- `artifacts/dashboard/src/pages/Graph.tsx`
- `artifacts/dashboard/src/pages/Landing.tsx`
- `artifacts/dashboard/src/pages/Metrics.tsx`
- `artifacts/dashboard/src/pages/ProjectDetail.tsx`
- `artifacts/dashboard/src/pages/Projects.tsx`
- `artifacts/dashboard/src/pages/Rules.tsx`
- `artifacts/dashboard/src/pages/SignIn.tsx`
- `artifacts/dashboard/src/pages/SignUp.tsx`
- `artifacts/dashboard/src/pages/Tasks.tsx`
- `artifacts/dashboard/src/pages/Workflows.tsx`
- `artifacts/dashboard/src/pages/not-found.tsx`

**الاستنتاج:** الواجهة تغطي Landing / Auth، Projects / ProjectDetail، Discover Project wizard، Tasks / Rules / Workflows / Events / Metrics / Graph، بالإضافة إلى shell/sidebar/layout components.

### G. Sandbox / Mockup
- `artifacts/mockup-sandbox/src/.generated/mockup-components.ts`
- `artifacts/mockup-sandbox/src/App.tsx`
- `artifacts/mockup-sandbox/src/components/ui/accordion.tsx`
- `artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx`
- `artifacts/mockup-sandbox/src/components/ui/alert.tsx`
- `artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx`
- `artifacts/mockup-sandbox/src/components/ui/avatar.tsx`
- `artifacts/mockup-sandbox/src/components/ui/badge.tsx`
- `artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx`
- `artifacts/mockup-sandbox/src/components/ui/button-group.tsx`
- `artifacts/mockup-sandbox/src/components/ui/button.tsx`
- `artifacts/mockup-sandbox/src/components/ui/calendar.tsx`
- `artifacts/mockup-sandbox/src/components/ui/card.tsx`
- `artifacts/mockup-sandbox/src/components/ui/carousel.tsx`
- `artifacts/mockup-sandbox/src/components/ui/chart.tsx`
- `artifacts/mockup-sandbox/src/components/ui/checkbox.tsx`
- `artifacts/mockup-sandbox/src/components/ui/collapsible.tsx`
- `artifacts/mockup-sandbox/src/components/ui/command.tsx`
- `artifacts/mockup-sandbox/src/components/ui/context-menu.tsx`
- `artifacts/mockup-sandbox/src/components/ui/dialog.tsx`
- ... (42 ملفات إضافية في نفس المسار)

**الاستنتاج:** الموكب موجود كمساحة تجريبية، لكنه ليس طبقة تشغيل أساسية للوصول للرؤية.

### H. الذاكرة التشغيلية
- `.agents/memory/MEMORY.md`
- `.agents/memory/audit-fixes.md`
- `.agents/memory/clerk-auth-testing.md`
- `.agents/memory/discovery-feature.md`
- `.agents/memory/drizzle-error-wrapping.md`
- `.agents/memory/engineeringos-completion-plan.md`
- `.agents/memory/fk-atomic-claim-ordering.md`
- `.agents/memory/imported-project-workflow-failures.md`
- `.agents/memory/knowledge-engine.md`
- `.agents/memory/orval-openapi-codegen.md`
- `.agents/memory/scanner-ast-extraction.md`
- `.agents/memory/testing-drift-checks.md`

**الاستنتاج:** هذه الملفات تحمل قرارات التنفيذ والقيود المتراكمة، ويجب عدم كسرها عند التطوير.

### I. الوثائق الرسمية
- `docs/completion-plan.md`
- `docs/fact-record.md`

**الاستنتاج:** لديك سجل حقيقة رسمي + خطة مرحلية رسمية، وهذا يجعل التطوير مبنيًا على دليل لا على الانطباع.

## 4) ما هو الموجود فعلًا الآن

### موجود بقوة
1. **Contract-first pipeline** — OpenAPI → Zod → React Query hooks → API server.
2. **Data backbone** — Tables حقيقية مع FK/Enums/JSONB للمشاريع والمهام والسير والأحداث والgraph والتدقيق.
3. **Execution engine** — queue محدود + reconciliation + scan runner + transactional writes.
4. **Discovery onboarding** — إدخال المشاريع يبدأ بالاكتشاف لا بform تقليدي.
5. **Knowledge graph** — استخراج علاقات + استدلال تأثير + مسار + clusters + summary.
6. **Observability/traceability** — events + task_logs + audit_logs + metrics + correlationId.

### موجود جزئيًا
1. **Authorization** — يوجد Clerk auth، لكن لا يوجد RBAC أو project-scoped permissions.
2. **Simulation** — يوجد impact analysis، لكن لا توجد محاكاة مستقلة "ماذا لو؟".
3. **Engineering timeline** — توجد الأحداث والتدقيق والقياسات، لكن لا توجد طبقة timeline موحدة.
4. **Plugin platform** — runtime موجود لكنه in-process ومحدود.
5. **Advisory engine** — لا يوجد محرك توصية صريح يبني قرارات هندسية قابلة للتنفيذ.

## 5) أقل التغييرات المطلوبة للوصول إلى الرؤية

### الهدف
الوصول إلى رؤية Engineering Digital Twin / Engineering Intelligence Platform بأقل تعديل ممكن على البنية الحالية.

### الترتيب الأدنى المقترح

#### 1) إضافة طبقة Knowledge Snapshot
- تخزين snapshot بعد كل scan/discovery.
- حفظ entities وrelationships وmetrics وprovenance وcorrelationId وversion/timestamp.
- الملفات الأقرب: `lib/db/src/schema/graph.ts`، `lib/db/src/schema/metrics.ts`، `lib/db/src/schema/audit_logs.ts`، `artifacts/api-server/src/lib/scan-runner.ts`، `artifacts/api-server/src/routes/discovery.ts`، `artifacts/api-server/src/routes/projects.ts`.

#### 2) إضافة Timeline موحد
- endpoint يجمع scans، audit logs، events، task logs، workflow transitions، metrics snapshots.
- الملفات الأقرب: `artifacts/api-server/src/routes/events.ts`، `artifacts/api-server/src/routes/dashboard.ts`، `artifacts/api-server/src/routes/projects.ts`، `artifacts/dashboard/src/pages/ProjectDetail.tsx`، `artifacts/dashboard/src/pages/Dashboard.tsx`.

#### 3) تقوية provenance + trust
- جعل provenance وconfidence ظاهرين بوضوح في graph/UI/API.
- منع عرض inference بلا evidence واضح.
- الملفات الأقرب: `lib/db/src/schema/graph.ts`، `lib/knowledge-engine/src/*`، `artifacts/api-server/src/routes/graph.ts`، `artifacts/dashboard/src/pages/Graph.tsx`.

#### 4) إضافة Simulation API
- محاكاة حذف ملف / تعديل endpoint / تغيير schema / نقل module.
- outputs: impacted entities, broken contracts, risk score, estimated fallout.
- الملفات الأقرب: `lib/knowledge-engine/src/queries.ts`، `lib/knowledge-engine/src/inference.ts`، `artifacts/api-server/src/routes/graph.ts` أو route جديد، `artifacts/dashboard/src/pages/Graph.tsx`.

#### 5) إضافة RBAC / Project-scoped access
- طبقة صلاحيات على مستوى admin / editor / viewer / agent أو على مستوى المشروع.
- الملفات الأقرب: `artifacts/api-server/src/middlewares/requireAuth.ts`، `artifacts/api-server/src/app.ts`، `lib/db/src/schema/*` عند الحاجة لحفظ memberships/roles.

#### 6) Advisory Engine خفيف
- اقتراح أكثر الملفات حساسية، أقل تعديل، أولويات الإصلاح، مخاطر التغيير.
- الملفات الأقرب: `lib/knowledge-engine/src/inference.ts`، `artifacts/api-server/src/routes/graph.ts`، `artifacts/dashboard/src/pages/ProjectDetail.tsx`.

## 6) ما لا يحتاج إعادة بناء كبيرة

- `lib/api-spec/openapi.yaml` كعقدة أساسية.
- `lib/api-zod/src/generated/*`.
- `lib/api-client-react/src/generated/*`.
- `lib/scanner/src/file-walker.ts`.
- `lib/scanner/src/rule-matcher.ts`.
- `artifacts/api-server/src/lib/job-queue.ts`.
- `artifacts/api-server/src/lib/job-reconciliation.ts`.
- نواة `tasks.ts` و`workflows.ts` الحالية.

## 7) الخلاصة التنفيذية
أنت لا تحتاج مشروعًا جديدًا للوصول إلى الرؤية. تحتاج إضافات صغيرة نسبيًا على طبقات موجودة أصلًا: snapshots/versioning، timeline، trust/provenance، simulation، RBAC، وadvisory layer خفيفة.

## 8) ترتيب البدء الأدنى
1. `graph.ts` + `scan-runner.ts` لإضافة snapshot/provenance/versioning.
2. `knowledge-engine` لإضافة simulation/advisory queries.
3. `routes/graph.ts` و`ProjectDetail.tsx` لعرضها.
4. `requireAuth.ts` وطبقة roles لتأمينها.

هذا المسار يعطي أكبر قفزة فكرية بأقل عدد ملفات.
# EngineeringOS — الدفعة الثانية من التحليل الهندسي

هذه الدفعة توسّع التحليل من الفهرسة العامة إلى الطبقات التنفيذية الفعلية: API server، مسارات AI، scanner، knowledge engine، DB schemas، وطبقة الضبط والجودة.
كل نتيجة أدناه مربوطة بملف أو أكثر من الملفات المرفقة. الملفات الكبيرة جدًا تم تفقدها بشكل انتقائي داخل مناطقها الأعلى أثرًا، وأشير لذلك صراحةً في الفهرس.

## 1) الملخص التنفيذي

EngineeringOS يظهر هنا كنظام هندسي/حوكمي داخلي مبني على ثلاثة محاور متزامنة: جمع الحقيقة من المشاريع (discovery + scan + graph)، تشغيل أعمال هندسية موجهة بالـ AI (chat / task execution / workflow orchestration)، وفرض traceability عبر events / audit logs / correlation IDs. البنية ليست مجرد تسميات؛ هناك ربط مباشر بين DB schema، مسارات Express، محرك الجراف، وأدوات AI.

أقوى ما في هذه الدفعة هو أن الطبقات التنفيذية مترابطة فعلاً: `requireAuth` و`requireProjectAccess` يطبّقان ownership-scoping، ومسارات `projects/tasks/workflows/rules/events/metrics/graph/discovery/git/ai` تستخدم هذا النمط، بينما `scan-runner` و`plugin-runtime` و`job-queue` تشكل آلية التنفيذ الخلفي. كذلك يظهر أن `lib/knowledge-engine` طبقة pure للقراءة/inference فقط، وأن `lib/ai-orchestrator` يبني context غنيًا من قاعدة البيانات ويطبّق validation صارمة على payloads.

النقطة الأهم في تقييم النضج: النظام متقدم وظيفيًا، لكن هناك حدود واضحة ما تزال تُسجّل في الكود نفسه: queue العملية local وليست durable، قياس الاختبارات في metrics ما زال proxy heuristics، والوثائق القديمة موسومة تاريخيًا ولا ينبغي أخذها كمرجع current truth إلا عبر `docs/architecture.md`.

## 2) فهرس الملفات التي تمت قراءتها في هذه الدفعة

| المسار | الفئة | نوع الملف | نطاق القراءة | الغرض المتوقع | ملاحظة تحليلية |
|---|---|---:|---|---|---|
| `package.json` | إعدادات | json | full | ممتد/تشغيل | نقطة تشغيل الجذر، سكربتات التحقق والبناء |
| `replit.md` | توثيق | md | full | تشغيل/بنية | وصف بنية الريبو ومتطلبات التشغيل |
| `docs/fact-record.md` | توثيق | md | selective | تاريخي/سجل حقائق | سجل حقائق تاريخي مع banner يحدد أنه ليس baseline حالي |
| `docs/architecture.md` | توثيق | md | selective | baseline معماري | المرجع الحالي للبنية المعمارية |
| `docs/completion-plan.md` | توثيق | md | selective | خطة تاريخية | خطة مراحل قديمة مع banner يعلن أنها تاريخية |
| `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md` | توثيق | md | selective | مرجع تنفيذي | دستور تنفيذي مبني من codebase |
| `scripts/validate-truth-flow.ts` | سكربت | ts | full | تحقق | بوابة drift لمصفوفة truth-flow |
| `.github/workflows/ci.yml` | CI/CD | yml | full | تحقق مستمر | fast path drift + validate job |
| `artifacts/api-server/src/index.ts` | كود | ts | selective | نقطة دخول | تهيئة التشغيل، reconciliations، invalidation channel |
| `artifacts/api-server/src/app.ts` | كود | ts | selective | نقطة دخول | Express security hardening + routing |
| `artifacts/api-server/src/config.ts` | كود | ts | full | إعدادات | مصدر إعدادات env مضبوط بـ zod |
| `artifacts/api-server/src/routes/index.ts` | كود | ts | full | تجميع routes | ترتيب mount للـ routers |
| `artifacts/api-server/src/middlewares/requireAuth.ts` | كود | ts | full | مصادقة | Auth + optionalAuth |
| `artifacts/api-server/src/middlewares/requireProjectAccess.ts` | كود | ts | full | تفويض | ملكية project-scoped |
| `artifacts/api-server/src/routes/projects.ts` | كود | ts | selective | CRUD projects | إنشاء/قراءة/تعديل/حذف/scan |
| `artifacts/api-server/src/routes/tasks.ts` | كود | ts | selective | CRUD tasks | إدارة task lifecycle + AI execution |
| `artifacts/api-server/src/routes/rules.ts` | كود | ts | selective | CRUD rules | قواعد عامة + قواعد project-scoped |
| `artifacts/api-server/src/routes/workflows.ts` | كود | ts | selective | CRUD workflows | workflow state + executions |
| `artifacts/api-server/src/routes/events.ts` | كود | ts | full | events API | list scoped events |
| `artifacts/api-server/src/routes/metrics.ts` | كود | ts | selective | metrics API | project metrics + latest snapshot |
| `artifacts/api-server/src/routes/graph.ts` | كود | ts | selective | graph API | KG query surface |
| `artifacts/api-server/src/routes/discovery.ts` | كود | ts | selective | discovery | sessions + source detection |
| `artifacts/api-server/src/routes/plugins.ts` | كود | ts | selective | plugins | seed/enable/disable plugins |
| `artifacts/api-server/src/routes/git.ts` | كود | ts | selective | git integration | status/log/commit/push |
| `artifacts/api-server/src/routes/health.ts` | كود | ts | full | health | healthz + counters |
| `artifacts/api-server/src/routes/ai/index.ts` | كود | ts | full | AI router | compose AI subroutes |
| `artifacts/api-server/src/routes/ai/chat.ts` | كود | ts | selective | AI chat | chat/session/apply-changes |
| `artifacts/api-server/src/routes/ai/analysis.ts` | كود | ts | selective | AI analysis | scan analysis + code review |
| `artifacts/api-server/src/routes/ai/tasks.ts` | كود | ts | selective | AI tasks | task execution + scheduler |
| `artifacts/api-server/src/routes/ai/workflows.ts` | كود | ts | selective | AI workflows | orchestration endpoint |
| `artifacts/api-server/src/routes/ai/providers.ts` | كود | ts | selective | provider keys | key CRUD + active provider |
| `artifacts/api-server/src/lib/scan-runner.ts` | كود | ts | selective | scan pipeline | performScan transaction + plugin hooks |
| `artifacts/api-server/src/lib/discovery-runner.ts` | كود | ts | selective | discovery pipeline | source detection + summary |
| `artifacts/api-server/src/lib/job-queue.ts` | كود | ts | full | job queue | process-local queue with dedup |
| `artifacts/api-server/src/lib/plugin-runtime.ts` | كود | ts | selective | plugin runtime | in-process hooks onScanComplete |
| `artifacts/api-server/src/lib/audit.ts` | كود | ts | full | audit | best-effort audit writes |
| `artifacts/api-server/src/lib/graph-provenance.ts` | كود | ts | full | provenance | normalize scanner provenance to DB |
| `artifacts/api-server/src/lib/logger.ts` | كود | ts | full | logging | pino logger |
| `lib/scanner/src/index.ts` | كود | ts | full | scanner barrel | exports scanner surface |
| `lib/scanner/src/file-walker.ts` | كود | ts | selective | file walker | walk tree + language detection |
| `lib/scanner/src/graph-extractor.ts` | كود | ts | selective | graph extractor | AST/regex graph extraction |
| `lib/scanner/src/metrics-calc.ts` | كود | ts | selective | metrics | heuristic score computation |
| `lib/knowledge-engine/src/index.ts` | كود | ts | full | knowledge engine barrel | export pure query/inference layer |
| `lib/knowledge-engine/src/queries.ts` | كود | ts | selective | graph queries | impact/path/neighborhood/provenance |
| `lib/knowledge-engine/src/inference.ts` | كود | ts | selective | inference | centrality / clusters / summaries |
| `lib/ai-orchestrator/src/index.ts` | كود | ts | full | orchestrator barrel | export agents + context invalidation |
| `lib/ai-orchestrator/src/context-builder.ts` | كود | ts | selective | context builder | DB-backed prompt context + cache |
| `lib/ai-orchestrator/src/schemas/context.schema.ts` | كود | ts | full | context schema | strict agent context validation |
| `lib/ai-orchestrator/src/schemas/workflow.schema.ts` | كود | ts | selective | workflow schema | phases + decision schema |
| `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts` | كود | ts | selective | workflow orchestrator | decide/validate/execute transitions |
| `lib/ai-orchestrator/src/agents/chat-agent.ts` | كود | ts | selective | chat agent | tool-using chat loop |
| `lib/ai-orchestrator/src/groq-client.ts` | كود | ts | selective | model gateway | retry/error classification |
| `lib/ai-orchestrator/src/provider-registry.ts` | كود | ts | full | providers | single source of truth |
| `lib/ai-orchestrator/src/tools/file-tools.ts` | كود | ts | selective | file tools | read/list/search/write proposal |
| `lib/ai-orchestrator/src/tools/git-tools.ts` | كود | ts | full | git tools | status/diff/log helpers |
| `lib/db/src/index.ts` | كود | ts | full | DB entry | drizzle pool + schema export |
| `lib/db/src/schema/index.ts` | كود | ts | full | schema barrel | exports all tables |
| `lib/db/src/schema/projects.ts` | كود | ts | full | projects schema | owner-scoped project model |
| `lib/db/src/schema/tasks.ts` | كود | ts | full | tasks schema | task lifecycle + correlation |
| `lib/db/src/schema/workflows.ts` | كود | ts | full | workflows schema | workflow definitions/executions |
| `lib/db/src/schema/events.ts` | كود | ts | full | events schema | project/event trace |
| `lib/db/src/schema/metrics.ts` | كود | ts | full | metrics schema | score snapshots |
| `lib/db/src/schema/graph.ts` | كود | ts | selective | graph schema | KG provenance + evidence |
| `lib/db/src/schema/discovery.ts` | كود | ts | selective | discovery schema | sessions/options/summary |
| `lib/db/src/schema/audit_logs.ts` | كود | ts | full | audit schema | provenance log |
| `lib/db/src/schema/ai_chats.ts` | كود | ts | full | ai chat schema | sessions + messages |
| `lib/db/src/schema/scan_jobs.ts` | كود | ts | full | scan jobs schema | async scan lifecycle |

## 3) تحليل المشروع

### المشكلة التي يحلها
المشروع يحاول توحيد دورة حياة هندسية كاملة: استيراد مشروع أو سحبه أو مسحه، استخراج بنية الجراف والـ metrics، إدارة tasks and workflows، ثم تشغيل مساعد AI يقرأ الحقيقة الحالية من السياق نفسه بدل الاعتماد على وصف منفصل.

### المستخدمون المستهدفون
من الملفات يظهر أنه يستهدف مشغّلًا هندسيًا أو فريقًا صغيرًا يدير عدة مشاريع داخل workspace واحد: مالك المشروع، مشغل discovery/scan، ومستخدم dashboard يتابع المشاريع والمهام والجراف والمراجعات.

### القيمة المقدمة
القيمة ليست مجرد لوحة تحكم؛ القيمة هي توحيد contract + database + graph + audit + AI. أي تغيير في المشروع يمكن تتبعه إلى event أو audit log أو graph provenance، ثم استدعاؤه داخل context الـ AI أو UI.

### السيناريوهات الأساسية
1. إنشاء مشروع جديد ثم تشغيل scan/discovery.
2. فحص قواعد/مهام/flows وربطها بمشروع محدد.
3. تشغيل chat أو review أو orchestration على سياق المشروع.
4. تصفح الجراف/المؤشرات/الأحداث ومراجعة trace كامل لعملية واحدة.

### ما هو ثابت وما هو مجرد نية
الثابت: routes، schemas، scanner، knowledge-engine، audit logs، queue، provider registry، CI gates. النية/الشرح التسويقي: بعض وثائق الفهرس التاريخي التي تصف اتجاهات قديمة أو مراحل سابقة. هذا يَظهر بوضوح في banners داخل `docs/fact-record.md` و`docs/completion-plan.md`.

## 4) تحليل المعمارية

### الخريطة المعمارية الفعلية
```text
┌─────────────────────────────┐
│       Dashboard UI          │
│ React + Vite + generated    │
│ client/hooks from OpenAPI   │
└──────────────┬──────────────┘
               │ HTTPS / same-origin
┌──────────────▼──────────────┐
│      API Server (Express)    │
│ auth / project access /      │
│ routes / audit / jobs / AI   │
└───┬──────────┬───────────┬───┘
    │          │           │
    ▼          ▼           ▼
┌────────┐  ┌──────────┐  ┌─────────────────┐
│  DB    │  │ Scanner  │  │ AI Orchestrator │
│ Drizzle│  │ AST+walk │  │ Groq / tools /  │
│ PG     │  │ graph    │  │ prompts/schema  │
└───┬────┘  └────┬─────┘  └────────┬────────┘
    │             │                │
    ▼             ▼                ▼
┌──────────┐  ┌────────────┐  ┌──────────────┐
│Audit/Events│ │Knowledge KG│  │Provider Keys │
│Traceability│ │queries/infer│  │/rate limits  │
└──────────┘  └────────────┘  └──────────────┘

```

### الطبقات الموجودة فعليًا
**واجهة المستخدم**: Dashboard React/Vite مع مكوّنات UI كثيرة، لكن هذه الدفعة لم تغطِّ كل الصفحات. وجود generated client/hooks من OpenAPI يشير إلى أن الواجهة تستهلك العقدة المولدة لا مسارات مخصّصة عشوائية.

**API Server**: Express هو بوابة التنفيذ، ويضم security hardening (helmet/rate-limit/cors/logging), auth, project ownership checks, routes, job orchestration, and health. هذا هو مركز التنسيق runtime.

**DB / schema**: Drizzle schemas تعرّف domain entities: projects/tasks/workflows/events/metrics/graph/discovery/audit/ai chats/scan jobs. الكود يربط القيود والانحيازات (foreign keys, enums, indexes) مباشرةً بالتشغيل.

**Scanner**: طبقة pure-ish لقراءة الملفات واستخراج entities/relationships/metrics. تستفيد من AST حيث يمكن ومن regex heuristics حيث يلزم.

**Knowledge Engine**: طبقة pure على الجراف؛ تسترجع وتتنبأ ولا تكتب. هذا الفصل واضح في index.ts والـ queries/inference.

**AI Orchestrator**: يبني سياقًا من قاعدة البيانات ويحوّله إلى prompt/tool loop مضبوط schema. هذا ليس chatbot عام؛ هو agent layer مقيّد بسياق المشروع.

## 5) تحليل الطبقات

| الطبقة | الغرض | المكونات الأساسية | النضج النسبي | الدليل |
|---|---|---|---|---|
| API Server | التوجيه والتنفيذ والحماية | app/index/routes/middlewares/lib | عالٍ نسبيًا | artifacts/api-server/src/app.ts, src/index.ts, src/routes/index.ts, src/middlewares/*.ts |
| Data Layer | تمثيل العقدة في PostgreSQL | Drizzle schemas + enums + relations | عالٍ | lib/db/src/schema/*.ts |
| Scanner | استخراج هيكلي وقياس | file-walker, graph-extractor, metrics-calc | متوسط-عالٍ | lib/scanner/src/*.ts |
| Knowledge Engine | استعلام/استدلال على الجراف | queries, inference, types | متوسط-عالٍ | lib/knowledge-engine/src/*.ts |
| AI Orchestrator | context + prompts + tool-loop | context-builder, schemas, agents, tools, provider registry | متوسط-عالٍ | lib/ai-orchestrator/src/*.ts |
| CI/Gates | التحقق من drift والبناء | CI workflow + validate scripts | عالٍ | scripts/validate-truth-flow.ts, .github/workflows/ci.yml, package.json |

## 6) تحليل المكونات

| المكوّن | المسؤولية | الحالة | النسبة التقديرية | الأدلة | المخاطر المباشرة |
|---|---|---|---:|---|---|
| API Server | طبقة التنفيذ | مكتمل جزئيًا | ≈85% | artifacts/api-server/src/app.ts, src/index.ts, src/routes/index.ts, src/middlewares/*.ts, src/routes/*, src/lib/* | تعقيد التوسع قد يكشف أي route جديد لا يمر عبر الحراس |
| Projects / Tasks / Workflows | نطاق الأعمال | مكتمل جزئيًا | ≈80% | artifacts/api-server/src/routes/projects.ts, tasks.ts, workflows.ts, rules.ts, events.ts, metrics.ts | consistency بين lifecycle state/events/audit |
| Discovery Pipeline | طبقة ingest | مكتمل جزئيًا | ≈80% | artifacts/api-server/src/routes/discovery.ts, src/lib/discovery-runner.ts, src/lib/discovery-adapters.ts | crash/restart re-enqueue semantics |
| Scan Runner | تنفيذ الخلفية | مكتمل جزئيًا | ≈85% | artifacts/api-server/src/lib/scan-runner.ts, src/lib/plugin-runtime.ts, src/lib/job-queue.ts | transaction boundaries and long CPU sections |
| Knowledge Engine | تحليل الجراف | مكتمل جزئيًا | ≈85% | lib/knowledge-engine/src/{queries.ts,inference.ts,types.ts} | schema drift with DB graph structures |
| Scanner | استخراج هيكلي | مكتمل جزئيًا | ≈85% | lib/scanner/src/{file-walker.ts,graph-extractor.ts,metrics-calc.ts,python-extractor.ts} | regex fallbacks can miss edge cases |
| AI Orchestrator | توليد/تخطيط | مكتمل جزئيًا | ≈80% | lib/ai-orchestrator/src/{context-builder.ts,agents/*.ts,schemas/*.ts,tools/*.ts,groq-client.ts} | prompt/schema drift and provider failures |
| DB Schema | طبقة البيانات | مكتمل جزئيًا | ≈90% | lib/db/src/schema/*.ts | migration drift or missing constraints |
| Dashboard | واجهة المستخدم | غير معروف جزئيًا | ≈70% | artifacts/dashboard/src/* | unverified UI alignment in this tranche |
| CI / Gates | ضبط الجودة | مكتمل | ≈90% | .github/workflows/ci.yml, package.json, scripts/validate-truth-flow.ts | contract drift if gates are bypassed |

### ملاحظات على النضج
هذه النِّسب استدلالية، وليست قياسًا رسميًا. رُفعت النسبة عندما كان هناك: schemas واضحة، guards واضحة، tests موجودة، وroutes/flow موثقة في الكود. خُفضت عندما ظهر في نفس الملف caveat صريح مثل queue-local أو heuristic coverage.

## 7) تحليل الكود

### نقاط الدخول الرئيسية
- `artifacts/api-server/src/index.ts` يشغّل server، reconciliation، invalidation channel، migrations الضرورية قبل قبول traffic.
- `artifacts/api-server/src/app.ts` يركّب security middleware, health, auth, routing.
- `artifacts/api-server/src/routes/index.ts` يجمع كل المسارات ويُظهر ترتيب mount المقصود.
- `lib/scanner/src/index.ts` و`lib/knowledge-engine/src/index.ts` و`lib/ai-orchestrator/src/index.ts` هي barrels تظهر حدود المكتبات.

### مسارات التنفيذ
1. طلب REST يصل إلى Express.
2. `requireAuth` يثبت هوية المستخدم، ثم `requireProjectAccess` يثبت ملكية المشروع عند الحاجة.
3. route يستدعي DB/schema أو scan/discovery/AI layer.
4. تسجل الأحداث في events/audit/task_logs حسب نوع العملية.
5. في AI paths، يبنى project context ويُمرَّر إلى orchestrator/provider.
6. عند scan/discovery، تُحدّث graph/metrics/jobs ويُفصل بين heavy work وHTTP response.

### المصادقة والتفويض
المصادقة متوفرة عبر Clerk، والتفويض الحالي owner-scoped. `requireAuth.ts` يصرّح صراحةً بأنه لا توجد role/RBAC layer داخل المستخدم المصدق. `requireProjectAccess.ts` يطبّق 400/404/403 حسب وجود المشروع وملكيته. هذا يثبت أن النظام ليس multi-role collaborative حتى الآن.

### الخلفيات / jobs
`job-queue.ts` يقدّم queue في الذاكرة مع dedup، بينما `scan-runner.ts` و`discovery-runner.ts` يستخدمان job orchestration وقفل advisory في بعض المسارات. `src/index.ts` يعترف صراحةً بأن الأعمال في الطابور تُفقد عند crash/restart، ثم يعوض ذلك عبر reconciliation.

### الأحداث / audit / traceability
DB schema يدعم `events`, `audit_logs`, `task_logs`, و`correlationId`. `audit.ts` يكتب best-effort telemetry، و`scan-runner.ts` و`projects/tasks/workflows/ai` routes تضيف correlation IDs ومجالات projectId لتسهيل tracing.

### logging والإدارة التشغيلية
`logger.ts` يستخدم pino مع redaction. `app.ts` يضيف helmet, cors, rate-limit, body size limits. `health.ts` يضيف healthz مع operational counters. هذا يشير إلى نية تشغيلية حقيقية لا مجرد demo.

### الاختبارات وCI
يوجد 35 ملف اختبار في الأرشيف الكامل، منها 13 في routes و6 في ai-orchestrator و4 في scanner و2 في knowledge-engine على الأقل ضمن الدفعة المفهرسة. CI عنده job سريع لـ codegen drift ثم validate شامل يتضمن typecheck وtests. هذا يرفع الثقة في contract-first approach.

## 8) تحليل الوثائق

### `docs/architecture.md`
هذا هو مرجع الحقيقة الحالي بحسب banner الملف نفسه. يصف dashboard، API server، DB، scanner، knowledge-engine، AI orchestrator، ويؤكد القراءة inside-out. هذا الملف ينسجم مع الكود الذي راجعناه.

### `docs/fact-record.md` و`docs/completion-plan.md`
كلاهما موسوم صراحة بأنه historical phase log وليس current truth baseline. لذلك لا ينبغي استخدامهما وحدهما لتحديد الحالة الحالية. قيمتهما الأساسية هنا أنهما يفسران مسار التطوير السابق.

### `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md`
يعمل كمرجع تنفيذي يربط surfaces الحالية: openapi, zod, client, db, routes, audit, provenance import, scanner, knowledge-engine, dashboard. مهمته تثبيت فكرة Engineering Truth Verification كأساس.

### `scripts/validate-truth-flow.ts`
هذا سكربت gating حقيقي، لا شرح نظري. يقرأ baseline JSON ويقارنه بالـ schema/constant، ويفصل بين structural validation وdrift validation. هذا أقوى دليل على أن truth-flow ليس مجرد توثيق.

## 9) تحليل الجودة

| الجانب | التقييم | السبب المختصر |
|---|---|---|
| جودة المعمارية | جيدة إلى عالية | الفصل بين API/DB/scanner/KG/AI واضح ومسنود بكود، وليس مجرد أسماء. |
| جودة التنظيم | جيدة | الـ barrels، route hub، schema barrels، وCI gates تدل على تنظيم مقصود. |
| جودة التوثيق | متوسطة إلى جيدة | هناك baseline واضح، لكن الوثائق التاريخية كثيرة ويجب عدم خلطها بالحقيقة الحالية. |
| جودة الكود | جيدة إلى متوسطة-عالية | التعليقات والحدود صريحة، لكن بعض المسارات تبقى معقدة بسبب orchestrations والقيود الخارجية. |
| سهولة الصيانة | متوسطة-جيدة | المسارات واضحة لكن كثرة التكاملات تجعل أي drift في العقدة أو المخطط مؤثرًا. |
| القابلية للتوسع | متوسطة | يمكن التوسع أفقيًا في الطبقات الخالصة، لكن queue local وبعض decision loops قد تحتاج فصلًا إضافيًا. |
| الأمان | جيد نسبيًا | helmet/rate-limit/auth/project access/redaction موجودة، لكن لا RBAC متعدد الأدوار بعد. |
| الاختبارات | جيدة نسبيًا | وجود test suites وCI gating واضح، لكن المقاييس الحقيقية للcoverage ليست مثبتة هنا. |
| جاهزية الإنتاج | متوسطة | التشغيل يتطلب secrets, DB push, migrations, reconciliation; القاعدة جيدة لكن ليست بلا إعدادات. |

## 10) تحليل الفجوات

| العنصر | الموجود فعليًا | المتوقع/المستهدف | الفجوة | الخطورة | الأولوية | الدليل |
|---|---|---|---|---|---|---|
| RBAC / shared access | موثق على أنه owner-scoped فقط؛ requireAuth لا يقدّم role layer | تعاون متعدد الأدوار/صلاحيات | غياب role-based access وإدارة أعضاء | عالي | عالية | artifacts/api-server/src/middlewares/requireAuth.ts, lib/db/src/schema/projects.ts |
| Durability of background queue | JobQueue process-local + comment notes lost in-flight jobs on crash | تنفيذ durable background jobs | jobs in memory قد تُفقد عند restart | عالي | عالية | artifacts/api-server/src/lib/job-queue.ts, src/index.ts |
| True test coverage | metrics-calc uses structural proxy, not measured branch/line coverage | coverage measured from CI/test tooling | القياس heuristics فقط | متوسط-عالي | عالية | lib/scanner/src/metrics-calc.ts, lib/db/src/schema/metrics.ts |
| Historical docs drift | fact-record/completion-plan marked historical; architecture is current baseline | وثائق truth baseline محدثة ومتماسكة | مستندات قديمة قد تربك التحليل إذا قُرئت وحدها | متوسط | عالية | docs/fact-record.md, docs/completion-plan.md, docs/architecture.md |
| Startup dependency surface | replit.md requires Clerk secrets + GROQ key + DB push + startup migrations | تشغيل production/self-hosted بدون خطوات يدوية كثيرة | إعداد أولي يعتمد على أسرار وخطوات تشغيل | متوسط | متوسطة-عالية | replit.md, artifacts/api-server/src/index.ts, artifacts/api-server/src/app.ts |
| AI provider/key management | provider registry + key CRUD موجودان، لكن الإعداد يعتمد على مفاتيح لكل مستخدم | إدارة مفاتيح واضحة مع fallback | تعقيد تشغيلي للمزودات/المفاتيح | متوسط | متوسطة | artifacts/api-server/src/routes/ai/providers.ts, lib/ai-orchestrator/src/provider-registry.ts |
| Graph evidence provenance | graph schema يدعم provenance/evidence، والـ scanner يرسل evidence، لكن بعض legacy/manual paths تعتمد fallbacks | تغطية provenance كاملة على كل المسارات | بعض السجلات قد تكون legacy/partial provenance | متوسط | متوسطة | lib/db/src/schema/graph.ts, artifacts/api-server/src/lib/graph-provenance.ts |
| Dashboard scope validation | dashboard route/page files موجودة، لكن هذه الدفعة لم تراجعها كاملًا | تقييم واجهة المستخدم بالكامل | لا توجد أدلة كافية في هذه الدفعة وحدها | منخفض-متوسط | متوسطة | artifacts/dashboard/src/* |

## 11) إطار متابعة المشروع

### بطاقة حالة مختصرة للمكوّنات الرئيسية
يمكن استخدام البطاقات التالية كنموذج متابعة داخل Jira أو GitHub Projects:
- **API Server** — الطبقة: طبقة التنفيذ؛ الحالة: مكتمل جزئيًا؛ الإنجاز: ≈85%؛ الأولوية: تتبع الفجوات المرتبطة به؛ المسؤول: غير مذكور؛ آخر تحديث: غير متوفر؛ الاعتماديات: artifacts/api-server/src/app.ts, src/index.ts, src/routes/index.ts, src/middlewares/*.ts, src/routes/*, src/lib/*.
- **Projects / Tasks / Workflows** — الطبقة: نطاق الأعمال؛ الحالة: مكتمل جزئيًا؛ الإنجاز: ≈80%؛ الأولوية: تتبع الفجوات المرتبطة به؛ المسؤول: غير مذكور؛ آخر تحديث: غير متوفر؛ الاعتماديات: artifacts/api-server/src/routes/projects.ts, tasks.ts, workflows.ts, rules.ts, events.ts, metrics.ts.
- **Discovery Pipeline** — الطبقة: طبقة ingest؛ الحالة: مكتمل جزئيًا؛ الإنجاز: ≈80%؛ الأولوية: تتبع الفجوات المرتبطة به؛ المسؤول: غير مذكور؛ آخر تحديث: غير متوفر؛ الاعتماديات: artifacts/api-server/src/routes/discovery.ts, src/lib/discovery-runner.ts, src/lib/discovery-adapters.ts.
- **Scan Runner** — الطبقة: تنفيذ الخلفية؛ الحالة: مكتمل جزئيًا؛ الإنجاز: ≈85%؛ الأولوية: تتبع الفجوات المرتبطة به؛ المسؤول: غير مذكور؛ آخر تحديث: غير متوفر؛ الاعتماديات: artifacts/api-server/src/lib/scan-runner.ts, src/lib/plugin-runtime.ts, src/lib/job-queue.ts.
- **Knowledge Engine** — الطبقة: تحليل الجراف؛ الحالة: مكتمل جزئيًا؛ الإنجاز: ≈85%؛ الأولوية: تتبع الفجوات المرتبطة به؛ المسؤول: غير مذكور؛ آخر تحديث: غير متوفر؛ الاعتماديات: lib/knowledge-engine/src/{queries.ts,inference.ts,types.ts}.
- **Scanner** — الطبقة: استخراج هيكلي؛ الحالة: مكتمل جزئيًا؛ الإنجاز: ≈85%؛ الأولوية: تتبع الفجوات المرتبطة به؛ المسؤول: غير مذكور؛ آخر تحديث: غير متوفر؛ الاعتماديات: lib/scanner/src/{file-walker.ts,graph-extractor.ts,metrics-calc.ts,python-extractor.ts}.
- **AI Orchestrator** — الطبقة: توليد/تخطيط؛ الحالة: مكتمل جزئيًا؛ الإنجاز: ≈80%؛ الأولوية: تتبع الفجوات المرتبطة به؛ المسؤول: غير مذكور؛ آخر تحديث: غير متوفر؛ الاعتماديات: lib/ai-orchestrator/src/{context-builder.ts,agents/*.ts,schemas/*.ts,tools/*.ts,groq-client.ts}.
- **DB Schema** — الطبقة: طبقة البيانات؛ الحالة: مكتمل جزئيًا؛ الإنجاز: ≈90%؛ الأولوية: تتبع الفجوات المرتبطة به؛ المسؤول: غير مذكور؛ آخر تحديث: غير متوفر؛ الاعتماديات: lib/db/src/schema/*.ts.

### مصفوفة ربط الوثائق
| العنصر | المتطلب | التصميم | الكود | الاختبار | الملاحظة |
|---|---|---|---|---|---|
| Auth/ownership | Clerk + project ownership | requireAuth / requireProjectAccess | middlewares/*.ts + protected routes | route tests | owner-scoped only |
| Truth flow | current baseline drift gate | truth-flow schema + validator | scripts/validate-truth-flow.ts | schema/test checks | baseline JSON + schema constant |
| Graph/KG | traceable graph entities/relationships | knowledge-engine + graph schema | lib/knowledge-engine + lib/db schema/graph.ts | graph tests | evidence/provenance aware |
| AI orchestration | contextful agents | schemas + prompts + provider registry | lib/ai-orchestrator/src/* | ai-orchestrator tests | strict schemas + validation |

### دورة متابعة عملية
1. مراجعة الوثائق المعلَّمة current truth baseline فقط.
2. مقارنة الكود مع schemas وCI gates.
3. تحديث حالة المكوّنات اعتمادًا على الأدلة.
4. تحويل كل فجوة إلى task واضح.
5. تنفيذ task في أصغر PR ممكن.
6. تشغيل الاختبارات والتحقق من drift.
7. تحديث الوثائق/الـ backlog بعد الدمج.

## 12) خطة الاستكمال

### قصير المدى
الهدف: إغلاق الفجوات الحرجة التي تمنع الاستقرار التشغيلي أو تفتح باب السلوك غير المصرّح به. السبب: هذه الفجوات تظهر مباشرةً في الكود نفسه أو في banners الوثائقية. المخرجات: تقوية queue durability، تثبيت scope guards على أي routes جديدة، وتخفيض أي drift بين truth baseline وgenerated surfaces. المهارات: backend/TypeScript/Drizzle/Express. الزمن النسبي: قصير.

### متوسط المدى
الهدف: رفع نضج المكونات التفسيرية (scanner / KG / AI) وربطها بجودة قياس أفضل. السبب: الجودة الحالية تعتمد على heuristics وvalidation، لكنها تحتاج قياسات أقوى واتساق provenance أوسع. المخرجات: تحسين tests، ضبط metrics، ومزيد من التوحيد بين graph provenance وAI context. المهارات: TypeScript, data modeling, graph traversal, testing. الزمن النسبي: متوسط.

### طويل المدى
الهدف: تحويل EngineeringOS من منصة داخلية قوية إلى نظام proof-like أكثر صرامة، مع tracing أوسع، وربما تعدد أدوار وصلاحيات وتوسيع UI reflect الحقيقة الداخلية بدقة أكبر. السبب: الحالي قوي كنواة، لكن هناك حدود واضحة في RBAC/durability/operational scale. المخرجات: authorization model أوسع، job durability أفضل، وتجربة dashboard تشرح traceability بدل الاكتفاء بعرض البيانات. المهارات: معماري نظم، أمن، front-end، product instrumentation. الزمن النسبي: طويل.

## 13) سجل المخاطر

| الخطر | الأثر | التخفيف الحالي | ما يزال مفتوحًا | الدليل |
|---|---|---|---|---|
| Crash while jobs are in flight | فقدان مهمة في queue الذاكرة أو بقاء حالة DB غير متسقة | استخدام reconcile + status rows لتخفيف الأثر | إعادة enqueue/mark failed صحيحة لكنها لا تجعل queue durable | artifacts/api-server/src/index.ts, src/lib/job-queue.ts |
| Unauthorized cross-project access | خطر القراءة/التعديل خارج نطاق المشروع | requireProjectAccess/loadProjectByIdForUser على أغلب routes | أي route جديد قد يتجاوز الحارس إن لم يُلحق | artifacts/api-server/src/middlewares/requireProjectAccess.ts, src/routes/* |
| LLM provider failures | تعطّل AI features عند key/provider issue | fallback providers + error classification + rate limiting | الاعتماد على مفاتيح خارجية يظل نقطة فشل | artifacts/api-server/src/routes/ai/*.ts, lib/ai-orchestrator/src/groq-client.ts |
| Doc/implementation drift | الاعتماد على plan قديم بدل baseline الحالي | architecture.md واضح كبداية truth الحالية | fact-record/completion-plan يجب ألا تُستخدم وحدها | docs/*.md |

## 14) قائمة الافتراضات غير المؤكدة

- لم تُقرأ جميع ملفات dashboard في هذه الدفعة قراءة كاملة، لذلك تقدير نضج الواجهة ما يزال جزئيًا.
- لم تُراجع كل ملفات `.agents/memory` و`attached_assets` في هذه الدفعة، لذا أي ذكر لتاريخ التطوير الأقدم يبقى contextual فقط.
- تقديرات الاكتمال المذكورة هنا استدلالية من الأدلة، وليست قياسًا كميًا رسميًا.
- أي مسار AI أو route جديد غير موجود في الملفات المقروءة لا يمكن اعتباره موجودًا.

## 15) ملحق الملفات التي تم تحليلها

الفهرس التفصيلي لهذه الدفعة موجود أيضًا في CSV المرفق. أما الفهرس الكامل للدفعة الأولى فهو ما يزال المرجع الأوسع على مستوى الأرشيف كله.

### ملاحظات ختامية
هذه الدفعة تُظهر أن EngineeringOS ليس مشروعًا واجهات فقط ولا Scanner فقط؛ هو نظام truth/trace/AI مترابط. لكن نجاحه النهائي يعتمد على إغلاق الفجوات التشغيلية التي اعترف بها الكود نفسه: queue durability، RBAC أوسع، وقياس جودة أكثر صرامة.
# EngineeringOS — السلسلة التالية: تحليل عميق بالأدلة من داخل الكود والملفات

آخر تحقق فعلي على الأرشيف: 2026-07-13

## الخلاصة التنفيذية

EngineeringOS لم يعد مجرد “منصة قيد البناء”، بل أصبح control plane هندسي متعدد الطبقات له خط حقيقة واضح من العقد إلى البيانات إلى التنفيذ إلى التحليل إلى الحوكمة.
اللافت هنا ليس كثرة الملفات فقط، بل أن المنظومة بدأت تُثبت نفسها ذاتيًا عبر حلقات تحقق متقاطعة: `openapi.yaml` كمصدر الحقيقة، `codegen` و`codegen:check` لكشف drift، قيود Drizzle/FKs، طوابير bounded للتشغيل الخلفي، اختبارات سلوكية على المسارات الحرجة، وطبقة تدقيق/أحداث/مرجعية provenance تسمح بتتبع كل أثر تقريبًا من المصدر إلى النتيجة.

## ما ثبت بالأدلة من الأرشيف

- إجمالي عناصر الأرشيف: 518.
- الملفات الموثقة في `docs/fact-record.md`: 383 ملفًا.
- عقد OpenAPI: 47 مسارًا و58 عملية فعلية.
- توزيع العمليات حسب الطبقة:
  - Workflows: 10
  - Tasks: 9
  - Projects: 8
  - AI: 7
  - Rules: 6
  - KnowledgeGraph: 6
  - Discovery: 4
  - Plugins: 3
  - Metrics: 2
  - Health / Events / Dashboard: 1 لكل منها
- طبقة المسارات في الـ API:
  - 13 ملف route إنتاجي
  - 7 ملفات اختبار routes
- طبقة البيانات:
  - 13 ملف schema رئيسي
  - جداول واضحة تشمل: projects, scan_jobs, discovery_sessions, tasks, workflows, workflow_executions, graph_entities, graph_relationships, metrics, events, audit_logs, task_logs, ai_chat_sessions, ai_chat_messages, plugins
- طبقة AI:
  - 5 وكلاء صريحين في `lib/ai-orchestrator/src/agents/`
- طبقة scanner:
  - TS/JS AST extraction عبر TypeScript compiler API
  - Python AST batch extraction عبر python3 subprocess
  - regex fallback فقط عندما يلزم

## خط الحقيقة الطبقي

### 1) العقد أولًا: OpenAPI هو المرجع الأعلى
الـ API مُعرّف في `lib/api-spec/openapi.yaml`، ثم يُولَّد منه:
- `lib/api-zod/src/generated/`
- `lib/api-client-react/src/generated/`

ثم يوجد حارس drift واضح:
- `scripts/check-codegen-drift.ts`
- و`package.json` يجعل `build` يمر عبر `codegen` ثم `typecheck`

هذا يعني أن العقد ليست وثيقة وصفية فقط، بل قيد تشغيل على البناء نفسه.

### 2) الحماية ليست شكلية
`artifacts/api-server/src/app.ts` يثبت طبقة hardening فعلية:
- `app.disable("etag")` لتفادي 304 bodyless responses على البيانات الديناميكية
- `helmet`
- `rateLimit` بحد 300 طلب/5 دقائق لكل IP
- `cors({ credentials: true, origin: true })`
- body size limit = `2mb`
- `trust proxy = 1`
- `requireAuth` على كل `/api/*` ما عدا `/api/healthz`

وفي `middlewares/requireAuth.ts` يوجد تصريح صريح:
- لا roles
- لا per-project authorization بعد
- كل مستخدم authenticated لديه full access

هذه نقطة حاسمة: الأمن موجود، لكن التفويض ما يزال أحادي المستوى.

### 3) التشغيل الخلفي أصبح bounded لا fire-and-forget غير محدود
هناك `heavyJobQueue` في `lib/job-queue.ts`:
- in-process
- concurrency = 2
- يشترك فيه scan وdiscovery

هذا يثبت أن النظام انتقل من “تشغيل خلفي بلا سقف” إلى “تشغيل محدود ومضبوط”، لكنه لا يزال غير موزع ولا persistent عبر restarts.

### 4) scan pipeline صار atomic وذو أثر قابل للتتبع
`artifacts/api-server/src/lib/scan-runner.ts` يوضح أن الفحص الكامل:
- لا يُنفّذ داخل request handler
- يحدّث `scan_jobs` إلى `running`
- يلتف حول `performScan` داخل `try/catch`
- يسجل `completed` أو `failed`
- يعيد `projects.status` إلى `active` عند الفشل
- يستخدم `correlationId` واحدًا لربط `audit_logs` و`events` و`metrics`

وفي `performScan` يظهر أن الفحص الكامل داخل transaction واحدة، بحيث لا تبقى كتابة جزئية لو فشل جزء متأخر من السلسلة.

### 5) discovery import صار transactionally claimed
`routes/discovery.ts` يظهر claim ذريًا عند الاستيراد:
- session تنتقل من `ready` إلى `imported`
- claim يحدث داخل نفس transaction بعد insert المشروع
- ذلك يمنع race condition على نفس discovery session

هذا أحد أهم الأدلة على نضج النظام: المنصة تتعامل مع السباقات كحقيقة معمارية، لا كحالة نادرة.

### 6) graph layer ليس مجرد مخزن، بل layer ذات provenance
في `lib/db/src/schema/graph.ts`:
- كل entity/relationship تحمل `provenance`
- العلاقات تحمل `confidence`
- entities مرتبطة بـ `scanJobId`
- العلاقات مرتبطة بـ `scanJobId`

وفي `lib/knowledge-engine`:
- `getImpactedEntities` BFS impact traversal
- `getShortestPath`
- `getNeighborhood`
- `computeCentrality`
- `detectClusters`
- `computeGraphSummary`

هذه ليست Knowledge Graph اسمية؛ هذه طبقة معرفة قابلة للاستعلام والاستدلال.

### 7) AI layer صارت جزءًا أصيلًا من المنصة
`lib/ai-orchestrator` يضم:
- `context-builder.ts`
- 5 agents:
  - chat-agent
  - code-reviewer
  - scan-analyst
  - task-agent
  - workflow-orchestrator
- `groq-client.ts`

وفي `routes/ai.ts` توجد 7 endpoints:
- chat
- chat sessions
- chat messages
- analyze project
- review project
- orchestrate workflow
- execute task

والأهم أن AI لا يعمل في فراغ؛ بل يستهلك:
- project context
- recent tasks
- recent events
- latest metrics
- knowledge graph summary

هذا يعني أن الذكاء هنا مقيد بسياق المنصة وليس مجرد واجهة دردشة منفصلة.

### 8) plugin runtime موجود لكن مضبوط كـ in-process contract
`lib/plugin-runtime.ts` يوضح أن plugins:
- ليست processes خارجية
- بل TypeScript hooks داخل runtime
- المدعوم حاليًا: `onScanComplete`
- والـ DB يخزن enable/disable فقط

هذا قرار عملي يقلل التعقيد، لكنه يعني أيضًا أن extensibility ما زالت محدودة بالنمط الداخلي.

## ما يثبت نضج المنصة فعلًا

1. Contract-first + codegen + drift checks  
2. DB constraints + references + cascade/set null  
3. Transaction boundaries في scan/import/task/workflow  
4. Queue محدود التزامن  
5. Audit + events + metrics + correlation  
6. Scanner AST حقيقي بدل regex فقط  
7. Knowledge graph provenance + confidence  
8. AI agents مبنية على context حقيقي من النظام  
9. اختبارات سلوكية للمسارات الحرجة في:
   - discovery
   - graph
   - metrics
   - plugins
   - projects
   - tasks
   - workflows

## ما يزال جزئيًا أو مفقودًا

### مكتمل تقريبًا
- API contract and codegen loop
- scan/discovery atomic flow
- knowledge-engine الأساسية
- AI layer الأساسية
- app-level hardening
- behavioral tests للمسارات الحرجة

### جزئي
- RBAC / roles / per-project authorization
- durable background execution خارج process memory
- workflow engine كمنفذ حقيقي متعدد المراحل مع state semantics أعمق
- plugin extensibility beyond built-ins
- AI streaming / live interaction beyond request-response

### مفقود أو يحتاج إغلاقًا
- policy engine موحد
- queue persistence / job recovery across process restart
- fine-grained authorization model
- unified trace UI يربط correlationId عبر كل الطبقات بشكل مباشر للمستخدم

## قراءة معمارية نهائية

المنصة لم تعد “واجهة أمامية + backend”؛ بل أصبحت:
OpenAPI → Generated Contracts → DB Schema → Scan/Discovery Pipelines → Knowledge Graph → AI Orchestration → Routes → Dashboard → Audit/Events/Metrics

والفارق الجوهري هنا أن كل طبقة تقريبًا لديها أثر قابل للتحقق داخل الكود:
- إذا تغيّر العقد، codegen drift يفضحه.
- إذا فشل scan، job row يسجل ذلك.
- إذا فشل import، claim الذري يمنع التكرار.
- إذا تغيّر graph، provenance يوضح المصدر.
- إذا استُخدمت AI، context يوضح ما رأت ولماذا.
- إذا حدثت عملية كبيرة، correlationId يجمع آثارها.

## الخطوة التالية العملية

المرحلة التالية لا ينبغي أن تكون UI-first.
الأولوية هي:
1. إغلاق RBAC / authorization
2. تعميم policy engine
3. تحويل jobs من in-process queue إلى execution durable أو على الأقل recoverable
4. توحيد tracing/correlation في واجهة تشغيلية
5. توسيع workflow execution ليصبح orchestration engine كاملًا
6. بعد ذلك فقط يأتي تعميق الواجهة

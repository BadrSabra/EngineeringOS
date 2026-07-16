# EngineeringOS — السلسلة 26
## حدود الثقة والتشغيل بين النواة الموثَّقة والطبقة الذكية

هذه السلسلة لا تعيد شرح الفكرة العامة، بل تثبّت **أين انتهى المشروع فعليًا الآن** من داخل الملفات نفسها: ما الذي صار جزءًا من النواة، ما الذي أصبح قابلًا للتشغيل المتكرر، وما الذي ما يزال يحتاج إغلاقًا قبل اعتبار المنصة مكتملة حوكميًا.

## 1) الصورة الحالية بالأرقام

بحسب الأرشيف المرفوع وملفات التوثيق الداخلية:

- الأرشيف يحتوي **518 ملفًا**.
- ملف `docs/fact-record.md` يذكر أن الملفات الموثّقة داخله وصلت إلى **383 ملفًا**.
- `lib/api-spec/openapi.yaml` يحتوي **47 مسارًا** و **58 عملية API** فعلية.
- في `lib/api-spec` يوجد **59 schema** معرّفًا.
- في `lib/db/src/schema/` يوجد **14 ملف مخطط** منفصلًا.
- في `artifacts/api-server/src/routes/` يوجد **20 ملف route/test**، منها **7 ملفات route tests**.
- في `.agents/memory/` يوجد **14 مذكرة قرار وتشغيل** تحفظ تاريخ القرارات المهمة.
- `docs/fact-record.md` يصرّح أن آخر تحقق في **2026-07-13** يشمل طبقة AI الكاملة + codegen ناجح + typecheck نظيف.

هذه الأرقام مهمة لأنها تُظهر أن EngineeringOS لم يعد "مشروعًا مفككًا"؛ بل صار **منصة بعقود واضحة، طبقة بيانات واضحة، طبقة تنفيذ واضحة، وطبقة ذكاء واضحة**.

## 2) ما الذي ثبت الآن من داخل الكود

### أ) العقد صار مصدر الحقيقة، لا مجرد وثيقة
الملف `lib/api-spec/openapi.yaml` هو المرجع الأعلى للعقد، وليس مجرد وصف نظري.  
الأثر العملي لهذا ظاهر في:

- `package.json`:
  - `codegen` يعيد توليد الكود من OpenAPI.
  - `codegen:check` يوقف البناء إذا ظهر drift بين العقد والمولَّدات.
  - `build` يبدأ بـ codegen ثم typecheck ثم build.
- `replit.md` يربط هذا مباشرة بالمسارات الفعلية:
  - `lib/api-spec/openapi.yaml`
  - `lib/api-zod/src/generated/`
  - `lib/api-client-react/src/generated/`

هذا يعني أن المشروع لا يحاول فقط "توضيح" نفسه، بل **يمنع التباين بين العقد والكود**.

### ب) طبقة البيانات الآن تحمل invariants حقيقية
ملفات `lib/db/src/schema/` لا تصف جداول فقط؛ بل تصف **سلوكًا تشغيليًا**:

- `projects.ts` يفرض `rootPath` فريدًا ويميز `status`.
- `scan_jobs.ts` يربط job بالمشروع عبر FK مع `onDelete: cascade`.
- `events.ts` يربط الأحداث بـ `projects`, `tasks`, `workflows` مع FKs مناسبة و`correlationId` اختياري.
- `ai_chats.ts` يضيف `ai_chat_sessions` و`ai_chat_messages` كجزء من الحالة الدائمة للذكاء الاصطناعي.
- `workflows.ts` يعرّف `workflow_executions` ككيان مستقل عن workflow نفسه.

النتيجة: البيانات لم تعد "مخزنًا" فقط، بل **محركًا لحالة النظام**.

### ج) discovery/import أصبح مسارًا حقيقيًا مبنيًا على claim/transaction
`artifacts/api-server/src/routes/discovery.ts` يحتوي عدة نقاط حاسمة:

- `validateRootPath(...)` يرفض المسارات غير الصالحة مبكرًا.
- `runDiscovery(...)` يبني مراحل discovery بشكل متسلسل مع progress وstatus.
- `POST /projects/discover` ينشئ session ويعيد `202 Accepted`.
- `GET /projects/discover/:discoveryId/summary` لا يسمح بالملخص قبل اكتمال discovery.
- `POST /projects/import`:
  - يعمل داخل `db.transaction(...)`.
  - يستخدم **atomic claim** من `ready` إلى `imported`.
  - ينشئ المشروع والجداول المرتبطة في نفس المعاملة.
  - يعالج سباق المنافسة بين importين متزامنين عبر conditional update وunique violation.

هذا مهم جدًا: discovery لم يعد مجرد "فحص أولي"، بل **باب دخول محكوم** إلى المنصة.

### د) الفحص Scan صار bounded + atomic + reconciled
الملفات الثلاثة:

- `artifacts/api-server/src/lib/job-queue.ts`
- `artifacts/api-server/src/lib/job-reconciliation.ts`
- `artifacts/api-server/src/lib/scan-runner.ts`

تثبت أن scan لم يعد fire-and-forget فوضويًا:

- `JobQueue` يحد التزامن حتى لا يبتلع event loop.
- `job-reconciliation.ts` يعيد تسوية jobs العالقة عند startup قبل قبول traffic.
- `scan-runner.ts` يضع عمل الفحص داخل try/catch ويحدّث job row بحالة نهائية.
- `performScan(...)` لا يكتب النتائج النهائية جزئيًا؛ بل يجمع أهم الكتابات داخل transaction.
- في `scan-runner.ts` نرى بوضوح أن نتيجة الفحص تشمل:
  - tasks
  - rule hit counts
  - graph entities/relationships
  - metrics
  - project score/status
  - event logging
  - plugin dispatch بعد commit

هذه نقطة نضج كبيرة: الفحص أصبح **عملية قابلة للتكرار والاستعادة** بدل وظيفة خلفية غير منضبطة.

### هـ) workflow/task state machines أصبحت حقيقية
الملفان:

- `artifacts/api-server/src/routes/tasks.ts`
- `artifacts/api-server/src/routes/workflows.ts`

يوضحان أن المنصة لا تكتفي CRUD:

#### tasks
- `execute`
- `retry`
- `rollback`
- `logs`

وفي كل انتقال تقريبًا يوجد:
- atomic claim
- status guard
- transactional update
- correlationId
- audit/event emission

#### workflows
- `start`
- `stop`
- `advance`
- `fail-phase`
- `retry-phase`

وهنا أيضًا:
- transitions مشروطة
- execution row منفصلة
- phase progression محكومة
- السجل يربط العملية بكامل آثارها

هذا يعني أن EngineeringOS صار يملك **state machine layer** حقيقيًا، وليس مجرد واجهة لإدارة العناصر.

### و) المعرفة Knowledge Engine صارت طبقة قراءة دلالية فوق graph
`lib/knowledge-engine/src/index.ts` يثبت أن الطبقة ليست عرض graph فقط، بل:

- `getImpactedEntities`
- `getShortestPath`
- `getNeighborhood`
- `fetchProjectGraph`
- `computeCentrality`
- `detectClusters`
- `computeGraphSummary`

وهذا مهم لأن الـ graph لم يعد "مستودع علاقات"، بل **طبقة استدلال read-only** فوق البيانات.

### ز) طبقة AI أصبحت مسارًا منتجًا لا فكرة معلقة
الملف `lib/ai-orchestrator/src/index.ts` يعرّف واجهة تشغيل AI تشمل:

- `chat`
- `executeTask`
- `analyzeScan`
- `reviewCode`
- `orchestrateWorkflow`
- `buildProjectContext`
- plus Groq client helpers

ومع `artifacts/api-server/src/routes/ai.ts` تظهر 7 endpoints رئيسية:

- `POST /ai/chat`
- `GET /ai/chat/sessions`
- `GET /ai/chat/:sessionId/messages`
- `POST /ai/projects/:projectId/analyze`
- `POST /ai/projects/:projectId/review`
- `POST /ai/workflows/:workflowId/orchestrate`
- `POST /ai/tasks/:taskId/execute`

ومع `lib/db/src/schema/ai_chats.ts` صار هناك storage حقيقي للحوارات والرسائل.

الخلاصة: AI layer لم تعد مجرد experiment؛ بل **subsystem متكامل**.

### ح) الحوكمة الأمنية الأساسية أصبحت موجودة
`artifacts/api-server/src/app.ts` و`middlewares/requireAuth.ts` يثبتان:

- `helmet`
- `rateLimit`
- `trust proxy = 1`
- تعطيل `etag`
- Clerk proxy middleware
- `requireAuth`

لكن `requireAuth.ts` نفسه يصرّح بوضوح أن:

- لا يوجد بعد **per-role** أو **per-project authorization**
- الوصول ما زال **single-tier** بعد التوثيق

وهنا يقع الحد الفاصل بين "آمن مبدئيًا" و"مفوض حوكميًا".

## 3) ماذا يعني ذلك على مستوى الوضع الحالي؟

EngineeringOS الآن يمكن وصفه بدقة هكذا:

- **نواة عقود**
- **نواة بيانات**
- **نواة تنفيذ خلفية**
- **نواة state machines**
- **نواة knowledge graph**
- **نواة AI orchestration**
- **نواة أمان أساسي**
- **نواة توثيق ذاتي**

هذا ليس مجرد stack؛ هذا **control plane تشغيلي**.

لكن المنصة ما تزال غير مكتملة حوكميًا لأن بعض الحدود لم تُغلق بعد.

## 4) الفجوات الحقيقية المتبقية

### 1. Authorization متقدم غير موجود
`requireAuth.ts` يوضح أن جميع المستخدمين الموثقين يملكون نفس المستوى تقريبًا من الوصول.  
هذا يعني غياب:

- RBAC
- project-scoped permissions
- policy evaluation
- explicit deny/allow semantics

الأثر: المنصة محمية من غير الموثق، لكنها ليست بعد **مجزأة الصلاحيات**.

### 2. correlationId موجود في البيانات، لكن ليس موحدًا في العقد
`lib/db/src/schema/events.ts` يحتوي `correlationId`، و`routes/events.ts` يدعمه مباشرة عبر parsing يدوي، لكن الملف نفسه يصرّح بأن generated schema لم يُحدّث بعد ليشمله.

الأثر: tracing جزئي، وليس traceability شاملة من العقد حتى الـ UI.

### 3. AI قوية لكن ليست مفعّلة في كل خطوط التشغيل
الـ AI layer الآن موجودة كمسار مستقل `/api/ai/*`.  
لكن هذا لا يعني أنها أصبحت **الطبقة الضابطة الافتراضية** لكل scan/task/workflow.

الأثر: AI subsystem موجود، لكن ما زال integration depth محدودًا مقارنة بإمكاناته.

### 4. لا توجد route tests مستقلة لـ AI
يوجد 7 route test areas، لكن لا توجد `ai.test.ts` ضمن `artifacts/api-server/src/routes/`.

الأثر: الطبقة الجديدة ما زالت أضعف من حيث regression safety مقارنةً بالطبقات الأقدم.

### 5. plugin runtime best-effort
`artifacts/api-server/src/lib/plugin-runtime.ts` يوضح أن dispatch يتم بعد نجاح scan commit وأنه best-effort telemetry.

الأثر:
- جيد لعدم كسر المسار الأساسي
- لكن ليس بعد امتدادًا حوكميًا مضمونًا أو durable event pipeline

## 5) التفسير الأعمق: ما الذي أصبح "مضمونًا" وما الذي لم يصبح بعد؟

### مضمون الآن
- العقد لا تنفصل عن generated clients/schemas بسهولة.
- الفحص لا يترك آثارًا نصفية عند الفشل.
- discovery/import لا يفقد الاتساق عند التزامن.
- tasks/workflows لا تتقدم عشوائيًا.
- graph والـ metrics والـ events مقروءة كطبقات مستقلة.
- AI لديها storage وroutes وorchestrator حقيقي.

### غير مضمون بعد
- صلاحيات دقيقة على مستوى السياق.
- event correlation coverage كامل.
- durability خارج الذاكرة لبعض الأنماط.
- end-to-end tests للطبقات الجديدة.
- جعل AI جزءًا من default operating path بدل كونها subsystem منفصل.

## 6) خلاصة السلسلة 26

السلسلة الحالية تثبت أن EngineeringOS عبر من مرحلة "إثبات الفكرة" إلى مرحلة **نظام تشغيل هندسي قابل للضبط**.  
المشروع الآن ليس مجرد تطبيق CRUD ولا مجرد dashboard، بل طبقات متراكبة من:

**contract → data → discovery → execution → graph → inference → orchestration → governance**

والسؤال المتبقي لم يعد: هل النظام موجود؟  
بل: **كيف نغلق طبقة الحوكمة حتى يصبح control plane كاملًا ومفوضًا ومتاحًا بشكل آمن؟**

## 7) الترتيب المنطقي لما بعد هذه السلسلة

الأولوية التالية الطبيعية هي:

1. إدخال RBAC / policy layer حقيقي
2. توحيد correlationId في العقد والمولدات والـ UI
3. إضافة اختبارات AI routes
4. جعل jobs أكثر durable خارج الذاكرة
5. رفع AI من subsystem إلى orchestration surface أوسع
6. جعل traceability end-to-end من discovery إلى metrics إلى events إلى UI

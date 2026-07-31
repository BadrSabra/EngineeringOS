# EngineeringOS — السلسلة 31: تدقيق تسليم وتشغيل

**نطاق هذه السلسلة:** هذه قراءة داخلية للأرشيف الفعلي للمشروع تركّز على سؤال واحد: هل EngineeringOS أصبح منصة تشغيلية قابلة للتسليم، أم ما زال يحتاج إغلاقًا في حدود الثقة، الديمومة، والاختبارات؟

**الخلاصة التنفيذية:**
EngineeringOS لم يعد نموذجًا أوليًا؛ أصبح **control plane متعدد الطبقات** متماسكًا: عقد OpenAPI أولًا، توليد آلي للعميل وschemas، قاعدة بيانات Drizzle بترابطات صريحة، scanner فعلي، knowledge graph قابل للاستعلام، queue محدود التزامن، reconciliation عند الإقلاع، audit/provenance، وطبقة AI متعددة الوكلاء. لكن التسليم النهائي ما يزال مشروطًا بإغلاق ثلاثة محاور: **RBAC/authorization التفصيلي، الديمومة خارج الذاكرة للمهام الخلفية، وتوسيع الاختبارات/التغطية لأسطح AI/events**.

---

## 1) مؤشرات النضج التي تثبت أن المنصة أصبحت تشغيلية فعلًا

| الطبقة | الحالة | الدليل من الملفات | الأثر | ما تبقى |
|---|---|---|---|---|
| العقود والـ codegen | مكتمل تقريبًا | `lib/api-spec/openapi.yaml` يحتوي **47 path** و**58 operation** و**59 schema**؛ الجذر يملك `codegen` و`codegen:check` و`build` و`typecheck`؛ `lib/api-client-react/src/generated/*` و`lib/api-zod/src/generated/*` مولدة من العقد | العقد هي مصدر الحقيقة، والعميل/التحقق النوعي يدور حولها | إبقاء الـ OpenAPI والـ generated code متزامنين بلا drift |
| قاعدة البيانات | مكتمل | `lib/db/src/schema/*.ts` = **13 ملفات schema** و**16 جدولًا** مع enums واضحة للعُقَد والمهام والـ workflow والـ audit والـ graph والـ AI chat | بنية بيانات حقيقية وليست مجرد JSON عابر | استمرار ضبط القيود والأنواع مع أي توسع |
| مسارات الـ API | مكتمل وظيفيًا | `artifacts/api-server/src/routes/` يضم مشاريع/مهام/قواعد/سير عمل/أحداث/metrics/graph/plugins/discovery/AI/dashboard | السطح الخارجي أصبح Control Plane فعليًا | توحيد الحماية والاختبارات على كل المسارات |
| التنفيذ الخلفي | مكتمل مع حدود واضحة | `artifacts/api-server/src/lib/job-queue.ts`, `job-reconciliation.ts`, `scan-runner.ts` | يوجد queue محدود التزامن + إصلاح orphaned jobs عند الإقلاع + scan atomic | الديمومة ما تزال in-memory أثناء التنفيذ |
| التتبّع والحوكمة | قوي | `audit_logs`, `events`, `task_logs`, `correlationId` في `scan-runner.ts`, `tasks.ts`, `workflows.ts`, `events.ts` | يمكن تتبع العملية من البداية للنهاية عبر correlation واحد | جعل correlationId مغطى بشكل أوضح في العقد والواجهات |
| الذكاء الاصطناعي | مكتمل وظيفيًا | `lib/ai-orchestrator/src/agents/*` = **5 وكلاء**؛ `artifacts/api-server/src/routes/ai.ts` = **7 endpoints**؛ `AiChat.tsx` في اللوحة | AI ليس “مضافًا” بل جزء من مسار المنتج | التوسعة الاختبارية والربط الأوسع داخل المسارات العامة |
| الواجهة | مكتملة كـ command center | `artifacts/dashboard/src/App.tsx`, `DiscoverProjectWizard.tsx`, `AiChat.tsx` | الواجهة تعكس الطبقات الفعلية: discovery، project ops، graph، AI | تعميق الاختبارات UX وAPI integration |

---

## 2) ماذا يثبت أن EngineeringOS ليس مجرد فكرة

### 2.1 العقد أولًا وليس التنفيذ أولًا
- `lib/api-spec/openapi.yaml` هو مصدر الحقيقة للعقد.
- الحزمة الجذرية تفرض `codegen` ثم `codegen:check` ثم `build` و`typecheck`.
- وجود `lib/api-client-react/src/generated/*` و`lib/api-zod/src/generated/*` يعني أن العميل والتحقق النوعي ليسا مكتوبين يدويًا بشكل منفصل، بل مشتقان من نفس العقد.

**النتيجة:** أي تعديل في العقود ينعكس على التوليد، وأي drift سيظهر كمشكلة build/verify بدل أن يبقى خافيًا داخل runtime.

### 2.2 قاعدة بيانات حقيقية بعلاقات ومجالات عمل متعددة
الـ schema لم تعد فقط مشاريع/مهام؛ بل أصبحت تشمل:
- `projects`
- `tasks`
- `workflows` و`workflow_executions`
- `rules`
- `scan_jobs`
- `discovery_sessions`
- `events`
- `task_logs`
- `audit_logs`
- `graph_entities` و`graph_relationships`
- `metrics`
- `plugins`
- `ai_chat_sessions` و`ai_chat_messages`

وهذا يضع EngineeringOS في وضع منصة تشغيلية كاملة: بيانات، تتبّع، معرفة، ذكاء، وحوكمة.

### 2.3 طبقة تشغيل خلفية حقيقية
`projects.ts` لا ينفّذ scan inline؛ بل:
1. يسجّل `scan_jobs`.
2. يغيّر حالة المشروع إلى `scanning`.
3. يضع المهمة في `heavyJobQueue`.
4. يترك `runScanJob()` ليُنجز العمل خارج الطلب.
5. يعيد الحالة إلى `active` عند الفشل أو الاكتمال.

هذا فرق جوهري بين “endpoint يقوم بشيء” و“control plane يدير دورة حياة عمل”.

---

## 3) حدود الثقة والأمان: ما هو محكم، وما هو ما يزال مفتوحًا

### 3.1 الحماية الأساسية موجودة فعلًا
في `artifacts/api-server/src/app.ts`:
- `helmet`
- `express-rate-limit`
- `cors` مع credentials
- حد 2MB للـ body
- `trust proxy = 1`
- `Cache-Control: no-store` لكل `/api`
- Clerk middleware
- `requireAuth` لكل `/api` ما عدا `/api/healthz`

هذا يعني أن الواجهة ليست مكشوفة عشوائيًا، وأن السطح العام مضبوط على مستوى معقول لخدمة داخلية/تشغيلية.

### 3.2 لكن التفويض ما يزال طبقة واحدة
`artifacts/api-server/src/middlewares/requireAuth.ts` يوضح بوضوح أن:
- أي مستخدم مسجّل له وصول كامل.
- لا يوجد RBAC.
- لا يوجد ACL.
- لا يوجد per-project authorization.

**هذا ليس عيبًا مخفيًا؛ هو حد حالي معلن.**

**الأثر على التسليم:**
- مناسب كمنصة داخلية أو لفريق واحد موثوق.
- غير كافٍ كمستوى Enterprise/متعدد المستأجرين/محتوى حساس.

### 3.3 Clerk proxy مضبوط، لكن هذا ليس بديلًا عن authorization
`clerkProxyMiddleware.ts` يحل مشكلة custom domains وFrontend API proxy في production، ويعالج مشكلة content-length/transfer-encoding على edge.
هذا نضج تشغيلي مهم، لكنه لا يحل مسألة الصلاحيات داخل النظام نفسه.

---

## 4) الديمومة والاستمرارية: أين ينجح التصميم وأين يتوقف

### 4.1 Queue محدود التزامن — خطوة صحيحة
`artifacts/api-server/src/lib/job-queue.ts` يحدد `heavyJobQueue = new JobQueue(2)`.
هذا يعني:
- لا يوجد انفجار غير محدود في scans/discovery.
- كل مهمة heavy تدخل queue في الذاكرة.
- الفشل في job لا يجب أن يخرج كـ unhandled rejection.

### 4.2 Startup reconciliation — مهم جدًا لكنه يكشف الحد
`artifacts/api-server/src/lib/job-reconciliation.ts` يفعل sweep عند الإقلاع:
- أي `scan_jobs` ما زال `queued` أو `running` يُوسم `failed`.
- أي `discovery_sessions` ما زالت `discovering` تُوسم `error`.

**المعنى العملي:**
النظام لا “يستعيد” العمل بعد crash؛ بل **ينظفه** ويبدأ من جديد. هذا تصميم مقبول لمنتج داخلي، لكنه ليس resumable durable workflow engine.

### 4.3 scan-runner آمن جزئيًا ولكنه transactional
`artifacts/api-server/src/lib/scan-runner.ts` يثبت ثلاثة أشياء مهمة:
1. scan job يُحوّل إلى `running` ثم `completed/failed`.
2. كل نتائج scan الأساسية تُكتب داخل **معاملة واحدة**: tasks, graph, metrics, project update, event.
3. `correlationId` واحد يربط `audit_logs`, `events`, `metrics`, و`task_logs`.

**لكن:** التنفيذ نفسه يبقى in-process. لو ماتت العملية أثناء التنفيذ قبل إتمام المعاملة، فالـ reconciliation سيحوّل الحالة إلى فشل بدل إكمالها.

---

## 5) التتبّع والـ provenance: نقطة قوة واضحة

### 5.1 كل عملية مهمة لها أثر قابل للتتبع
- `events.ts` يملك `correlationId` ويتيح الفلترة عليه.
- `task_logs.ts` يربط log lines بالعملية المنطقية.
- `audit.ts` يكتب سجلًا best-effort بعد commit.
- `scan-runner.ts` يوحّد trace عبر scan كامل.
- `tasks.ts` و`workflows.ts` يشتغلان بنفس مبدأ claim/transaction/audit.

### 5.2 graph ليس مجرد رسم، بل knowledge graph مع provenance
`lib/db/src/schema/graph.ts` يثبت:
- `graph_entities`
- `graph_relationships`
- `provenance` JSON لكل عنصر وعلاقة
- `confidence` للعلاقات
- ربط بـ `scan_job_id`

هذا مهم جدًا: المنصة لا تخزن “علاقات” فقط، بل تخزن **كيف اكتُشفت العلاقة ولماذا يمكن الوثوق بها**.

### 5.3 gap مهم في events contract
`events.ts` يسمح بالتصفية عبر `correlationId` حتى لو لم يكن مُمثّلًا بالكامل بعد في generated schema. هذا ليس عيبًا تشغيليًا، لكنه **فجوة عقدية** يجب تسويتها حتى لا تبقى بعض قدرات المنصة “موجودة في الكود ومخفية في التوليد”.

---

## 6) طبقة المهام والسير: state machines حقيقية وليست أزرار UI

### 6.1 tasks.ts
- `execute`
- `retry`
- `rollback`
- `logs`
- حالة task تنتقل عبر `pending/queued/running/verifying/completed/failed/cancelled`
- claim atomic مع 409 في حالة السباق

### 6.2 workflows.ts
- `start`
- `stop`
- `advance`
- `fail-phase`
- `retry-phase`
- execution state محفوظ في `workflow_executions`

**هذا يثبت أن النظام يدير state machines فعلية**، وليس مجرد CRUD على جداول.

### 6.3 ماذا يعني هذا للتسليم؟
إذا كان الـ task/workflow layer صلبًا، فالمنصة يمكن أن تُستخدم لتنفيذ عمليات حقيقية قابلة للمراقبة والتراجع. لكن هذه القوة لا تكتمل دون RBAC وديمومة أعلى في الخلفية.

---

## 7) طبقة الذكاء الاصطناعي: كاملة وظيفيًا لكن ما تزال معزولة نسبيًا

### 7.1 البنية الداخلية
`lib/ai-orchestrator/src/agents/` يحتوي خمسة وكلاء:
- `chat-agent`
- `scan-analyst`
- `code-reviewer`
- `task-agent`
- `workflow-orchestrator`

والـ context builder يجمع:
- project snapshot
- recent tasks
- latest metrics
- graph summary
- recent events

### 7.2 نقاط API
`artifacts/api-server/src/routes/ai.ts` يوفر 7 endpoints:
- chat
- chat sessions
- chat messages
- analyze scan
- review code
- orchestrate workflow
- execute task

### 7.3 الدلالة العملية
هذه ليست “ميزة Chat” فقط؛ هذا **مسار قرار** داخل المنصة. AI يقرأ state، ويكتب back into events/tasks/workflows.

### 7.4 ما زال ناقصًا
- لا توجد route tests مخصصة لـ `ai.ts` ضمن شجرة الاختبارات الظاهرة.
- الـ AI surface قوي، لكن جزءًا منه ما يزال يعمل كجزيرة منفصلة داخل `/api/ai` بدل أن يكون متغلغلًا أكثر في كل workflow surface.

---

## 8) الواجهة: توافق واضح مع الطبقات الخلفية

`artifacts/dashboard/src/App.tsx` يظهر أن الواجهة تعكس البنية الحقيقية:
- Landing للزائر غير المسجّل
- Protected routes للوحة التشغيل
- صفحات: Projects, Tasks, Rules, Workflows, Events, Metrics, Graph, AiChat
- `DiscoverProjectWizard.tsx` يطابق مسار discovery الحقيقي
- `AiChat.tsx` يستهلك `/api/ai/*`

**الاستنتاج:** الواجهة ليست mockup منفصل؛ هي surface تشغيلية فوق الـ APIs الحقيقية.

---

## 9) صورة الاختبارات والتغطية

من شجرة الملفات الحالية:
- **14 ملف اختبار** إجمالًا: 7 لسطح API، 3 لوحدات API server، 4 في scanner.
- الاختبارات تغطي: discovery, graph, metrics, plugins, projects, tasks, workflows, job-queue, job-reconciliation, plugin-runtime, scanner internals.
- لا تظهر اختبارات route مباشرة لـ `ai.ts` أو `events.ts` أو `dashboard.ts` في الشجرة الحالية.

**هذا ليس فشلًا شاملاً**؛ لكنه يحدد أين يكون أثر الانقطاع أعلى لو أُهملت هذه الأسطح.

---

## 10) سجل الحالة الطبقي المختصر

| الطبقة | مكتمل | جزئي | مفقود | الأثر | الخطوة التالية |
|---|---:|---:|---:|---|---|
| OpenAPI/codegen | نعم |  |  | contract-first حقيقي | الحفاظ على عدم وجود drift |
| DB schema | نعم |  |  | بيانات/علاقات/قيود حقيقية | توسيع القيود عند الحاجة فقط |
| Auth/Access |  | نعم | RBAC/ACL | مخاطر متعددة المستأجرين وصلاحيات زائدة | إضافة per-project roles |
| Background jobs |  | نعم | durable resume | orphan jobs تُفشل عند restart | نقل التنفيذ إلى persistence أقوى |
| Traceability | نعم |  |  | correlationId + audit/events/logs | تغطية أوسع للعقد والواجهات |
| AI layer | نعم |  |  | قرار وتحليل مدمجان بالمنصة | زيادة الاختبارات والدمج عبر surfaces |
| Plugin runtime |  | نعم | sandbox/isolation | best-effort فقط، ليس أمانًا تشغيليًا كاملًا | فصل runtime أو sandbox |
| UI | نعم |  |  | command center متوافق مع الخلفية | اختبارات تكامل مسار/حالة |

---

## 11) الحكم النهائي على جاهزية التسليم

**جاهز كمنصة داخلية متقدمة وقوية جدًا.**

**غير جاهز بعد كمنتج متعدد المستأجرين أو compliance-heavy.**

السبب ليس نقصًا في الفكرة، بل في **حدود الحوكمة والديمومة**:
- تفويض أحادي المستوى بدل RBAC
- queue in-memory بدل durable workflow engine
- audit best-effort بدل transactional compliance log
- plugin hooks داخل العملية نفسها
- تغطية اختبارية غير متساوية بين السطوح

---

## 12) ما أوصي بإغلاقه قبل أي تسليم أوسع

1. **RBAC/Project membership**
   - أولوية P0
   - لأن أي authenticated user يملك الآن وصولًا كاملًا.

2. **Durability للمهام الخلفية**
   - إما persistence/resume أو strong retry semantics مع حالة واضحة.
   - لأن reconciliation الحالي يفشل الأورفان بدل استكماله.

3. **توسيع اختبارات AI/events/dashboard**
   - لأن هذه الأسطح أصبحت جزءًا حقيقيًا من المنتج.

4. **تحديد position audit رسميًا**
   - هل هو traceability داخلي؟ أم سجل التزام؟
   - إن كان compliance-grade فيجب transactional or compensating guarantees.

5. **تثبيت العقد على correlationId filters**
   - خاصة في events وما يتصل بالتتبّع المشترك.

6. **فصل/عزل plugin runtime**
   - إذا كان الهدف هو التحمل، لا يكفي أن يكون in-process فقط.

---

## 13) جملة واحدة تلخّص الوضع الحالي

EngineeringOS اليوم ليس “مشروعًا قيد البناء” بقدر ما هو **منصة تشغيلية مكتملة النواة تحتاج إغلاقًا في الحوكمة والديمومة قبل أن تُسلَّم بثقة أوسع**.


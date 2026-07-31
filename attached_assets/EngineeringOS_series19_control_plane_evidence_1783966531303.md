# EngineeringOS — السلسلة 19: أدلة التحكم التشغيلي والطبقة الذاتية التحقق

**تاريخ القراءة:** 2026-07-13  
**مصدر القراءة:** الأرشيف الفعلي للمستودع `EngineeringOS-main (26).zip` + سجل الحقيقة الداخلي `docs/fact-record.md` + ملفات التنفيذ والتشغيل.

## الخلاصة التنفيذية

المشروع لم يعد مجرد skeleton أو مجموعة صفحات ولوحات؛ الكود يثبت أنه أصبح **control plane متعدد الطبقات**:

`OpenAPI contract → generated types/hooks → DB schema → scanner → knowledge engine → AI orchestrator → API server → dashboard`

الفرق الحاسم في هذه المرحلة أن المنصة لم تعد “تجمع البيانات” فقط، بل بدأت **تتخذ قرارات تشغيلية**: تنسيق مهام، تشغيل فحوصات بخلفية محدودة التوازي، ربط الأحداث بسياق واحد عبر `correlationId`، وبناء سياق مشروع يغذي وكلاء ذكاء اصطناعي متعددي الأدوار.

مع ذلك، ما زالت هناك حدود واضحة للحوكمة: **لا توجد أدوار/صلاحيات تفصيلية بعد**، وبعض مسارات التتبع الموحد لا تزال غير مُعمَّمة في كل الطبقات، وحقول مثل `condition` داخل `workflows.phases` موجودة في البيانات لكن لا يوجد مُفسِّر تشغيلي لها بعد.

---

## 1) ما الذي يثبت أن المشروع صار Control Plane وليس مجرد تطبيق؟

### 1.1 عقد API صارت مصدر الحقيقة الصريح

في `lib/api-spec/openapi.yaml` يوجد **47 path** و**58 operation**. الجذر `package.json` يفرض codegen قبل build، ويحتوي على فحص drift صريح يوقف الالتزام إذا اختلفت الملفات المولدة عن `openapi.yaml`.

هذا يعني أن التوافق ليس “تقديريًا”: العقد هي المرجع، والمولدات هي التابع.

**أدلة مباشرة:**
- `package.json`: `codegen`, `codegen:check`, `build`.
- `replit.md`: يصرّح بأن OpenAPI هو “مصدر الحقيقة الوحيد”.
- `lib/api-spec/orval.config.ts` + `lib/api-client-react/src/generated/*` + `lib/api-zod/src/generated/*`.

### 1.2 طبقة التشغيل الخلفي ليست fire-and-forget خام

`artifacts/api-server/src/lib/job-queue.ts` يثبت أن `scan` و`discovery` لم يعودا عملين غير محدودي التوازي؛ يوجد **bounded-concurrency queue** مشترك لسقف التنفيذ.

`artifacts/api-server/src/lib/job-reconciliation.ts` يكمّل الصورة: عند restart، أي job عالق في `queued/running` يُسوّى إلى failed بدل أن يظل النظام في حالة غير معروفة.

هذه نقطة مهمة جدًا: المنصة لا “تفترض” نجاح التشغيل فقط، بل **تعالج حالة الانقطاع**.

### 1.3 كل عملية جوهرية تخلّف أثرًا قابلًا للتتبع

`eventsTable` في `lib/db/src/schema/events.ts` يحتوي `correlationId` كحلقة وصل خفيفة تربط سلسلة العمليات المنطقية الواحدة.  
`scan-runner.ts` يشرح بوضوح أن scan واحد يكتب نفس `correlationId` في audit logs, events, metrics.  
`routes/events.ts` يسمح بالفعل بالفلترة بهذه القيمة حتى لو لم تُوسَّع بعد في schema المولَّدة.

هذا يحول المنصة من “CRUD” إلى **traceable operations platform**.

---

## 2) طبقة البيانات: ما الذي يثبت أن المشروع يملك نموذج بيانات حقيقيًا؟

### 2.1 الجداول الأساسية تغطي دورة الحياة الكاملة

الـ schema داخل `lib/db/src/schema/` تغطي:
- `projects`
- `scan_jobs`
- `tasks`
- `workflows` + `workflow_executions`
- `graph_entities` + `graph_relationships`
- `rules`
- `metrics`
- `events`
- `audit_logs`
- `plugins`
- `ai_chats` (جلسات/رسائل)

هذا ليس تجميع جداول منفصلة؛ بل **نموذج لمنتج تشغيلي**.

### 2.2 علاقات البيانات تدعم الحوكمة وليس العرض فقط

`graph.ts` يضيف أمورًا مهمة جدًا:
- `scanJobId` على الكيانات والعلاقات
- `provenance` لكل entity/relationship
- `confidence` على العلاقات

هذا يعني أن المعرفة ليست مجرد graph؛ بل graph **قابل للتدقيق** ويحتفظ بأصل الاستخراج ودرجة الثقة.

### 2.3 الـ workflow state model موجود لكنه ليس مكتمل الدلالة بعد

`workflows.ts` و`workflow_executions` يثبتان أن هناك state machine فعلية:
- `idle / running / completed / failed / stopped`
- `currentPhase`
- `completedPhases`

لكن `phases[].condition` موجود في schema ولا يظهر حتى الآن كـ evaluator فعلي. هذه فجوة مهمة: **البيانات تعرف الشرط، لكن المنفّذ لا يفسّره بالكامل بعد**.

---

## 3) طبقة الأمان والتشغيل: ما الذي تم تثبيته فعليًا؟

`artifacts/api-server/src/app.ts` يثبت حزمة حوكمة واضحة:
- `helmet`
- `express-rate-limit`
- `cors` مع credentials
- body size limits
- `Cache-Control: no-store` على `/api`
- Clerk middleware
- `requireAuth` على كل `/api` عدا health

الأهم أن الملف يصرّح صراحة: **لا يوجد تفريق أدوار بعد**، أي مستخدم مسجّل الدخول يملك الوصول الكامل إلى كل المشاريع والبيانات.

هذا ليس نقصًا بسيطًا؛ بل حدّ حوكمي واضح يجب فهمه بدقة: النظام **محمي** لكنه ليس **مفصول الصلاحيات** بعد.

---

## 4) طبقة Scanner: لماذا لم يعد مجرد file-walker؟

### 4.1 الاستكشاف صار متعدد اللغات

`lib/scanner/src/python-extractor.ts` يثبت وجود استخراج Python AST حقيقي عبر subprocess، وليس regex.  
`lib/scanner/src/python-ast-script.ts` يوضح أن الـ script يقرأ JSON batch ويعيد entities/imports/error لكل ملف، مع استمرارية للفشل الجزئي بدل إسقاط scan كامل.

### 4.2 الـ graph-extractor صار يحاول فهم الكود وليس فهرسته فقط

`lib/scanner/src/graph-extractor.ts` يبيّن:
- AST-based TS/JS extraction
- CommonJS support (`module.exports`, `exports`, `Object.assign(module.exports, ...)`)
- Python import path resolution
- entities من نوع file/function/class/module/api/task/rule/phase

هذه نقطة فارقة: المنصة لم تعد تحفظ أسماء الملفات فقط، بل بدأت تبني **خريطة علاقات قابلة للتنقل**.

---

## 5) طبقة Knowledge Engine: لماذا هي أكثر من utility library؟

`lib/knowledge-engine/src/index.ts` يصفها صراحة بأنها semantic query + inference layer فوق knowledge graph.

### 5.1 الاستعلامات الدلالية

`queries.ts` يقدّم:
- `getImpactedEntities()`
- `getShortestPath()`
- `getNeighborhood()`
- `fetchProjectGraph()`

هذه وظائف تشغيلية لفهم:
- ما الذي سيتأثر؟
- ما أقصر طريق بين عقدتين؟
- ما الجوار المباشر؟
- كيف أقرأ graph المشروع كاملًا؟

### 5.2 الاستدلال داخل الذاكرة

`inference.ts` يضيف:
- centrality
- cluster detection
- graph summary

هذا يحول graph من “مخرجات scan” إلى **طبقة فهم**.

---

## 6) طبقة AI Orchestrator: ما الجديد الحقيقي هنا؟

هذه هي القفزة الأوضح في هذه النسخة من المشروع.

### 6.1 هناك سياق مشروع موحّد يُغذّي الوكلاء

`lib/ai-orchestrator/src/context-builder.ts` يجمع:
- بيانات المشروع
- آخر المهام
- آخر metrics
- ملخص graph
- آخر events

أي أن الـ LLM لا يعمل على prompt مجرّد؛ بل على **مشهد تشغيلي حي**.

### 6.2 هناك خمسة وكلاء واضحون بأدوار منفصلة

`lib/ai-orchestrator/src/index.ts` يصدّر:
- chat
- executeTask
- analyzeScan
- reviewCode
- orchestrateWorkflow

والملفات التنفيذية تؤكد الأدوار:
- `chat-agent.ts`
- `task-agent.ts`
- `scan-analyst.ts`
- `code-reviewer.ts`
- `workflow-orchestrator.ts`

### 6.3 النموذج اللغوي صار طبقيًا وليس عشوائيًا

`groq-client.ts` يثبت وجود نموذجين مضبوطين:
- `MODEL_POWERFUL` للمهام الثقيلة
- `MODEL_FAST` للمحادثة والتحليل السريع

المنصة إذاً لا تستخدم AI كزخرفة؛ بل كـ **محرك قرار وتقييم وتنفيذ**.

### 6.4 الراوتر API يربط AI مباشرة بالكيان التشغيلي

`artifacts/api-server/src/routes/ai.ts` يربط الوكلاء بخمسة سيناريوهات واضحة:
- `/api/ai/chat`
- `/api/ai/projects/:projectId/analyze`
- `/api/ai/projects/:projectId/review`
- `/api/ai/workflows/:workflowId/orchestrate`
- `/api/ai/tasks/:taskId/execute`

وتحتها يتجلى النمط نفسه:
- بناء context
- استدعاء agent
- حفظ النتيجة
- تسجيل event
- أحيانًا تسجيل task logs / audit

هذا يثبت أن AI layer ليست isolated service، بل **مرتبطة بقاعدة النظام نفسها**.

---

## 7) طبقة API التنفيذية: كيف تُدار العمليات فعليًا؟

### 7.1 scans atomic ومحصّنة من الانقطاع

`scan-runner.ts` يوضح بجلاء:
- scan job ينتقل إلى running
- `performScan()` تنفذ خارج request path
- كل ما يتعلق بالـ scan داخل transaction واحدة
- في حالة الفشل، job تُوسم failed ويُعاد المشروع إلى active

النتيجة: لا scan half-committed يترك المشروع في حالة مشوشة.

### 7.2 tasks صار فيها atomic claim

في `routes/tasks.ts` وداخل مسارات AI للمهام:
- claim شرطي على status
- retry count guard
- commit/rollback منضبط
- logs/events/correlationId

هذا يخفف race conditions ويجعل task lifecycle أقرب إلى FSM حقيقية.

### 7.3 workflows صار فيها state machine فعلية

`routes/workflows.ts` يثبت:
- start/stop atomically
- advance/fail-phase/retry-phase
- execution row مستقل عن workflow row
- event + audit بعد كل transition

هذا ليس مجرد CRUD للـ workflows؛ بل **orchestration surface**.

---

## 8) طبقة الواجهة: هل الـ dashboard مجرد عرض؟

`artifacts/dashboard/src/App.tsx` يثبت:
- Clerk signed-in / signed-out split
- landing page عامة
- حماية routes الداخلية
- invalidation لكاش React Query عند تغيّر المستخدم
- إعادة توجيه ذكية عند sign-out

هذا مهم لأن الواجهة لا تتصرف كـ SPA عامة، بل كـ **console محكوم بالصلاحيات والجلسة**.

---

## 9) ما الذي ما يزال جزئيًا أو مفقودًا؟

### مكتمل بقوة
- OpenAPI-first contract flow
- generated schemas/hooks drift checks
- bounded job queue
- scan atomicity
- workflow state transitions
- task atomic claim/retry control
- audit/events على المسارات المتغيرة
- knowledge graph + inference
- AI orchestrator مع سياق مشروع
- dashboard محمي ومربوط بالحالة

### جزئي
- التتبع الموحد: `correlationId` موجود ومستخدم عمليًا، لكنه ليس بعد primitive موحدًا في كل schema/client path.
- workflows conditional branching: `condition` موجود في البيانات، لكن evaluator غير ظاهر بعد.
- graph navigation UI أعمق من البيانات الحالية، رغم أن البيانات أصبحت جاهزة.

### مفقود / غير موجود بعد
- RBAC / per-project roles
- policy engine مركزي يقرّر ما الذي يُسمح به بحسب الدور/السياق
- فصل صلاحيات تفصيلي بين المستخدمين
- First-class trace explorer يربط operation الواحد عبر كل tables والـ views

---

## 10) القراءة النهائية: ما هو هذا المشروع الآن؟

EngineeringOS الآن ليس “مشروع إدارة مهام” ولا “لوحة مشاريع”؛ هو أقرب إلى:

**منصة حوكمة هندسية ذاتية التحقق**

السبب:
1. لديها عقد رسمية ومولدات.
2. لديها قاعدة بيانات تمثل السياق والنتائج والآثار.
3. لديها scanner يبني معرفة من الشفرة.
4. لديها knowledge engine يستنتج ويجيب.
5. لديها AI orchestrator يصدر قرارات تشغيلية.
6. لديها API server يحكم التفاعلات.
7. لديها dashboard محمي يعرض الحالة.
8. ولديها audit/event/correlation تسمح بإثبات ما حدث.

هذه ليست أدوات منفصلة؛ هذه **طبقة تحكم هندسية**.

---

## 11) السلسلة التالية المنطقية

المرحلة التالية يجب ألا تكون وصفًا عامًا، بل واحدة من ثلاث صيغ:

- **سجل حالة رسمي نهائي**: مكتمل / جزئي / مفقود / الدليل / الأثر / الخطوة التالية لكل طبقة وملف حاكم.
- **Backlog تنفيذي صارم**: P0 / P1 / P2 / Owner / Risk / Acceptance Criteria.
- **خطة إغلاق الحوكمة**: RBAC + policy engine + correlation explorer + workflow conditions + trace unification.

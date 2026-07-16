# EngineeringOS — السلسلة 32: تدقيق الالتزام بالخطة المرحلية

هذه السلسلة لا تعيد وصف الفكرة العامة، بل تقيس **درجة التوافق الفعلية** بين الخطة المرحلية الموثقة في `docs/completion-plan.md` وبين ما هو موجود داخل الكود والملفات الآن.  
الهدف هنا: معرفة أين أصبح المشروع مطابقًا للخطة، أين تقدّم عنها، وأين ما يزال يحتاج إغلاقًا قبل اعتباره منصة مكتملة عمليًا.

## لقطة سريعة من الأرشيف

- إجمالي مدخلات الأرشيف: **518** (ملفات + مجلدات)
- ملفات المخطط/الترميز الحاكم:
  - `docs/fact-record.md`
  - `docs/completion-plan.md`
  - `package.json`
  - `replit.md`
- عدد ملفات مخطط قاعدة البيانات: **14**
- عدد الجداول المعرّفة فعليًا: **16**
- عدد ملفات المسارات في API server: **11**
- عدد مسارات OpenAPI: **47**
- عدد العمليات الفعلية في OpenAPI: **58**
- عدد ملفات الاختبار ذات الامتداد `.test.ts`: **14**
- عدد صفحات الـ dashboard: **15**

## ما الذي يثبت أن الخطة ليست كلامًا نظريًا؟

الخطة المرحلية نفسها موجودة كنص حاكم داخل المستودع:

- `docs/completion-plan.md` يفرض الترتيب الداخلي: **data → execution → analysis → orchestration → governance → tests → UI → docs**
- `docs/fact-record.md` يدوّن الحقيقة الملفية الحالية ويُحدّث بتاريخ التحقق الأخير
- `package.json` يحتوي على `codegen:check` الذي يفشل عند أي drift بين `openapi.yaml` والكود المولّد
- `replit.md` يربط التشغيل الحقيقي بمسارات الحزمة الفعلية ويذكر صراحةً ملاحظات الحوكمة والاختبارات

هذا يعني أن المشروع لا يعتمد على “نية تطوير” فقط، بل على **بنية تحقق** تمنع الانزلاق خارج التسلسل الصحيح.

## مصفوفة الالتزام المرحلي

| المرحلة | الحالة الحالية | الأدلة المباشرة | ما يثبته | الفجوات المتبقية | الخطوة التالية |
|---|---|---|---|---|---|
| 0 — تثبيت الحقيقة المعمارية | مكتمل | `docs/fact-record.md` + `docs/completion-plan.md` + `package.json` + `replit.md` | توجد حقيقة موثقة ومحدّثة، وخطة ترتيب ملزمة، وفحص drift للعقود | يجب الاستمرار في تحديث السجل مع كل تغير فعلي | إبقاء السجلين `fact-record` و`completion-plan` متزامنين مع الكود |
| 1 — سلامة البيانات والقيود | مكتمل | `lib/db/src/schema/events.ts`، `scan_jobs.ts`، `discovery.ts`، `tasks.ts`، `workflows.ts` | المفاتيح الخارجية موجودة بالفعل: project/task/workflow/job/discovery relationships مضبوطة | بعض الحقول ما زالت “معلومات تشغيلية” أكثر من كونها قيودًا صارمة؛ مثل `phases` و`verificationResult` | مراجعة الحقول شبه البنيوية فقط، لا إعادة بناء المرحلة |
| 2 — تقوية التنفيذ الخلفي | مكتمل | `artifacts/api-server/src/lib/job-queue.ts`، `job-reconciliation.ts`، `routes/discovery.ts`، `routes/tasks.ts`، `routes/workflows.ts` | يوجد queue محدود التزامن، واستعادة orphaned jobs عند الإقلاع، وclaims ذرية للمهام والسير | الديمومة ما تزال in-process على مستوى التنفيذ، وليست worker خارجية منفصلة | إذا طُلبت ديمومة أعلى، يكون ذلك كتحسين تشغيلي لاحق لا كإصلاح أساسي |
| 3 — عمق scanner / graph extraction | مكتمل أوليًا / ناضج جدًا | `lib/scanner/src/graph-extractor.ts`، `python-extractor.ts`، `file-walker.ts`، `metrics-calc.ts` + اختبارات scanner | استخدم TS compiler API وAST حقيقيًا، وPython AST via subprocess، مع استخراج entities/relationships/metrics | مسار Python ما يزال لديه degraded path عند الفشل، والعمق الدلالي محدود عمدًا بقواعد extraction الحالية | توسيع semantic extraction فقط عند ظهور حاجة عملية |
| 4 — graph كطبقة معرفة | مكتمل إلى حد كبير | `lib/knowledge-engine/src/index.ts`، `queries.ts`، `inference.ts` + `artifacts/api-server/src/routes/graph.ts` + صفحة Graph | توجد BFS impact/path/neighbourhood queries + centrality/cluster inference + واجهة API | لا توجد بعد استدلالات أعمق أو semantics خارج graph traversal/inference الأساسية | تعميق المعرفة إذا أصبح graph هو مركز القرار، لا قبل ذلك |
| 5 — workflows كـ orchestration engine | جزئي / ناضج وظيفيًا | `lib/db/src/schema/workflows.ts`، `artifacts/api-server/src/routes/workflows.ts`، `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts` | يوجد workflow definition + workflow executions + start/stop state transitions + AI orchestration agent | ما يزال orchestration مستوى التطبيق، وليس scheduler/worker دائم/موزع | تثبيت durable orchestration إذا أصبح التشغيل المتعدد العقد متطلبًا |
| 6 — traceability موحّدة | جزئي قوي | `events.ts`، `task_logs.ts`، `audit_logs.ts`، `metrics.ts`، `routes/events.ts`، emission في tasks/workflows/projects/plugins | الأحداث والتدقيق والمقاييس موجودة وتُكتب في مسارات متعددة، و`correlationId` موجود في `events` | ليست كل الواجهات والقراءات موحّدة بالكامل حول `correlationId`؛ وبعض الفلاتر ما تزال غير مولدة في schema | جعل correlation trace حقًا first-class عبر كل الأسطح |
| 7 — توسيع الاختبارات | جزئي | 14 ملف `.test.ts` في API server/scanner + `replit.md` يذكر 40 scanner test و8 api-server integration tests | توجد اختبارات تغطي queue, reconciliation, plugin runtime, scanner, graph, metrics, projects, tasks, workflows | لا تغطية كافية لـ `ai`, `events`, `audit`, وبعض مسارات dashboard | سد فجوات الاختبارات عالية المخاطر أولًا |
| 8 — UI depth | جزئي | 15 صفحة في dashboard: `AiChat`, `DiscoverProjectWizard`, `Graph`, `Projects`, `Tasks`, `Workflows`, `Metrics`, `Events`… | الواجهة بالفعل تعكس عدة طبقات حقيقية لا مجرد shell | تحتاج مزيدًا من الربط بالحقائق الداخلية بدل تبسيطها أكثر من اللازم | إضافة cross-links وdrill-down حيث يوجد قرار/حالة/أثر |
| 9 — docs/handoff النهائي | شبه مكتمل | `docs/fact-record.md`, `docs/completion-plan.md`, `replit.md`, `package.json`, `codegen:check` | توجد وثائق تشغيل، خطة، وسجل حقيقة وفحوصات drift | `ARCHITECTURAL_ANALYSIS.md` غير موجود، وبعض الوثائق تحتاج مزامنة مستمرة | إنشاء/تحديث وثيقة معمارية نهائية فقط إذا كانت ستُحفظ كمرجع رسمي |

## ما الذي تغيّر فعليًا داخل المنصة؟

### 1) العقد لم تعد سطحًا، بل أصبحت ضابطًا للسلوك
- `lib/api-spec/openapi.yaml` يعرّف **47** path و**58** operation.
- `package.json` يفرض `codegen:check` بحيث أي drift بين OpenAPI والكود المولّد يوقف السلسلة.
- هذا يعني أن الـ contract layer أصبح مُراقبًا، لا مجرد ملف تصميم.

### 2) قاعدة البيانات تحولت إلى نسيج علاقات حقيقي
الجدولـات الـ 16 تغطي:
- المشاريع
- المهام
- القواعد
- workflows
- executions
- scan jobs
- discovery sessions
- graph entities / relationships
- events
- metrics
- audit logs
- task logs
- ai chat sessions / messages
- plugins

وهذا يثبت أن EngineeringOS لم يعد “CRUD واحدًا”، بل طبقات مترابطة: **تشغيل + معرفة + تدقيق + ذكاء + مراقبة**.

### 3) التنفيذ الخلفي صار محكومًا، لا fire-and-forget
الأدلة الأقوى:
- `job-queue.ts`: bounded-concurrency queue
- `job-reconciliation.ts`: استعادة stuck jobs عند الإقلاع
- `scan-runner.ts` و`routes/tasks.ts` و`routes/workflows.ts`: claims ذرية وتسجيل حالة داخل transactions

هذا يثبت أن النظام انتقل من “نفّذ وتمنى” إلى “نفّذ ثم تحقق ثم أصلح ما انقطع”.

### 4) الـ graph تحوّل إلى knowledge layer
- `lib/knowledge-engine/src/queries.ts` يقدم BFS-based impact/path/neighbourhood
- `lib/knowledge-engine/src/inference.ts` يقدم centrality وcluster detection وsummary
- `routes/graph.ts` يعرّض هذه القدرات عبر API
- صفحة `Graph.tsx` تعرضها في الواجهة

إذن graph ليس تجميعيًا فقط؛ بل صار طبقة معرفة يمكن الاستعلام منها.

### 5) AI layer ليست مجرد endpoint، بل سياق + وكلاء + سجلات
- `lib/ai-orchestrator/src/` يحتوي `chat-agent`, `task-agent`, `scan-analyst`, `code-reviewer`, `workflow-orchestrator`
- `routes/ai.ts` يربط هذا بالمشروع عبر جلسات ورسائل
- `ai_chat_sessions` و`ai_chat_messages` موجودتان في schema
- `AiChat.tsx` موجودة في dashboard

هذا يثبت أن الذكاء هنا جزء من model التشغيل، لا feature معزولة.

## أين توجد الفجوات الحقيقية الآن؟

### الفجوة 1: التخويل الدقيق
`requireAuth.ts` يوضح أن كل مستخدم موثّق يملك وصولًا كاملًا، بلا roles أو project ACL.  
هذا ليس عيبًا بسيطًا، بل حد واضح للحوكمة: **التوثيق موجود، التخويل التفصيلي غير موجود بعد**.

### الفجوة 2: ديمومة التنفيذ الخلفي
queue الحالي في الذاكرة، مع reconciliation عند restart.  
هذا حل صحيح لطبقة واحدة/instance واحدة، لكنه ليس worker durable مستقلًا.  
إذا توسع التشغيل، قد تحتاج المنصة لاحقًا إلى منفذ تنفيذ أكثر بقاءً.

### الفجوة 3: التتبّع الموحد عبر كل السطوح
`events.correlationId` موجود، لكن ليس كل المسارات/الأدوات تُعامل correlation كهوية أولى موحّدة في schema/client/UI.  
المنصة تملك الأساس، لكنها لم توحّد بعد كل القراءات والمرشحات حوله.

### الفجوة 4: الاختبارات لا تغطي كل أسطح الخطر
الاختبارات الحالية قوية نسبيًا، لكن لا تزال هناك فراغات في:
- `ai`
- `events`
- `audit`
- أجزاء من dashboard
- وربما drift checks أعمق حول generated clients/schemas

### الفجوة 5: الوثيقة المعمارية النهائية غير موجودة
هناك سجل حقيقة وخطة مراحل، لكن لا يوجد بعد `ARCHITECTURAL_ANALYSIS.md` كمرجع رسمي نهائي داخل الجذر.  
إذا كان الهدف حزمة handoff مؤسسية، فهذه وثيقة ما تزال مطلوبة.

## قراءة نهائية من داخل الكود

EngineeringOS الآن ليس “مشروعًا قيد البناء” بالمعنى الضعيف، بل **منصة وصلت إلى نواة تشغيل صحيحة ومترابطة**.  
الخطة المرحلية ليست حلمًا بعيدًا؛ هي تقريبًا مطبقة حتى المرحلة السادسة، مع بقاء العمل الحقيقي في:
- التخويل الدقيق
- الاستمرارية الأعلى
- توحيد التتبّع
- سد فجوات الاختبار
- وتوسيع UI لتمثيل الحقيقة بدل تبسيطها

## السطر العملي التالي

أعلى عائد الآن ليس في إضافة طبقة جديدة، بل في **إغلاق الحواجز المتبقية**:
1. RBAC / ACL / project membership
2. زيادة durability للـ background jobs إن لزم
3. توحيد `correlationId` في القراءة والكتابة والواجهة
4. سد اختبارات `ai` / `events` / `audit`
5. توثيق معماري نهائي إذا كان سيُستخدم كمرجع تسليم


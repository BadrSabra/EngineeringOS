# EngineeringOS — السلسلة 21  
## طبقة الثقة الذاتية والتحكم التشغيلي من داخل الكود والملفات

**تاريخ القراءة:** 2026-07-13  
**العينة المفحوصة:** الأرشيف الكامل `EngineeringOS-main (26).zip`  
**المرجعان الداخليان الأكثر ثباتًا:**  
- `docs/fact-record.md`
- `docs/completion-plan.md`

---

## 1) ما الذي ثبت بوضوح في هذه السلسلة؟

هذه السلسلة لم تعد مجرد إثبات أن EngineeringOS "مشروع كبير".  
الذي ثبت هنا أن المشروع أصبح **Control Plane** متماسكًا، له مسار بيانات، ومسار تنفيذ، ومسار معرفة، ومسار ذكاء اصطناعي، ومسار تدقيق، ومسار تعافٍ عند الإقلاع، وكل ذلك مربوط بعقود API وقاعدة بيانات وتوليد تلقائي.

والأهم: المنصة لم تعد تعتمد على "تقدير بصري" أو واجهة جميلة، بل على طبقات داخلية يمكن تتبعها من المصدر نفسه:

- العقد: `lib/api-spec/openapi.yaml`
- التوليد: `lib/api-zod` و `lib/api-client-react`
- البيانات: `lib/db/src/schema/*`
- المسح والتحليل: `lib/scanner/src/*`
- المعرفة والاستدلال: `lib/knowledge-engine/src/*`
- الذكاء الاصطناعي: `lib/ai-orchestrator/src/*`
- التنفيذ الفعلي: `artifacts/api-server/src/*`
- العرض التشغيلي: `artifacts/dashboard/src/pages/*`

---

## 2) لقطة رقمية سريعة

- إجمالي الملفات داخل الأرشيف: **518**
- الملفات الموثقة في `docs/fact-record.md`: **383**
- عدد المسارات في OpenAPI: **47**
- عدد العمليات الفعلية (GET/POST/PATCH/DELETE…): **58**
- ملفات مخطط قاعدة البيانات: **13 schema files**
- صفحات الواجهة التشغيلية: **15 صفحة**
- وكلاء الـ AI داخل `lib/ai-orchestrator`: **5 وكلاء**
- نقاط النهاية الخاصة بالذكاء الاصطناعي: **7 endpoints**
- حد التوازي في queue الثقيل: **2**

هذه الأرقام ليست مجرد إحصاءات؛ هي دليل على أن المنصة بنيت كمنظومة طبقية لا كتجميع ملفات متفرقة.

---

## 3) الأدلة الحاكمة التي تغيّر التقييم

### أ) الأمن والتشغيل الأساسيان أصبحا مضبوطين في `artifacts/api-server/src/app.ts`

الملف يثبت عدة قرارات بنيوية مهمة:

- تعطيل `etag` لتجنب 304 bodyless responses على بيانات ديناميكية.
- تفعيل `helmet`.
- تفعيل `rateLimit`.
- تفعيل `cors` مع credentials.
- تفعيل `express.json` و `urlencoded` بحجم محدد `2mb`.
- جعل `/api` غير قابل للتخزين المؤقت عبر `Cache-Control: no-store`.
- جعل `requireAuth` هو بوابة كل شيء تحت `/api` ما عدا health.
- وجود تعليق صريح يقول إن **لا يوجد بعد تفويض متعدد الأدوار أو متعدد المشاريع**؛ أي أن النظام الآن **authenticated-only** وليس **role-based**.

هذا مهم جدًا: المنصة **آمنة نسبيًا على مستوى الأساس**، لكن **التحكم الدقيق في الصلاحيات ما يزال غير مكتمل**.

### ب) التعافي عند الإقلاع صار جزءًا من التصميم في `artifacts/api-server/src/index.ts` و`job-reconciliation.ts`

- عند بدء السيرفر يتم استدعاء `reconcileStuckJobs()` قبل قبول أي طلب.
- `job-reconciliation.ts` يوضح أن scan/discovery jobs تُدار داخل العملية نفسها، وأن أي crash أو kill يترك صفوفًا عالقة في حالة `queued` أو `running`.
- عند الإقلاع يتم:
  - تحويل scan jobs العالقة إلى `failed`
  - إعادة المشروع إلى `active`
  - تحويل discovery sessions العالقة إلى `error`

هذا لا يحل مشكلة الاستمرارية الكاملة، لكنه يثبت أن المشروع **يعرف حالته المنقطعة** ويعيد ضبطها بشكل واعٍ بدل تركها متعفنة.

### ج) المسح الشامل أصبح transaction-aware في `artifacts/api-server/src/lib/scan-runner.ts`

الملف يثبت ما يلي:

- المسح الكامل منفصل عن route handler حتى لا يحبس HTTP response.
- هناك `correlationId` واحد لكل scan.
- كل ما ينتج عن scan:
  - tasks
  - rule hit counts
  - graph entities
  - graph relationships
  - metrics row
  - project status update
  - scan event
  - audit record
  - plugin dispatch
  أصبح مربوطًا بتسلسل واضح.

الأهم هنا أن الجزء الأساسي من persistence يتم داخل **transaction واحدة**.  
هذا يعني أن scan لم يعد "مجرد تشغيل ملفات" بل **عملية ذرّية**: إما ينجح كحزمة واحدة، أو يفشل كحزمة واحدة.

### د) طبقة المعرفة أصبحت فعلية وليست رمزية في `lib/knowledge-engine`

الملفان `queries.ts` و`inference.ts` يثبتان أن المعرفة ليست مجرد جدولين:

- `getImpactedEntities` يستخدم BFS باتجاه outbound لتقدير أثر التغيير.
- `getShortestPath` و`getNeighborhood` يقدمان طبقة تنقل في الرسم البياني.
- `computeCentrality` و`detectClusters` و`computeGraphSummary` تقدم استدلالًا داخليًا على الرسم البياني.
- كل الدوال **pure** ولا تكتب شيئًا في قاعدة البيانات.

هذا مهم جدًا: لدينا هنا **طبقة استدلال فوق الرسم البياني** وليست فقط استخراجًا للكيانات.

### هـ) طبقة الذكاء الاصطناعي أصبحت كاملة داخل `lib/ai-orchestrator`

الملف `src/index.ts` يصدّر:
- `chat`
- `executeTask`
- `analyzeScan`
- `reviewCode`
- `orchestrateWorkflow`

والملفات الداخلية تثبت أن المنصة لديها:

- Chat Agent
- Task Agent
- Scan Analyst
- Code Reviewer
- Workflow Orchestrator

كما أن `groq-client.ts` يحدد نموذجين واضحين:
- `MODEL_POWERFUL`
- `MODEL_FAST`

أي أن الذكاء الاصطناعي هنا ليس "استدعاء نموذج" فقط، بل **طبقة تشغيل موجهة حسب نوع المهمة**.

### و) الواجهة صارت تعكس البنية الداخلية فعلًا

في `artifacts/dashboard/src/pages` توجد صفحات:
- `AiChat`
- `DiscoverProjectWizard`
- `Projects`
- `ProjectDetail`
- `Tasks`
- `Workflows`
- `Graph`
- `Metrics`
- `Events`
- `Rules`
- صفحات الدخول/التسجيل

وهذا مهم لأن الواجهة لا تبدو منفصلة عن المنصة الداخلية، بل تسحب من نفس العقود والـ routes.

---

## 4) خريطة الحقيقة الطبقية

| الطبقة | ماذا ثبت | الحالة | الأثر |
|---|---|---|---|
| العقود | OpenAPI واسع + 58 عملية | مكتمل عمليًا | يصنع مصدر الحقيقة الأول |
| البيانات | 13 schema files مع FKs وأقسام واضحة | مكتمل/متقدم جدًا | يثبت أن الحالة محفوظة لا مجرد واجهة |
| التنفيذ | routes + scan runner + queue + reconciliation | متقدم جدًا | المنصة تعمل كـ control plane |
| المعرفة | graph entities + relationships + BFS + inference | مكتمل كطبقة مستقلة | يجعل الرسم البياني قابلًا للاستعلام والمعنى |
| الذكاء الاصطناعي | 5 وكلاء + 7 endpoints | مكتمل وظيفيًا | يربط المنصة بالاستدلال والتنفيذ |
| الحوكمة | audit + events + metrics + correlationId | متقدم | توجد traceability، لكن التوحيد ما زال قابلاً للتعميق |
| الأمان | helmet + rate-limit + auth gate + cache control | جيد كأساس | لكن RBAC/ACL التفصيلي ما يزال ناقصًا |
| التشغيل | startup reconciliation + fail-safe cleanup | جيد | يقلل بقايا الأعطال بعد restart |
| الواجهة | Discover + AiChat + Graph + Tasks… | ناضجة | تعرض الحقيقة الداخلية بدل تبسيطها |

---

## 5) ما الذي ما يزال جزئيًا أو ناقصًا؟

### 1. التفويض الدقيق
في `app.ts` و`requireAuth.ts` يوجد تصريح مباشر بأن:

- كل مستخدم موثق لديه وصول كامل
- لا يوجد بعد per-role / per-project authorization

هذا ليس عيبًا صغيرًا؛ هذا هو أكبر حدّ واضح في الحوكمة.

### 2. الاستمرارية خارج العملية الواحدة
`job-queue.ts` و`job-reconciliation.ts` يثبتان أن queue الثقيلة ما تزال in-process مع reconciliation عند الإقلاع.  
هذا جيد كمرحلة انتقالية، لكنه ليس durable distributed execution engine.

### 3. plugin runtime ما يزال in-process
`plugin-runtime.ts` يوضح أن الإضافات ليست عمليات مستقلة ولا dynamic modules؛ هي كائنات TypeScript داخل نفس runtime.  
هذا ممتاز للبساطة والاختبار، لكنه يحدّ التوسع والتشغيل المعزول.

### 4. المعرفة والاستدلال يحتاجان مزيد توحيد في عرضهما
الطبقة موجودة فعلًا، لكن ما يزال هناك مجال لتوحيد طريقة عرض:
- impact
- path
- centrality
- clusters
- graph summary

في واجهة ومخرجات موحّدة أكثر صرامة.

---

## 6) أهم ما في هذه السلسلة: المشروع ليس "بداية فكرة" بل "نظام تحكم"

بناءً على الملفات نفسها، EngineeringOS الآن أقرب إلى:

- **contract-first platform**
- **transactional execution platform**
- **knowledge graph platform**
- **AI-augmented engineering control plane**
- **self-verifying architecture**

وهذا الاستنتاج ليس من الشكل العام فقط؛ بل من تداخل:
- OpenAPI ↔ Zod ↔ routes
- DB ↔ queue ↔ reconciliation
- scanner ↔ graph ↔ knowledge engine
- AI ↔ context builder ↔ dashboard
- audit/events/metrics ↔ correlationId

---

## 7) الخطوة العملية التالية

الأولوية المنطقية التالية ليست UI جديدة ولا ميزة سطحية.  
الأولوية هي:

1. إغلاق **RBAC / ACL / project-scoped access**
2. توحيد **correlation / trace** على مستوى كل العمليات
3. تقوية **durability** للمهام الثقيلة خارج العملية الواحدة
4. توحيد **governance policy engine**
5. تحويل طبقة الحقيقة الحالية إلى **سجل حالة رسمي نهائي** على مستوى كل ملف وطبقة

---

## 8) الخلاصة

هذه السلسلة تثبت أن المشروع وصل إلى مرحلة **المنصة التشغيلية ذاتية القراءة**، وليس مجرد مستودع يحتوي وثائق وكود منفصلين.  
المهم الآن ليس “هل الفكرة موجودة؟”؛ الفكرة موجودة بوضوح.  
المهم هو: **إغلاق الصلاحيات، تثبيت الاستمرارية، وتوحيد الحوكمة**.
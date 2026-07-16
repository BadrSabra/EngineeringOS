
# EngineeringOS — وثيقة التنفيذ التفصيلية للمشروع

**النسخة:** 1.0  
**تاريخ الإعداد:** 2026-07-11  
**مصادر الإعداد:**  
1. `EngineeringOS_File_by_File_Fact_Record.md` (سجل الحقيقة الملفّي)  
2. أرشيف المشروع المرفوع `EngineeringOS-main (11)(3).zip`  
3. سياق المحادثة السابقة حول التحليل المعماري، الفجوات، وخطة الاستكمال

---

## 1) الغرض من الوثيقة

هذه الوثيقة هي **خطة التنفيذ التفصيلية الشاملة** لمشروع **EngineeringOS** كما هو موجود الآن فعليًا داخل المستودع، وليس كما يُفترض أن يكون في المستقبل.

هدفها أن تكون مرجعًا عمليًا يجيب عن الأسئلة التالية:

- ما الذي بُني بالفعل؟
- ما الذي ما يزال ناقصًا؟
- ما التسلسل الصحيح لإكمال المشروع؟
- ما هي الملفات/الطبقات/المسارات التي يجب لمسها أولًا؟
- كيف نمنع الانحراف بين الكود والعقد والواجهة والتوثيق؟
- ما تعريف “الاكتمال” القابل للقياس لكل طبقة؟

---

## 2) ملخص تنفيذي

EngineeringOS ليس تطبيقًا منفردًا، بل **منصة متعددة الطبقات** تتكون من:

1. **طبقة العقد (Contract Layer)**  
   `lib/api-spec/openapi.yaml` مع توليد `lib/api-zod` و`lib/api-client-react`.

2. **طبقة البيانات (Data Layer)**  
   `lib/db/src/schema/*` وتشمل المشاريع، القواعد، المهام، workflows، events، metrics، graph، audit logs، discovery sessions، scan jobs.

3. **طبقة التحليل (Analysis Layer)**  
   `lib/scanner/src/*` وتشمل file-walker وrule-matcher وgraph-extractor وmetrics-calc.

4. **طبقة التنفيذ (Execution Layer)**  
   `artifacts/api-server` وتشمل discovery pipeline، scan runner، tasks، workflows، graph، metrics، events، plugins، audit.

5. **طبقة العرض (Presentation Layer)**  
   `artifacts/dashboard` وتشمل لوحة التحكم، المشاريع، المهام، القواعد، workflows، graph، metrics، events، discovery wizard.

**الخلاصة العملية:**  
النواة المعمارية والخلفية والتحليل أصبحت متقدمة، لكن **التنفيذ النهائي ما يزال يحتاج**:
- تسوية العقد مع التنفيذ
- تحويل الجراف إلى knowledge layer فعلي
- جعل workflows تظهر عمقها الحقيقي
- رفع الاختبارات
- سد فجوة الواجهة التي تختصر الداخل أكثر من اللازم
- توحيد التتبع traceability على مستوى operation chain واحدة

---

## 3) الحالة الراهنة حسب الطبقات

### 3.1 طبقة العقد
**الموجود:**
- OpenAPI هو مصدر الحقيقة الأول
- التوليد الآلي لـ Zod وReact Query hooks قائم
- العميل والخادم يرتبطان بالعقد بدل الأنواع اليدوية

**الضعف المتبقي:**
- توجد مسارات تنفيذية في الخادم غير ممثلة بالكامل في OpenAPI
- هذا يسبب drift بين الحقيقة التنفيذية والحقيقة التعاقدية

**الأثر:**
- العميل المولّد لا يرى جميع القدرات
- الاختبارات والتوثيق والتكامل تصبح غير مكتملة
- أي فريق يستهلك العقد يواجه صورة ناقصة

**القرار التنفيذي:**
- لا يجوز إضافة ميزات API جديدة خارج OpenAPI
- أي endpoint جديد أو معدل يجب أن يبدأ بالعقد ثم التوليد ثم التنفيذ ثم الاختبار

---

### 3.2 طبقة البيانات
**الموجود:**
- schema غني ومنظم
- علاقات واضحة بين المشاريع والمهام والقواعد والـ workflows والجراف والأحداث والمقاييس والتدقيق
- القيود المرجعية الأساسية أصبحت أقوى
- النظام لم يعد يعتمد على تخمينات رخوة بقدر كبير

**الضعف المتبقي:**
- بعض الحقول ذات المعنى التشغيلي تحتاج ضبطًا أدق على مستوى invariants
- traceability لا تزال ليست موحّدة بهوية تشغيلية واحدة في كل الطبقات

**الأثر:**
- البيانات أصبحت جيدة، لكن تتبع “عملية واحدة” عبر النظام لا يزال يحتاج توحيدًا أفضل

---

### 3.3 طبقة التحليل
**الموجود:**
- scanner حقيقي وليس مجرد regex بسيط
- TS/JS تحلل عبر AST
- CommonJS و`export =` وmethods داخل classes أصبحت مرئية
- metrics calculation قائم
- file walking منظم ويستثني المجلدات غير المناسبة

**الضعف المتبقي:**
- Python extraction لا يزال heuristic/regex
- rule matching ما يزال regex-driven
- بعض أنماط CommonJS المتقدمة يمكن تأجيلها أو إضافتها لاحقًا

**الأثر:**
- قيمة التحليل العالية موجودة فعلاً
- لكن التغطية اللغوية غير متوازنة بعد

---

### 3.4 طبقة التنفيذ
**الموجود:**
- discovery pipeline يعمل
- scan runner يعمل بشكل transactionally safer
- tasks وworkflows يملكان lifecycle منظمًا
- events وaudit تُكتب في المسارات المتحولة
- graph API يملك endpoints للعرض والتصفح

**الضعف المتبقي:**
- بعض المسارات غير معكوسة في العقد
- بعض المنطق متقدم في الخادم لكنه غير مرئي في الواجهة
- بعض حالات الفشل/العودة تحتاج المزيد من الاختبار

---

### 3.5 طبقة العرض
**الموجود:**
- dashboard يغطي كل المجالات الأساسية
- Shell وSidebar موجودان
- صفحات المشروع/المهام/القواعد/workflows/graph/events/metrics/discovery موجودة

**الضعف المتبقي:**
- Graph page ما تزال أبسط من الحقيقة الداخلية
- Workflows page تختزل عمق state machine
- بعض الصفحات تعرض summary بدل insight
- الواجهة لا تزال خلف الخادم من حيث العمق

---

## 4) المبادئ الحاكمة للتنفيذ

### المبدأ 1: الداخل أولًا
لا يبدأ التنفيذ من الواجهة.  
التسلسل الصحيح هو:
**البيانات → التنفيذ → التحليل → orchestration → traceability → الاختبارات → الواجهة → التوثيق**

### المبدأ 2: العقد قبل التوليد قبل الاستهلاك
أي تغيير في الـ API يجب أن يمر:
1. OpenAPI
2. codegen
3. server implementation
4. client hooks
5. tests
6. documentation

### المبدأ 3: لا تُبنَ الواجهة على افتراض ناقص
أي صفحة Dashboard يجب أن تعكس حقيقة الخادم، لا نسخة مبسطة تضلل المستخدم.

### المبدأ 4: التتبع يجب أن يكون قابلًا للتجميع
الأحداث، audit logs، task logs، metrics، workflows executions يجب أن تترك أثرًا يمكن ربطه وتحليله.

### المبدأ 5: لا نجاح دون اختبارات
أي مسار حرج لا يغطى باختبار تكامل أو contract test أو regression test لا يُعتبر مكتملًا.

---

## 5) الخطة التنفيذية الشاملة

## المرحلة 0 — تثبيت الحقيقة المعمارية
**الوضع:** منجز كمرجعية  
**الهدف:** منع إعادة النقاش من الصفر كل مرة

### المخرجات
- سجل الحقيقة الملفّي
- هذه الوثيقة
- تحديث دوري للمرجعين مع كل تغيير

### معيار القبول
- كل قرار معماري مهم له أثر واضح في السجل أو الخطة
- لا توجد مساحة لافتراضات غير مكتوبة

---

## المرحلة 1 — تسوية العقد والـ codegen
**الهدف:** إزالة أي drift بين التنفيذ والعقد

### الأعمال المطلوبة
- مراجعة `lib/api-spec/openapi.yaml`
- إدخال/تحديث المسارات التنفيذية غير الممثلة
- إعادة توليد `lib/api-zod`
- إعادة توليد `lib/api-client-react`
- التأكد من أن hooks وschemas تعكس الحقيقة الكاملة

### ملفات محورية
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/api-zod/src/generated/*`
- `lib/api-client-react/src/generated/*`
- `artifacts/api-server/src/routes/graph.ts`
- `artifacts/api-server/src/routes/workflows.ts`
- `artifacts/api-server/src/routes/discovery.ts`

### مخرجات متوقعة
- العقد تعكس التنفيذ بدل أن تتخلف عنه
- العميل المولد يلتقط القدرات الفعلية
- لا توجد endpoints “حية” خارج العقد

### معيار القبول
- لا يوجد endpoint تنفيذي مهم غير ممثل في OpenAPI
- codegen يعمل دون تعارضات
- جميع الاختبارات المرتبطة بالعقد تمر

---

## المرحلة 2 — تقوية طبقة البيانات
**الهدف:** تثبيت صحة العلاقات والقيود والحقول ذات المعنى التشغيلي

### الأعمال المطلوبة
- مراجعة schema الحساسة:
  - projects
  - tasks
  - workflows
  - events
  - metrics
  - graph
  - discovery
  - scan_jobs
  - audit_logs
- التأكد من منطق الحذف/الإسناد/الربط
- ضبط أي invariant إضافي يحتاجه النظام في التشغيل الحقيقي

### ملفات محورية
- `lib/db/src/schema/projects.ts`
- `lib/db/src/schema/tasks.ts`
- `lib/db/src/schema/workflows.ts`
- `lib/db/src/schema/events.ts`
- `lib/db/src/schema/metrics.ts`
- `lib/db/src/schema/graph.ts`
- `lib/db/src/schema/discovery.ts`
- `lib/db/src/schema/scan_jobs.ts`
- `lib/db/src/schema/audit_logs.ts`

### المخرجات المتوقعة
- بيانات أكثر اتساقًا
- علاقات أكثر وضوحًا
- حالات orphan / partial states أقل

### معيار القبول
- لا توجد علاقات حرجة غير محمية
- لا توجد state transitions تخطئ في حفظ أثرها

---

## المرحلة 3 — تعميق scanner
**الهدف:** توسيع دقة التحليل البنيوي واللغوي

### الأعمال المطلوبة
- الحفاظ على AST-based TS/JS extraction
- دراسة إدخال Python AST parser بدل regex heuristics
- تحسين rule matching إذا كانت هناك أنماط جديدة مطلوبة
- توسيع اختبارات الحالات الحدية
- الاستمرار في التقاط:
  - imports
  - exports
  - class methods
  - CommonJS surfaces
  - graph entities/relationships
  - metrics signals

### ملفات محورية
- `lib/scanner/src/file-walker.ts`
- `lib/scanner/src/rule-matcher.ts`
- `lib/scanner/src/graph-extractor.ts`
- `lib/scanner/src/metrics-calc.ts`
- `lib/scanner/src/__tests__/*`

### مخرجات متوقعة
- تحليل أكثر ثراءً
- graph أكثر فائدة
- metrics أكثر قربًا من الحقيقة

### معيار القبول
- لا رجوع إلى مستوي سطحية سابق
- حالات CommonJS وclass methods لا تضيع
- إضافة Python AST – إن نُفذت – تمر باختبارات واضحة

---

## المرحلة 4 — تحويل Graph إلى Knowledge Layer
**الهدف:** جعل الجراف قابلًا للتصفح والاستكشاف وليس مجرد قائمة nodes

### الأعمال المطلوبة
- ربط `/neighbors` بالواجهة
- إظهار العلاقات الحقيقية edges
- تمكين التصفية حسب المشروع والنوع والاتجاه
- تمكين entity detail panel
- ربط file → function → class → api relationships
- تبسيط رحلة “من هذه الوحدة ما الذي يعتمد عليها وما الذي تعتمد عليه”

### ملفات محورية
- `artifacts/api-server/src/routes/graph.ts`
- `artifacts/dashboard/src/pages/Graph.tsx`
- `lib/db/src/schema/graph.ts`
- `lib/api-spec/openapi.yaml`

### مخرجات متوقعة
- Graph page تصبح explorer حقيقي
- user can navigate dependencies and neighbors
- knowledge extraction تصبح عملية

### معيار القبول
- لا تبقى Graph page مجرد scatter plot بلا edges
- `/neighbors` يصبح primitive مستخدمًا فعليًا
- العلاقة بين node وedge وproject وtype واضحة في الواجهة

---

## المرحلة 5 — تحويل Workflows إلى orchestration engine حقيقي
**الهدف:** جعل workflow يعبر المراحل بوضوح، لا أن يظل statically started/stopped

### الأعمال المطلوبة
- إبراز `currentPhase`
- إظهار `completedPhases`
- تفعيل/مراجعة المنطق الشرطي إن كان مطلوبًا
- عرض advance/fail/retry-in-place في الواجهة
- ربط كل مرحلة بأثرها في events/audit/logs

### ملفات محورية
- `artifacts/api-server/src/routes/workflows.ts`
- `artifacts/dashboard/src/pages/Workflows.tsx`
- `lib/db/src/schema/workflows.ts`
- `lib/db/src/schema/events.ts`

### مخرجات متوقعة
- workflow state machine مرئية
- retry عند المرحلة الحالية بدل إعادة التشغيل من البداية
- transitory state أوضح

### معيار القبول
- لا يختفي معنى `currentPhase`
- الانتقال بين المراحل واضح ومختبر
- fail/retry/advance behavior محدد ومؤكد

---

## المرحلة 6 — توحيد traceability والحوكمة
**الهدف:** جعل كل عملية كبيرة قابلة للتتبع من أولها إلى آخرها

### الأعمال المطلوبة
- توحيد العلاقة بين:
  - audit logs
  - events
  - task logs
  - metrics
  - workflow executions
- دراسة correlation ID موحد
- تحسين filterability والتشخيص
- الحفاظ على best-effort audit ما لم تُطلَب سياسة أشد

### ملفات محورية
- `artifacts/api-server/src/lib/audit.ts`
- `lib/db/src/schema/audit_logs.ts`
- `lib/db/src/schema/events.ts`
- `lib/db/src/schema/task_logs.ts`
- `lib/db/src/schema/metrics.ts`

### مخرجات متوقعة
- traceable operations
- better operational debugging
- clearer post-mortem analysis

### معيار القبول
- يمكن تتبع عملية واحدة عبر عدة طبقات
- لا تضيع الآثار بين tables منفصلة
- لا توجد mutations بلا أثر مقصود

---

## المرحلة 7 — توسيع الاختبارات
**الهدف:** سد الفجوة بين وجود المنطق وموثوقيته

### الاختبارات المطلوبة
- contract drift tests
- graph neighbors tests
- workflow phase transition tests
- discovery/import edge-case tests
- task lifecycle tests
- scan runner atomicity tests
- metrics sanity tests
- scanner regression tests

### ملفات/مساحات مستهدفة
- `artifacts/api-server/src/routes/*.test.ts`
- `lib/scanner/src/__tests__/*`
- أي tests جديدة للعقد أو التوليد

### مخرجات متوقعة
- ثقة أعلى في التعديلات
- regressions أقل
- تغييرات أكثر أمانًا

### معيار القبول
- critical paths مغطاة
- فشل مسار أساسي يلتقطه الاختبار فورًا
- عدم وجود drift صامت بين السرور والعميل

---

## المرحلة 8 — تعميق الواجهة
**الهدف:** جعل الواجهة مرآة حقيقية للمنصة الداخلية

### الأعمال المطلوبة
- تحسين Graph page
- تحسين Workflows page
- تقديم drill-down بدل summary فقط
- تحسين Project detail / Events / Metrics views
- توظيف التصميم لإظهار العمق وليس فقط الجمال

### ملفات محورية
- `artifacts/dashboard/src/pages/Graph.tsx`
- `artifacts/dashboard/src/pages/Workflows.tsx`
- `artifacts/dashboard/src/pages/ProjectDetail.tsx`
- `artifacts/dashboard/src/pages/Events.tsx`
- `artifacts/dashboard/src/pages/Metrics.tsx`
- `artifacts/dashboard/src/pages/Dashboard.tsx`

### مخرجات متوقعة
- واجهة أقرب للحقيقة الداخلية
- تقليل التبسيط المخل
- usability أفضل للمشغل/المطور

### معيار القبول
- Graph لا يبدو كديكور
- Workflow لا يبدو start/stop فقط
- البيانات المهمة تظهر بنية ومعنى

---

## المرحلة 9 — التوثيق النهائي والتسليم
**الهدف:** تثبيت المشروع بوثائق قابلة للتشغيل والصيانة

### الأعمال المطلوبة
- تحديث `docs/fact-record.md`
- تحديث `docs/completion-plan.md`
- تحديث `replit.md`
- حفظ قرارات الهندسة النهائية
- إعداد handoff notes واضحة

### مخرجات متوقعة
- مرجع رسمي حديث
- وثائق متسقة مع الواقع
- تسليم يسهل على فريق جديد أو وكيل AI متابعة العمل

### معيار القبول
- docs لا تتعارض مع الكود
- أي تغيير مهم ينعكس في المرجع
- يوجد مسار واضح لمن يأتي بعدنا

---

## 6) تفصيل الملفات الحرجة التي تحدد مسار التنفيذ

### أ) ملفات العقد والتوليد
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/api-zod/src/generated/*`
- `lib/api-client-react/src/generated/*`

**وظيفتها:** ضبط الحقيقة التعاقدية ومنع drift.  
**الخطر إذا أُهملت:** عميل لا يرى القدرة الفعلية، وتوثيق غير مطابق، وتكامل هش.

---

### ب) ملفات البيانات
- `lib/db/src/schema/projects.ts`
- `lib/db/src/schema/tasks.ts`
- `lib/db/src/schema/workflows.ts`
- `lib/db/src/schema/events.ts`
- `lib/db/src/schema/metrics.ts`
- `lib/db/src/schema/graph.ts`
- `lib/db/src/schema/discovery.ts`
- `lib/db/src/schema/scan_jobs.ts`
- `lib/db/src/schema/audit_logs.ts`

**وظيفتها:** حفظ الحقيقة التشغيلية للمشروع.  
**الخطر إذا أُهملت:** states غير واضحة، relations رخوة، وتدقيق ضعيف.

---

### ج) ملفات التحليل
- `lib/scanner/src/file-walker.ts`
- `lib/scanner/src/rule-matcher.ts`
- `lib/scanner/src/graph-extractor.ts`
- `lib/scanner/src/metrics-calc.ts`

**وظيفتها:** تحويل النصوص والملفات إلى معرفة ومقاييس قابلة للتنفيذ.  
**الخطر إذا أُهملت:** تحليل سطحي، graph ضعيف، metrics غير معبرة.

---

### د) ملفات التنفيذ
- `artifacts/api-server/src/lib/scan-runner.ts`
- `artifacts/api-server/src/routes/discovery.ts`
- `artifacts/api-server/src/routes/tasks.ts`
- `artifacts/api-server/src/routes/workflows.ts`
- `artifacts/api-server/src/routes/graph.ts`
- `artifacts/api-server/src/lib/audit.ts`

**وظيفتها:** تشغيل النظام فعليًا وربط الحالة بالأثر.  
**الخطر إذا أُهملت:** منطق موجود لكن غير موثوق أو غير مرئي.

---

### هـ) ملفات العرض
- `artifacts/dashboard/src/pages/Graph.tsx`
- `artifacts/dashboard/src/pages/Workflows.tsx`
- `artifacts/dashboard/src/pages/ProjectDetail.tsx`
- `artifacts/dashboard/src/pages/Dashboard.tsx`
- `artifacts/dashboard/src/pages/Events.tsx`
- `artifacts/dashboard/src/pages/Metrics.tsx`

**وظيفتها:** تمثيل الحقيقة التشغيلية للإنسان.  
**الخطر إذا أُهملت:** واجهة جميلة تخفي ضعفًا وظيفيًا.

---

## 7) مخاطر التنفيذ الرئيسية

| الخطر | كيف يظهر | أثره | المعالجة |
|---|---|---|---|
| Drift بين OpenAPI والخادم | endpoint يعمل لكنه غير موجود في العقد | العميل والتوليد والاختبارات يفقدون الدقة | تحديث العقد أولًا ثم التوليد |
| UI تبسيطي زائد | graph/workflows تظهر بصورة ناقصة | فهم خاطئ لحقيقة النظام | ربط الواجهة ببيانات الخادم الغنية |
| Scanner غير متوازن لغويًا | TS/JS قوي وPython أقل | رؤية غير متساوية بين اللغات | تحسين Python AST أو تثبيت القيود بوضوح |
| Traceability مجزأة | audit/event/logs منفصلة ذهنيًا | صعوبة التتبع والتحقيق | correlation ID أو trace model موحد |
| اختبارات غير كافية | regressions صامتة | تراجع الثقة في التطوير | توسيع الاختبارات الحرجة |
| تنفيذ خارج الوثائق | الكود أسرع من الدليل | سوء فهم من فريق جديد | تحديث docs مع كل phase |

---

## 8) معيار اكتمال المشروع

المشروع لا يُعد مكتملًا إلا عندما تتحقق الشروط التالية:

1. **العقد والتنفيذ متطابقان**
2. **البيانات محكومة بقيود واضحة**
3. **scanner يلتقط البنية التي نحتاجها فعليًا**
4. **graph قابل للتصفح والاستدلال**
5. **workflows قابلة للشرح بصريًا وتشغيليًا**
6. **traceability موحدة وقابلة للتحقيق**
7. **الاختبارات تحمي المسارات الحرجة**
8. **الواجهة تُظهر الحقيقة لا نسخة مبسطة**
9. **الوثائق تعكس الكود دون تأخر**
10. **أي شخص جديد يستطيع فهم النظام وتشغيله من الوثائق**

---

## 9) خطة التنفيذ الفعلية المقترحة للمرحلة القادمة

### الأسبوع/السبرنت الأول
1. مراجعة OpenAPI drift وإغلاقه
2. توسيع/تثبيت `/neighbors` في العقد والعميل
3. توصيل Graph page ببيانات neighbors
4. تحسين Workflows page لإظهار currentPhase/execution history
5. إضافة اختبارين أو أكثر على critical path
6. تحديث سجل الحقيقة بعد كل إغلاق

### الأسبوع/السبرنت الثاني
1. توسيع traceability
2. إضافة contract drift tests
3. مراجعة scanner Python roadmap
4. تحسين الاستكشاف في Projects/Events/Metrics
5. إعادة تقييم الجاهزية العامة

---

## 10) الخلاصة النهائية

EngineeringOS الآن **ليس مشروعًا ناقص الفكرة**.  
هو مشروع **اكتملت فيه الفلسفة المعمارية الأساسية**، بينما ما تبقى هو:
- إغلاق الفجوات بين الداخل والخارج
- توحيد الحقيقة التعاقدية والتنفيذية
- تحويل الطبقات الداخلية إلى تجربة تشغيلية مرئية
- رفع الاختبار والتسليم إلى مستوى المنصة لا مستوى الصفحات

بكلمات أدق:  
**المشروع جاهز لمرحلة “إكمال المنصة” وليس لمرحلة “اختراع المنصة”.**

---

## 11) ملحق: المراجع الأساسية داخل المستودع

- `docs/fact-record.md`
- `docs/completion-plan.md`
- `replit.md`
- `lib/api-spec/openapi.yaml`
- `lib/db/src/schema/*`
- `lib/scanner/src/*`
- `artifacts/api-server/src/*`
- `artifacts/dashboard/src/*`

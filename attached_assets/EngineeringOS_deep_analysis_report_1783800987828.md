# EngineeringOS — Deep Analysis Report

## 1) ما هو المشروع فعليًا؟

EngineeringOS ليس تطبيقًا أحادي الطبقة، بل منصة هندسية متعددة الطبقات:
- **طبقة العقد**: OpenAPI هو مصدر الحقيقة للعقود، ويُولِّد Zod وReact Query hooks.
- **طبقة البيانات**: Drizzle/PostgreSQL مع جداول للمشاريع والمهام والقواعد والسير والأحداث والمقاييس والرسم البياني والمسح والتدقيق والإضافات.
- **طبقة التحليل**: مكتبة scanner مستقلة للمشي على الملفات، مطابقة القواعد، استخراج الرسم البياني، وحساب المقاييس.
- **طبقة التنفيذ**: API server ينفذ CRUD، discovery/import، scan jobs، tasks، workflows، rules، events، metrics، graph، plugins.
- **طبقة العرض**: Dashboard React SPA تعرض وتشغّل العمليات.
- **طبقة المختبر**: mockup-sandbox لتجريب UI primitives بشكل منفصل.

الخلاصة: المشروع بالفعل أقرب إلى **platform kernel + governance + observability + execution shell**، وليس مجرد CRUD أو لوحة عرض.

## 2) المؤشرات الكمية الحالية

- إجمالي الملفات داخل الأرشيف: **365**
- مسارات OpenAPI: **37**
- مخططات OpenAPI: **41**
- جداول DB الأساسية: **13**
- صفحات Dashboard: **11**
- مسارات API Server الفعلية: **12 ملف route**
- اختبارات Scanner: **4**
- اختبارات API Server: **7**
- ملفات api-zod المولدة: **76**
- ملفات api-client-react المولدة: **2**

## 3) طبقات النظام وحالتها

### طبقة العقد
الحالة: **قوية وقريبة من الاكتمال**  
الأدلة:
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/*`
- `lib/api-client-react/src/generated/*`
- `package.json` فيه `codegen` و`codegen:check`

المعنى العملي: لا يوجد عمليًا فصل بين “التعريف” و“التنفيذ”؛ بل توجد دائرة عقد–توليد–تنفيذ.

### طبقة البيانات
الحالة: **قوية ومنظمة**  
الأدلة:
- `projects`, `tasks`, `workflows`, `workflow_executions`, `rules`, `events`, `metrics`, `graph_entities`, `graph_relationships`, `scan_jobs`, `discovery_sessions`, `plugins`, `audit_logs`
- enums واضحة للحالات والأولويات والمستويات

نقاط القوة:
- مفاتيح أجنبية أساسية موجودة
- audit log مستقل
- scan jobs و discovery sessions يعطون النظام ذاكرة تشغيلية

### طبقة التحليل
الحالة: **جيدة لكن ليست نهائية**  
الأدلة:
- `file-walker.ts`
- `rule-matcher.ts`
- `graph-extractor.ts`
- `metrics-calc.ts`
- اختبارات تغطي هذه الوحدات

نقاط القوة:
- AST parsing للـ TS/JS موجود
- CommonJS و`export=` وclass methods مدعومة بحسب الذاكرة التشغيلية
- المقاييس تُحسب من violations/files

الحدود المتبقية:
- Python ما يزال regex-based
- التغطية ليست مساوية لفهم semantic عميق لكل اللغات
- استخراج المعرفة ما يزال قابلاً للتوسع

### طبقة التنفيذ
الحالة: **ناضجة تقنيًا لكن ما زالت تحتاج تشديدًا**  
الأدلة:
- `artifacts/api-server/src/routes/*`
- `artifacts/api-server/src/lib/scan-runner.ts`
- `app.ts` فيه `helmet` و`cors` و`rateLimit`
- `audit.ts` يسجل حالات التغير
- tests موجودة على المسارات الحرجة

نقاط القوة:
- discovery/import موجودان
- tasks execute/retry/rollback موجودة
- workflows start/stop/advance/fail/retry موجودة
- graph/entities/relationships/neighbor traversal موجود
- dashboard overview وmetrics/latest موجودان

الحدود المتبقية:
- scan job execution ما يزال fire-and-forget داخل نفس الخدمة، وليس worker/queue منفصل
- لا يوجد auth/RBAC ظاهر في الكود
- لا توجد طبقة user/tenant governance
- بعض القرارات الأمنية ما تزال “سياسة تشغيل” أكثر من كونها “سياسة مفروضة”

### طبقة العرض
الحالة: **عملية فعلاً وليست شكلية**  
الأدلة:
- `Dashboard`, `Projects`, `ProjectDetail`, `Tasks`, `Rules`, `Workflows`, `Events`, `Metrics`, `Graph`, `DiscoverProjectWizard`, `not-found`
- الصفحة تعرض أفعال حقيقية: إنشاء/بحث/تشغيل/إعادة تنفيذ/استعادة/استكشاف/استيراد/تنقل بياني

المتبقي:
- تعميق بعض الصفحات إلى تجربة تشغيليّة أكثر ثراءً
- إكمال تفاصيل history/trend/log inspection حيث يلزم
- تحسين حالات الخطأ/الفراغ/التحميل بشكل متسق في كل الصفحات

### طبقة المختبر
الحالة: **مفصولة ومفيدة**  
الأدلة:
- `artifacts/mockup-sandbox`
- مفيدة لتجربة UI primitives دون كسر المنتج

## 4) ما الذي تم بناؤه بالفعل؟

تم بناؤه فعلاً:
- contract-first workflow
- DB schema منظم
- scanner library مستقلة
- API server متعدد المسارات
- audit trail
- background scan job concept
- discovery/import
- task lifecycle
- workflow lifecycle
- graph explorer
- dashboard operational surface
- plugin registry

هذا يعني أن المشروع **ليس skeleton فارغ**؛ بل هو **منصة مكتملة الهيكل جزئيًا ومتماسكة معماريًا**، مع فجوات تنفيذية مهمة لكنها محددة.

## 5) الفجوات الحقيقية الأكثر أهمية

1. **الاستقلال التشغيلي للمسح الثقيل**  
   scan jobs لا تزال داخل نفس العملية؛ هذا مقبول داخليًا لكنه ليس final-grade إن كان المطلوب موثوقية أعلى وعزل أعطال أفضل.

2. **الحوكمة الأمنية/الصلاحيات**  
   لا يظهر auth/RBAC في الكود الحالي. إذا كانت المنصة داخلية فلابد من توثيق ذلك صراحة؛ وإذا كانت متعددة المستخدمين فيلزم تنفيذها.

3. **عمق المعرفة البيانية**  
   graph-extractor جيد، لكنه ليس بعد “knowledge engine” كامل بكل اللغات والأنماط.

4. **التجربة التشغيلية في الواجهة**  
   كثير من الوظائف موجود، لكن بعض الصفحات ما زالت بحاجة توسيع للـ timeline/logs/trends/details.

5. **الاختبارات السلوكية للفشل والتزامن**  
   توجد اختبارات، لكن يجب زيادة coverage للمسارات الحساسة: race conditions، failure rollback، drift، import conflicts.

## 6) خطة الاستكمال العملية

### أولوية 1 — تثبيت الحقيقة والحوكمة
- مزامنة `fact-record.md` و`completion-plan.md`
- إغلاق أي drift بين الملفات والعقد والكود
- تثبيت سياسة واضحة للأمان والصلاحيات والـ audit

### أولوية 2 — فصل التنفيذ الثقيل
- تحسين scan jobs إلى worker/queue أو نمط تشغيل معزول
- جعل حالات الفشل/النجاح أكثر ثباتًا وقابلة للاسترجاع

### أولوية 3 — تعميق scanner/graph/discovery
- توسيع AST extraction
- زيادة استخراج العلاقات والكيانات
- رفع جودة discovery report وربطه بالـ import

### أولوية 4 — تحويل اللوحة إلى مركز تشغيل
- history timelines
- neighbor explorer
- trend charts
- task logs inline
- empty/error/loading states موحدة

### أولوية 5 — الاختبارات والحراسة
- race tests
- transaction tests
- codegen drift check
- integration tests للفشل الحقيقي

### أولوية 6 — plugins
- ربط capabilities بسلوك فعلي
- توثيق extensibility contract
- تثبيت enable/disable behavior

## 7) التقييم النهائي

**الحالة الحالية للمشروع:**  
منصة متعددة الطبقات ناضجة معماريًا، متقدمة أكثر مما يبدو لأول وهلة، لكن ما زالت تحتاج:
- تشديدًا تشغيليًا
- توسيعًا في العمق التحليلي
- تقويةً في الحوكمة
- واكتمالًا في تجربة التحكم التشغيلي

**بصياغة أدق:**  
المشروع ليس “قيد البناء من الصفر”، بل هو **قيد الانتقال من بنية صحيحة إلى منصة production-grade governed platform**.

## 8) مهام جاهزة للإرسال لوكيل الذكاء الاصطناعي

### T1 — ثبت سجل الحقيقة مع شجرة الملفات الحالية

الهدف: مزامنة docs/fact-record.md و docs/completion-plan.md مع الشجرة الفعلية، وإضافة أي ملف جديد أو مكرر مع تصنيف واضح.

المدخلات:
- docs/fact-record.md
- docs/completion-plan.md
- .agents/memory/*
- attached_assets/*

يعُدّ العمل منجزًا عندما:
- لا يوجد ملف tracked خارج السجل
- كل ملف في السجل له تصنيف: عقد/بيانات/تحليل/تنفيذ/عرض/مختبر/وثائق/أصول
- أي تعارض في العدد أو العناوين يتم حله

الأولوية: high

### T2 — تقوية الحدود غير الوظيفية في طبقة التنفيذ

الهدف: إغلاق الفجوات الأمنية/التشغيلية التي ما زالت تعتمد على اتفاق ضمني أكثر من كونها مفروضة.

المدخلات:
- artifacts/api-server/src/app.ts
- artifacts/api-server/src/routes/*
- lib/db/src/schema/*

يعُدّ العمل منجزًا عندما:
- تثبيت سياسة CORS/Helmet/Rate limit مبررة ومختبرة
- إضافة طبقة auth/RBAC أو توثيق غيابها كقرار صريح إذا كان المنتج داخليًا
- تعريف حدود واضحة للبيانات الحساسة وسجل التدقيق

الأولوية: high

### T3 — افصل مسار المسح الثقيل عن دورة HTTP

الهدف: تحويل scan jobs من fire-and-forget داخل العملية إلى عامل خلفي واضح أو queue داخلي موثق.

المدخلات:
- artifacts/api-server/src/lib/scan-runner.ts
- lib/db/src/schema/scan_jobs.ts
- artifacts/api-server/src/routes/projects.ts

يعُدّ العمل منجزًا عندما:
- لا يعتمد المسح الطويل على نفس event loop دون عزل واضح
- حالات queued/running/completed/failed قابلة للتتبع بدقة
- فشل المسح لا يترك المشروع في حالة معلقة

الأولوية: high

### T4 — عمّق قدرات المستخرج البنيوي والربط البياني

الهدف: زيادة تغطية graph-extractor ليصبح المعرفة الهيكلية أكثر ثراءً وأقل اعتمادًا على regex.

المدخلات:
- lib/scanner/src/graph-extractor.ts
- lib/scanner/src/__tests__/graph-extractor.test.ts

يعُدّ العمل منجزًا عندما:
- تغطية أعمق لأنماط TS/JS الحرجة
- فصل واضح لما يدعمه AST وما يزال regex
- اختبارات تثبت عدم كسر الأنماط الحالية

الأولوية: medium

### T5 — حوّل لوحة التحكم إلى مركز تشغيلي كامل

الهدف: استكمال واجهات العلاقات والتاريخ والـ logs والـ trend charts والـ empty/error states.

المدخلات:
- artifacts/dashboard/src/pages/*
- lib/api-client-react/src/generated/*

يعُدّ العمل منجزًا عندما:
- الصفحات تعرض بيانات زمنية وتاريخًا تشغيليًا وليس لقطات سطحية فقط
- Graph وWorkflow وTasks قابلة للتشغيل من الواجهة
- كل صفحة لها loading/error/empty states منضبطة

الأولوية: medium

### T6 — ارفع الاختبارات إلى مستوى تثبيت السلوك

الهدف: إضافة اختبارات لمسارات الفشل والاتساق والعلاقات المتقاطعة وليس فقط النجاح.

المدخلات:
- artifacts/api-server/src/routes/*.test.ts
- lib/scanner/src/__tests__/*

يعُدّ العمل منجزًا عندما:
- اختبارات race/atomic-claim وfailure-path موجودة
- تغطية المسارات الحساسة في discovery/import/task/workflow
- codegen drift check مفعّل ضمن سير التطوير

الأولوية: high

### T7 — ثبّت حوكمة الإضافات

الهدف: تعريف contract واضح للـ plugins وربطها بنقاط تمديد حقيقية داخل النظام.

المدخلات:
- lib/db/src/schema/plugins.ts
- artifacts/api-server/src/routes/plugins.ts

يعُدّ العمل منجزًا عندما:
- capabilities ليست مجرد سجل، بل تُستخدم في سلوك النظام
- توثيق رسمي لكيفية إضافة/تعطيل plugin وتأثيره
- اختبار تفعيل/تعطيل وحالات الفشل

الأولوية: medium

### T8 — مراجعة نهائية للعقد المولّد والدقة بين الطبقات

الهدف: التأكد أن openapi.yaml و api-zod و api-client-react و routes متطابقة بلا drift.

المدخلات:
- lib/api-spec/openapi.yaml
- lib/api-zod/src/generated/*
- lib/api-client-react/src/generated/*
- artifacts/api-server/src/routes/*

يعُدّ العمل منجزًا عندما:
- codegen:check نظيف
- أي endpoint جديد يولّد schemas/hooks بدون تعارض أسماء
- لا توجد مسارات خادم غير ممثلة في العقد

الأولوية: high

## 9) ملاحظة تشغيلية
الملف `docs/fact-record.md` هو السجل التفصيلي الملف-ب-الملف، بينما هذا التقرير يقدّم القراءة المعمارية والتنفيذية العليا ويحوّلها إلى خطة عمل.

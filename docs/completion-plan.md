# خطة استكمال EngineeringOS

مبنية على: `EngineeringOS_File_Inventory_Complete.md` و `EngineeringOS_Combined_Deep_Analysis.md`

## الوضع الحالي (ملخص من التحليل)
- **نضج معماري مرتفع**: عقد OpenAPI-first، فصل واضح بين lib/artifacts، DB schema غني (projects, rules, tasks, workflows, metrics, graph, discovery, audit_logs, plugins).
- **نضج تنفيذي متوسط-جيد**: discovery/import pipeline ناضج جدًا (session state, background pipeline, claim ذري + transaction, TTL cleanup). الخادم مقوّى (helmet, rate-limit, trust proxy, error handler مركزي).
- **الفجوة الأكبر**: scanner لا يزال regex/heuristics وليس AST؛ الاختبارات محصورة في `lib/scanner/src/__tests__/` فقط؛ audit_logs موجود كمخطط لكن غير موصول في كل المسارات الحساسة؛ workflow engine بدائي؛ بعض الحسابات الثقيلة داخل request cycle.

## المراحل المقترحة

### المرحلة 1 — تثبيت الحقيقة (Testing & Contract Safety)
- إضافة اختبارات للمسارات الحرجة خارج scanner: `discovery.ts` (claim ذري، transaction rollback)، `projects.ts`, `tasks.ts`.
- اختبار تكامل بين `openapi.yaml` والكود المولّد (orval) للكشف عن drift تلقائيًا في CI.
- توسيع `lib/scanner/src/__tests__/` لتغطية edge cases إضافية (ملفات كبيرة، امتدادات غير مدعومة، مسارات نسبية معقدة).

### المرحلة 2 — تقوية الاستخراج (Scanner/Graph Upgrade)
- استبدال أجزاء من regex-based extraction بـ AST حقيقي (مثل TypeScript Compiler API) في `graph-extractor.ts`.
- تثبيت قواعد identity واضحة لـ entities/relationships في الـ graph (تجنّب تكرار/تضارب الهوية).
- توسيع `rule-matcher.ts` ليدعم أنماط أعمق دون المساس بالـ caps الأمنية الحالية.

### المرحلة 3 — تقوية الحوكمة (Audit & Traceability)
- ربط `audit_logs` فعليًا بكل المسارات الحساسة (create/update/delete على projects, rules, tasks, workflows).
- توحيد events + audit logs + task logs في مسار تتبع واحد واضح.
- إضافة traceability لعمليات discovery/import/scan/execute/start/stop.

### المرحلة 4 — فصل الأحمال الثقيلة (Performance & Background Jobs)
- نقل الحسابات الثقيلة (مثل aggregation في dashboard، حساب metrics/trend) إلى background jobs أو cached views.
- تخفيف استعلامات dashboard الكبيرة (pagination، indexing، caching).

### المرحلة 5 — توسيع المنظومة (Platform Depth)
- تطوير workflow engine ليصبح multi-phase حقيقي (حالات انتقالية، retries، rollback).
- توسيع plugins كـ capability layer فعلي بدل هيكل أولي.
- تعميق tasks pipeline (verification steps، feedback loop) بدلاً من كونه CRUD فقط.

## ترتيب التنفيذ الموصى به
1 → 3 (الاختبارات + الحوكمة يمكن أن يسيرا معًا لأنهما مستقلان عن بعض)
ثم 2 (يحتاج استقرار الاختبارات ليقاس التحسن)
ثم 4
ثم 5 (الأعمق والأكثر اعتمادًا على استقرار ما سبق)

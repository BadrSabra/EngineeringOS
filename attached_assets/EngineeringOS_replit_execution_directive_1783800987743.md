# EngineeringOS — Execution Directive for Replit Agent

## Mission
حوّل المشروع من حالة "منصة مكتملة شكليًا جزئيًا" إلى منصة قابلة للتشغيل، مضبوطة بالعقود، ومثبتة بالسلوك، مع تقليل drift بين الطبقات.

## قواعد تنفيذ صارمة
1. لا تعتبر أي مهمة مكتملة إلا بعد تحقق جميع معايير القبول الخاصة بها.
2. لا تنتقل إلى مهمة لاحقة إذا فشل أي أمر تحقق في المهمة الحالية.
3. لا تعدّل ملفات خارج نطاق المهمة إلا إذا كان ذلك ضروريًا ومبررًا بالاعتماديات.
4. بعد كل تغيير، شغّل أوامر التحقق المحددة للمهمة نفسها.
5. أي اختلاف بين `openapi.yaml` وملفات التوليد أو `routes` يجب اعتباره عيبًا حرجًا.
6. أي مسار طويل أو حساس يجب أن يثبت بالحالات الفاشلة وليس مسار النجاح فقط.

## ترتيب التنفيذ المقترح
`T1 → (T2, T3, T4, T7) → (T6, T5) → T8`

T6 وT5 يمكن تنفيذهما بالتوازي بعد اكتمال الأساسيات الأمنية/البيانية/التحليلية/الامتدادية.

## Gates عامة بعد كل مرحلة
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run codegen:check` عند أي تغيير في طبقة العقد أو العميل المولّد
- `pnpm run build` قبل إعلان المرحلة النهائية

---

## T1 — ثبت سجل الحقيقة مع شجرة الملفات الحالية
**الأولوية:** high

**الاعتماديات:** لا يوجد

**النطاق:**
- `docs/fact-record.md`
- `docs/completion-plan.md`
- `.agents/memory/*`
- `attached_assets/*`

**الهدف التنفيذي:** مزامنة سجل الحقيقة مع الشجرة الفعلية وإخراج تصنيف نهائي لكل ملف: عقد/بيانات/تحليل/تنفيذ/عرض/مختبر/وثائق/أصول.

**أوامر التنفيذ والتحقق:**
- `git status --short`
- `find . -type f | sort > /tmp/engineeringos-tree.txt`
- `pnpm run typecheck`

**خطوات التنفيذ:**
- قارن سجل الحقيقة والشجرة الفعلية واكشف أي ملفات مفقودة أو مكررة أو غير مصنفة.
- حدّث التصنيف لكل ملف وفق دوره الفعلي لا اسمه فقط.
- أغلق أي تعارض عددي أو وصفي بين الوثائق وبين الأصول الحقيقية.

**معايير القبول:**
- لا يوجد ملف tracked خارج سجل الحقيقة.
- كل ملف في السجل له تصنيف واحد واضح.
- لا توجد تعارضات بين عدّ الملفات والعناوين والأقسام.

**بوابة التحقق النهائية للمهمة:**
- `git status --short`
- `pnpm run typecheck`

---

## T2 — تقوية الحدود غير الوظيفية في طبقة التنفيذ
**الأولوية:** high

**الاعتماديات:** T1

**النطاق:**
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/routes/*`
- `lib/db/src/schema/*`

**الهدف التنفيذي:** إغلاق الفجوات الأمنية/التشغيلية عبر سياسات مفروضة ومختبرة بدل الاعتماد على اتفاق ضمني.

**أوامر التنفيذ والتحقق:**
- `pnpm --filter @workspace/api-server typecheck`
- `pnpm --filter @workspace/api-server test`
- `pnpm run typecheck`

**خطوات التنفيذ:**
- ثبت إعدادات Helmet وCORS وRate Limit في نقطة دخول واحدة واضحة.
- حدد قرار auth/RBAC صراحة: تطبيقه الآن أو توثيق عدم تفعيله كقرار منتج داخلي.
- عرّف الحدود الخاصة بالبيانات الحساسة ومسار التدقيق audit log.

**معايير القبول:**
- إعدادات CORS/Helmet/Rate limit موجودة ومبررة ومختبرة.
- موقف auth/RBAC موثق بوضوح أو مطبق فعلاً.
- لا توجد مسارات حساسة بلا أثر تدقيقي.

**بوابة التحقق النهائية للمهمة:**
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/api-server typecheck`

---

## T3 — افصل مسار المسح الثقيل عن دورة HTTP
**الأولوية:** high

**الاعتماديات:** T1, T2

**النطاق:**
- `artifacts/api-server/src/lib/scan-runner.ts`
- `lib/db/src/schema/scan_jobs.ts`
- `artifacts/api-server/src/routes/projects.ts`

**الهدف التنفيذي:** تحويل المسح من fire-and-forget داخل العملية إلى مسار خلفي واضح أو queue داخلي موثق.

**أوامر التنفيذ والتحقق:**
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/api-server typecheck`
- `pnpm run test`

**خطوات التنفيذ:**
- افصل تشغيل المسح الطويل عن نفس event loop كلما أمكن.
- اجعل الحالات queued/running/completed/failed قابلة للتتبع بدقة.
- تأكد أن الفشل لا يترك المشروع في حالة معلقة أو نصف مكتملة.

**معايير القبول:**
- المسح الطويل لا يعتمد على HTTP request lifecycle وحده.
- حالات scan job كاملة ومتعقبة.
- فشل المسح ينتج حالة نهائية واضحة.

**بوابة التحقق النهائية للمهمة:**
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/api-server typecheck`

---

## T4 — عمّق قدرات المستخرج البنيوي والربط البياني
**الأولوية:** medium

**الاعتماديات:** T1

**النطاق:**
- `lib/scanner/src/graph-extractor.ts`
- `lib/scanner/src/__tests__/graph-extractor.test.ts`

**الهدف التنفيذي:** رفع ثراء graph-extractor وتقليل الاعتماد على regex قدر الإمكان عبر AST حيث يلزم.

**أوامر التنفيذ والتحقق:**
- `pnpm --filter @workspace/scanner test`
- `pnpm --filter @workspace/scanner test:coverage`
- `pnpm run typecheck`

**خطوات التنفيذ:**
- وسّع الأنماط الحرجة في TS/JS التي يدعمها المستخرج.
- افصل صراحة ما يأتي من AST وما يزال regex.
- أضف اختبارات تمنع كسر الأنماط الحالية.

**معايير القبول:**
- التغطية أعمق للأنماط الحرجة.
- مصدر كل نوع استخراج واضح: AST أو regex.
- الاختبارات الحالية لا تنكسر.

**بوابة التحقق النهائية للمهمة:**
- `pnpm --filter @workspace/scanner test`
- `pnpm --filter @workspace/scanner test:coverage`

---

## T5 — حوّل لوحة التحكم إلى مركز تشغيلي كامل
**الأولوية:** medium

**الاعتماديات:** T1, T2, T3, T4, T7

**النطاق:**
- `artifacts/dashboard/src/pages/*`
- `lib/api-client-react/src/generated/*`

**الهدف التنفيذي:** إكمال واجهات العلاقات والتاريخ والـ logs والـ trend charts وحالات loading/error/empty.

**أوامر التنفيذ والتحقق:**
- `pnpm --filter @workspace/dashboard typecheck`
- `pnpm --filter @workspace/dashboard build`
- `pnpm run codegen`

**خطوات التنفيذ:**
- اجعل صفحات Graph وWorkflow وTasks قابلة للتنفيذ من الواجهة.
- أضف سلاسل زمنية وتاريخًا تشغيليًا بدل اللقطات السطحية فقط.
- غطِّ كل صفحة بحالات loading/error/empty منضبطة.

**معايير القبول:**
- Graph وWorkflow وTasks قابلة للتشغيل من الواجهة.
- الصفحات تعرض بيانات زمنية وتاريخًا تشغيليًا.
- لا توجد صفحة بدون loading/error/empty states.

**بوابة التحقق النهائية للمهمة:**
- `pnpm --filter @workspace/dashboard typecheck`
- `pnpm --filter @workspace/dashboard build`

---

## T6 — ارفع الاختبارات إلى مستوى تثبيت السلوك
**الأولوية:** high

**الاعتماديات:** T2, T3, T4, T7

**النطاق:**
- `artifacts/api-server/src/routes/*.test.ts`
- `lib/scanner/src/__tests__/*`

**الهدف التنفيذي:** إضافة اختبارات للمسارات الحرجة والفشل والتزامن والعلاقات المتقاطعة وليس فقط النجاح.

**أوامر التنفيذ والتحقق:**
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/scanner test`
- `pnpm run codegen:check`

**خطوات التنفيذ:**
- أضف اختبارات race/atomic-claim/failure-path.
- غطِّ discovery/import/task/workflow للمسارات الحساسة.
- فعّل drift check للعقد المولدة ضمن سير التطوير.

**معايير القبول:**
- اختبارات التزامن والفشل موجودة.
- المسارات الحساسة مغطاة.
- codegen drift check يعمل دون فرق غير مقصود.

**بوابة التحقق النهائية للمهمة:**
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/scanner test`
- `pnpm run codegen:check`

---

## T7 — ثبّت حوكمة الإضافات
**الأولوية:** medium

**الاعتماديات:** T1, T2

**النطاق:**
- `lib/db/src/schema/plugins.ts`
- `artifacts/api-server/src/routes/plugins.ts`

**الهدف التنفيذي:** تعريف contract واضح للـ plugins وربطها بنقاط تمديد حقيقية داخل النظام.

**أوامر التنفيذ والتحقق:**
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/api-server typecheck`
- `pnpm run typecheck`

**خطوات التنفيذ:**
- حوّل capabilities من سجل وصفي إلى سلوك فعلي مؤثر في النظام.
- اكتب طريقة إضافة/تعطيل plugin وتأثير ذلك تشغيليًا.
- اختبر تفعيل/تعطيل plugin وحالات الفشل.

**معايير القبول:**
- capabilities تؤثر فعلًا في السلوك.
- تأثير plugin موثق رسميًا.
- حالات التفعيل/التعطيل والفشل مغطاة باختبارات.

**بوابة التحقق النهائية للمهمة:**
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/api-server typecheck`

---

## T8 — مراجعة نهائية للعقد المولّد والدقة بين الطبقات
**الأولوية:** high

**الاعتماديات:** T2, T3, T4, T5, T6, T7

**النطاق:**
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/*`
- `lib/api-client-react/src/generated/*`
- `artifacts/api-server/src/routes/*`

**الهدف التنفيذي:** التأكد أن العقد والـ schemas والـ client والـ routes متطابقة بلا drift.

**أوامر التنفيذ والتحقق:**
- `pnpm run codegen:check`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run build`

**خطوات التنفيذ:**
- تأكد أن أي endpoint جديد يولّد schemas/hooks تلقائيًا.
- تحقق أنه لا توجد routes على الخادم غير ممثلة في العقد.
- أصلح أي تعارض أسماء أو فروق بين الطبقات.

**معايير القبول:**
- codegen:check نظيف.
- لا توجد مسارات خادم غير ممثلة في openapi.yaml.
- لا توجد فروق drift بين العقد والكود المولّد.

**بوابة التحقق النهائية للمهمة:**
- `pnpm run codegen:check`
- `pnpm run build`

---


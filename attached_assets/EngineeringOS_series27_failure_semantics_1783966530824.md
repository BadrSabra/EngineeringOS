# EngineeringOS — السلسلة 27
## نموذج الفشل، الاستعادة، والحدود التشغيلية للمنصة

هذه السلسلة لا تعيد سرد طبقات EngineeringOS مرة أخرى، بل تركّز على سؤال واحد حاسم: **كيف يتصرف النظام عند الضغط، الفشل، أو انقطاع العملية؟**  
الجواب من داخل الملفات واضح: المنصة لم تعد مجرد CRUD فوق قواعد بيانات؛ بل أصبحت **control plane** له قيود تشغيلية صريحة، ومسارات تعافٍ، وآليات قفل، وأثر متتبع عبر audit/events/metrics.

---

## 1) ما الذي ثبت من الأرشيف نفسه

حسب الأرشيف المرفوع وملفات التوثيق الداخلية:

- الأرشيف يحتوي **518 ملفًا**.
- `lib/api-spec/openapi.yaml` يعرّف **47 مسارًا** و **58 عملية API** فعلية.
- `lib/api-spec` يحتوي **59 schema**.
- `lib/db/src/schema/` يحتوي **14 ملف مخطط**.
- `.agents/memory/` يحتوي **14 مذكرة قرار وتشغيل**.
- `artifacts/api-server/src/lib/` يضم طبقة تشغيل فعلية: queue / reconciliation / scan runner / plugin runtime / audit / logger.
- `artifacts/api-server/src/routes/` يضم مسارات ليست عرضًا فقط، بل مسارات انتقال حالة: projects / tasks / workflows / plugins / rules / ai / dashboard.

هذه الأرقام مهمة لأنها تثبت أن EngineeringOS ليس مشروعًا متفرقًا؛ بل **نواة محكومة** يمكن تتبع سلوكها من العقد إلى التنفيذ إلى التوثيق.

---

## 2) لماذا هذه السلسلة مختلفة عن السلاسل السابقة

السلاسل السابقة ركزت على:
- الطبقات،
- العقود،
- المعرفة،
- الذكاء الاصطناعي،
- وحدود الثقة بين الأجزاء.

أما هذه السلسلة فتركز على **الهندسة تحت الضغط**:
- ماذا يحدث عندما تتكدس المهام؟
- ماذا يحدث إذا تعطل التنفيذ في منتصف الطريق؟
- كيف نمنع بقاء المشروع في `scanning` أو `running` إلى الأبد؟
- كيف نمنع الطلب الواحد من فتح أكثر من مسار تنفيذ لنفس الكيان؟
- أين تنتهي best-effort telemetry وتبدأ الحالة التشغيلية الحقيقية؟

---

## 3) آلية التحكم في الضغط: JobQueue

الملف `artifacts/api-server/src/lib/job-queue.ts` يعرّف طابورًا محليًا **bounded-concurrency in-process**.

### ما الذي يثبته هذا عمليًا؟
- لا يمكن لعدد غير محدود من scan/discovery jobs أن يعمل في نفس اللحظة.
- أي فائض فوق الحدّ المسموح ينتظر في الذاكرة بدل أن يقتل event loop.
- أي job يفشل لا يخرج كـ unhandled rejection، وبالتالي لا يكسر العملية كاملة.

### المعنى المعماري
هذا ليس مجرد “تحسين أداء”.  
هذا **قيد تشغيل** يمنع:
- اختناق HTTP server،
- انفجار التوازي أثناء file walk أو rule matching،
- وتحول خطأ واحد إلى crash جماعي.

### الدليل من الاختبارات
`artifacts/api-server/src/lib/job-queue.test.ts` يثبت شيئين أساسيين:
1. الطابور لا يتجاوز حد التوازي المعلن.
2. لو job رمت استثناء، فالطابور لا يتجمد، ويواصل تفريغ backlog.

هذه نقطة مهمة جدًا: المنصة هنا لا “تأمل” أن العمل سينجح، بل **تصمم من أجل الفشل**.

---

## 4) الاستعادة بعد الانقطاع: Job Reconciliation

الملف `artifacts/api-server/src/lib/job-reconciliation.ts` يعالج مشكلة أعمق:  
إذا كانت scan/discovery jobs **في الذاكرة** وبعض حالاتها محفوظة فقط في DB، فماذا يحدث لو ماتت العملية؟

### ما الذي يحدث في الواقع؟
- jobs التي بقيت `queued` أو `running` بعد restart تُعتبر orphaned.
- reconciliation عند الإقلاع يضعها في `failed`.
- المشروع المرتبط بها يُعاد من `scanning` إلى `active`.

### لماذا هذا مهم؟
لأن النظام يعترف ضمنيًا أن:
- job queue محلي وغير durable،
- لكن حالة الكيان النهائي يجب ألا تُترك معلقة.

### ماذا تقول الاختبارات؟
`artifacts/api-server/src/lib/job-reconciliation.test.ts` يثبت أن:
- jobs العالقة تتحول إلى failed،
- وproject يرجع active،
- والآثار الثانوية تُسجَّل.

هذه ليست مجرد housekeeping.  
هذا **عقد استعادة** يمنع النظام من البقاء عالقًا في state غير قابلة للخروج.

---

## 5) الـ scan نفسه مصمم كعملية ذرّية قدر الإمكان

الملف `artifacts/api-server/src/lib/scan-runner.ts` هو جوهر هذه السلسلة.

### أ) هناك correlation واحد لكل scan
`performScan()` ينشئ `correlationId` واحدًا، ثم يستخدمه في:
- audit logs،
- events،
- metrics.

هذا يعني أن scan واحد يمكن تتبعه بالكامل عبر:
`WHERE correlation_id = ?`

وهذا أفضل بكثير من مطاردة timestamps أو projectId فقط.

### ب) الكتابة ليست “متفرقة”
داخل scan runner، النتائج المشتقة من نفس المسح تُحفظ معًا:
- tasks،
- rule hit counts،
- graph entities/relationships،
- metric row،
- تحديث project status/score،
- audit record،
- scan event.

الفكرة هنا واضحة:  
إذا فشل جزء من هذه السلسلة في منتصف الطريق، فالأفضل أن لا يبقى النظام بتركيبة نصف صحيحة.

### ج) الاستمرار بعد الفشل
`runScanJob()` محاط بـ try/catch من البداية إلى النهاية:
- يضبط job إلى `running`,
- يشغّل `performScan()`,
- ثم يكتب `completed`,
- وإذا فشل، يكتب `failed`,
- ويعيد المشروع إلى `active`.

هذا يثبت أن المنصة لا تترك المشروع في `scanning` للأبد.

### الدليل من النص نفسه
تعليقات الملف لا تخفي هذا:
- لا await قبل try.
- لا throw خارج fire-and-forget call.
- إعادة الحالة إلى active حتى في مسار الفشل.

هذه إشارات قوية جدًا إلى أن التصميم **مقصود** وليس صدفة.

---

## 6) قيود تنفيذ المهام: atomic claim + state transitions

في `artifacts/api-server/src/routes/tasks.ts` يظهر أن المهام ليست CRUD عادية، بل **state machine**.

### أمثلة واضحة
- `/tasks/:taskId/execute`
- `/tasks/:taskId/retry`
- `/tasks/:taskId/rollback`

### ماذا يعني ذلك؟
- execute لا يعمل إلا إذا كانت المهمة في `pending` أو `queued`.
- update يتم بشرط status guard.
- لو جاء طلبان في نفس الوقت، واحد فقط يربح، والآخر يحصل على `409`.

### لماذا هذا مهم؟
لأنه يمنع:
- double execution،
- double logging،
- race conditions في verification،
- وتضارب status داخل DB.

### rollback أيضًا محروس
`rollback` لا يكتفي بتغيير status؛ بل يستخدم شرطًا atomic claim ويكتب:
- task log،
- event،
- audit entry.

إذن العملية هنا ليست “تغيير حقل”، بل **تحول حالة موثّق ومقيد**.

### الخلاصة
المهام في EngineeringOS لها منطق تشغيل حقيقي:
- claim،
- transition،
- log،
- audit،
- conflict handling.

وهذا يضعها أقرب إلى workflow engine منها إلى جدول بسيط.

---

## 7) workflows ليست static records

في `artifacts/api-server/src/routes/workflows.ts` يوجد نفس المنطق تقريبًا:
- creation يسجل event وaudit،
- start/stop يتحرك عبر phases،
- التنفيذ يتابع execution rows.

هذا يعني أن workflow ليس تعريفًا فقط، بل **كيان له حياة تنفيذية**.

الاختبارات في `artifacts/api-server/src/routes/workflows.test.ts` تؤكد أن:
- workflow يتقدم عبر phases بترتيب محدد،
- وينهي execution بعد آخر phase.

---

## 8) plugin runtime: telemetery مفصولة عن صحة المسح

`artifacts/api-server/src/lib/plugin-runtime.ts` يوضح فلسفة مهمة جدًا:

### ما الذي يحدث؟
- الـ plugins ليست processes خارجية.
- هي TypeScript objects داخل نفس runtime.
- DB فقط تخزن من هو enabled.
- التنفيذ best-effort.

### ماذا يعني best-effort هنا؟
إذا فشل plugin:
- لا يفشل scan،
- لا يردّ scan،
- لا يغيّر نتيجة المسح الأساسية،
- لكنه يكتب error في logs.

### لماذا هذا القرار مهم؟
لأن المنصة تفصل بين:
- **صحة الاكتشاف الأساسي**،
- و**إثراء النتائج بplugins**.

هذه خطوة ناضجة:  
المنصة لا تسمح للـ telemetry الإضافية أن تسرق موثوقية core scan.

### ما الذي تثبته الاختبارات؟
`artifacts/api-server/src/lib/plugin-runtime.test.ts` يثبت أن:
- كل plugin hook يعمل على context مضبوط،
- plugin-react لا يطلق events بلا سبب،
- ويكشف المؤشرات المناسبة عندما تتوفر.

---

## 9) نقطة الضعف الصريحة: auth ما زال أحادي المستوى

الملف `artifacts/api-server/src/middlewares/requireAuth.ts` صريح جدًا:
- هناك Clerk session مطلوبة.
- لكن **لا يوجد per-role ولا per-project authorization layer بعد**.
- كل user موثّق لديه وصول كامل إلى المشاريع والمهام والـ workflows والـ rules والـ plugins والـ metrics.

### المعنى
هذا ليس bug خفيًا.  
هذا **حد معلوم ومصرّح به**.

### أثره على التقييم
- المنصة محمية ضد anonymous access.
- لكنها ليست بعد منصة مفصولة الصلاحيات.
- أي backlog ناضج يجب أن يبدأ من هنا إذا كان الهدف multi-tenant governance أو least privilege.

---

## 10) ماذا تقول المسارات العامة عن طبيعة المنصة

### Projects
`routes/projects.ts` يربط:
- project creation،
- scan job enqueue،
- events،
- audit،
- والـ heavy queue.

### AI
`routes/ai.ts` يثبت أن AI layer ليست تجربة منفصلة، بل مرتبطة بـ:
- project context،
- task execution،
- code review،
- workflow orchestration،
- logs وevents.

### Dashboard
`routes/dashboard.ts` لا يعرض بيانات فقط، بل يجمع:
- المشاريع،
- المهام،
- الأحداث،
- القواعد،
- metrics،
- ثم يحسب active/completed/failed counters.

هذا يجعل dashboard واجهة **مراقبة تشغيلية** وليس صفحة عرض خام.

---

## 11) المصفوفة التنفيذية المختصرة

| الطبقة | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| JobQueue | مكتمل جزئيًا | bounded concurrency + tests | يمنع الضغط المفاجئ | durable queue |
| Reconciliation | مكتمل جزئيًا | orphaned jobs → failed | يمنع التعليق بعد restart | restart-safe scheduling |
| Scan Runner | قوي جدًا | correlationId + atomic persistence | traceability عالية | فصل worker/process |
| Tasks FSM | قوي جدًا | atomic claim + 409 | يمنع race conditions | richer policy guards |
| Workflows FSM | قوي جدًا | phase progression + execution rows | تشغيل حقيقي للـ workflows | cancellation/compensation |
| Plugin Runtime | مكتمل وظيفيًا | in-process hooks + best effort | لا يكسر scan الأساسي | plugin isolation |
| AuthZ | مفقود | requireAuth يقرّ بالغياب | access متساوٍ لكل authenticated user | RBAC/ACL |
| Observability | قوي جزئيًا | events + audit + metrics | تتبع جيد | unified tracing |

---

## 12) الخلاصة العملية لهذه السلسلة

EngineeringOS الآن ليس مجرد منصة “تفهم المشروع”؛  
بل صار **منصة تعرف كيف تتصرف عندما تفشل**.

وهذا هو الفرق بين:
- مشروع ما زال يثبت الفكرة،
- ومنصة بدأت تقترب من control plane حقيقي.

لكن الإغلاق النهائي ما زال يحتاج:
1. **RBAC / project-scoped authorization**  
2. **durable queue أو worker backing**  
3. **توحيد tracing عبر جميع المسارات**  
4. **policy engine يحدد من يحق له تنفيذ ماذا**  
5. **فصل أقوى بين core runtime وplugin enrichment**

هذه ليست إضافات تجميلية؛  
هذه هي طبقة النضج التي تفصل بين “يعمل” و“يمكن الوثوق به”.


# تدقيق إغلاق EngineeringOS — لقطة قراءة فقط

**تاريخ الفحص:** 2026-11-06
**النسخة المرجعية:** `473da246a3bd8cff483a2faecd7f3fd3494f9f92` (`main`)
**النطاق:** مطابقة الادعاءات القابلة للتحقق في الملف المرفق مع GitHub والكود المحلي. هذه ليست مراجعة مكتملة لكل المحاور الاثني عشر.

لم تُعدّل الشيفرة أو إعدادات GitHub، ولم تُدمج أو تُغلق طلبات سحب. أُعيد تشغيل اختبار سياسة Dashboard محليًا لإثبات الحالة فقط؛ بقي فاشلًا كما هو موضح أدناه.

## النتيجة التنفيذية

**لا تتوفر أدلة كافية لإغلاق المشروع أو اعتماد النسخة الحالية.** توجد بوابتان فاشلتان في CI على النسخة المرجعية، وطلبا السحب المفتوحان ما زالا مسودتين ومتأخرين كثيرًا عن `main`. لا يعني ذلك أن كل مكونات المنتج معطوبة؛ كثير من بنود التقرير قوائم فحص لا ادعاءات مثبتة، وتظل حالتها `UNKNOWN` إلى أن تُراجع بأدلة.

## سجل الأدلة

| المحور | الحالة | الدليل والحدود |
|---|---|---|
| النسخة المرجعية | PASS | فرع مساحة العمل `main` وSHA المحلي يطابقان SHA الذي أعاده GitHub لـ `main`. |
| حماية `main` | FAIL / يحتاج قرارًا | مسار GitHub القياسي لحماية الفرع أعاد `404` مع `Branch not protected`. لم تُفحص قواعد Repository Rulesets؛ لذلك لا يُستنتج غياب كل أشكال القواعد قبل التحقق منها. |
| توقيع آخر Commit | حالة مؤكدة، وليست عيبًا بذاتها | GitHub أعاد `verified: false` وسبب `unsigned` للـ Commit المرجعي. عدم التوقيع وحده لا يثبت اختراقًا ولا يصبح إخفاقًا إلا إذا اعتمد المشروع سياسة توقيع. |
| طلبات السحب المفتوحة | PARTIAL | قائمة GitHub الحالية تضم مسودتين مفتوحتين فقط: PR #1 وPR #2. المقارنة مع `main` الحالي: #1 متقدم 7 ومتأخر 275 Commit؛ #2 متقدم 3 ومتأخر 273 Commit. أحدث CI معروف لكل رأس PR فاشل. لا ينبغي دمجهما قبل مراجعة تغييراتهما وتشغيل التحقق على قاعدة حديثة. |
| أرقام PR #17 و#23 | قديمة/غير مثبتة | لا تظهر في قائمة طلبات السحب المفتوحة الحالية. لذلك جدول التقرير الذي يعرضهما بوصفهما الطلبات المفتوحة غير متسق مع الحالة الحية؛ الطلبان المفتوحان الآن هما #1 و#2. |
| Issues المفتوحة | PASS | طلب GitHub الحالي أعاد صفر Issues مفتوحة (مع استبعاد عناصر Pull Request). |
| CI على `main` | FAIL | أحدث تشغيل CI هو #258 على SHA المرجعي نفسه، وانتهى بالفشل: فشل فحص سياسة Dashboard وفشل خطوة `Run tests`. التشغيل: https://github.com/BadrSabra/EngineeringOS/actions/runs/42228943669 |
| سبب فشل فحص سياسة Dashboard | FAIL ومُعاد محليًا | `pnpm run test:dashboard-contract-trigger`: 3 من 4 اختبارات نجحت، وفشل اختبار تصنيف مستهلكي API. وجد الاختبار 22 ملفًا ضمن تقسيم `pages/ai-chat` غير مصنّف في `.github/dashboard-contract-trigger-policy.json`؛ التقرير المرفق ذكر 21، والعدد الحالي 22. |
| سبب فشل `Run tests` | FAIL في إعداد CI، وليس فشل اختبارات المنتج | سجل #258 يبيّن أن المشرف خرج عند `scripts/workspace-runtime-supervisor.mjs:29-31` لأن `SESSION_SECRET` غير مضبوط في خطوة `Run tests`. فشل فحص الجاهزية قبل تنفيذ `pnpm run test`؛ لذلك لم تبدأ مجموعة اختبارات المنتج في ذلك التشغيل، ولا يثبت هذا السجل فشلها. |
| OpenAPI contract drift | FAIL في التغطية الفعلية للتشغيل | تشغيل Push #258 تخطّى هذه المهمة بعد فشل `contract-trigger`. في `.github/workflows/ci.yml` تعتمد المهمة على `contract-trigger`، وشرطها لا يتضمن `always()`؛ لذلك يمنع سلوك الاعتماد الافتراضي تشغيلها عند فشل المهمة السابقة، رغم أن شرطها يذكر Push. |
| Release validation | UNKNOWN، وليس فشل Push | تخطيها في Push متوقع: المهمة مشروطة بـ `workflow_dispatch` وباختيار بيئة `release-validation`. لم يظهر أي تشغيل `workflow_dispatch` على `main` في الاستعلام الحالي، لذا لا يوجد هنا دليل قبول إصدار ناجح. هذا لا يثبت أن تشغيلًا ناجحًا لم يحدث تاريخيًا على أي مرجع آخر. |
| الرحلة الكاملة وبقية محاور المنتج | UNKNOWN | لا يثبت تشغيل CI الحالي رحلة قبول كاملة ناجحة؛ وفي المقابل لا تكفي هذه اللقطة لإثبات أن الرحلة لم تنجح سابقًا. بنود Agent Core وDatabase وPlugins وSecurity وFrontend وProduction في الملف المرفق هي أسئلة تدقيق، وليست مخالفات مثبتة بمجرد وجودها في القائمة. |

### الملفات التي كشفها اختبار السياسة

هذه هي الملفات الـ22 غير المصنفة التي أبلغ عنها الاختبار الحالي:

```text
artifacts/dashboard/src/pages/ai-chat/delivery-proof.tsx
artifacts/dashboard/src/pages/ai-chat/evidence-panels.tsx
artifacts/dashboard/src/pages/ai-chat/execution-proof.tsx
artifacts/dashboard/src/pages/ai-chat/execution-trace.tsx
artifacts/dashboard/src/pages/ai-chat/forensic-evidence-card.tsx
artifacts/dashboard/src/pages/ai-chat/message-bubble.tsx
artifacts/dashboard/src/pages/ai-chat/pending-changes.tsx
artifacts/dashboard/src/pages/ai-chat/project-query.tsx
artifacts/dashboard/src/pages/ai-chat/provider-key-cards.tsx
artifacts/dashboard/src/pages/ai-chat/provider-runtime.tsx
artifacts/dashboard/src/pages/ai-chat/stream-errors.ts
artifacts/dashboard/src/pages/ai-chat/stream-intent.ts
artifacts/dashboard/src/pages/ai-chat/stream-lifecycle.ts
artifacts/dashboard/src/pages/ai-chat/stream-observations.ts
artifacts/dashboard/src/pages/ai-chat/stream-terminal.ts
artifacts/dashboard/src/pages/ai-chat/structured-results.tsx
artifacts/dashboard/src/pages/ai-chat/task-result-panel.tsx
artifacts/dashboard/src/pages/ai-chat/trace-parsing.tsx
artifacts/dashboard/src/pages/ai-chat/types.ts
artifacts/dashboard/src/pages/ai-chat/use-cross-tab-sync.ts
artifacts/dashboard/src/pages/ai-chat/use-live-activity.ts
artifacts/dashboard/src/pages/ai-chat/use-provider-metrics.ts
```

## حزمة الإصلاحات المقترحة

### P0 — إعادة بوابة CI إلى حالة قابلة للتفسير

1. **إكمال تصنيف مستهلكي Dashboard الـ22.** راجع كل ملف وحدد `trigger` أو `no-trigger` وفق استخدامه الفعلي لعقد API؛ لا تضف قيمًا جماعية دون مراجعة. حدّث أنماط المسارات في `.github/workflows/ci.yml` للملفات التي يجب أن تطلق فحص العقد.
2. **إصلاح تهيئة مشرف CI ثم تشغيل الاختبارات فعلًا.** ولّد `SESSION_SECRET` عشوائيًا قصير العمر داخل خطوة CI، ومرّره للمشرف ولأوامر الاختبار في الخطوة نفسها؛ لا تستخدم سرًا ثابتًا ولا تطبع القيمة. بعد ذلك أعد تشغيل مجموعة الاختبارات على قاعدة الاختبار المعزولة، وسجّل أي إخفاق لاحق باسمه وسببه قبل تصنيفه كعيب منتج.
3. **منع تخطي OpenAPI drift على Push بسبب فشل فحص السياسة.** اجعل تحقق عقد Push مستقلًا عن نجاح `contract-trigger`، مع إبقاء فشل فحص السياسة حاجزًا ظاهرًا في CI. أضف تحققًا يثبت أن تعطل فحص السياسة لا يحوّل فحص العقد إلى `skipped`.

### P1 — بوابات الإصدار وإدارة المستودع

4. **تحديد سياسة حماية `main` مع مالك المشروع.** قبل أي تغيير خارجي، افحص Repository Rulesets، ثم اختر متطلبات المراجعة وفحوص الحالة المطلوبة. لا تُفرض إعدادات فرع أو توقيع Commit ضمنيًا.
5. **فرز PR #1 وPR #2 قبل اتخاذ إجراء.** راجع الفروق الوظيفية مقابل `main`، وحدد ما يستحق النقل إلى فرع حديث. لا تدمج أو تغلق أو تعِد كتابة فروعهما تلقائيًا.
6. **بعد إصلاح P0، شغّل Release validation على SHA مرشح واحد.** تحقق من الرحلة المطلوبة وسجلاتها، واحتفظ بدليل قبول مرتبط بالنسخة. تخطيها على Push ليس بديلًا عن هذا التشغيل.

## ما لم يُثبت في هذه المرحلة

- لم يُحسم السبب الجذري لفشل مجموعة الاختبارات العامة.
- لم تُراجع كل محاور Agent Core أو Runtime أو Database أو Plugins أو Security أو Frontend أو Production.
- لم يُفحص تاريخ Git كاملًا أو أسرار GitHub أو صلاحيات Actions.
- لم يُفحص محتوى كل PR ملفًا بملف، ولم تُتخذ قرارات دمج أو إغلاق.
- لم تُختبر قاعدة Production أو النسخ الاحتياطي أو الاستعادة.

لا تُعلن جاهزية الإغلاق قبل إغلاق P0 وإثبات رحلة قبول ناجحة على نسخة محددة، ثم استكمال المحاور غير المفحوصة وفق سجل أدلة مستقل.

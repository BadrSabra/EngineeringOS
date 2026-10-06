# Engineering Agent Core — Forensic Audit Follow-up

- **تاريخ المراجعة:** 2026-10-06
- **النطاق:** تحديث code-first للتقرير المؤرخ 2026-10-05؛ مراجعة ساكنة لمسار ordered-root forensic scope، مع تصحيح حالة بوابة المراحل.
- **التغييرات:** توثيق فقط. لا تغييرات تطبيق أو schema أو صلاحيات.
- **حدّ التحقق:** لم تُشغّل اختبارات أو builds أو workflows أو استعلامات DB في هذه المراجعة. نتائج الاختبارات الواردة في السجلات الأقدم تظل تاريخية ومحدودة بنطاقها.
- **التقرير السابق:** `docs/agent-core-four-agent-forensic-audit-2026-10-05.md` محفوظ كسجل تاريخي؛ هذا الملحق هو مرجع الحالة الحالية.
- **الحكم:** `NOT READY`. النسب العامة للطبقات الأربع `UNKNOWN` لعدم وجود مقام موثوق.

## 1. Executive Summary

أُعيد تتبع مسار الأدوات في نمط التدقيق ذي الجذور المرتبة. قائمة الأدوات المكشوفة للدورة يمكن أن تقتصر على `read_file` و`list_directory`، بينما يبقى `toolManifest` الكامل متاحًا لتطبيع استجابة مزود متأخرة. فحص ordered-root يطبق على `read_file` و`list_directory` ولا يشمل `search_code`. إذا لم يفرض `allowedToolNames` أو `phase` قيدًا إضافيًا، فقد تُقبل استجابة قديمة لـ`search_code` وتصل إلى التنفيذ خارج الجذور الفرعية المطلوبة، مع بقائها داخل جذر المشروع.

هذه نتيجة تتبع ساكن، وليست تجربة runtime أو إثباتًا أن كل طلب يصل إلى هذا المسار. حدود project-root وأي `objectiveScopePolicy` نشطة تبقى ضوابط مستقلة؛ لا يثبت هذا التقرير تجاوز جذر المشروع أو تجاوز كل سياسة نطاق.

**قرار المراحل:** E2 ما زالت نشطة على مستوى البوابة. إغلاق invariant محدود في World State لا يغلق E2 كاملة. لا يبدأ E3 ولا Learning / Transfer / Generalization قبل اجتياز بوابة E2 صراحةً. يبقى E3.2 replay safety مفتوحًا. النسب العامة `UNKNOWN`؛ لا تُستخدم نسبة `14/19`.

## 2. Current Scorecard

| الطبقة | الحالة | ما يدعمه الفحص الحالي | ما لا يثبته |
|---|---|---|---|
| Reliable Tool Agent | `PARTIAL`؛ النسبة `UNKNOWN` | حدود package الحالية واختبارات الأدوات الموثقة في السجل؛ اكتشاف فجوة ordered-root الخاصة بـ`search_code` ساكنًا | إغلاق كل ingress أو runners أو نطاق/إلغاء/وقت/خرج/Episode؛ لم يُختبر المسار المكتشف |
| Reliable Execution Agent | `PARTIAL`؛ النسبة `UNKNOWN` | اختبارات recovery وroute محدودة موثقة سابقًا، ومنها Apply windows ومسارات analyze/review | lifecycle موحد وتعافٍ بعد crash لكل mutation surface؛ لم تُعد هذه الاختبارات هنا |
| Evidence-grounded Agent | `PARTIAL`؛ النسبة `UNKNOWN` | Canonical Proof لمسارات محددة | توحيد كل producers/consumers أو إغلاق replay safety؛ E3 لم يبدأ |
| Closed-loop World Agent | `PARTIAL / UNKNOWN` | انتقالات World State محددة ومربوطة بملاحظات في مسارات معروفة | تغطية كل التغييرات أو إثبات أن fact يغير قرار planner |

## 3. Reliable Tool Agent

### نتيجة ordered-root scope

1. في `tool-execution-engine.ts:5126-5131`، تضيق `iterationTools` الأدوات الظاهرة للدورة؛ وقد تقتصر على `read_file` و`list_directory`.
2. عند بقاء أدوات مكشوفة، يمرر المسار `toolManifest` الكامل لتطبيع استجابة قديمة (`tool-execution-engine.ts:5133-5149`).
3. `normalizeProviderToolCalls` يفضّل `toolManifest` على قائمة `tools` الأضيق عند التحقق من اسم الأداة (`provider-tool-calls.ts:41-65,173-179`).
4. `allowedTools` مشتق من `allowedToolNames` و/أو `phase` (`tool-execution-engine.ts:4102-4113`). عند غياب كليهما تكون قيمته `null`؛ وفحصها لا يمنع registered tool لمجرد عدم إدراجه في القائمة الظاهرة (`tool-execution-engine.ts:6609-6625`; `tool-policy.ts:181-200`).
5. فحص ordered-root يطبق على `read_file` و`list_directory` فقط، ولا يشمل `search_code` (`tool-execution-engine.ts:6719-6738`).

**الأثر المحدود:** قد يُنفّذ `search_code` على مسار داخل المشروع لكنه خارج الجذور الفرعية المطلوبة، إذا وصل استدعاء قديم صالح وفق `toolManifest` ولم توجد سياسة أضيق فعالة. يبقى فحص `objectiveScopePolicy` مسارًا منفصلًا عندما يكون مفعّلًا، كما تبقى حماية جذر المشروع في أدوات الملفات. لا نسجل هذا كـproject-root escape أو كـruntime exploit مثبت.

**تصنيف الدليل:** `STATICALLY CONFIRMED`; `RUNTIME-TESTED: NO`. لا توجد في هذه الجولة إعادة تشغيل للاختبارات أو تجربة للاستدعاء القديم.

### موضع الإصلاح/الاختبار المقترح ضمن E2

- اجعل قرار التنفيذ يفرض manifest مخولًا وفعليًا واحدًا بعد كل narrowing، لا manifest أوسع مخصصًا لتطبيع الاستجابة القديمة.
- أضف اختبارًا عدائيًا لحالة ordered-roots مع استدعاء `search_code` قديم خارج الجذور، واختبارًا عندما تكون `allowedToolNames` غائبة؛ يجب رفضه قبل تشغيل executor وعدم تسجيله كقراءة مكتملة.
- اختبر أن سياسة objective scope الفعالة لا تتسع بسبب fallback إلى manifest كامل.
- لا تعتبر إصلاح فجوة الأداة وحده إغلاقًا لـE2 أو Reliable Tool Agent.

## 4. Reliable Execution Agent

تسجل الوثائق السابقة اختبارات محدودة لـApply crash/recovery، وGit recovery، وworkflow W9، وstructured analyze/review. وتشمل وثيقة الحالة الحالية تشغيلًا مسجلًا لـanalyze/review بواقع 8/8 على PostgreSQL مؤقتة. لم تُعد أي من هذه الاختبارات في مراجعة 2026-10-06؛ لا تتحول الأرقام التاريخية إلى إثبات جديد أو إغلاق شامل.

تظل E2 مفتوحة لأسطح lifecycle والتعافي المتبقية. إغلاق invariant واحد يمنع materialization قبل اكتمال proof chain لا يغلق execution lifecycle، ولا يثبت تعافي كل أثر خارجي أو سلامة كل سباق/إلغاء.

## 5. Evidence-grounded Agent

يظل Canonical Proof مرجعًا لبعض مسارات القبول، لكن هذا الفحص لم يُجرِ جردًا جديدًا شاملًا لكل producer وconsumer. `E3.2 replay safety` `OPEN`، وE3 implementation `STOPPED` إلى أن تجتاز E2 بوابتها. نجاح receipt أو إسقاط حالة أو اختبار replay محدود لا يثبت حداثة Proof أو إعادة تحميله عبر كل المستهلكين.

## 6. Closed-loop World Agent

تبقى transitions المحددة في Apply و`runtime.start` وverified delivery أدلة على هذه المسارات فقط. لا يثبت هذا التحديث أن كل mutation surface ينتج World Transition حيث يلزم، أو أن fact ذي صلة يغير قرار planner. حالة `E4.1 Read-Only Sample Source Inventory` هي `UNQUALIFIED`: النجاح يخص جرد المصادر فقط، ولا يعني اجتياز E4.1 أو تأهيل مصدر أو فتح بروتوكول/تقييم/ترقية.

## 7. Cross-layer Integrity

حدود سلسلة ordered forensic scope الحالية:

`root request → iteration tool exposure → provider response normalization → server allow-list → ordered-root check → file-tool project-root boundary`

الفجوة الموثقة تقع بين تطبيع الاستجابة والتحقق من scope: قد تستخدم الأولى manifest أوسع من الأدوات الظاهرة، بينما لا يطبق فحص ordered-root على `search_code`. `objectiveScopePolicy` له فحص منفصل مشروط بوجوده (`tool-execution-engine.ts:6628-6686`)، وأداة البحث تعمل من file tools (`file-tools.ts:1473` وما بعدها). المطلوب إثبات رفض الاستدعاء قبل التنفيذ وعلى حدود النطاق المحددة؛ لا يوجد هنا دليل على قراءة خارج project root أو قبول إثبات ملوث.

## 8. False Confidence Risks

- نجاح E1 package-boundary على مصادر محددة لا يعني أن كل مسار أداة يلتزم بالجذور الفرعية المطلوبة.
- لا تُحوّل نتيجة تتبع ساكن إلى ادعاء runtime exploit؛ المسار لم يُختبر.
- لا تخلط بين `toolManifest` الكامل والتعرض الفعلي للأداة؛ الأول قد يقبل استدعاءً غير موجود في `iterationTools`.
- إغلاق invariant World State محدود لا يعني إغلاق E2 كاملة.
- تدقيق E3 المؤرخ 2026-10-05 سجل تاريخي، وليس تصريحًا ببدء E3.
- أرقام الاختبارات السابقة لا تنتج نسبة عامة؛ جميع نسب الطبقات الأربع `UNKNOWN`.

## 9. Exact Implementation Roadmap

1. **E2 فقط:** أضف الاختبار العدائي لـordered-root/`search_code`، ثم اجعل authorization بعد normalization يطبق مجموعة الأدوات المسموح بها في التنفيذ الحالي. لا توسّع الصلاحية اعتمادًا على نص المزود أو manifest أقدم.
2. افحص الاستدعاءات المتأخرة/المكررة بعد تضييق iteration tools، وتحقق أن الأداة غير المعروضة تُرفض قبل runner وتبقى غير مكتملة في lifecycle.
3. استكمل جرد E2 لبقية أسطح التنفيذ وcrash/recovery. نتيجة هذا المسار الواحد لا تغلق E2.
4. أعد تدقيق بوابة E2 صراحةً بعد معالجة فجواتها. لا تبدأ E3 أو تعِد تشغيل Strategy Replay receipts قبل اجتياز هذه البوابة.
5. أبقِ E4.1 `OPEN / NOT PASS` حتى تأهيل مصدر مستقل وإغلاق بقية شروطها؛ لا تستنتج جمعًا أو تقييمًا أو ترقية من نتيجة inventory.

## 10. Do Not Start Yet

- لا تبدأ E3 أو E3.2 implementation قبل إغلاق E2 صراحةً.
- لا تُعد تشغيل Strategy Replay receipts.
- لا تبدأ P7.5 collection/calibration أو Learning أو Transfer أو Generalization أو promotion.
- لا تُعامل inventory `UNQUALIFIED` كـsource qualification أو authorization.
- لا تشغّل اختبارًا حيًا لهذا المسار أو أي workflow/DB validation ضمن مراجعة توثيقية دون عزل وموافقة مناسبة.

## 11. Final Gate

تظل خانات Final Gate الأصلية التسع عشرة غير مكتملة على مستوى نطاقها العام؛ لا توجد نسبة إغلاق قابلة للدفاع:

```text
[ ] Tool authorization complete
[ ] Tool scope complete
[ ] Tool bounded execution complete
[ ] Tool adversarial coverage complete
[ ] Execution lifecycle unified
[ ] Attempt fencing complete
[ ] Crash recovery complete
[ ] Cancellation race safety complete
[ ] Acceptance single authority
[ ] Evidence canonical
[ ] No non-canonical PROVEN
[ ] Claim completeness
[ ] Revision binding
[ ] World Delta reconstruction
[ ] World State materialization
[ ] Planner consumes World State
[ ] Unexpected outcome updates belief
[ ] Replan changes decision
[ ] Replay/evaluation available
```

**Final verdict: `NOT READY`. E2 remains active; E3 remains stopped.**

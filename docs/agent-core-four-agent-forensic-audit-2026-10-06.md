# Engineering Agent Core — Forensic Audit Follow-up

- **تاريخ المراجعة:** 2026-10-06
- **النطاق:** تحديث code-first للتقرير المؤرخ 2026-10-05، ثم متابعة تنفيذية ضيقة ضمن E2 لمسار ordered-root forensic scope.
- **التغييرات:** حارس نطاق على أدوات القراءة ذات المسار واختبارات عدائية؛ لا تغييرات schema أو DB أو صلاحيات عامة.
- **حدّ التحقق:** اجتازت 3 مجموعات اختبار مركّزة 249/249 مع مهلة 20 ثانية؛ اجتاز typecheck و`git diff --check`. لم يُختبر provider حي أو API/workflow أو قاعدة بيانات.
- **التقرير السابق:** `docs/agent-core-four-agent-forensic-audit-2026-10-05.md` محفوظ كسجل تاريخي؛ هذا الملحق هو مرجع الحالة الحالية.
- **الحكم:** `NOT READY`. النسب العامة للطبقات الأربع `UNKNOWN` لعدم وجود مقام موثوق.

## 1. Executive Summary

أثبت الاختبار العدائي أن استدعاء `search_code` قديمًا يمكن تطبيعه عبر `toolManifest` الأوسع عند غياب `allowedToolNames` و`phase`. أُصلح dispatcher بحيث يطبق ordered-root على `read_file` و`read_file_range` و`list_directory` و`search_code`، ويرفض المسارات المطلقة وأي مسار يحتوي `..` قبل تشغيل file runner. كما يتحقق من المسار بعد حلّه عبر filesystem، فيرفض رابطًا رمزيًا إذا خرج هدفه عن الجذر المطابق للطلب، حتى لو وصل إلى جذر آخر لاحق في القائمة. الاختبارات تؤكد أن هذه الحالات لا تصل إلى runner ولا تنتج source read مكتمل.

يظل `toolManifest` الكامل مستخدمًا لتطبيع الاستدعاءات؛ لم يُفرض تقاطع عام مع أدوات الدورة الظاهرة لأن استدعاءات `read_file_range` المخفية قد تكون لازمة لاستعادة الدليل الكامل من ملف كبير. بدلًا من ذلك، يطبق dispatcher حد الجذور على كل أدوات القراءة ذات المسار. الاختبارات حتمية وعلى مستوى الوحدة، وليست تجربة API أو provider حي. حدود project-root وأي `objectiveScopePolicy` نشطة تبقى ضوابط مستقلة؛ لا يثبت هذا التقرير تجاوز جذر المشروع أو تجاوز كل سياسة نطاق.

**قرار المراحل:** E2 ما زالت نشطة على مستوى البوابة. إغلاق invariant محدود في World State لا يغلق E2 كاملة. لا يبدأ E3 ولا Learning / Transfer / Generalization قبل اجتياز بوابة E2 صراحةً. يبقى E3.2 replay safety مفتوحًا. النسب العامة `UNKNOWN`؛ لا تُستخدم نسبة `14/19`.

## 2. Current Scorecard

| الطبقة | الحالة | ما يدعمه الفحص الحالي | ما لا يثبته |
|---|---|---|---|
| Reliable Tool Agent | `PARTIAL`؛ النسبة `UNKNOWN` | اختبارا ordered-root العدائيان وtypecheck؛ رفض `search_code` خارج النطاق قبل runner | إغلاق كل ingress أو runners أو نطاق/إلغاء/وقت/خرج/Episode؛ لا اختبار API أو provider حي |
| Reliable Execution Agent | `PARTIAL`؛ النسبة `UNKNOWN` | اختبارات recovery وroute محدودة موثقة سابقًا، ومنها Apply windows ومسارات analyze/review | lifecycle موحد وتعافٍ بعد crash لكل mutation surface؛ لم تُعد هذه الاختبارات هنا |
| Evidence-grounded Agent | `PARTIAL`؛ النسبة `UNKNOWN` | Canonical Proof لمسارات محددة | توحيد كل producers/consumers أو إغلاق replay safety؛ E3 لم يبدأ |
| Closed-loop World Agent | `PARTIAL / UNKNOWN` | انتقالات World State محددة ومربوطة بملاحظات في مسارات معروفة | تغطية كل التغييرات أو إثبات أن fact يغير قرار planner |

## 3. Reliable Tool Agent

### نتيجة ordered-root scope والمتابعة

1. قد تضيق الأدوات الظاهرة للدورة إلى `read_file` و`list_directory`، بينما يبقى `toolManifest` الكامل مستخدمًا لتطبيع استجابة مزود قديمة.
2. عند غياب `allowedToolNames` و`phase` لا يمنع `allowedTools` registered tool لمجرد عدم ظهوره في الدورة؛ هذا السلوك مقصود لدعم manifest كامل مصرح به واسترجاع القراءة الجزئية.
3. كان ordered-root يقتصر على `read_file` و`list_directory`. أصبح يطبق على `read_file` و`read_file_range` و`list_directory` و`search_code`.
4. تطبيع هدف الجذر يرفض المسارات المطلقة ومقاطع `..`، فلا يقبل alias مثل `src/allowed/../private` لمجرد أن بدايته النصية تطابق الجذر المسموح.
5. فحص المسار المحلول قبل dispatcher يشترط بقاء المسار في الجذر المطابق نفسه؛ لا يكفي أن ينتهي symlink في أي جذر آخر بالقائمة.

**الأثر المحدود:** الاستدعاء القديم خارج الجذور الفرعية المطلوبة يُرفض عند حد dispatcher قبل التنفيذ، مع عدم تسجيله كقراءة مكتملة. يبقى فحص `objectiveScopePolicy` مسارًا منفصلًا عندما يكون مفعّلًا، كما تبقى حماية جذر المشروع في أدوات الملفات. لا نسجل هذا كـproject-root escape أو كـruntime exploit.

**تصنيف الدليل:** فجوة التنفيذ كانت مؤكدة ساكنًا؛ الإصلاح واجتياز المسارات العدائية مثبتان باختبارات وحدة: 249/249 عبر 3 ملفات مع `--testTimeout=20000`. اجتاز typecheck و`git diff --check`. `LIVE API/PROVIDER: NOT TESTED`.

### الإصلاح والتحقق ضمن E2

- يبقى manifest الكامل لتطبيع الاستجابة القديمة؛ يفرض dispatcher ordered-root على جميع أدوات القراءة ذات المسار بدل تقاطع عام مع قائمة العرض.
- الاختبار العدائي يمرر استدعاء `search_code` خارج الجذر عبر manifest كامل مع غياب `allowedToolNames` و`phase`، ويتحقق من عدم تشغيل runner أو إضافة مسار إلى `toolSources`.
- اختبارات إضافية تغطي `read_file_range` و`read_file` و`list_directory` و`search_code` خارج الجذر، ومسارات `..`، وsymlink داخل الجذر يشير إلى مصدر خاص، مع تأكيد أن البحث داخل الجذر يظل مسموحًا.
- لا تعتبر إصلاح فجوة الأداة وحده إغلاقًا لـE2 أو Reliable Tool Agent.

## 4. Reliable Execution Agent

تسجل الوثائق السابقة اختبارات محدودة لـApply crash/recovery، وGit recovery، وworkflow W9، وstructured analyze/review. وفي متابعة 2026-10-06 أُعيد تشغيل اختباري Apply materialization/recovery (2/2) على PostgreSQL مؤقتة، كما اجتاز اختبار route المستهدف لحد ما بعد ملاحظات before/after وقبل حفظ effect (1/1؛ 111 حالة أخرى متجاوزة بالترشيح). تثبت النتائج هذه الحدود المحددة فقط؛ لا تتحول إلى إغلاق شامل لـE2 أو إلى إثبات حي لمزوّد خارجي.

تظل E2 مفتوحة لأسطح lifecycle والتعافي المتبقية. إغلاق invariant واحد يمنع materialization قبل اكتمال proof chain لا يغلق execution lifecycle، ولا يثبت تعافي كل أثر خارجي أو سلامة كل سباق/إلغاء.

## 5. Evidence-grounded Agent

يظل Canonical Proof مرجعًا لبعض مسارات القبول، لكن هذا الفحص لم يُجرِ جردًا جديدًا شاملًا لكل producer وconsumer. `E3.2 replay safety` `OPEN`، وE3 implementation `STOPPED` إلى أن تجتاز E2 بوابتها. نجاح receipt أو إسقاط حالة أو اختبار replay محدود لا يثبت حداثة Proof أو إعادة تحميله عبر كل المستهلكين.

## 6. Closed-loop World Agent

تبقى transitions المحددة في Apply و`runtime.start` وverified delivery أدلة على هذه المسارات فقط. لا يثبت هذا التحديث أن كل mutation surface ينتج World Transition حيث يلزم، أو أن fact ذي صلة يغير قرار planner. حالة `E4.1 Read-Only Sample Source Inventory` هي `UNQUALIFIED`: النجاح يخص جرد المصادر فقط، ولا يعني اجتياز E4.1 أو تأهيل مصدر أو فتح بروتوكول/تقييم/ترقية.

## 7. Cross-layer Integrity

حدود سلسلة ordered forensic scope الحالية:

`root request → iteration tool exposure → provider response normalization → lexical + resolved ordered-root checks → file-tool project-root boundary`

قد تظل الاستجابة الأقدم معتمدة على `toolManifest` الأوسع، لكن dispatcher يطبق حد الجذور قبل أي تنفيذ لأدوات القراءة ذات المسار. `objectiveScopePolicy` له فحص منفصل مشروط بوجوده، وأداة البحث تعمل من file tools. اختبارات الوحدة تثبت الرفض على النطاق المطلوب فقط؛ لا تثبت تغطية كل ingress أو قراءة خارج project root أو قبول إثبات ملوث.

## 8. False Confidence Risks

- نجاح E1 package-boundary على مصادر محددة لا يعني أن كل مسار أداة يلتزم بالجذور الفرعية المطلوبة.
- لا تُحوّل اختبار الوحدة إلى ادعاء اختبار API/provider حي أو إثبات exploit إنتاجي؛ التحقق الحالي محصور في الاختبارات المركّزة.
- لا تخلط بين `toolManifest` الكامل والتعرض الفعلي للأداة؛ قبول استدعاء قديم بالتطبيع لا يتجاوز dispatcher scope. ولا تحذف full-manifest semantics لأن range reads قد تكون لازمة لاستعادة الدليل.
- إغلاق invariant World State محدود لا يعني إغلاق E2 كاملة.
- تدقيق E3 المؤرخ 2026-10-05 سجل تاريخي، وليس تصريحًا ببدء E3.
- أرقام الاختبارات السابقة لا تنتج نسبة عامة؛ جميع نسب الطبقات الأربع `UNKNOWN`.

## 9. Exact Implementation Roadmap

1. **مكتمل ضمن هذا المسار فقط:** اختبار ordered-root/`search_code` العدائي وحارس كل أدوات القراءة ذات المسار؛ لا توسّع الصلاحية اعتمادًا على نص المزود.
2. **مفتوح ضمن E2:** استكمل فحص بقية الاستدعاءات المتأخرة/المكررة والأسطح التي لا يحكمها path-based ordered-root.
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

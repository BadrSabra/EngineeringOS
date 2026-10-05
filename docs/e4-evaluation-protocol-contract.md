# E4.1 — عقد بروتوكول تقييم التحسن

**الحالة:** مسودة عقد قرار للمراجعة فقط؛ غير معتمد وغير منفذ.
**النطاق:** تعريف شروط تقييم المرشح مقابل خط أساس قبل أي تنفيذ للتقييم أو جمع النتائج أو ترقية سياسة.

## 1. الغرض والحدود

يحدد هذا العقد متى يجوز وصف استراتيجية أو سياسة مرشحة بأنها **أفضل من خط
الأساس**، وما الأدلة اللازمة قبل اقتراح ترقيتها. وهو يفصل بين:

```text
Observation → World State → Replan
Candidate → Replay / Promotion
Measured Evaluation → Policy Improvement
```

المساران الأولان موجودان في المنتج ضمن حدود مختلفة؛ وجودهما لا يثبت تحسنًا
مقاسًا. يجب أن تكون أدلة التقييم أضيق وأكثر انضباطًا من World State، وأن
يُنتج قرار التحسن مقيم مستقل عن الآلية التي أنشأت المرشح.

هذه الوثيقة لا تنشئ cohort أو مصدر بيانات أو evaluator أو سجلًا أو واجهة API
أو مخطط قاعدة بيانات أو صلاحية تشغيل. ولا تفوض reset أو فحصًا تشغيليًا أو جمعًا
أو ترويجًا. لا تعيد فتح E3 أو تغير نطاقه، ولا تغير `/git/push`.

تظل E4 `OPEN / BLOCKED` حتى تُحسم القرارات المفتوحة وتُستكمل المراحل اللاحقة.
ويظل P7.5 `NO-GO`، و`collectionAuthorized=false`، والاختيار
`fixed_safe_probe`؛ لا يغيّر هذا العقد أي قرار في سجل سلطة P7.5 الحالي.
تنفيذ التقييم `NOT STARTED`، وجمع البيانات `NOT AUTHORIZED`، ولا يوجد تفويض
للتقييم أو الترقية.

## 2. الـInvariant المقترح

> لا يجوز ترقية Candidate إلى Policy أو Strategy فعّالة إلا بعد تقييمها على
> مجموعة held-out مستقلة عن بيانات إنشاء المرشح وضبطه، وبمقارنة paired مع
> baseline محدد مسبقًا، ضمن objective وscope وproject/environment protocol
> ثابتة. يجب تجميد metric وthreshold وevaluator وقواعد الأهلية قبل كشف أي outcome،
> وأن يصدر حكم التحسن evaluator مستقل عن مولّد المرشح. اجتياز التقييم لا يفعّل
> المرشح وحده: يلزم approval صريح، وإصدار versioned قابل للتراجع، ثم قياس
> post-promotion مستقل ومحدود يقرر الإبقاء أو rollback.

World State وprovider prose ونجاح التنفيذ أو Canonical Proof لا تثبت أن
الاستراتيجية حسّنت الأداء. ولا يمنح أي تقييم صلاحية لتجاوز authorization أو
acceptance أو safety gates.

## 3. هوية البروتوكول وتجميده

قبل أول outcome مؤهل، يجب أن يحدد البروتوكول ويثبت على الأقل:

| الحقل | ما يجب تثبيته قبل التقييم |
|---|---|
| الهدف والنطاق | `objectiveId`, `scopeId`, task stratum، وحدود التعميم المقصود |
| بيئة المصدر | project/revision، environment identity/revision، وإجراء reset/isolation المعتمد |
| الطرفان | هوية وإصدار وبصمة Candidate وBaseline، ومصدر إنشاء Candidate |
| البروتوكول | `protocolId`, `protocolVersion`, وقت التجميد الموثوق، وبصمة manifest |
| وحدة العينة | وحدة الاستدلال، إطار السحب، شروط الأهلية والاستبعاد، ومعالجة التكرار/الاعتماد |
| الحجب | قاعدة العضوية، توقيت تثبيت العضوية، مصدر provenance، وحدود التداخل المسموح |
| المقيم | `evaluatorId`, `evaluatorVersion`, بصمة التنفيذ، وحدود الاستقلال والتطبيق |
| القياس | metric أساسي، guardrails، التعريف والصيغة والاتجاه والأوزان والthresholds |
| التصميم | paired-case manifest، ترتيب التنفيذ/الموازنة عند الحاجة، حجم العينة ومبرره، وقاعدة التوقف |
| الموارد والفشل | budget ثابت، نتيجة النقص/الإلغاء/فشل البيئة/الخرق الأمني، وسياسة البيانات المفقودة |
| الحوكمة | مالك البروتوكول، مسؤول العينة، حارس held-out، المراجع المستقل، وصلاحيات القرار |
| ما بعد الترقية | نطاق canary، مؤشرات المراقبة، حدود الإيقاف، قرار الإبقاء/التراجع، وحفظ التاريخ |

لا تُختار قيم metric أو threshold أو حجم عينة في هذه المسودة. يجب تبريرها
ومراجعتها قبل السحب. لا تُنقل تلقائيًا أرقام خاصة بـP7.5 أو ببوابات strategy
محددة إلى scope آخر.

بعد بدء التقييم، تكون هذه القيم والعضويات غير قابلة للتعديل داخل البروتوكول.
أي تعديل بعد الاطلاع على outcomes يتطلب إصدار بروتوكول جديدًا وعينة held-out
مستقبلية مستقلة؛ لا يعاد استخدام outcomes المكشوفة لتقييم الإصدار الجديد.

## 4. الاستقلال ومنع التسرب

1. **هوية منفصلة لا تعني عينة مستقلة.** اختلاف `missionId` أو `projectId` أو
   `environmentRevision` وحده لا يثبت الاستقلال. يجب تحديد وحدة الاستدلال
   ومصدر موثوق لسلسلة نسبها وعلاقات الاشتراك أو النسخ أو seed أو fixture.
2. تسجل بيانات التدريب والدعم وإنشاء Candidate منفصلة عن held-out evaluation.
   يكشف النظام التداخل على مستوى lineage/family والبيانات والحالة، لا على
   مستوى المعرّفات المباشرة فقط.
3. تثبت أهلية الوحدة وعضويتها في held-out قبل توقعها أو تشغيلها، مع مصدر
   زمني موثوق وقواعد إدراج واستبعاد وإعادة استخدام مجمدة مسبقًا.
4. يحفظ حارس held-out سجل العضوية والوصول والاستخدام والتعديل طوال الفترة
   ذات الصلة. اسم partition أو hash لا يثبت وحده أن النتائج ظلت محجوبة.
5. إذا غابت سلسلة النسب أو تاريخ التجميد/الوصول، أو ظهر تداخل أو تعرض غير
   مصرح به، فالنتيجة `BLOCKED` أو `INVALID` وفق قاعدة الإبطال المجمدة؛ لا
   يستنتج النظام عدم التسرب من غياب السجل.
6. لا تقبل ادعاءات `independent=true` أو `heldout=true` من caller أو model
   أو نص المشغل كدليل مصدر.

## 5. تصميم المقارنة والمقيم المستقل

### المقارنة

- تقارن Candidate وBaseline على **نفس** objective وscope ومراجعة المشروع
  والبيئة وbudget وcase manifest، مع workspace وrun وexecution identities
  منفصلة.
- يحدد البروتوكول مسبقًا الترتيب أو الموازنة عند وجود أثر محتمل للترتيب أو
  الحالة المتبقية، وإجراء reset الذي يعيد الحالتين إلى شروط قابلة للمقارنة.
- تحفظ نتيجة كل case للطرفين وأدلتها؛ لا يستبدل paired comparison بمجموع
  نجاحات المرشح وحده.
- يحفظ كل فشل أو نتيجة غير مكتملة أو إلغاء أو خرق safety. لا تحذف الحالات
  الصعبة لتحسين النتيجة.

### استقلال المقيم

يجب أن يكون evaluator محددًا بإصدار وبصمة قبل التقييم، وألا يختار المرشح
metric أو threshold أو حالات الاختبار أو يغير قواعد تفسير النتائج. يجب أن
تكون آلية إصدار الحكم منفصلة عن مولّد Candidate، وألا تقبل حكم التحسن من
provider prose أو من مكوّن يتلقى أوزانًا أو تعليمات قابلة للتغيير من المرشح.

تراجع جهة مستقلة ملاءمة evaluator وحدوده وخطة العينة قبل التقييم. وجود
`evaluatorId` أو deterministic code لا يثبت وحده الاستقلال أو الملاءمة.

### القياسات

يسجل البروتوكول metric أساسيًا واتجاهه وthreshold قبل النتائج، مع guardrails
غير قابلة للتعويض بمكسب في metric آخر. يحدد مسبقًا طريقة حساب عدم اليقين،
التلخيص بحسب strata، ومعالجة الترابط بين الحالات. لا يجوز اختيار metric أو
stratum أو وزن بعد رؤية النتائج لإعلان PASS.

لا توجد thresholds عامة في هذا العقد. يجب أن يكون حجم العينة وطريقة تحليلها
مبررين للـscope والادعاء؛ لا تكفي عتبة ثابتة من بروتوكول مختلف.

## 6. Evaluation Evidence Plane

تُحفظ نتيجة كل Evaluation Case في مسار أدلة مستقل عن World State. هذا وصف
للعقد وليس اقتراح مخطط تنفيذي. يجب أن تكون كل حالة قابلة لإعادة التحقق من:

- case/protocol/evaluator identities وإصداراتها وبصماتها؛
- objective/scope وcandidate/baseline identities؛
- وحدة الاستقلال وعائلة المنشأ وقرار الأهلية ومرجع held-out قبل outcome؛
- project/environment revisions وإجراء العزل أو reset؛
- workspace/run/execution/attempt/Episode identities لكل من الطرفين؛
- observation/evidence references ومصدرها وتوقيتها واكتمالها وحداثتها؛
- outcomes الخام المسموح بها، والmetric المحسوب، وحالة التحقق وسببها؛
- budget والانحرافات والإلغاء وإشارات safety؛
- سجل الوصول إلى held-out وأي إبطال أو تعارض أو مراجعة لاحقة.

تظل المراجع والبيانات الخام خاضعة لحدود الخصوصية والاحتفاظ. العرض العام
يعرض أسباب القبول أو الحجب ومراجع bounded، لا يكشف أسرار البيئة.

World State مفيد لوصف الحالة الحالية وتوجيه التخطيط، لكنه لا يثبت المقارنة
السببية أو استقلال عينات التقييم. لا يُستخدم World State وحده كـoutcome label
أو كسلطة promotion.

## 7. حالات القرار وحدود الترقية

### ترتيب الحكم

```text
thresholds_met
    ↓
protocol-compliant evaluation
    ↓
independent evidence
    ↓
review decision
    ↓
promotion authorization
```

`thresholds_met` نتيجة حساب metric فقط؛ لا تعني `validated` أو `PASS` أو
استحقاق الترقية. يتطلب `protocol-compliant evaluation` إثبات تنفيذ البروتوكول
المجمد دون حذف الحالات أو تغيير قواعده بعد كشف النتائج. ويتطلب
`independent evidence` أدلة مؤهلة ومربوطة بالعينة وheld-out، وحكم evaluator
مستقل عن مولّد المرشح. بعد ذلك فقط يصدر المراجع صاحب الصلاحية قرارًا مرتبطًا
بنسخة البروتوكول والنتائج؛ ويظل `promotion authorization` قرارًا منفصلًا وصريحًا.

### حالات نتيجة التقييم

يجب أن يميز evaluator على الأقل بين:

- `PASS`: اكتملت شروط البروتوكول، وقُبلت الأدلة المستقلة، واجتاز التحسن
  الحدود المجمدة. هذه نتيجة تقييم فقط، وليست مراجعة أو تفويضًا.
- `FAIL`: اكتملت المقارنة المؤهلة بأدلة مستقلة ولم يجتز المرشح المعيار أو guardrail.
- `INCONCLUSIVE`: الأدلة المؤهلة لا تكفي للحكم وفق خطة العينة وعدم اليقين.
- `BLOCKED / INVALID`: فشل شرط provenance أو الاستقلال أو التجميد أو binding أو safety.

لا يفعّل `PASS` Candidate ولا يغير planner أو permissions أو Canonical Proof.
يتطلب التفعيل مسارًا منفصلًا مع reviewer ذي سلطة محددة، وموافقة مرتبطة
بالبروتوكول والنتيجة والإصدار، وسجلًا append-only. يبقى التراجع أو الإبطال
ممكنًا دون حذف تاريخ التقييم أو promotion.

لا يثبت pre-promotion PASS وحده تحسنًا تشغيليًا بعد الترقية. يجب أن يقيس canary
محدود outcomes جديدة مستقلة عن held-out المكشوف، مقابل خط أساس معلن مسبقًا،
وبقواعد إيقاف وتراجع مجمدة. الإبقاء أو rollback قرار موثق؛ لا يكتبه Candidate
generator أو provider prose.

## 8. نتيجة مراجعة قرار E4.1 — للقراءة فقط

المواقف التالية تثبت حدود التصميم فقط؛ لا تؤهل مصدرًا فعليًا، ولا تعيّن
evaluator أو reviewer، ولا تمنح صلاحية تشغيل:

| البند | الموقف المسجل | ما يثبته وما لا يثبته |
|---|---|---|
| مصدر العينة | `NO-GO / UNQUALIFIED` | لم يُثبت مصدر موثوق مؤهل لـE4. لا يصبح World State أو Mission history أو accepted Episode أو provider output أو failure narrative أو بيانات P7.5 مصدر سلطة للعينة لمجرد وجوده؛ قد يكون input أو supporting evidence. |
| بناء held-out | `DEFERRED`؛ يمكن تثبيت قاعدة العقد | لا توجد مجموعة تقييم مؤهلة الآن. يجب منع استخدام الحالة في candidate generation أو strategy extraction أو support أو replay selection أو tuning أو threshold selection، وإثبات provenance والاستقلال. اختلاف `MissionId` وحده لا يكفي. |
| المقاييس والعتبات | `DEFERRED` | لا يوجد metric عام لكل EngineeringOS. يحدد metric واتجاهه وعتبته/هامشه وحجم العينة أو قاعدة الكفاية بعد تحديد objective وevaluation protocol؛ تظل القيم مجمدة قبل التقييم. يمكن تثبيت شكل العقد دون اختيار قيم مسبقًا. |
| استقلال evaluator | `ACCEPTED AS E4.1 CONTRACT RULE` | يكون evaluator مستقبلًا server-owned وprotocol-bound وغير قابل للتحكم من candidate generator أو model/provider. لا يختار المرشح الحالات أو metric أو threshold أو baseline بعد ظهور النتائج أو البروتوكول، ولا يكتب نتيجة evaluator أو يمنح نفسه promotion. هذا قبول قاعدة تصميمية، لا إثبات evaluator منفذ أو مستقل بالفعل. |
| صلاحية reviewer | `ACCEPTED AS E4.1 CONTRACT RULE` | يكون قرار promotion server-owned وصريحًا ومنفصلًا عن generator وevaluator، ومربوطًا بـcandidateVersion وevaluationId وprotocolVersion وbaselineVersion والنتيجة وهوية/سلطة reviewer والقرار والوقت/الإصدار. لم تُسمَّ جهة reviewer ولم تُمنح سلطة فعلية؛ ولا يستطيع reviewer اعتماد نتيجة غائبة أو ناقصة. |

`Evaluator PASS` لا يساوي `Promotion`: المسار المطلوب هو مراجعة نتيجة مكتملة،
ثم موافقة صريحة، ثم promotion versioned. قبول هذا الفصل كقاعدة لا ينشئ سجلًا
أو آلية تفويض.

**الحالة الإجمالية:** مراجعة E4.1 `NOT PASS`؛ يظل E4.1 `DRAFT / OPEN` لأن
مصدر العينة غير مؤهل، وبناء held-out وقيم المقاييس مؤجلان. لا يبدأ collection
أو evaluation أو promotion. لا تُستخدم حالة P7.5 `NO-GO` دليلًا يؤهل E4 أو
يرفضه تلقائيًا؛ نطاق قرارها هو جمع P7.5 الخاص بها. وP12 بوابة لاحقة لا بديل
عن هذه المراجعة.

تبقى تفاصيل manifest الأخرى في §3، ومنها reset/isolation وbudget ومعالجة
الفشل، متطلبات لأي بروتوكول مستقبلي. ولا يغيّر استكمالها أحد المواقف أعلاه
أو أي صلاحية من الخمسة دون مراجعة موثقة.

### جرد مصادر العينة — E4.1 Read-Only Sample Source Inventory (2026-10-05)

**النتيجة:** `UNQUALIFIED` — `PASS` للجرد فقط، بمعنى أنه لم يُعثر في
مسارات الكود الحالية على مصدر يثبت أهلية عينة تقييم E4 المستقلة. لا يغيّر ذلك
E4.1، الذي يبقى `OPEN / NOT PASS`.

راجع الجرد عقود ومسارات الكود داخل المستودع قراءةً ساكنة؛ لم يستعلم عن صفوف
قاعدة بيانات، ولم يشغّل benchmark أو runtime، ولم يغيّر كودًا أو بيانات.
لذلك لا يدّعي عدم وجود سجل في بيئة أخرى أو مصدر خارجي غير مفحوص؛ الحكم يخص
ما يستطيع النظام الحالي إثباته server-side من الشيفرة والعقود المفحوصة.

| مصدر محتمل | ما يثبته الكود | سبب عدم أهليته لعينة E4 المستقلة | الحكم |
|---|---|---|---|
| Strategy replay cases | `strategy-replay-case-registry.ts:327–359` يستبعد Episode الداعم للمرشح ويشترط أن يُغلق المصدر بعد تحديث المرشح، ثم يربط case بهوية المرشح وsource revision وEpisode والتنفيذ والقبول وCanonical Proof. | هذا فصل زمني وربط إثباتي لإعادة تشغيل مرشح بعينه، لا إطار اختيار مستقل ولا إثبات عضوية held-out أو سلطة مصدرها أو سجل وصول/ضبط يمنع التلوث. `strategy-replay-case-runner.ts:67, 543–555` يضع `partition: "held_out"` كقيمة ثابتة في receipt؛ والـschema الصارم لتعريف case في `strategy-replay-case-registry.ts:33–50` لا يحمل سجل اختيار أو حراسة held-out. | `UNQUALIFIED` |
| Code Agent benchmark | `code-agent-benchmark.ts:12–32, 89–102` يعرّف suite ثابتًا من 34 حالة وملفات حالة ذات prompt/expected outcome؛ ويصف الملفات المستهدفة الصغيرة بأنها مسارات تشخيص، مع كون المصفوفة الكاملة مصدر baseline. | لا توجد في عقد الحالة عضوية held-out أو مصدر اختيار/أهلية أو سجل تعرض وتعديل. الـfixtures في `code-agent-benchmark-fixtures.ts:8–31, 39–57` معرفة داخل الشيفرة، وبعض السيناريوهات اصطناعية؛ صلاحيتها كاختبارات أو baseline لا تثبت استقلالها عن tuning. | `UNQUALIFIED` |
| Empirical AI quality corpus | `empirical-quality.ts:49–75, 289–335` و`reviewed-empirical-quality-corpus-v2.json` يحملان corpus revision وروابط GitHub عامة ومراجعات مصدر مثبتة وground truth للحالات. | هذا corpus لقياس جودة مراجعة الكود، وليس بروتوكول E4 لهدف/مرشح محدد. عقده لا يثبت فصلًا محجوبًا عن الضبط أو تاريخ وصول/استخدام أو سلطة اختيار مستقلة؛ وscorecard موسوم `measurementOnly` في `empirical-quality.ts:160–168`. | `UNQUALIFIED` |
| Runtime-start/P7.5 experiment ledger | `runtime-start-hypothesis-experiment.ts:88–120, 265–290` يربط التسجيل والنتيجة بالمشروع وMission وEpisode والنطاق ومراجعات المصدر/البيئة، ويحدد partition حرفيًا. | هذا مسار P7.5 محدود، وليس سلطة عينة E4. كما يسجل `runtime-start-hypothesis-trust-boundary.ts:92–101, 136–149` غياب مصدر cohort-selection وheld-out dataset في نطاق P7.5 نفسه. لا يُنقل حكم P7.5 تلقائيًا إلى E4 في أي اتجاه. | `UNQUALIFIED` |
| World State وMission IDs وCanonical Proof وpaired-baseline receipts | يمكنها ربط حالة أو نتيجة تنفيذ أو مقارنة مرشح/خط أساس بأدلة وهوية محددة؛ `paired-baseline.ts:218–226` يقارن تنفيذين على عقد حالات مشترك. | لا تثبت وحدها إطار اختيار عينة E4 أو أهلية الوحدة أو عضويتها في held-out أو سجل عدم التلوث. اختلاف Mission أو وجود proof/receipt ليس دليل استقلال أو مصدر تقييم. | `UNQUALIFIED` |

لم يُثبت أي مصدر داخل النطاق المفحوص سلسلةً قابلة للتحقق server-side تجمع
provenance وindependence وscope وenvironment وnon-contamination لعينة E4.
هذا هو نجاح الجرد وفق معيار الخروج المحدد، وليس تأهيلًا لمصدر أو إذنًا
للانتقال إلى E4.2 أو التنفيذ أو التقييم أو collection أو promotion.

## 9. الترتيب بعد مراجعة القرار

هذا الترتيب يصف الاعتماديات فقط؛ لا يفوض التنفيذ أو الاختبار التشغيلي أو الجمع:

```text
E4.1 Decision Review — البنود الخمسة؛ النتيجة الحالية NOT PASS
  ↓
Decision Review PASS — بعد تأهيل المصدر وحسم held-out والمقاييس
  ↓
Freeze Protocol — تثبيت نسخة E4.1 بقرار مراجعة موثق
  ↓
Implementation plan — تحديد التصميم ونطاق التنفيذ
  ↓
Failing tests — إثبات حجب الحالات غير المؤهلة قبل التنفيذ
  ↓
Implementation — بعد اعتماد نطاق وخطة منفصلين
  ↓
Controlled evaluation — بعد تفويض جمع/تشغيل مستقل وصريح
  ↓
Review → promotion authorization → bounded canary
  ↓
Post-promotion measurement → retain / rollback
  ↓
E4 Closure Audit
```

مراجعة المسودة أو قبول قاعدة تصميمية لا يبدأ جمعًا أو تشغيلًا أو إنشاء
evaluator. لا ينتقل البروتوكول إلى freeze حتى تصبح نتيجة Decision Review
`PASS`؛ وتظل كل بوابة تنفيذ وتقييم وتفويض لاحقة منفصلة. P7.5 يبقى `NO-GO`
و`collectionAuthorized=false` حتى اجتياز قراراته وبواباته الخاصة؛ وتظل
مستندات سلطته وعينة held-out الحالية أدناه مرجعًا حاكمًا لتلك الحالة.

## 10. معيار الخروج من E4.1

يوثق سجل المراجعة موقفًا منفصلًا لكل بند، لكن E4.1 لا يحقق `Decision Review
PASS` لمجرد توثيق `NO-GO` أو `DEFERRED`. لا يُجمّد البروتوكول إلا بعد حسم
المصدر والأهلية وheld-out والقيم objective-specific، وقبول قواعد استقلال
evaluator وصلاحية reviewer ضمن إصدار موثق. يمكن تسجيل `NO-GO` للحفاظ على
الحد؛ ولا يجيز ذلك أي خطوة تنفيذ أو collection أو evaluation أو promotion.
لا تعني مراجعة الوثيقة أو اجتياز اختبارات مستقبلية بمفردها تفويضًا.

لا يُعدّ E4.1 جاهزًا إذا بقي evaluator تابعًا لمولّد المرشح، أو كان held-out
مجرد label، أو كان الـbaseline/metric/threshold قابلًا للتغيير بعد الاطلاع،
أو ساوى الحكم بين `thresholds_met` و`validated`، أو لم يوجد مسار قياس بعد
الترقية.

## 11. المراجع وحدود التداخل

- `docs/agent-generalization-execution-plan.md` — خطط Evaluation Plane،
  replay وpromotion وبوابات التعميم.
- `docs/agent-generalization-progress.md` — سجل حالة التنفيذ؛ لا تستبدل هذه
  المسودة حالة المراحل المسجلة فيه.
- `docs/p75-claim-authority-decision-record.md` — القرار الحالي بأن جمع P7.5
  `NO-GO` وشروط السلطة غير المحسومة.
- `docs/p75-cross-project-calibration-protocol-draft.md` — مسودة خاصة بمعايرة
  `runtime.start` عبر مشاريع مستقلة؛ لا تثبت تحسن استراتيجية ولا تستبدل هذا العقد.
- `docs/p75-sampling-heldout-source-contract.md` و
  `docs/p75-sampling-heldout-governance-procedure.md` — عقود قرار خاصة بمصادر
  استقلال العينة وheld-out وسلطتها.

هذه الوثيقة عقد تقييم عام مقترح؛ لا تعدل أو تعيد تصنيف القرارات المسجلة في
المراجع الخاصة بـP7.5 أو استراتيجية replay أو skill registry.

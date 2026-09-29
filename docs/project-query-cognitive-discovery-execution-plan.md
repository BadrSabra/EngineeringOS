# خطة تنفيذ Cognitive Discovery في PROJECT_QUERY

> **الحالة:** وثيقة تنفيذية تكميلية؛ لا تفوض وحدها تغييرات runtime.
> **تاريخ المراجعة:** 2026-09-29.
> **مصدر الاعتماديات الوحيد:** §31 من `docs/agent-generalization-execution-plan.md`.
> **الحدود:** لا تغيّر هذه الوثيقة ترتيب P3.5→P4→P5→P6، ولا تفتح fallback عامًا لـ`PROJECT_QUERY` بلا objective canonical.

## 1. القرار التنفيذي

أضف، بعد مراجعة المستخدم لهذه الوثيقة، قدرة استقصاء **محدودة داخل طلب PROJECT_QUERY واحد**: تقترح ما لا يزال مجهولًا، وتساعد على اختيار قراءة تالية من المصادر التي سمح بها العقد الخادمي القائم. لا تُعد كتابة `PROJECT_QUERY`، ولا تستبدل `QueryPlan` أو objective أو claim closure أو بوابة القبول.

يجب الفصل بين هدفين مختلفين:

1. **استقصاء أعمق تحت objective canonical قائم:** يمكن أن يقترح النظام احتياج دليل أو فرضية تفسيرية جديدة، لكن يظل الهدف والـclaims والنطاق ومصادر الإثبات معرّفة مسبقًا من الخادم. هذه هي الشريحة الوحيدة التي يمكن تصميمها كتطوير query-local محدود.
2. **الإجابة المكتملة عن سؤال لا يملك objective canonical:** هذا ليس مجرد اكتشاف مسارات؛ إنه يحتاج عقدًا جديدًا يحدد معنى الاكتمال والقبول. إلى أن يُراجع ذلك العقد ويُعتمد منفصلًا، يبقى المسار بلا objective في حالة `ANALYSIS_INCOMPLETE` ولا يصبح Discovery fallback عامًا.

المقياس المعماري للنجاح ليس عدد الطبقات أو الملفات الجديدة. هو أن يختار النظام قراءة مسموحًا بها تقلل غموضًا محددًا، ثم يستخدم الأدلة المقبولة القائمة ليجيب، أو يصرّح بأن الدليل غير كافٍ. تبقى `DIRECT_OBSERVATION` و`SERVER_DERIVED` و`MODEL_INFERRED` فئات مختلفة؛ مخرجات Discovery hypotheses أو اقتراحات، وليست observations أو facts أو proof.

## 2. علاقة الوثيقة بالخطة المعتمدة

§31 هو dependency graph الوحيد: P0→P1→P2→P3→P3.5→P4→P5→P6→P7→P7.5→P8→P9→P10→P10.5→P11→P12، مع اعتماديات P13/P14 المحددة هناك. هذه الوثيقة تصف **شريحة منتج قراءة فقط داخل مسار PROJECT_QUERY**؛ لا تضيف مرحلة P جديدة، ولا ترفع حالة أي بوابة، ولا تمنح إذنًا بتجاوز الاعتماديات. (الخطة المعتمدة §31، الأسطر 3539–3624؛ سجل التقدم، الأسطر 115–162).

ينطبق شرط مراجعة الوثائق قبل أي runtime أو schema work. إنشاء هذه الوثيقة لا يعني أن العمل البرمجي مفوض أو بدأ؛ يلزم أن يراجع المستخدم حدودها ويطلب التنفيذ. لا تعدّل هذه الخطة §31 أو سجل التقدم أو عتباتهما ضمن الشريحة المقترحة. (سجل التقدم، الأسطر 47–88).

## 3. خط الأساس الفعلي

### 3.1 من النية إلى العقد القانوني

- يحسم `resolveTurnIntent` نية الطلب وبيانات حل الهدف. وجود `PROJECT_QUERY` أو `source_first_discovery` لا ينشئ objective قانونيًا بحد ذاته.
- يختار `resolveActiveEvidenceContract` عقدًا صريحًا، أو يبني objective من `ProjectQueryTarget` الذي حُلّ خادميًا، أو يعيد `source: "none"`.
- يحدد `ProjectQueryTarget` الهدف ومساراته الأساسية والمسموحة للتوسع والممنوعة، ومسارات الدليل والـclaims المطلوبة.
- يقوم `QueryPlan` بتخطيط التنقل الأولي: target files وentities وscope estimate وiteration hint وsubqueries وcompound parts. المرشحون الملاحيون ليسوا proof؛ تُراجع المسارات مقابل manifest الخادم، وتبقى بوابة scope سارية.

المراجع: `lib/ai-orchestrator/src/turn-intent.ts:439-451,541-567,628-656`؛ `lib/ai-orchestrator/src/active-evidence-contract.ts:27-53`؛ `lib/ai-orchestrator/src/project-query-target.ts:869-1102`؛ `lib/ai-orchestrator/src/agents/query-planner.ts:110-199,459-535`.

### 3.2 القراءة والأدلة والقبول

لا يبدأ النظام من scheduler واحد. توجد قراءات أولية، وقراءات objective manifest، وقراءات planner/graph، والحلقة الرئيسية، والحلقات الفرعية الهرمية، واستعادة evidence gaps. بعض المسارات dedupe أو تستخدم cache، لكن جمع مسار إضافي من Discovery من دون جرد هذا التداخل قد يزيد القراءات المكررة ويشوّش telemetry.

يوجد مسار ضيق لاستعادة القراءات الناقصة أو المبتورة: `deriveObjectiveReplanTargets` يشتق أهدافًا من objective الحالي فقط، ويحدها إلى هدفين؛ ويُنفذ الاسترجاع بعد الحلقة الرئيسية مع إبقاء objective وscope كما هما. هذا ليس planner لادعاءات جديدة ولا تفويضًا لتوسيع scope. يجب تدقيق نقاط القراءة القائمة قبل اختيار نقطة الدمج.  
المراجع: `lib/ai-orchestrator/src/agents/chat-agent.ts:7556-7663,7995-8053,8110-8121,8393-8438,8590-8750,9244-9671`؛ `lib/ai-orchestrator/src/objective-replanning.ts:58-139`؛ `lib/ai-orchestrator/src/objective-claim-plan.ts:1-7,48-114`.

بعد القراءة، تُربط الأدلة بالـclaims الحالية عبر تحقق المصدر والمراجعة والـneedles وإغلاق الإجابة. قراءة ملف إضافي لا تحوله تلقائيًا إلى دليل مقبول ولا تنشئ claim. لا يتغير القبول النهائي إلا عبر objective/evidence/answer gates الموجودة.  
المراجع: `lib/ai-orchestrator/src/required-claims.ts:234-450`؛ `lib/ai-orchestrator/src/evidence-integrity.ts:131-228,2268-2416`؛ `artifacts/api-server/src/routes/ai/chat.ts:504-537,5302-5357`.

### 3.3 شريحة Candidate Validation الأخيرة

في 2026-09-29 أُحكم ربط فعل `candidate.verify` بملاحظة عملية validator المعروفة: يلزم تطابق evidence/session/profile وهوية المشروع والتنفيذ والمحاولة وEpisode والعملية ومراجعة المصدر، وأن يكون وقت الملاحظة بعد `ACTION_REQUESTED`. تدخل مراجع الملاحظات في EffectBundle القائم؛ غيابها أو قدمها أو تناقضها يحجب النجاح. (التنفيذ: `artifacts/api-server/src/lib/recipe-operation-runner.ts:1811-1877,3185-3328`؛ `artifacts/api-server/src/lib/agent-state/candidate-validation-effect.ts:6-68`).

هذا مثال حديث على بناء proof داخل المسارات القائمة، لكنه **شريحة Candidate Validation محدودة**، وليس دليلًا على إغلاق P3.5/P4/P5 عامة أو على جاهزية Discovery المعرفي. لا تخلط Action/Effect الخاصين بالتحقق من candidate مع كل قراءة مصدر في PROJECT_QUERY؛ للقراءة provenance/evidence path قائم، ولا يلزم تحويل كل read إلى Action/Effect.

سجل التقدم الذي تمت مراجعته مؤرخ في 2026-09-28. يجب أن يظل أي وصف لهذا التحديث محددًا بهذه الشريحة إلى أن يُحدّث سجل التقدم في عمل منفصل؛ لا تعدّل ذلك السجل ضمن وثيقة الخطة هذه.

## 4. مقارنة المقترح بالتنفيذ الحالي

| فكرة المقترح | الحكم | التوجيه |
|---|---|---|
| المرحلة 0: تثبيت المسار الحالي | قائم ومطلوب | حافظ على اختبارات target/objective/no-objective/claim closure؛ لا تنقلها إلى مسار جديد ولا تغيّر نتائجها. |
| عقد `ProjectQueryDiscoveryPlan` مستقل | قابل للتصميم، لا كعقد سلطة | إن لزم نوع جديد، يكون projection داخليًا استشاريًا فوق `QueryPlan` والعقد الحالي. لا تضف تخزينًا أو حقول API أو معرّفًا يقدمه النموذج في الشريحة الأولى. |
| فصل فهم السؤال عن target resolution | جزئيًا قائم | توجيه النية وحل الهدف متمايزان بالفعل. لا تضف `ProjectQueryCognitiveMode` موازيًا قبل إثبات فجوة فعلية، ولا تجعل التصنيف يخلق objective. |
| Discovery Planner فوق Query Planner | متداخل حاليًا | `QueryPlan` يقدم بالفعل أهداف ملفات وsubqueries وميزانية إرشادية. ابدأ بتجربة إسقاط استشاري فوقه؛ لا تضف استدعاء planner آخر تلقائيًا. |
| Evidence Need Resolver خادمي | أفضل مرشح للتطوير المحدود | اجعله adapter يحول حاجة دلالية إلى مرشحين موجودين في manifest والنطاق الحاليين؛ ليس مصدر scope أو evidence authority جديدًا. |
| حلقة evidence متكيفة | مؤجلة كتغيير عام؛ يمكن تصميم continuation ضيق | لا تنشئ scheduler ثانيًا. بعد جرد التداخل، يمكن تجربة اختيار تالية داخل المسار الحالي وتحت objective قائم، وبميزانيته، من دون تعديل claims أو objective. |
| Observation lifecycle جديد لكل evidence need | يحتاج مواءمة | أعد استخدام trace/provenance والقراءات المقبولة الموجودة. لا تعِد تسمية model context أو provider prose كـObservation، ولا تحوّل القراءة إلى Action/Effect. |
| Semantic Claim Discovery/Evaluator | مؤجل كسلطة جديدة | يمكن تسجيل candidate claim أو hypothesis كـ`MODEL_INFERRED` للاستدلال فقط. لا تضفه إلى `ObjectiveRequiredClaim`، ولا تنشئ statuses تنافس أنواع `evidence-integrity.ts`. |
| Hypothesis engine وknowledge replanning | مؤجل إذا غيّر اختيار الملاحظات أو الحقيقة | لا تضف `project-query-replanning` كمنفذ موازٍ. الفرضية المقترحة لا تثبت سببًا جذريًا؛ التحديثات المعرفية والتخطيط العام تتبع بوابات §31 وP7.5/P8. |
| فصل synthesis عن evidence/answer completeness | فجوة دلالية تستحق تصميمًا لاحقًا | يوجد `projectQueryResponseSource` وfallback metadata، كما يوجد `validateFinalAnswer`. لا تضف status lattice أو API schema في الشريحة الأولى؛ صمّم توافق JSON/SSE/history أولًا إذا ظهر احتياج مثبت. |
| Answer Completeness Evaluator | متداخل جزئيًا ومحجوب كقبول جديد | لا تجعل evaluator بديلًا عن `validateFinalAnswer` أو objective gate. أي تقدير لغوي للاكتمال لا يمنح proof أو terminal success. |
| Canonical Proof route harness | route coverage موجودة جزئيًا | أضف حالات Discovery الناقصة إلى fixtures والمسارات الموجودة؛ لا تؤجل اختبار route حتى PR متأخر، ولا تكرر اختبارات failover القائمة بلا فجوة محددة. |
| Benchmark ومقاييس Discovery | مؤهل كاختبار محلي فقط | افصل precision والقراءات غير الضرورية والتناقضات عن proof وquality claims؛ لا تسمه learning أو transfer أو generalization. |
| World State/Belief integration | مؤجل | لا تحدث facts أو belief من Discovery في هذه الخطة. World State read model ليس سلطة قبول، وP7.5 لا تملك scope معايرة مؤهلًا. |

المقترح نفسه يضع ضوابط سليمة: Discovery ليس proof، والنموذج لا يحدد path حرًا، وWorld State مؤجل (المرفق، الأسطر 136–162 و309–364 و954–986). لكن عقده وPRs 1–8 تجمع بين استكشاف الأدلة، والـclaims، والـhypotheses، والـreplanning، وحالات الاستجابة والقبول؛ يجب تقسيم هذه السلطات لا تنفيذها كوحدة واحدة.

## 5. عقد وحدود Discovery المقترح

### 5.1 ما يجوز أن يقترحه

يجوز لـDiscovery إنتاج أسئلة استقصاء أو hypotheses أو وصفًا للحاجة إلى ملاحظة تالية. تظل هذه المخرجات `MODEL_INFERRED` أو اقتراحات تخطيط، ويجب أن تكون قابلة للرفض أو التعذر من الخادم. في تجربة shadow لا تنفّذ الاقتراحات قراءة جديدة؛ تقارنها فقط بالـQueryPlan والـmanifest المعروفين.

### 5.2 ما لا يملكه

لا يحدد النموذج أو Discovery:

- `projectId`, `executionId`, `attempt`, `sourceRevision`, `targetId`, `objectiveContract`, `scopeHash` أو manifest identity.
- project root، مسارًا صالحًا للقراءة، objective أو required claim أو evidence needle.
- أذونات أو tools أو ميزانية أو `maxIterations` أعلى من حدود التنفيذ الحالية.
- `PROVEN`, accepted claim، answer completion، effect، World Fact أو terminal acceptance.

تُشتق الهوية من التنفيذ النشط في الخادم. إذا استلزم استمرار Discovery بين الطلبات حفظًا دائمًا لا يدعمه checkpoint الحالي بهوية التنفيذ والمحاولة والمراجعة نفسها، فتتوقف الخطة وتطلب مراجعة تصميم مستقلة؛ لا تضف ledger أو جدولًا موازيًا.

### 5.3 تحويل الحاجة إلى قراءة

يعمل resolver الخادمي بهذا الترتيب:

1. يتحقق من وجود objective canonical صالح، ويأخذ `targetId` و`scopePolicy` وmanifest والـrevision من الخادم.
2. يحول وصف الحاجة إلى مرشحين من `QueryPlan` أو knowledge graph أو filesystem manifest. هذه المصادر تساعد على الملاحة ولا تثبت محتوى الملف.
3. يرفض أي مرشح غير موجود في manifest، أو خارج primary/`allowedExpansionPaths`، أو داخل `forbiddenPaths`، أو غير مقبول بعد canonicalization وفحوص containment/symlink القائمة.
4. يمرر المسار المقبول إلى read tool والسياسة والخط التنفيذي الحاليين. لا تستدعِ أدوات الملفات مباشرة من planner.
5. يسجل المرشح المرفوض أو غير القابل للحل كـno-read reason؛ لا يبحث عن بديل خارج النطاق ولا يغير objective.

المراجع: `lib/ai-orchestrator/src/project-query-target.ts:27-44`؛ `lib/ai-orchestrator/src/agents/query-planner.ts:153-199`؛ `lib/ai-orchestrator/src/tool-execution-engine.ts:5436-5511`؛ `lib/ai-orchestrator/src/capability-contract.ts:424-470`.

### 5.4 الفرق بين “قراءة مسموحة” و“دليل مقبول”

وجود المسار في `allowedExpansionPaths` يجيز قراءة محتملة ضمن السياسة، ولا يجعله required evidence ولا يغلق claim. لا تُقبل القراءة كدليل على claim إلا إذا ربطتها آليات الخادم الحالية بالـclaim والنص ومصدر القراءة والمراجعة وقراءة كاملة. وإلا فهي context أو candidate evidence فقط. لا تنشئ Discovery claims حتى لو كانت قراءة إضافية مقنعة لغويًا.

### 5.5 إيقاف الحلقة وحالات الفشل

تعتمد الحدود على `ExecutionLedger` وtool-call budget وcancellation وno-progress guards القائمة؛ لا تضف thresholds مستقلة في أول شريحة. تتوقف محاولة Discovery عند اكتمال المهمة المحدودة، أو عدم وجود هدف صالح، أو رفض كل المرشحين، أو استنفاد الميزانية، أو الإلغاء، أو عدم إحراز تقدم. يؤدي ذلك إلى تسليم الأدلة المقبولة الحالية للـfinalizer القائم أو البقاء في `ANALYSIS_INCOMPLETE`؛ لا يولد نجاحًا اصطناعيًا.

عند resume، لا يعاد استخدام اقتراح أو evidence need إذا اختلف execution/attempt/revision/target/manifest identity. لا يغير Discovery contract عند استئناف قديم، ولا يعيد قراءة evidence مكتمل لمجرد فشل synthesis.

## 6. مسار التنفيذ المقترح

هذه حزم عمل داخل PROJECT_QUERY، وليست مراحل جديدة في dependency graph.

### D0 — مراجعة الوثائق والعقود

راجع هذه الوثيقة مع المستخدم، وتحقق من إحالاتها ومن تطابقها مع §31 وحالة progress الحالية. ثبّت baseline لاختبارات الهدف canonical، المسار بلا objective، claim closure، deterministic fallback، وterminal parity قبل أي تعديل runtime.

**شرط الخروج:** قرار صريح بأن الشريحة الأولى تقصر Discovery على objective canonical قائم، مع بقاء no-objective fail-closed.

### D1 — جرد مسارات التخطيط والقراءة والدمج

أنشئ خريطة قصيرة لمواضع first-evidence، objective prefetch، planner/graph prefetch، الحلقة العادية، subqueries الهرمية وobjective recovery؛ حدد مصادر dedupe/cache وtelemetry والـbudget الذي يخص كل مسار. اختر نقطة دمج واحدة بعد تثبيت objective، لا قبل حل الهدف، وقبل materialize claims/synthesis.

**شرط الخروج:** برهان بالاختبار أو trace ثابت أن الشريحة لا تضيف قراءة مكررة ولا تتجاوز scheduler أو scope موجودًا.

### D2 — اقتراح استقصاء استشاري

عرّف proposal داخليًا ومحدودًا بما يصف مجهولًا أو فرضية وسبب الحاجة إلى مصدر، مع مرجع إلى claim ID قائم عند انطباقه. اختبر parsing، الأشكال الناقصة، تكرار IDs، النصوص الطويلة، وخروج المخرجات عن العقد؛ المخرجات غير الصالحة لا تغير التنفيذ.

**شرط الخروج:** لا يملك proposal حقول objective أو proof أو مسارات authoritative أو حدود تنفيذ. لا تضف schema قاعدة بيانات أو public API.

### D3 — Resolver خادمي حتمي

حوّل proposal إلى مرشحين ضمن manifest وprimary/`allowedExpansionPaths` للعقد الحاليين، مستخدمًا فحوص المسارات والسياسة الحالية. احتفظ بسبب resolution أو الرفض لأغراض الاختبار والتشخيص، من دون تخزين أجسام الأدلة أو كشف تشخيصات داخلية للمستخدم.

**شرط الخروج:** مدخلات مختلفة عن objective أو manifest نفسه لا توسع scope، والمرشح غير القابل للحل لا يسبب read.

### D4 — شريحة قراءة محدودة داخل المسار القائم

بعد اكتمال D0–D3 فقط، اختبر continuation واحدًا داخل scheduler موجود، تحت objective canonical واحد ونوع استعلام محدد. لا تضف executor أو recovery loop موازية، ولا تغيّر required claims أو scope أو request budget. إذا احتاجت القدرة إلى claim جديد أو مسار خارج expansion الحالي، توقف وتعود لمراجعة العقد.

**شرط الخروج:** كل قراءة تمر عبر بوابة الخادم وتُدمج في evidence/trace القائم؛ لا تتغير دلالات objective completion أو acceptance.

### D5 — route-level deterministic acceptance

وسّع الاختبارات route-level الحالية بفجوات Discovery فقط. استخدم filesystem fixtures ومزوّدات محقونة حتمية؛ لا تستخدم live provider. لا تستبدل اختبار route باستدعاء `planQuery` أو resolver مباشرة.

### D6 — قياس محلي محدود

أضف fixtures مع oracle معلوم لقراءة موزعة أو hidden dependency ضمن عقد قانوني قائم، وfixture غير كافٍ أو متناقض. قس جودة اختيار المصدر والتكرار والإكمال، لكن لا تفسر نتيجة benchmark كـG5 held-out validation أو cross-project transfer.

### أعمال لاحقة تحتاج قرارًا مستقلًا

- تعريف objective canonical جديد للسؤال المفتوح، بما في ذلك الجهة التي تملك claims ومعيار اكتمال الإجابة.
- semantic claim evaluation أو answer-completeness semantics إذا لم تغطها العقود الحالية.
- hypothesis-aware automatic observation selection أو Diagnosis/Replan عام.
- response-status API جديد أو persistence إضافي.
- World State/Belief، P7.5، collection، calibration، strategy learning أو generalization.
- live provider evaluation.

## 7. معايير القبول والاختبارات

لا تُعد الشريحة جاهزة إلا إذا تحققت الشروط التالية:

### عدم التراجع

- لا تتغير نتائج الأهداف canonical الحالية، ولا no-objective `ANALYSIS_INCOMPLETE`، ولا `PROVEN`/`BLOCKED` semantics.
- تبقى required claims وrequired evidence paths وexecution edges وscope policy متطابقة قبل وبعد Discovery.
- لا يمنح محتوى الخطة أو fallback أو synthesis قبولًا بدل evidence/claim gate.

### سلامة المصدر والنطاق

- candidate path غير موجود أو خارج `allowedExpansionPaths` أو ممنوع يرفض قبل القراءة.
- تعذر resolver لا يتسبب في broad scan أو محاولة ملف بديل غير مصرح به.
- evidence قديم أو cached أو ناقص لا يصبح proof جديدًا لمجرد إدخاله في proposal.
- القراءة الإضافية لا تغلق claim إلا عبر claim closure الحالي ومرجعه الدقيق.

### حلقة القراءة والاستعادة

- لا يعاد فتح الملف المكتمل عند استمرار Discovery أو فشل صياغة الإجابة.
- لا تتكرر قراءة واحدة بين discovery/main loop/recovery؛ أظهر التمييز في telemetry الحالي.
- source revision أو attempt أو objective/manifest mismatch يمنع استعادة proposal قديم.
- الإلغاء يمنع بدء قراءة لاحقة، والاستنفاد/غياب الدليل يبقى غير مكتمل.

### إسقاطات الاستجابة

- JSON وSSE والرسالة المحفوظة والتاريخ تتفق في النتيجة والمصادر والـexecution identity.
- لا تظهر hypothesis كحقيقة أو source لم يُقرأ.
- إذا اكتمل objective ولم تتوفر صياغة provider، تبقى قواعد evidence report/fallback الحالية؛ لا يُعلن `ANSWER_COMPLETE` جديد في هذه الشريحة.

### مجموعات الاختبار المطلوبة

1. target canonical معروف مع proposal قابل للحل داخل المسارات المسموحة.
2. candidate خارج scope أو traversal/symlink أو ملف غير موجود؛ لا read ولا نجاح إضافي.
3. proposal malformed أو unknown أو يطلب claim/path/ميزانية سلطوية؛ يُرفض.
4. مصدر ثانٍ يضيف دليلًا إلى claim قائم، ومصدر متناقض أو غير كافٍ؛ لا يفرض claim جديدًا ولا يرفع verdict.
5. نفس الملف موجود في prefetch أو loop سابق؛ لا read مكرر ولا evidence duplicative.
6. فشل synthesis بعد اكتمال القراءة، مع بقاء evidence دون إعادة قراءته.
7. resume بعد attempt/revision/manifest drift، وإلغاء قبل قراءة Discovery وبعدها، واستعادة آمنة عند التطابق.
8. JSON/SSE/history parity واختبارات no-objective fail-closed.

أُنجزت بالفعل اختبارات route-level لـPROJECT_QUERY المحدود تشمل failover للمزود، ثبات evidence packet، عدم إعادة القراءة، وتكافؤ JSON/SSE/history لهدف embedded-AI canonical. يجب إعادة استخدام هذه fixtures وإضافة الحالات الناقصة فقط. لا تشغّل اختبارًا حيًا حتى تنجح بوابة AI release كاملة ويتوفر harness PROJECT_QUERY صالح يثبت القراءة فقط وCanonical Proof المقبول. (الخطة المعتمدة §42.80–§42.81 و§43.02؛ سجل التقدم، الأسطر 3268–3298).

## 8. المقاييس وحدود الادعاء

يمكن لbenchmark محلي، بعد D5، قياس:

- نسبة احتياجات الدليل التي انتهت إلى مصدر موجود ومسموح ومرتبط بالسؤال.
- عدد القراءات الإضافية غير الضرورية أو المكررة.
- نسبة الاحتياجات التي تعذر حلها داخل النطاق، وسبب التعذر.
- اكتشاف التناقضات وعدم كفاية الدليل من دون تحويلهما إلى claim مقبول.
- ثبات زمن/عدد قراءات الشريحة ضمن حدود request budget القائمة.

هذه مقاييس جودة بحث/استرجاع محلية، لا proof لصحة جواب عام، ولا قياسًا لجودة provider حي، ولا تعميمًا أو تعلمًا محمولًا. لا تضف score مجمعًا يحل محل G1–G9، ولا تستخدم EIG أو World Belief لاختيار القراءة في هذه الشريحة. يظل `fixed_safe_probe` وبوابة P7.5 كما هما؛ لا تبدأ collection أو calibration من benchmark Discovery.

## 9. شروط عدم البدء أو التوقف

توقف قبل runtime أو عد إلى مراجعة التصميم إذا تحقق أي مما يلي:

- يتطلب المسار إضافة هدف/claim/required path من مخرجات النموذج.
- يحتاج resolver إلى توسيع نطاق خارج manifest أو `allowedExpansionPaths`.
- يضيف التصميم scheduler أو evidence/replan/acceptance ledger موازيًا.
- لا يمكن ربط resume بالـexecution/attempt/revision/manifest الحاليين عبر آليات الاستمرار القائمة.
- يحتاج تحقيق `ANSWER_COMPLETE` إلى حقل API أو schema جديد غير مراجع.
- تعتمد الخطة على Belief أو causal attribution أو P7.5/P8 أو live-provider evidence.

**قرار التوقف الصحيح:** سجّل الحاجة غير المحلولة، واحتفظ بالأدلة المقبولة، واترك النتيجة غير مكتملة. لا توسع الصلاحية أو العقد تلقائيًا للوصول إلى إجابة مكتملة.

## 10. مراجع التحقق

- `docs/agent-generalization-execution-plan.md:3539-3624,3643-3651,3668-3781`
- `docs/agent-generalization-progress.md:7-21,27-45,47-88,115-162,184-215,3268-3298`
- `lib/ai-orchestrator/src/active-evidence-contract.ts:27-53`
- `lib/ai-orchestrator/src/turn-intent.ts:439-451,541-567,628-656`
- `lib/ai-orchestrator/src/project-query-target.ts:27-44,869-1102`
- `lib/ai-orchestrator/src/agents/query-planner.ts:110-199,459-535`
- `lib/ai-orchestrator/src/agents/chat-agent.ts:7556-7663,7995-8053,8110-8121,8393-8438,8590-8750,9244-9671`
- `lib/ai-orchestrator/src/objective-claim-plan.ts:1-7,48-114`
- `lib/ai-orchestrator/src/objective-replanning.ts:58-139`
- `lib/ai-orchestrator/src/tool-execution-engine.ts:5436-5511`
- `lib/ai-orchestrator/src/evidence-integrity.ts:131-228`
- `lib/ai-orchestrator/src/evidence-integrity.ts:2268-2416`
- `lib/ai-orchestrator/src/required-claims.ts:234-450`
- `lib/ai-orchestrator/src/capability-contract.ts:424-470`
- `artifacts/api-server/src/routes/ai/chat.ts:504-537,5302-5357`
- `artifacts/api-server/src/lib/recipe-operation-runner.ts:1811-1877,3185-3328`
- `artifacts/api-server/src/lib/agent-state/candidate-validation-effect.ts:6-68`
- `attached_assets/Pasted--PROJECT-QUERY--1790645299579_1790645299590.txt:1-1345`
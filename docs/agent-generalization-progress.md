# سجل تقدم خطة تعميم الوكيل الهندسي

> هذا السجل جزء من `docs/agent-generalization-execution-plan.md`.
> يجب على الوكيل التالي تحديثه بعد كل خطوة مكتملة، وقبل الانتقال إلى الخطوة
> التالية. لا تعتبر المرحلة منجزة من دون إدخال يثبت معيار الخروج والتحقق.

## الحالة الحالية

**آخر تحديث:** 2026-09-29
**الوضع:** P0–P2 مكتملة؛ P3 foundation مكتمل مع تكامل معرفي جزئي؛ P3.5/P4/P5 جزئية؛ وP5.5 مكتملة ضمن أسطحها المخولة والمدرجة فقط. أُغلق pilot P6 لانتقال `runtime.start` من `stopped → running`، كما أُغلق pilot P7 bounded للتشخيص ضمن الانتقال نفسه؛ لا يعني ذلك إغلاق المراحل العامة أو تغطية `restart/stop`. P7.5 جزئية ولا يوجد scope معايرة مؤهل. أُوصل continuation observe-only لتعافي Mission، وأُثبت استعادته بين عاملي API مستقلين عبر singleton الإنتاجي وlistener الـsupervisor المُدار؛ تظل نتائجه خارج calibration v1. اجتازت fixtures المحلية اختبارات الانقطاع والإلغاء ودوران lease وسباق DB بين الإلغاء والإنهاء (54/54)، كما اجتاز observer اختبار runtime process محلي (1/1) وشاهد استعادة عبر supervisor (§42.86). لا يفتح ذلك بوابة الجمع، التي ما زالت تتطلب scope مؤهلًا واستقلالًا وheld-out ومراجعة evaluator. أي احتساب مستقبلي يتطلب policy/scope وevaluator جديدين ومراجعين مسبقًا. يظل الاختيار `fixed_safe_probe`. P8/P9/P10 لديها primitives محدودة لا تثبت إغلاق التشخيص العام أو causal attribution أو portability. اكتملت شرائح PROJECT_QUERY المحدودة والـterminal parity، ونُفذ failover synthesis محدود بعد اكتمال الأدلة لقائمة المزودين المصرح بها؛ أثبت §42.80–§42.81 انتقال route-level من فشل provider A إلى نجاح B، وثبات evidence packet، وتكافؤ JSON/SSE/history، وحدود استنفاد المرشحين والميزانية والمهلة والإلغاء لهدف embedded-AI ذي objective canonical. لم يثبت ذلك جودة مزود حي. يبقى المسار بلا objective canonical غير مكتمل عمدًا، ولا يوجد fallback عام مفتوح. بعد تفويض التطوير طُبق schema المفقود بالمسار الرسمي وعاد API إلى الاستماع؛ تفاصيل إثبات استعادة P7.5 عبر listener الـsupervisor في §42.85–42.86.
**تكامل المنتج (2026-09-27):** اكتملت شريحة تفعيل scan hooks للإضافات على
مستوى المشروع، مع بقاء تعريفات الإضافات والتوافر العام محكومين عالميًا. لا
تغيّر هذه الشريحة حالة P0–P14 أو dependency graph، ولا تمنح Mission أو planner
أو tool صلاحية.
**إثبات رحلة Archive Upload (2026-09-28):** نجحت رحلة Clerk الحقيقية عبر upload
وdiscovery وimport وscan حتى `completed`، ثم أثبتت إعادة التحميل بقاء تفعيل
scan hook الخاص بالمشروع وفعاليته. نجحت كذلك رحلة رفض الأرشيف وإعادة المحاولة
واختبارات API للسلامة. يغلق هذا فجوة الوصول والإثبات المحددة في جرد Dashboard؛
ولا يُعد دليلًا على تعميم الوكيل أو تعلمه.
**تصحيح بوابة AI الحتمية (2026-09-29):** تقرير القرار الافتراضي الأحدث اجتاز
15/15 فحصًا بلا فشل أو تخطٍ، مع Preview مفعّل وناجح و`liveProviderChecks=disabled`.
اجتاز كذلك harness PROJECT_QUERY الحتمي والمقيّد بالقراءة فقط: تكافؤ JSON/SSE/
history، وCanonical Proof لمسار SSE ولطلبات JSON المؤهلة ذات objective صالح،
وقراءات محفوظة كاملة تطابق أجسام fixtures، ومن دون آثار كتابة. الطلبات ذات
الأدلة غير المكتملة أو بلا objective canonical تبقى غير ناجحة. لم يُشغّل مزود حي
أو يبدأ STATE؛ راجع §43.02 للتاريخ و§43.03 للسياق و§43.04 لإثبات JSON.
**المصدر الرئيسي:** `docs/agent-generalization-execution-plan.md`

| المرحلة | الحالة | النطاق المنجز أو المتبقي |
|---|---|---|
| P0 — Contracts, baseline, threat model | `done` | عقود agent-state واختبارات parsing/hash/redaction موجودة. |
| P1 — Durable execution | `done` | durable execution وleases وcheckpoints وownership fences هي substrate التنفيذ الحالية. |
| P2 — Evidence and acceptance | `done` | evidence contracts وvalidation وCanonical Proof وMission/Goal terminal gates موجودة؛ لا تمنح receipt/projection وحدها النجاح. |
| P3 — World State foundation | `foundation complete / cognitive integration partial` | عقود facts، materialization، supersession، contradictions، world revision وcurrent-fact projection موجودة مع task/environment scoping وAPI filters؛ Belief مؤجلة إلى P7.5 والملاحظات المستقلة من المصدر الفعلي ضمن P4. |
| P3.5 — Cognitive Action / Observation Spine | `partial` | Candidate Validation وRuntime start/restart/stop وBrowser/Delivery وAI apply-changes وMission `mission_repair` تستخدم Episode → Action → Before/After Observation → Effect → Acceptance في شرائح محدودة. قبول Effect لا يضمن بحد ذاته تحديث World State أو إنشاء سجل معرفة قابل للاستهلاك. في `mission_repair` تسجل الكتابات المعتمدة Action لكل tool call داخل candidate overlay؛ استعادة `ACTION_COMMITTED` تقرأ الطلب canonical من Episode وتحفظ actorId كـprovenance، بينما يظل append محكومًا بملكية lease العامل الحالي. صار aggregate وper-tool `ACTION_COMMITTED` idempotent دلاليًا ضمن execution/attempt: retry المطابق يعيد الحدث نفسه، وإعادة استخدام الهوية بمعنى مختلف أو attempt غير مطابق تفشل مغلقًا. أحداث الأدوات تثبت staging في candidate overlay فقط؛ aggregate observations وEffectBundle يظلان بوابة قبول الأثر. استعادة Mission repair محدودة بمراحل manifest المثبتة؛ لم يُفعّل replay عامًا. سياسة التعافي same-attempt فقط عند تطابق manifest/identities/hashes وإمكان إعادة validation بأمان، وإلا fail-closed ومحاولة جديدة معتمدة. Mission repair لا يروّج bytes إلى live root؛ تقارير Task و`mission_observe`/`mission_validate` تبقى خارج mutation-effect gate. تظل P3.5 جزئية لأن الإغلاق الكامل في §42.2 يعتمد World Delta/revision من P6 وتكامل الحلقة عبر القدرات. |
| P4 — Independent Observation and World Integration | `partial` | task/environment scoping وAPI filters منجزة ضمن P3. توجد ملاحظات receipt-time وruntime launch، ورصد مباشر محدود لعملية validator عند توفر binding كامل إلى Episode؛ كما توجد ملاحظة محدودة لمالك listener في مسارات runtime محددة مع recovery/heartbeat fencing. أضيف مستهلك واحد ضيق للـ`getProjectWorldState` في automatic Mission replan: قراءة استشارية لا تدخل إلا عند تطابق acceptance والتنفيذ والمحاولة والـEpisode، ومع ملاحظات كاملة وحديثة من النطاق نفسه؛ أثبت اختبار DB-backed وصولها إلى plan revision. لا يغلق ذلك P4: propagation للتناقضات ومصادر الملاحظة الأوسع وWorld Delta/revision closure ما زالت جزئية. |
| P5 — Authoritative Effect Verification | `partial` | Candidate Validation مغلق؛ Runtime start/restart/stop المباشر وBrowser/Delivery وapply-changes وMission `mission_repair` يستخدمون effect gate. تعافي restart لـapply-changes أصبح fail-closed ودائمًا. في مسار `apply-changes` تُحفظ ملاحظتا الشجرة قبل/بعد مع `materializeWorldState: false` لعزل candidate؛ لم يظهر إسقاط لاحق لحالة live بعد نجاح الترقية في هذا المسار. يبقى هذا فصلًا صحيحًا عن قبول الأثر، لكنه يعني أن نجاح الأثر لا يحدّث وحده World State. تبقى الحالات غير المثبتة للمعالجة اليدوية ومسارات lease/reconnect الأوسع؛ لا يكتمل DoD المرحلي قبل ربط الآثار بـWorld Delta في P6. |
| P5.5 — Unified Action Semantics | `complete` | لكل invocation مخول عقد server-owned يربط execution/attempt وscope/revision والنتيجة أو الفشل ومراجع evidence. قراءتا recipe `database.read_project` و`project.read_file` تسجلان Observation على Episode canonical واحد مع scopeHash. قراءات Mission المسموح بها تحمل الآن scopeHash مستقلًا مشتقًا من السياسة والنطاق المحسومين على الخادم؛ request/result يشتركان في hash واحد وتُحجب النتيجة عند mismatch. مسارا `/api/ai/chat` و`/api/ai/chat/stream` يسجلان قراءات provider المؤهلة، كما يسجلان `query_knowledge_graph` و`discover_project_apis` مع hashes للمدخلات والـmanifest والـscope والنتيجة. لا تتغير allowlists أو صلاحيات Mission، ولا تنشئ الملاحظات `AgentAction` أو `EffectBundle` أو acceptance. تبقى أدوات Mission غير المدرجة في manifest و`refresh_project_scan` stateful وأدوات validation/effect خارج نطاق جرد القراءة. mutations المعتمدة تستخدم `AgentAction` الكامل؛ `mission_repair` يسجل `write_file`/`replace_text` داخل candidate overlay من دون per-tool EffectBundle. |
| P6 — World Delta and Revision Closure | `pilot closed (scoped; retry-order guard implemented and tested)` | اكتمل pilot `runtime.start` الحقيقي `stopped → running`: D1 يمنع الأثر عند غياب/تعارض الدليل؛ materialization يثبت هوية التنفيذ والمحاولة وEpisode والجلسة ومراجع المشروع والبيئة؛ D2 يربط dispatch بالانتقال الحدثي ومراجعاته وملاحظاته وخطتيه. لا يمنع تغير World State غير متعلق هذا dispatch. `running → running` لا ينتج انتقالًا، و`restart/stop` خارج النطاق. عولج خطر السباق قبل القبول داخل المسار القائم؛ تغطي الاختبارات الانتظار دون استهلاك retry، ومراجع idempotency، وفشل القبول غير المرتبط بـEffectBundle. لا يوسع هذا P6 خارج pilot. |
| P7 — World-State Failure Diagnosis | `pilot done — runtime.start only` | أُغلق تشخيص bounded للانتقال `runtime.start` وفق إدخال 42.47 في هذا السجل؛ التشخيص العام وربط بقية World State والـfacts والـobservations ما زال غير مكتمل. |
| P7.5 — Belief and Information Gain | `partial — supervisor-backed observe-only recovery verified; readiness gate still blocks collection` | التسجيل مؤهل فقط عبر Mission runtime المربوط بـMission/Goal/planRevision وعند transition من stopped؛ endpoint العام لا ينتج عينة P7.5. الـforecast bootstrap ثابت، لا selector. اختبارات ECE المرجعية وmission-cluster bootstrap مضافة. تعافي Mission يعثر على التسجيل غير المحسوم داخل execution نفسه، ويقرأ `runtime.status` فقط في attempt/Episode جديدين؛ لا يعيد `runtime.start`. الطلب/النتيجة advisory، والنتيجة السابقة تُعاد دون قراءة مكررة، بينما اختلاف scope أو التعارض يفشل مغلقًا. تُنهى Episode والتنفيذ ذريًا وتُعاد Goal إلى `needs_replan` بلا acceptance. نتائج continuation مستبعدة صراحةً من calibration v1 ولا تسوّي التسجيل الأصلي؛ أي احتساب مستقبلي يحتاج policy/scope وevaluator جديدين. اجتازت اختبارات محلية حتمية للانقطاع والإلغاء ودوران lease وسباق DB بين طلب الإلغاء والإنهاء (54/54)، واختبار observer على runtime محلي (1/1)، وشاهد عاملين عبر listener الـsupervisor المُدار (§42.86). لا يوجد scope مؤهل وتبقى `fixed_safe_probe` وبوابة الجمع مغلقتين. |
| P8 — Diagnosis-aware Replanning | `partial` | توجد bounded objective recovery وMission replan primitives، وأضيف إليها مدخل World State استشاري ضيق ومربوط بمراجعة الخطة؛ هذا لا يستهلك World Delta أو Belief revision، ولا يثبت أن التشخيص يوجّه كل إعادة تخطيط. فصل world-belief وforecast-calibration وcausal-attribution وتشخيص mismatch بعد فحص الرصد والتنفيذ والبيئة، مع pilot ضيق، ما زال غير منفذ. تظل P7.5 بوابة سابقة لإغلاق P8 حسب §31. |
| P9 — Causal Credit Assignment Safety Layer | `partial / advisory` | effect coverage sidecar موجود؛ causal attribution وcontrolled counterfactual ومساهمة action/information/failure/redundancy غير مثبتة. |
| P10 — Portable Strategy Extraction | `partial; not portable learning` | توجد candidate discovery وregistered replay محدود بـ`runtime.start`؛ لا توجد بعد abstraction قابلة للنقل أو held-out/transfer evaluation مكتملة. |
| P10.5 — Agent Capability Self-Model | `not_started` | reliability وsupported environments وfailure modes وcost/risk/authorization وevidence quality. |
| P11 — Learning Validation and Transfer | `not_started` | توجد replay primitives محدودة تحت P10؛ لا توجد held-out evaluation مكتملة أو cross-project transfer أو Learning Delta؛ يلزم Brier/ECE حسب scope مع project/fixture-level split وقياس عدم اليقين، من دون تغيير حد §25.4. |
| P12 — Strategy Promotion and Revocation | `not_started` | canary/promotion/revocation آمنة دون حذف forensic history. |
| P13 — Capability composition | `not_started` | composition آمن عبر semantic contracts وsandbox وshadow replay. |
| P14 — Multimodal extension | `not_started` | مؤجل إلى ما بعد إغلاق effect/evidence/learning gates. |

## بوابة جاهزية الوثائق قبل استئناف تغييرات الكود

يبقى العمل توثيقيًا فقط إلى أن تتحقق جميع الشروط التالية:

- §31 هو المصدر الوحيد لترتيب التنفيذ؛ جدول الحالة هنا و§42 متطابقان معه.
- ملخص schema القائم في §18.2–§18.6 متسق مع Drizzle، ومرجع المخطط الدقيق محدد؛
  العقود المستقبلية موسومة بوضوح كتصميم أو عمل لم يبدأ.
- تسلسل Action وحالاته متسقة بين §5 و§19 و§42؛ لكل invocation هوية ونتيجة
  server-owned، بينما `AgentAction` الكامل و`EffectBundle` يخصان mutation أو
  effect-gated validation. والفرق بين قبول الشريحة قبل P6 والإغلاق الكامل بعد
  World Delta موضح صراحة.
- `EffectBundle` و`WorldTransition` و`Acceptance` عقود منفصلة؛ فشل materialization
  لا يبطل القبول، لكن كل أثر مؤهل للتعلم يملك التزامًا durable بنتيجة أو فشل
  معرفي صريح، مع idempotency واستعادة، ولا يُعد P6 مكتملًا قبل إثبات استهلاك
  القرار التالي لـ`resultingWorldRevision`.
- حدود canary الرقمية في §25.3، وحدود promotion العامة في §25.4، وانتقالات
  النتيجة في §29.6؛ لا توجد thresholds مكررة أو متعارضة.
- §5.6 و§18.3 و§19 يحددون تسجيل forecast غير القابل للتعديل قبل التجربة،
  اختيار observation، مقارنة النتيجة وقياس Brier وربط Belief update؛ §25.4
  يقيس ECE على forecasts held-out المسجلة مسبقًا باستخدام الحد القائم.
- §5.6 يقيّد entropy-based EIG بفرضيات متنافية وشاملة، ويجعل expected decision
  value المقياس الأساسي وEIG لكسر التعادل فقط. يمنع auto-selection من forecasts
  غير المعايرة أو غير المرتبطة بقرار objective؛ الاختيار المحلي لا يفتح إلا بعد
  ≥30 held-out outcomes ضمن scope وECE ≤0.15، على أن لا يتجاوز الحد الأعلى
  لفاصل عدم اليقين هذا الحد. bootstrap وpilot محددان قبل توسيع النطاق.
- §25.4 يثبت project/fixture-level holdout split وقياس عدم اليقين؛ 30 حالة و3
  fixtures حدان أدنيان لا ضمان قوة إحصائية، ولا تتغير العتبات القائمة.
- §3.10 و§5.6 و§5.7 و§42.9 تفصل تحديث World Belief عن forecast calibration
  وعن causal attribution؛ تحليل mismatch يتحقق من الرصد والتنفيذ والبيئة أولًا،
  ويعرض تفسيرات مدعومة ومناقضة وخيار unresolved، ولا يدعي السببية دون تدخل مضبوط.
- الأقسام التاريخية معلّمة ولا تناقض ترتيب التنفيذ أو الحالة الحاليين.
- الإحالات الداخلية صالحة، ويجتاز التغيير `git diff --check`.

لا يصرح هذا الشرط ببدء تغييرات runtime أو schema؛ لا يبدأ تعديل الكود المرتبط
بالخطة قبل إغلاق هذه البوابة ومراجعة المستخدم للوثيقتين.

**حالة النسخة الحالية (2026-09-26):** أُغلقت البوابة لهذه المراجعة بعد تدقيق
مطابقة schema وترتيب المراحل وعقود Action وعتبات المعايرة والإحالات الداخلية،
واجتياز `git diff --check`. طلب المستخدم متابعة العمل بناءً على الخطة المحدثة،
ويُعد ذلك مراجعةً لهذه النسخة. هذا الإغلاق لا يغيّر ترتيب §31: أي P6 pilot ينتظر
جاهزية متطلبات P3.5/P4/P5، وأي تعديل لاحق للعتبات أو schema أو ترتيب المراحل
يعيد فتح مراجعة الوثائق.

## المعالم المعمارية المنفذة — شرائح محدودة

توجد الآن مسارات runtime حقيقية، لا contracts أو read models فقط:

```text
Episode → Action → Before → Execute → After → Effect → Acceptance
```

هذا المسار يعمل في شرائح محددة ولا يمثل عقدًا موحدًا لكل الوكيل. المعالم الحالية:

- **Action/Effect vertical slices:** Candidate Validation، Runtime lifecycle،
  Browser/Delivery، approved `apply-changes` مع restart reconciliation fail-closed،
  وMission `mission_repair` ضمن candidate مؤقت غير مروج إلى live root.
- **Environment identity:** Episode environment attestation، receipt-time observation،
  runtime launch identity، وvalidator pre-spawn identity مع رصد مباشر محدود للـ
  validator child عند توفر Episode binding كامل. listener ownership/recovery مثبتان
  جزئيًا في مسارات runtime المحددة؛ تبقى descendants والتغطية العامة لدورة حياة
  الخدمة خارج حد الإثبات الحالي.
- **World State:** task/environment scope وrevision وAPI filters read-only؛
  process observations مستقلة محدودة لعمليات runtime وvalidator، وlistener ownership
  في مسارات محددة؛ propagation الأوسع غير مكتمل، وWorld Delta/revision closure في P6.
- **Diagnosis وlearning:** bounded diagnosis/replan، effect-credit sidecar،
  strategy candidates وreplay محدود موجودة كـprimitives؛ لا تثبت cognition أو
  causality أو portability أو generalization.

## أولوية التنفيذ الحالية

يبقى §31 dependency graph الوحيد؛ pilots المنجزة لا تغلق المراحل العامة ولا
تسمح بتجاوز بواباتها. لا توسّع capabilities الوكيلة أو strategy learning
أفقيًا. يوجد مسار تسليم منتجي منفصل لإظهار الوظائف الموجودة أصلًا في Dashboard،
موثق في `docs/replit-platform-gap-inventory.md` §11؛ يمكن أن يسبق تنفيذ P7.5
دون تغيير ترتيب المراحل أو فتح جمع البيانات. تبقى جاهزية P7.5 شرطًا مانعًا لأي
cohort أو تعلم لاحق، لا شرطًا يمنع أعمال الواجهة المستقلة:

1. **Dashboard — الوصول إلى الميزات الحالية:** أُغلقت فجوة Archive Upload P0:
   رحلة Clerk الحقيقية وصلت عبر upload وdiscovery وimport إلى scan مكتمل؛
   وفُعّل project scan hook وأثبتت إعادة التحميل بقاءه وفعاليته. اختبر مسار
   الرفض الصيغ والأحجام، و413/422، وعدم بدء discovery بعد الرفض، ثم نجاح
   إعادة المحاولة؛ واختبرت API رفض الأرشيف غير الآمن وملكية الرفع. استخدم
   التحقق Firefox لأن Chromium يفصل أثناء reload في هذه البيئة. هذا إثبات
   reachability/persistence للمنتج لا generalization. ما زال نطاق Graph
   المتقدم وقرار كون World State وRuntime Observations وRuntime Disagreements
   داخلية أو عملياتية بحاجة إلى حسم. تبقى إعدادات Plugins typed، وربط
   credentials الآمن، وسياق Mission/CER عقودًا منفصلة مؤجلة؛ لا توسع صلاحيات
   الوكيل.
2. **P7.5 — بوابة الجاهزية قبل البيانات:** اختبارات ECE وmission-cluster
   bootstrap ذات الإجابة المعروفة أضيفت؛ أثبت تتبع التعافي أن resume يدوّر
   attempt/Episode ولا يكمل registration القديم، وأن الإلغاء نهائي. لذلك لا تجمع
   cohort حتى يثبت مسار observe-only للتجربة الأصلية، أو يعتمد قرار موثق لإنشاء
   scope جديد ذي policy version جديدة وheld-out cohort مستقبلية. وثّق cohort
   المأذون ومسار Mission runtime، وطريقة إعادة البيئة إلى `stopped` تحت تحكم
   المشغّل دون إضافة `stop/restart` لسلطة الوكيل. اختلاف `missionId` وحده ليس
   برهان استقلال، وتغيّر project/environment revision ينشئ scope آخر.
3. **P7.5 — جمع النتائج بعد اجتياز الجاهزية:** اجمع فقط outcomes حقيقية ومكتملة
   من Missions مؤهلة ضمن scope واحد؛ لا تصنع Missions/fixtures لبلوغ 30 ولا
   تستبعد القياسات الناقصة. أبقِ `fixed_safe_probe` حتى تحقق جميع عتبات §25.4
   و§42.8؛ اجتياز هذا القياس لا يفعّل ranking ولا يثبت صلاحية selector.
4. **PROJECT_QUERY:** §42.51 أغلق claims/handoff المحدود، و§42.56 أغلق terminal
   parity عند غياب objective canonical. أُثبت في §42.80–§42.81 مسار route-level
   من فشل provider A إلى نجاح B، وثبات evidence packet بلا إعادة قراءة،
   وتكافؤ JSON/SSE/history وحدود المهلة والميزانية والإلغاء لهدف
   `PROJECT_QUERY_EMBEDDED-AI`. ما زالت جودة provider حي غير مثبتة؛ آخر نتيجة
   مكتملة موثقة لـ`validate:ai-release` تعثرت في اختبارات أخرى، وأُصلح لاحقًا
   حاجز schema الخاص بتشغيل API. نتيجة إعادة القياس التشخيصية وحدودها في §43.02؛
   لا live run قبل اجتياز البوابة الكاملة.
   المسار بلا objective canonical يظل fail-closed ولا يفتح fallback عامًا؛
   لا يضيف هذا تحققًا عابرًا للمراحل إلى dependency graph أو يتجاوز جاهزية P7.5.
5. **المراقبة التشغيلية:** يجوز إضافة projection قراءة فقط لتقدم cohort بعد
   تثبيت عقد الجمع والاستعادة؛ ليست الخطوة الأولى ولا مصدر قبول أو معايرة.
6. بعد استيفاء شروط P7.5، تابع P8 ثم P9 ثم P10/P10.5/P11 وفق الاعتماديات
   ومعايير الخروج في §31؛ لا تجعل شريحة Chat سببًا لتجاوزها.

لا تبدأ مرحلة جديدة أو توسع replay/promotion قبل إغلاق بوابات الحلقة.

## Cognitive Spine Reality Check

وجود contract أو schema لا يساوي اكتمال القدرة التشغيلية. يجب تقييم المشروع على
محورين منفصلين:

1. **Feature/contract completion:** وجود العقود والتخزين والإسقاطات والاختبارات.
2. **Runtime cognitive integration:** قدرة runtime على ربط الفعل بالملاحظة المستقلة
   والأثر وتحديث العالم والتشخيص وإعادة التخطيط.

القواعد التالية إلزامية:

- Contract/schema existence ≠ runtime integration.
- Derived acceptance state ≠ independent observation.
- World-state materialization ≠ full belief/world model.
- Episode persistence ≠ closed-loop agent cognition.
- Strategy schema ≠ strategy learning.
- Replay infrastructure ≠ generalization.
- `Episode.environmentRevision` ≠ independent environment observation.
- Environment revision match alone ≠ proof that a child process ran in that environment.

## Observation Provenance

كل observation يجب أن يعلن مصدره:

```text
DIRECT_OBSERVATION
SERVER_DERIVED
MODEL_INFERRED
```

- `DIRECT_OBSERVATION` يجوز أن يثبت evidence عن العالم.
- `SERVER_DERIVED` يجوز أن يثبت facts مشتقة مع الاحتفاظ بمراجعها.
- `MODEL_INFERRED` يكوّن hypotheses فقط.

لا يجوز إعادة تسمية acceptance أو validation أو model output كـindependent
runtime observation، ولا يجوز أن تتحول نتيجة `PROVEN` إلى دليل runtime مستقل.

## Generalization Gates

لا تُرقّى capability أو strategy قبل اجتياز البوابات التالية كلّها، لا score
واحدًا مجمعًا:

```text
G1 Correctness
G2 Evidence Integrity
G3 Effect Verification
G4 Failure Diagnosis
G5 Held-out Validation
G6 Cross-project Transfer
G7 Novel Composition
G8 Regression Safety
G9 Revocation Safety
```

## سجل الخطوات

### 2026-09-26 — P7.5 Runtime-start fixed-safe bootstrap

- **phase/step:** P7.5 / Mission `runtime.start` فقط
- **status:** `partial`
- **what changed:** أضيفت hypothesis set server-owned وموزونة، ومرشح
  `runtime.status` ثابت وآمن. تسجل التجربة قبل استدعاء start، ويرصد العامل
  حالة status مرة واحدة بعد فشل/تعذر التحقق، ثم يحفظ نتيجة منفصلة عن Gate C.
  هوية النتيجة ثابتة عبر retry ولا تقبل نتيجة متعارضة للتجربة نفسها. لا تستخدم
  forecasts أو EIG غير المعايرة للاختيار أو لتحديث Belief؛ القياس الناقص أو
  stale أو المتغير بيئيًا يبقى inconclusive.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/agent-state/runtime-start-hypothesis-experiment.ts`,
  `recipe-operation-runner.ts`, `recipe-operation-runner.test.ts`,
  `mission-runtime.ts`, و`lib/ai-orchestrator/src/recipe-capabilities.ts`.
  لا migration أو schema change.
- **validation:** اختبارات `runtime-start-hypothesis-experiment.test.ts` و
  `recipe-operation-runner.test.ts` نجحت (22 اختبارًا)؛ `pnpm run typecheck` و
  `git diff --check` نجحا. أُعيد تشغيل API workflow، و`/api/healthz` أعاد
  `200` مع `status: ok`.
- **authority/safety impact:** لا تغيير في D1 أو Gate C أو P6/P7 acceptance؛
  لا `restart/stop` ولا authority من EIG أو forecast.
- **remaining/blocker:** هذا بدء محدود وليس إغلاق P7.5. المعايرة و
  expected-decision-value ranking وBelief updates وP8 integration ما زالت مؤجلة.
- **next step:** جمع outcomes موثوقة في scope runtime.start، ثم تنفيذ المعايرة
  والسياسات المستقلة فقط بعد استيفاء عتبات §42.8.

### 2026-09-25 — Pre-registered hypothesis experiments and forecast calibration

- **phase/step:** Governance / P7.5–P11 hypothesis-testing contract
- **status:** `done` — توثيق فقط؛ لم يبدأ تنفيذ المراحل.
- **what changed:** أضيف عقد لتسجيل forecasts وتوزيعات outcomes قبل observation،
  وقصر EIG على hypothesis sets صالحة، وربط كل تجربة بقيمة القرار المتوقعة من
  objective policy server-owned، مع استخدام EIG لكسر التعادل فقط. أضيف
  bootstrap shadow/fixed-safe-probe أو human approval حتى تتوفر معايرة scope،
  مع pilot ضيق قبل التوسع. الاختيار الآلي المحلي يحتاج ≥30 held-out outcomes
  في scope نفسه وECE ≤`0.15`، على أن لا يتجاوز الحد الأعلى لفاصل عدم اليقين هذا
  الحد؛ النقل العام يبقى خلف كل بوابات §25.4. يقاس الخطأ بـBrier، ويرتبط Belief
  update بالملاحظة المقبولة. فُصل تحديث حقيقة العالم عن معايرة forecast وعن
  الإسناد السببي، وأضيف تحليل mismatch append-only يفحص صلاحية القياس والتنفيذ
  والبيئة قبل عرض تفسيرات مرشحة وأدلتها؛ يبقى السبب unresolved دون دليل كافٍ.
  ثُبت project/fixture-level held-out split وقياس عدم اليقين لـECE دون تغيير
  العتبات القائمة.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`,
  `docs/agent-generalization-progress.md`; لا تغييرات runtime أو schema.
- **validation:** `git diff --check`؛ 25 إحالة داخلية بلا unresolved refs؛ فحص
  markers القرار والمعايرة وpilot وفصل مسارات التحديث وتشخيص الخطأ، وعدم بقاء EIG
  كمعيار منفرد؛ التغيير محصور بالوثيقتين.
- **authority/safety impact:** forecast ليس evidence أو authority؛ لا يثبت
  Brier/ECE حقيقة أو acceptance أو causality. observation الموثوقة وحدها تغذي
  تحديث Belief؛ خطأ منفرد لا يغير calibration status أو يثبت سببًا؛ لا تغيير في
  authorization أو Proof.
- **remaining/blocker:** بوابة مراجعة الوثائق ما زالت مفتوحة، وP7.5–P11 غير
  منفذة. لا يبدأ تعديل الكود قبل مراجعة المستخدم وموافقته على الوثيقتين.
- **next step:** مراجعة المستخدم وإغلاق بوابة الوثائق؛ بعد الموافقة فقط يستمر
  التنفيذ وفق dependency graph في §31.

### 2026-09-25 — Roadmap source-of-truth and cognitive-loop priority

- **phase/step:** Governance / P0–P14 status and dependency reconciliation
- **status:** `done`
- **what changed:** أعيدت معايرة الحالة الحالية: P7 جزئية لوجود diagnostics وbounded
  replan primitives؛ P9 هي safety layer جزئية/advisory؛ P10 لديها candidate/replay
  primitives لا تعني portable learning. رُفعت أولوية Unified Action وindependent
  observation وWorld Delta ثم Belief/Information Gain قبل توسيع learning. ثُبتت
  شرائح P3.5/P4/P5 runtime كمعالم محدودة، لا كإغلاق للمراحل.
- **files/schema/contracts touched:** `docs/agent-generalization-progress.md`,
  `docs/agent-generalization-execution-plan.md`; لا تغييرات runtime أو schema.
- **validation:** مراجعة تطابق الحالة مع السجل والخطة؛ `git diff --check`.
- **authority/safety impact:** environment identity تظل metadata، لا proof؛ لا
  تغيير في acceptance أو permission أو effect authority. لا يعتبر وجود
  `effectBundle` أو `environmentRevision` وحده إغلاقًا لـP4/P5.
- **remaining/blocker:** independent before/after closure وWorld Delta وBelief/
  Information Gain والتشخيص المعرفي ما زالت غير مكتملة.
- **next step:** ابدأ بـUnified `AgentAction`، ثم أغلق P4/P5 وP6 قبل توسيع
  diagnosis/replanning/learning وفق dependency graph في §31.

### 2026-09-25 — Server-owned environment attestation

- **phase/step:** P4 / Episode environment identity and freshness
- **status:** `partial`
- **what changed:** تُحسب بصمة مستقرة عند إنشاء Episode من ملفات manifests/lockfiles
  المسموحة، ونسخة Node/platform، وملف server-owned مشتق من نوع العملية. لا تُقرأ
  أو تُخزن محتويات الملفات الخام؛ `.env` و`.npmrc` مستبعدان، وتفشل القراءة
  المغلقة عند root غير الآمن، symlink، ملف كبير، أو غياب manifests.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/agent-state`,
  `artifacts/api-server/src/lib/task-execution-service.ts`,
  `artifacts/api-server/src/lib/recipe-operation-runner.ts`,
  `artifacts/api-server/src/routes/ai/chat.ts`,
  `lib/db/src/schema/ai_agent_episodes.ts`,
  `lib/db/src/schema/ai_agent_observations.ts`,
  `lib/db/src/schema/ai_world_facts.ts`,
  `lib/ai-orchestrator/src/agent-state`.
- **validation:** API typecheck؛ 17 اختبار API مركزًا؛ 18 اختبار DB؛
  schema apply/check. أُعيد تشغيل API وفُحصت سجلات التشغيل بعد اكتمال الدفعة.
- **authority/safety impact:** `environmentRevision` رصدية فقط؛ لا تمنح قبولًا
  أو صلاحية effect. `environmentFreshness` مستقلة عن project freshness؛ mismatch
  يستبعد الملاحظة من World State، وغياب revision يبقى unbound، بينما revision
  receipt بلا baseline تحتفظ بنطاقها مع freshness `unknown`.
- **remaining/blocker:** freshness هنا مربوطة بلقطة Episode، لا بمراقب مستقل
  للبيئة الحالية بعد التنفيذ. ما زالت World Delta وانتشار التناقضات غير منفذين.

### 2026-09-25 — Validator spawn environment identity

- **phase/step:** P4 / Bounded validator spawn identity
- **status:** `partial`
- **what changed:** أضيف hook اختياري قبل spawn في bounded-command kernel؛ بعده
  يعاد التحقق من root وcwd مباشرة قبل إنشاء child process. يلتقط validator
  البصمة من جذر workspace الذي سيعمل عليه فعلًا وبـprofile server-owned مطابق
  لسياق Episode، ثم يحمل `environmentRevision` عبر ValidationResult و
  TaskObjectiveValidatorReceipt وserver-owned Observation.
- **validation:** API typecheck؛ 44 اختبار API مركزًا عبر أربعة ملفات؛ 11 اختبار
  bounded execution؛ `git diff --check`؛ API restart وفحص `/api/healthz` بحالة
  `ok`.
- **authority/safety impact:** قيمة revision metadata فقط؛ لا تدخل في proof أو
  status أو scope أو permissions أو acceptance. القيمة `null` تبقى `unknown`.
  لا تستبدل بصمة workspace المؤقت تحت `/tmp` ببصمة root المصدر؛ سياسة root
  الحالية ترفض هذا المسار عمدًا.
- **remaining/blocker:** pending-change workspaces تحت `/tmp` غير قابلة للattestation
  وفق حد الجذر الحالي؛ لا يوجد تأكيد مستقل من child process بعد بدء التنفيذ.
  يلزم حل workspace موثوق مستقل قبل جعل تلك البصمات معروفة، مع إبقاء World
  Delta وانتشار التناقضات ضمن العمل المتبقي.

### 2026-09-24 — World State read-only وContext projection

- **phase/step:** P4 / World State read model
- **status:** `partial`
- **what changed:** materialized read-only facts من observations الموثوقة، world
  revision deterministic، contradictions وsupersession، endpoint محمي،
  وbounded `worldState` context slice مع cache invalidation مخصص.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/agent-state`,
  `artifacts/api-server/src/routes/projects.ts`,
  `lib/ai-orchestrator/src/context-*`,
  `lib/ai-orchestrator/src/schemas/context.schema.ts`.
- **validation:** API typecheck؛ اختبارات World State والroute (11)؛ اختبارات
  Context Builder/Loader (81)؛ `git diff --check`؛ `/api/healthz` أعاد `ok`.
- **authority/safety impact:** read-only؛ لا يغير acceptance أو proof أو planner
  أو permissions؛ provider prose لا يدخل materialization.
- **next step:** إغلاق تكامل Episode مع Mission/Workflow، ثم بدء P5 Effect
  Observation.

### 2026-09-24 — Architectural review وroadmap calibration

- **phase/step:** Governance / إعادة معايرة ترتيب P2–P13
- **status:** `done`
- **what changed:** تثبيت Effect-backed Generalization كمحور للخطة؛ جعل إغلاق
  Mission/Workflow شرطًا قبل Effect Enforcement؛ إعادة ترتيب observers وdiagnosis
  وreplan وreplay؛ إبقاء World State read model محدودًا؛ وتأجيل Multimodal إلى
  مسار لاحق منفصل.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`,
  `docs/agent-generalization-progress.md`; لا تغييرات runtime أو schema.
- **validation:** مراجعة اتساق الخطة مع acceptance/proof وMission/Goal وrecipe/
  capability وshadow replay؛ `git diff --check` بعد اكتمال التعديل.
- **authority/safety impact:** لا تغيير في authority؛ لا World State أو strategy
  memory أو benchmark يمنح acceptance أو permission أو promotion.
- **remaining/blocker:** P2 ما زالت `partial`؛ يلزم إغلاق Episode integration قبل
  بدء Gate B.
- **next step:** إكمال Mission/Workflow Episode integration ثم تنفيذ Candidate
  Validation Effect Loop كأول vertical slice كاملة.

### 2026-09-24 — Mission/Workflow Episode identity wiring

- **phase/step:** P2 / Episode identity at task execution
- **status:** `partial`
- **what changed:** ربط Episodes الناتجة من Task execution بـ`missionId` و`goalId`
  و`planRevision` عند وجود Goal، وتمييز Workflow tasks داخل الـscope بواسطة
  `workflowId`. ظل المسار Shadow-only.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/task-execution-service.ts`,
  `artifacts/api-server/src/lib/task-execution-service.test.ts`.
- **validation:** اختبار task execution المستهدف؛ 8 اختبارات ناجحة؛
  `git diff --check`.
- **authority/safety impact:** لا تغيير في acceptance أو proof أو Mission state أو
  permissions؛ Episode write ما زال غير authoritative.
- **remaining/blocker:** لم تثبت بعد رحلة Mission/Workflow end-to-end أو تكامل
  Episode مع كل terminal/recovery projections.
- **next step:** إضافة اختبار تكاملي يثبت الهوية عبر Mission dispatch وresume/
  retry قبل بدء Gate B.

### 2026-09-24 — Mission Episode identity integration coverage

- **phase/step:** P2 / Mission task lifecycle identity
- **status:** `done`
- **what changed:** أضيفت fixture تكاملية تتحقق من أن تنفيذ Task المرتبط بـMission
  ينشئ Episode يحمل `missionId` و`goalId` و`planRevision` وscope من نوع
  `mission-task`.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/task-execution-lifecycle.integration.test.ts`.
- **validation:** اختبارات lifecycle وEpisode وtask service؛ 17 اختبارًا ناجحًا؛
  API typecheck ناجح؛ `git diff --check`.
- **authority/safety impact:** assertion فقط؛ لا تغيير في acceptance أو proof أو
  Mission terminal state أو permissions.
- **remaining/blocker:** Workflow integration coverage غير مكتملة؛ P2 تبقى
  `partial` حتى يثبت scope الخاص بـWorkflow عبر lifecycle فعلي.
- **next step:** إضافة اختبار Workflow task يثبت `workflowId` في Episode scope.

### 2026-09-24 — Workflow Episode identity integration coverage

- **phase/step:** P2 / Workflow task lifecycle identity
- **status:** `done`
- **what changed:** أضيفت fixture تكاملية تتحقق من أن Task المرتبط بـWorkflow ينشئ
  Episode يحمل scope من نوع `workflow-task` مع `workflowId`، ولا يخلط هوية
  Mission/Goal غير الموجودة.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/task-execution-lifecycle.integration.test.ts`.
- **validation:** اختبارات lifecycle وEpisode وtask service؛ 18 اختبارًا ناجحًا؛
  API typecheck ناجح؛ `git diff --check`.
- **authority/safety impact:** assertion وتوسيع metadata في Shadow ledger فقط؛ لا
  تغيير في acceptance أو proof أو Mission/Workflow terminal authority.
- **remaining/blocker:** لا يوجد blocker في P2؛ P4 ما زالت جزئية، وEffect Loop
  غير منفذ.
- **next step:** بدء Gate B عبر Candidate Validation Effect Loop، مع تحديث السجل
  قبل الانتقال إلى observer أو learning لاحق.

### 2026-09-24 — Mission recipe Canonical Proof gate verification

- **phase/step:** P2 / Mission and Workflow terminal proof
- **status:** `partial`
- **what changed:** تم تثبيت والتحقق من أن إغلاق Goal/Mission في مسار recipe لا يعتمد
  على recipe receipt أو projection وحدهما؛ بل يمر عبر execution وacceptance وproof
  وsource/candidate/delivery bindings، ويعود إلى `verifying` عند غياب proof المقبول.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/mission-runtime.ts`,
  `artifacts/api-server/src/lib/proof-foundation.ts`,
  `artifacts/api-server/src/lib/mission-runtime-recipe.test.ts`,
  وschema التطوير لحقول `ai_executions` وacceptance.
- **validation:** `pnpm --filter @workspace/db run push` نجح؛ اختبارات
  `mission-runtime-recipe.test.ts` (6) و`mission-runtime.test.ts` و`missions.test.ts`
  (25) نجحت؛ API typecheck و`git diff --check` نجحا؛ API restart smoke نجح.
  رحلة Dashboard الأوسع وصلت إلى 45 نجاحًا من 49 مع 3 فشل و1 skipped، ونجح
  teardown والتنظيف، لذلك لم تُعتبر تغطية Gate A المتكاملة مغلقة.
- **authority/safety impact:** لا يوجد bypass للـCanonical Proof؛ acceptance وserver-owned
  evidence والهوية المرتبطة بالتنفيذ تبقى مصدر الحقيقة، وreceipt/projection تظل
  إسقاطًا غير كافٍ وحده.
- **remaining/blocker:** ما زالت رحلة Dashboard تحتوي فشلين في authenticated shell وMission
  management وفشلًا في عرض `Current execution acceptance` بعد reconnect؛ يلزم عزلها
  قبل إعلان Gate A كاملًا. P4 ما زالت جزئية وEffect Loop غير منفذ.
- **next step:** عزل وإصلاح فشل رحلة Dashboard، ثم إعادة تشغيل Gate A؛ بعد نجاحها فقط
  يبدأ P5 Candidate Validation Effect Loop.

### 2026-09-24 — Cognitive Closure Architecture recalibration

- **phase/step:** Governance / P3–P14 dependency and capability semantics
- **status:** `done`
- **what changed:** إعادة توصيف P3 كـWorld State foundation لا كـclosed-loop cognition؛
  إضافة P3.5 Cognitive Action/Observation Spine، وObservation Provenance،
  Unified Action Semantics، Belief/Information Gain، Causal Credit Assignment،
  Self-Model، Transfer، وGeneralization Gates. تحولت الخطة من feature checklist
  إلى dependency plan يفرق بين contract completion وruntime cognitive integration.
- **files/schema/contracts touched:** `docs/agent-generalization-progress.md`,
  `docs/agent-generalization-execution-plan.md`; لا تغييرات runtime أو schema.
- **validation:** مراجعة اتساق ترتيب P0–P14 ومعايير Definition of Done؛
  `git diff --check` بعد اكتمال تحديث الوثائق.
- **authority/safety impact:** لا تغيير في authority؛ `Proof` و`Acceptance`
  يظلان server-owned، و`DIRECT_OBSERVATION` وحدها لا تُخلط مع derived أو inferred
  state، ولا تمنح strategy أو World State صلاحية.
- **remaining/blocker:** P3.5 وP4 وP5 وCausal Learning غير منفذة runtime؛
  وجود contracts أو replay infrastructure لا يثبت generalization.
- **next step:** تنفيذ Cognitive Action/Observation Spine قبل أي Strategy Learning
  أو live promotion.

### 2026-09-24 — Candidate Validation Effect Loop

- **phase/step:** P3.5 / P5 / Gate B — Candidate Validation vertical slice
- **status:** `done`
- **what changed:** مسار `candidate.verify` يبدأ Episode authoritative بعد امتلاك lease،
  ويبني `AgentAction` و`EffectContract` server-owned، ويسجل
  `ACTION_REQUESTED` و`ACTION_COMMITTED`. يتم التقاط before/after direct observations
  لـcandidate tree ونتيجة validation، ثم تصنيف الأثر وحفظ effect bundle قبل
  `completeAiExecution`. يمرر التنفيذ `effectRequired` و`effectBundleId` إلى
  acceptance، بينما تبقى receipt/acceptance observations مشتقة فقط.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/recipe-operation-runner.ts`,
  `artifacts/api-server/src/lib/agent-state/candidate-validation-effect.ts`,
  `artifacts/api-server/src/lib/agent-state/observation-materializer.ts`,
  `artifacts/api-server/src/lib/agent-state/effect-observer.ts`,
  `artifacts/api-server/src/lib/ai-execution-state.ts`,
  واختبارات `recipe-operation-runner` و`effect-observer`.
- **validation:** API typecheck؛ recipe runner (8)؛ effect observer وEpisode ledger (11)؛
  اختبارات Candidate Validation تتثبت من observed effect وdirect observations
  وaction events وربط acceptance؛ `git diff --check`.
- **authority/safety impact:** لا يمنح Action صلاحية بذاته؛ profile والتنفيذ وlease
  server-owned. لا يُقبل النجاح قبل effect bundle observed مربوط بنفس
  execution/attempt/episode، وmissing/stale/worker-loss لا يرفع `PROVEN`.
  World State projection مؤجلة لهذه الملاحظات إلى P6 ولا تُستخدم كسلطة قبول.
- **remaining/blocker:** لا يوجد blocker في Candidate Validation؛ P5 الأوسع ما زالت
  تحتاج Runtime/Browser/Delivery after-state observers، وP6 يحتاج ربط effect بـWorld Delta.
- **next step:** إغلاق Gate C بإضافة Runtime/Browser/Delivery after-state observers،
  مع الحفاظ على نفس AgentAction/effect/acceptance seam.

### 2026-09-24 — Gate C After-State Observers

- **phase/step:** P3.5 / P5 / Gate C — Runtime, Browser, Delivery
- **status:** `partial`
- **what changed:** أضيف Runtime after-state مستقل يتحقق من session/revision/worker lease،
  PID، TCP port، HTTP health، header `x-engineeringos-revision`، وmarker اختياري.
  Browser evidence أصبح يحمل source revision وprofile/session identity وartifact reference.
  GitHub delivery يعيد التحقق من remote branch parent/tree/commit والـoperation marker بعد
  الدفع، بما في ذلك idempotent recovery. Browser وDelivery recipe nodes تستخدم الآن
  `AgentAction` و`EffectContract` وbefore/after direct observations قبل terminal acceptance.
- **files/schema/contracts touched:** `workspace-runtime.ts` واختباراته،
  `browser-preview-verification.ts` و`ai-repair-validation.ts`، `github-delivery-service.ts`
  و`recipe-capabilities.ts`، `agent-state/gate-c-effect.ts` و`recipe-operation-runner.ts`.
- **validation:** API typecheck؛ 27 اختبارًا مستهدفًا لـRuntime/Browser/Delivery/recipe/effect؛
  `git diff --check`.
- **authority/safety impact:** after-state لا يعتمد على `status: running` أو receipt فقط؛
  remote/runtime identity والتحقق server-owned. كل Gate C effect يمر عبر نفس observation
  وclassification seam، ولا يمنح `AgentAction` صلاحية جديدة ولا يستبدل Proof/Acceptance.
- **remaining/blocker:** Runtime after-state API موجود لكنه لم يُربط بعد بمسار recipe/action
  كامل؛ وتبقى اختبارات recovery/lease-loss وbrowser/delivery end-to-end التي تثبت
  `effectBundleId` عبر reconnect/replay.
- **next step:** استكمال Runtime action adapter ثم إضافة اختبارات Gate C المتكاملة لمسارات
  success، stale lease، reconnect، remote drift، وidempotent delivery.

### 2026-09-24 — Runtime Recipe Effect Integration

- **phase/step:** P5 / PR 6 / Gate C — Runtime
- **status:** `partial`
- **what changed:** أضيفت وصفة server-owned باسم `runtime.start`، وقدرة لا تقبل مدخلات
  تحكم من النموذج، ومشغّل يطلب بدء preview ثم يستدعي `observeAfterState` قبل إرجاع
  الدليل. تم توصيلها بمسار الوصفات المباشر وMission، وربطها بـEpisode وAgentAction
  وملاحظات before/after وتصنيف الأثر الحالي قبل acceptance. التشغيل من API المباشر
  يتطلب write access. اختبار recipe متكامل يثبت حفظ effect bundle وربطه بقبول
  التنفيذ بعد تحقق after-state. الدليل المحفوظ يقتصر على خصائص after-state اللازمة
  ولا يحتفظ بنص استجابة HTTP.
- **files/schema/contracts touched:** `recipe-capabilities.ts`,
  `recipe-definition-registry.ts`, `recipe-contract.ts`,
  `recipe-operation-runner.ts`, `gate-c-effect.ts`, ومسارات recipe وMission واختباراتها.
- **validation:** API وai-orchestrator typecheck؛ 20 اختبارًا مستهدفًا في ai-orchestrator
  و20 في API؛ `git diff --check`.
- **authority/safety impact:** الـruntime root/revision/profile ثابتة server-owned؛ يتطلب
  الأثر session وrevision وworker lease وPID/port/HTTP/serving revision، ويفشل مغلقًا عند
  فقد lease أو اختلاف الهوية. لا يحل receipt أو `status: running` محل after-state أو
  acceptance.
- **remaining/blocker:** اختبارات recovery/lease loss/revision/reconnect للـRuntime موجودة،
  لكن ما زالت اختبارات Gate C المتكاملة مطلوبة لإثبات effect bundle بعد reconnect/replay
  لـBrowser وDelivery، بما فيها remote drift وidempotent delivery.
- **next step:** استكمال اختبارات Gate C المتكاملة لـBrowser/Delivery وإثبات ربط effect
  bundle بالـacceptance بعد reconnect/replay.

### 2026-09-24 — Gate C Browser and Delivery Replay Proof

- **phase/step:** P5 / PR 6 / Gate C — Browser, Delivery
- **status:** `complete`
- **what changed:** أكملت اختبارات recipe المتكاملة لـBrowser وGitHub Delivery: لكل منهما
  `AgentAction` وملاحظتا before/after، effect bundle بحالة `OBSERVED`، وربط bundle نفسه
  بصف acceptance. إعادة تنفيذ الطلب بمفتاح idempotency نفسه تعيد النتيجة المحفوظة ولا
  تعيد تشغيل browser أو delivery runner. صار browser runner يتلقى operation ID الدائم
  وsource revision، ويرفض غيابهما. أضيف اختبار drift يرفض remote tree المخالف دون إنشاء
  إيصال push إضافي؛ ويغطي اختبار الاستعادة الموجود idempotent reconciliation بعد فقد receipt.
  طُبّع فحص recipe binding ليقارن هوية الربط دون phase/lease المتغيرة، مع بقاء تحقق الهوية.
- **files/schema/contracts touched:** `recipe-capabilities.ts`,
  `ai-execution-state.ts`, `recipe-operation-runner.test.ts`,
  `recipe-capabilities.test.ts`, `github-delivery-service.test.ts`.
- **validation:** API وai-orchestrator typecheck؛ 39 اختبارًا مستهدفًا عبر 7 ملفات API؛
  21 اختبارًا مستهدفًا في ai-orchestrator؛ `git diff --check`.
- **authority/safety impact:** مراجع browser مرتبطة بهوية operation/revision server-owned.
  آثار Browser وDelivery لا تُقبل من receipt وحده؛ يلزم after-observation مباشرة وربط
  effect bundle بالـacceptance. اختلاف remote state يفشل مغلقًا، وإعادة التشغيل لا تكرر
  mutation مكتملة.
- **remaining/blocker:** لا عائق معروف ضمن PR 6 / Gate C؛ بقية مراحل خطة تعميم الوكيل
  تستمر وفق ترتيبها في execution plan.
- **next step:** متابعة PR 7 — Failure Diagnosis.

### 2026-09-24 — PR 7 Failure Diagnosis

- **phase/step:** P5 / PR 7 — Failure Diagnosis
- **status:** `complete`
- **what changed:** أضيف `diagnoseFailure` الحتمي من إشارات server-owned في validator
  receipt وeffect classification وacceptance projection. التصنيف يختار failure kind
  بأولوية ثابتة، ويصدر reason/next-action codes مقيدة بقوائم allowlist، مع معرفي episode
  وaction اختياريين. لا يقرأ نصوص provider أو تفاصيل الأخطاء، ولا يخترع diagnosis عند
  غياب إشارة فشل معروفة. أُبقيت الحقول الجديدة اختيارية في schema v1 حتى تظل البيانات
  السابقة قابلة للقراءة.
- **files/schema/contracts touched:** `agent-state/failure-contract.ts`,
  `agent-state/failure-diagnosis.ts`, `agent-state/index.ts`,
  `agent-failure-contract.test.ts`.
- **validation:** ai-orchestrator typecheck؛ API typecheck؛ اختبارات التصنيف
  `agent-failure-contract.test.ts` (6/6). شغّلنا كامل حزمة ai-orchestrator أيضًا:
  149 من 151 ملف اختبار نجحت (2266 من 2268 اختبارًا). فشلا الاختبارين أعادا النتيجة
  نفسها عند التشغيل المنفرد: اختبارا تغطية evidence في forensic integration يتوقعان
  `EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED` و`PARTIAL` لكن المسار الحالي ينتج رفض excerpt
  و`NONE`. هذان خارج مسار diagnosis؛ لم يتغير سلوك evidence هنا.
- **authority/safety impact:** لا يحدد provider failure kind أو action. الدليل والقبول
  يسبقان إشارات validator العامة عند التعارض، وdirect effect contradiction يأخذ أولوية
  أعلى من failure نصي أو generic acceptance. projection العام يخرج الأكواد والعدادات
  فقط ولا يعرض قوائم facts أو نصوصًا خامًا.
- **remaining/blocker:** PR 7 مكتمل ضمن نطاق التصنيف. يبقى فشلا اختباري forensic
  integration المذكوران لإصلاح منفصل قبل اعتبار حزمة ai-orchestrator كاملة خضراء.
- **next step:** PR 8 — Bounded Replan، وربط diagnosis بـ`objective-replanning` و
  `mission-auto-replan` مع منع إعادة الخطة نفسها وحدود المحاولات الحالية.

### 2026-09-24 — PR 8 Bounded Replan

- **phase/step:** P5 / PR 8 — Bounded Replan
- **status:** `complete`
- **what changed:** objective recovery gates its existing two-attempt, read-only loop
  on a validated retryable `MISSING_REQUIRED_READ` or `EVIDENCE_INCOMPLETE` diagnosis.
  Goal acceptance now persists a strict diagnosis summary containing only kind, reason
  code, next-action code, retryability, and approval requirement. Automatic Mission
  replanning passes the validated summary into the fresh plan context; malformed
  summaries, approval-required failures, and non-retryable failures block dispatch.
  The generated planner prompt marks diagnosis as advisory, not authorization.
- **files/schema/contracts touched:** `agent-state/failure-contract.ts`,
  `agent-state/failure-diagnosis.ts`, `objective-replanning.ts`,
  `agents/chat-agent.ts`, `mission-planning.ts`,
  `mission-acceptance-projection.ts`, `mission-auto-replan.ts`,
  `routes/ai/missions.ts`, and their focused tests.
- **validation:** ai-orchestrator typecheck and 22 targeted tests passed, including
  objective chat recovery; API typecheck and 6 acceptance/auto-replan tests passed;
  API workflow restarted and `/api/healthz` returned `status: ok`; `git diff --check`
  passed. The full ai-orchestrator suite was not rerun after PR 8; its last full run
  had the two forensic evidence-integration failures recorded under PR 7.
- **authority/safety impact:** diagnosis is derived from server-owned acceptance or
  evidence coverage. Planner output cannot set it. The objective read loop remains
  read-only and capped at two targets. Mission automation retains its existing
  revision check and replan budget; diagnosis never supplies scope or write approval.
- **remaining/blocker:** PR 8 complete. PR 7's two forensic evidence integration
  failures remain separate outstanding test issues.
- **next step:** PR 9 — Strategy Candidates and Replay; preserve current candidate
  isolation, pairing, and Canonical Proof requirements.

### 2026-09-24 — PR 9 Strategy Candidate Extraction (partial)

- **phase/step:** P10 / PR 9 — Strategy Candidates and Replay
- **status:** `partial`
- **what changed:** Added deterministic, idempotent extraction and storage for the
  bounded single-action traces currently emitted by authoritative recipe episodes.
  Extraction requires a closed `achieved` episode, a contiguous identity-bound
  event stream, a completed execution, a matching successful acceptance whose
  Canonical Proof recomputes to `PROVEN`, and a matching observed effect bundle
  backed by complete, fresh, direct before/after observations at the episode
  revision. Successful proof-bearing effect episodes now close atomically with
  acceptance; recipe execution then attempts extraction as a best-effort sidecar.
  New `ACTION_REQUESTED` events retain a versioned, hashed server-owned action
  contract: recipe trigger, preconditions, expected effects, observation profile,
  and failure semantics. Extraction checks event actor and episode-scope identity.
- **candidate boundary:** Stored candidates remain `discovered`, have confidence
  `0`, and are not read by planner or runtime policy. Legacy action events without
  the versioned contract remain ineligible; extraction does not infer triggers
  or preconditions from provider prose or receipts. Candidate identity is project-
  and revision-bound, and retries merge supporting episode IDs idempotently.
- **validation:** API server typecheck and `git diff --check` passed. The focused
  recipe-operation, effect-observer, acceptance, and Gate C suites passed (34
  tests), including accepted runtime-effect extraction and idempotent extraction
  retry. The managed API workflow restarted successfully and `/api/healthz`
  returned `ok`.
  The API workflow restarted successfully and reported the server listening.
- **authority/safety impact:** Strategy candidates are data only. No planner
  behavior, skill registry state, authorization, or promotion path changes.
  Failed proof, incomplete/stale observation, mismatched event/effect identity,
  and unsupported multi-action traces produce no candidate.
- **remaining/blocker:** Strategy-specific current-corpus execution, held-out
  execution, transfer fixtures, paired-run generation, and durable Learning
  Delta receipts are not implemented. PR 9 remains partial and no
  generalization claim is made.
- **replay analysis boundary:** Added a diagnostic-only strategy replay analyzer.
  It recomputes each paired comparison from retained baseline/candidate runs,
  checks candidate and revision binding, manifest hashes, disjoint current and
  held-out cases, source-episode separation, and the documented held-out,
  transfer, Learning Delta, and calibration thresholds. It never changes a
  candidate status and is not wired to planning, runtime policy, or promotion.
- **validation:** Strategy replay analyzer unit tests use synthetic in-memory
  paired runs only; they do not count as independent replay evidence or as
  production corpus coverage.
- **remaining/blocker:** The 34-case Code Agent suite is not a strategy-specific
  corpus registry, and there is no strategy action executor, case-level accepted
  proof binding, durable replay receipt, or three-project transfer set. A
  diagnostic report cannot close these gaps. PR 9 remains partial and no
  candidate can advance on this analysis alone.
- **next step:** Add a server-owned strategy corpus and executor, bind every
  replay case to its accepted evidence/proof, persist its receipt under the
  candidate revision, then use the existing paired-baseline and promotion
  policies for status transitions.

### 2026-09-24 — Strategy Replay Admission Threshold (partial)

- **phase/step:** P10 / PR 9 — minimum evidence before replay admission
- **status:** `partial`
- **what changed:** Candidate support remains project- and source-revision-bound.
  After two distinct accepted supporting episodes are merged, a `discovered`
  candidate transitions atomically to `pending_replay`. One support episode
  remains `discovered`; duplicate episode IDs do not satisfy the threshold.
  Candidate grouping uses stable action/effect predicates rather than raw
  observed subject IDs, which can be unique to a runtime instance; every
  supporting episode still retains its own complete, fresh, proof-bound effects.
  Lifecycle status is no longer treated as immutable strategy content, so
  retries remain idempotent after admission. New support cannot mutate a
  candidate after it enters `pending_replay`.
- **authority/safety impact:** `pending_replay` is not replay acceptance,
  `replay_passed`, canary, or promotion. Candidates remain unused by planner and
  runtime policy. No controlled-experiment admission exists yet.
- **validation:** Added unit coverage for the two-distinct-support rule and
  preserved lifecycle states; the existing recipe-runner integration assertion
  continues to cover one-support `discovered` candidates.
- **remaining/blocker:** No strategy replay worker consumes `pending_replay`
  candidates yet. Current/held-out corpora, three independent transfer fixtures,
  proof-bound case receipts, and durable Learning Delta remain unimplemented.

### 2026-09-24 — Replay Case Proof-Binding Contract (partial)

- **phase/step:** P10 / PR 9 — case-level evidence identity
- **status:** `partial`
- **what changed:** Strategy replay manifest policy v2 requires one proof binding
  per paired case. Each binding carries the case, project/revision, source
  episode, execution attempt, acceptance, observed effect bundle, and
  **source** Canonical Proof digest. The analyzer checks that the binding set exactly
  matches baseline and candidate case IDs, rejects duplicate or mismatched
  source identities, and includes proof bindings in the manifest hash.
- **files/schema/contracts touched:** `lib/ai-orchestrator/src/agent-state/strategy-replay.ts`,
  `lib/ai-orchestrator/src/agent-state/index.ts`, and
  `lib/ai-orchestrator/src/agent-state/strategy-replay.test.ts`.
- **validation:** Strategy replay contract tests passed (9); orchestrator
  typecheck passed; API server typecheck passed; `git diff --check` passed.
- **authority/safety impact:** The analyzer remains diagnostic-only and cannot
  update candidate lifecycle. The source-proof digest is only a reference until
  the API server recomputes it from durable acceptance rows; replay-result proofs
  still need their own case receipts. No test fixture is treated as corpus
  evidence.
- **remaining/blocker:** The API does not yet produce or verify these bindings.
  There is no registered strategy-specific current/held-out corpus, replay
  executor, per-case receipt persistence, or Learning Delta record.
- **next step:** Add a server-owned corpus resolver that verifies each binding
  against durable Canonical Proof and effect rows, then execute only registered
  replay cases in isolated, server-owned profiles.

### 2026-09-24 — Server-Side Source Proof Binding (partial)

- **phase/step:** P10 / PR 9 — recompute case source proof
- **status:** `partial`
- **what changed:** Added an API-side materializer for a closed accepted episode.
  It locks and checks the episode, execution attempt/revision, successful
  acceptance, observed effect bundle, and complete/fresh direct observations;
  then it calls the durable Canonical Proof loader and hashes the recomputed
  proof. The case ID is generated server-side from the source identity. Incoming
  bindings are now re-derived and compared with the stored proof/effect identity;
  a supplied digest alone cannot pass verification.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/agent-state/strategy-replay-case-proof.ts` and
  `artifacts/api-server/src/lib/recipe-operation-runner.test.ts`.
- **validation:** The focused accepted-Runtime integration test passed (1 test;
  11 unrelated tests skipped); API typecheck and `git diff --check` passed.
  The managed API workflow restarted cleanly and `/api/healthz` returned `ok`.
  An earlier restart attempt hit `EADDRINUSE`; after verifying the active
  listener, the managed restart replaced it successfully.
- **authority/safety impact:** The source-proof digest is now recomputed from
  durable rows rather than accepted from a caller, and a manifest binding is
  compared against that recomputation. This helper does not register a case,
  establish its held-out partition, execute a candidate, persist a replay
  receipt, or change candidate lifecycle.
- **remaining/blocker:** No strategy-specific corpus registry or executor exists.
  The test uses an accepted runtime fixture and is not corpus evidence; replay
  result proofs and per-case receipts remain unimplemented.
- **next step:** Resolve only server-registered case manifests, enforce partition
  and support-episode separation there, and bind each candidate replay result to
  its own durable proof and receipt before calculating paired metrics.

### 2026-09-24 — Prospective Strategy Replay Case Registration (partial)

- **phase/step:** P10 / PR 9 — opt-in prospective corpus admission
- **status:** `partial`
- **what changed:** Added a project-owner setting for future Strategy Replay
  case registration, disabled by default. Only a later accepted recipe episode
  that matches one frozen `pending_replay` candidate can be registered. Matching
  reuses the accepted-action parser and strategy-key calculation, verifies the
  full accepted effect bundle and recomputes its source Canonical Proof binding.
  Every supporting episode remains excluded. Turning consent off stops future
  registration and removes all registered cases, which are currently
  unreplayed.
- **files/schema/contracts touched:** Project schema and PATCH contract,
  application schema gate, `ai_strategy_replay_cases`, Project Detail settings,
  and recipe-operation registration.
- **authority/safety impact:** Case capsules retain only project/candidate/
  episode/execution identities and hashes, including the action-contract and
  recomputed source-proof hashes. Prompts, chat text, source contents, and
  arbitrary episode prose are not stored. Registration does not run replay,
  change candidate status, or affect planner/runtime behavior.
- **validation:** API and dashboard typechecks passed. The full
  `recipe-operation-runner.test.ts` suite passed (12 tests), and the project
  consent route test passed. The broader `projects.test.ts` run passed 35/36;
  its unrelated graph-scan test exceeded its existing 5-second wait under suite
  load, then passed when run alone. `git diff --check` passed.
- **remaining/blocker:** No isolated Strategy Replay executor, held-out
  partition resolver, replay-result Canonical Proof, durable case receipt,
  paired baseline generation, transfer fixtures, or Learning Delta exists.
  Registered cases are not replay evidence and PR 9 remains partial.
- **next step:** Implement an isolated, server-owned replay executor that
  consumes only registered cases and produces a separate accepted proof and
  durable receipt for each replay run.

### 2026-09-24 — Registered Held-Out Runtime Replay Executor (partial)

- **phase/step:** PR 9 / isolated held-out replay execution
- **status:** `partial`
- **what changed:** Added a server-owned executor for registered `held_out`
  cases, currently restricted to `runtime.start`. It revalidates the source
  proof and frozen candidate, requires a clean source checkout at the recorded
  revision, runs in a disposable workspace with a separate in-memory runtime
  manager, and requires the normal execution acceptance plus a distinct
  replay Canonical Proof. A durable hash/identity-only receipt is persisted
  per registered case and revalidated on recovery. Workspace mutation,
  source drift, and source/candidate identity mismatch fail closed.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/agent-state/strategy-replay-case-runner.ts`,
  `strategy-replay-case-proof.ts`, `strategy-replay-case-registry.ts`,
  `artifacts/api-server/src/lib/recipe-operation-runner.test.ts`, and the
  registered case/run persistence and protected route.
- **validation:** API typecheck; `recipe-operation-runner.test.ts` (12/12);
  `git diff --check`. The API workflow was restarted after the server changes
  and `/api/healthz` returned `ok`; the later test-only additions did not need
  a workflow restart.
- **authority/safety impact:** The executor cannot choose an arbitrary recipe
  or corpus case, does not use generic Mission shadow replay, and does not
  mutate candidate lifecycle or planner policy. The replay proof is distinct
  from the source proof; receipts retain identities and hashes, not prompts,
  source contents, or episode prose.
- **remaining/blocker:** This is not a current/held-out corpus or generalization
  result. Current-corpus runs, broader held-out evaluation, cross-project
  fixtures, paired baselines, and Learning Delta remain absent. The dependency
  plan still marks P9 Causal Credit Assignment as not started, so P10/P11
  evaluation must not advance as if that prerequisite were closed.
- **next step:** Implement the first server-owned P9 credit-assignment slice.
  Keep observed effects distinct from causal attribution, and leave
  unsupported dimensions unknown rather than inferring them from event order.

### 2026-09-24 — P9 Effect-Coverage Credit Sidecar (partial)

- **phase/step:** P9 / server-owned action credit evidence
- **status:** `partial`
- **what changed:** `EFFECT_CLASSIFIED` now retains a bounded credit summary.
  It scores expected-effect coverage only when the server-side before/after
  classifier resolved the comparison; missing observation coverage remains
  unknown. Causal attribution is explicitly `unproven` without a controlled
  counterfactual. Claim closure, information gain, failure contribution, and
  redundancy remain null/unknown with typed reason codes.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/agent-state/action-credit-assignment.ts`,
  `action-credit-assignment.test.ts`, `effect-observer.ts`, and
  `effect-observer.test.ts`. The existing JSONB event contract was extended;
  no database migration was needed.
- **validation:** API typecheck passed; focused action-credit and effect-observer
  tests passed (8); `git diff --check` passed. The managed API workflow restarted
  successfully and `/api/healthz` returned `status: ok`.
- **authority/safety impact:** Advisory telemetry only. It does not change
  effect classification, acceptance, Canonical Proof, planner behavior, or
  candidate lifecycle. An observed effect is never relabeled as causal.
- **remaining/blocker:** This does not close P9. The explicit dependency plan
  places P7.5 Belief and Information Gain, then P8 hypothesis-aware replanning,
  before P9 completion. The P9 dimensions beyond direct effect coverage and
  controlled causal evidence remain unimplemented.
- **next step:** Start P7.5 Belief and Information Gain. P8's existing bounded
  diagnosis handoff is partial, not a substitute for Belief State or
  information/risk/cost-aware observation selection.

### 2026-09-24 — Execution Dependency Order Correction

- **phase/step:** Governance / dependency reconciliation
- **status:** `partial`
- **what changed:** Rechecked the ordered dependency graph after the P9 sidecar.
  The immediately preceding note naming P7.5 as the next step omitted earlier
  unfinished phases. P3.5, P4, and P5 are still partial; P6 and later work
  cannot be treated as the next phase until those earlier gaps are closed.
  The P9 event data remains advisory preparation only and does not unblock
  PR 9 corpus evaluation, P10 strategy learning, or promotion.
- **files/schema/contracts touched:** `docs/agent-generalization-progress.md`,
  `docs/agent-generalization-execution-plan.md`; no runtime or schema change.
- **validation:** Reconciled the progress matrix and execution order with
  sections 31, 40, and 42.2–42.10; `git diff --check` is required after this
  documentation correction.
- **authority/safety impact:** No runtime authority changed. The replay runner,
  effect-credit event, acceptance, and candidate lifecycle remain as described
  in their bounded scopes.
- **remaining/blocker:** P3.5/P4/P5 gaps remain; replay infrastructure is not
  corpus validation and P9 remains partial.
- **next step:** Resume at the earliest open dependency: close the remaining
  P3.5 action/effect spine, then complete P4 and P5 before beginning P6's
  World Delta / Revision Closure work.

### 2026-09-24 — Direct Runtime Start Action Spine

- **phase/step:** P3.5 / P5 — direct Runtime start route
- **status:** `partial`
- **what changed:** Routed `POST /projects/:projectId/runtime/start` through the
  registered `runtime.start` recipe runner, using a canonical project root,
  durable execution and Episode ownership, server-owned action/effect contracts,
  direct before/after observations, and acceptance linked to the observed effect
  bundle. A supplied `Idempotency-Key` maps to a stable operation identity;
  the existing runtime snapshot response is preserved with execution and receipt
  metadata added. Unavailable after-state remains blocked. The combined runner
  test also exposed and fixed the persisted `EFFECT_CLASSIFIED` hash projection:
  new credit sidecars are now hash-bound, while legacy event hashes remain valid.
- **files/schema/contracts touched:** `artifacts/api-server/src/routes/runtime.ts`,
  `artifacts/api-server/src/routes/runtime.test.ts`,
  `artifacts/api-server/src/lib/agent-state/strategy-candidate-extractor.ts`;
  no schema migration.
- **validation:** API typecheck; `runtime.test.ts` and
  `recipe-operation-runner.test.ts` passed (14 tests); `git diff --check`;
  API workflow restarted and `/api/healthz` returned `status: ok`.
- **authority/safety impact:** The route still requires project write access;
  runtime profile, root, revision, execution, observations, and acceptance remain
  server-owned. Same-key retries do not start a second runtime operation.
  Generic Mission shadow replay and the registered strategy replay scope were
  unchanged.
- **remaining/blocker:** P3.5/P5 remain partial. Direct Runtime restart/stop,
  AI `apply-changes`, and Task execution do not yet use this authoritative spine;
  P4 observation/world integration remains incomplete.
- **next step:** Specify distinct server-owned action profiles for Runtime
  restart/stop before adapting those routes; do not label them as `runtime.start`.
  Continue the P3.5/P4/P5 gates before P6 or broader replay evaluation.

### 2026-09-24 — Direct Runtime Restart and Stop Action Spine

- **phase/step:** P3.5 / P5 — direct Runtime restart and stop routes
- **status:** `partial`
- **what changed:** أضيفت وصفات وقدرات server-owned منفصلة باسم
  `runtime.restart` و`runtime.stop`، مع effect/action identities مستقلة مع إبقاء
  هوية `runtime.start` السابقة كما هي. يمر المساران الآن عبر execution وEpisode
  وbefore/after direct observations وeffect bundle وacceptance مرتبط به. Restart
  لا ينجح إلا بعد ملاحظة serving state للمراجعة والجلسة الجديدة. Stop يشترط
  session فعالة ومطابقة للمراجعة وPID/port معروفين، ويتحقق مباشرة من حياة PID
  واستماع المنفذ قبل الإشارة؛ بعد الإيقاف يفحص المراقب حالة terminal والـownership
  المحرر، ثم يثبت موت PID السابق وإغلاق المنفذ. إعادة الطلب بالمفتاح نفسه لا تكرر
  الأثر، ولا تُحقن القدرات الجديدة في مسارات AI recipe أو Mission.
- **files/schema/contracts touched:** `lib/ai-orchestrator/src/recipe-capabilities.ts`,
  `lib/ai-orchestrator/src/recipe-definition-registry.ts`,
  `artifacts/api-server/src/lib/recipe-operation-runner.ts`,
  `artifacts/api-server/src/lib/workspace-runtime.ts`,
  `artifacts/api-server/src/lib/agent-state/gate-c-effect.ts`,
  `artifacts/api-server/src/routes/runtime.ts` والاختبارات المرتبطة؛ لا migration.
- **validation:** API typecheck؛ 26 اختبار API مستهدفًا و15 اختبارًا لـ
  ai-orchestrator؛ `git diff --check`. أُعيد تشغيل API بعد التغييرات النهائية
  والتحقق من `/api/healthz`.
- **authority/safety impact:** لا يثبت stop من snapshot أو `pid=null` وحده؛
  الملاحظة تحمل هوية PID/port قبل الإيقاف وتتحقق من توفرهما قبله وإغلاقهما بعده.
  فشل الملاحظة أو stale identity يمنع `SUCCEEDED` acceptance. ظل replay المسجل محصورًا في
  `runtime.start` ولم يتغير generic Mission shadow replay.
- **remaining/blocker:** P3.5/P4/P5 تبقى جزئية. AI `apply-changes` وTask
  execution خارج action/effect spine؛ وتبقى ملاحظات البيئة/العالم، والتعافي
  الأوسع، واختبارات lease/reconnect.
- **next step:** تحديد مسار AI `apply-changes` وTask execution والعقود
  server-owned المطلوبة لإدخالهما في spine دون توسيع replay أو صلاحيات mutation؛
  ثم استكمال P4/P5 قبل P6.

### 2026-09-24 — تحديد عقود مسارات التعديل المتبقية

- **phase/step:** P3.5 / P5 — حصر نقاط دمج `apply-changes` وTask execution
- **status:** `done`
- **what changed:** حُدد مسار `apply-changes` في `applyChangesHandler`: الموافقة
  الحالية، exact-subset، مرشح delivery المعزول، preflight والتحقق السلوكي،
  مقارنة hashes، promotion المحمي، journal وrollback تبقى بواباتها الحالية.
  مسار apply لا يسجل حاليًا Episode/AgentAction أو direct before/after
  observations أو effect bundle مربوطًا بقبول durable. كما فُصل Task execution
  read-only والتحقق/التقرير عن Mission tool-loop الذي قد يعدل workspace؛
  يلزم action/effect proof للأفعال المعدّلة فقط، لا لكل تقرير أو تحقق.
- **files/schema/contracts touched:** `docs/agent-generalization-progress.md`,
  `docs/agent-generalization-execution-plan.md`,
  `.agents/memory/task-execution-lifecycle.md`; لا تغيير schema أو runtime.
- **validation:** مراجعة مسارات الملفات والحدود القائمة في `applyChangesHandler`,
  `/tasks/:taskId/execute` و`executeTaskLifecycle`؛ `git diff --check`.
- **authority/safety impact:** تبقى موافقة المستخدم، proposal journal، سلامة
  المرشح، validation والـrollback الحالية هي صاحبة سلطة الكتابة. فصل التقرير
  والتحقق read-only يمنع اعتبارهما mutation أو اختلاق أثر؛ لا صلاحية جديدة
  لـMission أو replay.
- **remaining/blocker:** لا يوجد مسار تعديل جديد موصول بـEpisode/Action/effect
  acceptance بعد. يلزم بدء هوية تنفيذ/محاولة apply durable، التقاط ملاحظة مباشرة
  قبل promotion وبعده، وربطها بالأثر والقبول مع إعادة استخدام recovery journal.
  ثم يطبق العقد نفسه على عمليات Mission tool-loop المعدّلة دون تعميمه على
  Task outputs غير المعدّلة.
- **next step:** تنفيذ `apply-changes` كأول مسار تعديل مباشر ضمن spine: هوية
  attempt وEpisode/Action server-owned، ملاحظات live-root قبل/بعد، effect
  classification وacceptance قبل نجاح العملية؛ ثم استكمال Mission tool-loop.

### 2026-09-24 — Apply Changes Action/Effect Integration

- **phase/step:** P3.5 / P5 — direct approved source promotion
- **status:** `partial`
- **what changed:** أضيف عقد مستقل server-owned لـapproved source promotion.
  بعد بوابات الموافقة وexact-subset والمرشح المعزول والتحقق وdrift، ينشئ
  endpoint تنفيذًا ومحاولة جديدين وEpisode `APPLY_CHANGES`، ويسجل
  `ACTION_REQUESTED` ثم direct before observation لـlive tree hash. بعد promotion
  أو rollback يعيد قراءة root، يسجل direct after observation و`ACTION_COMMITTED`،
  ويصنف effect bundle. لا يعيد المسار 200 أو `SUCCEEDED` إلا مع تطابق candidate
  tree hash، effect `OBSERVED`، وقبول durable مربوط بنفس effect bundle.
- **files/schema/contracts touched:** `artifacts/api-server/src/routes/ai/chat.ts`,
  `artifacts/api-server/src/routes/ai.test.ts`,
  `artifacts/api-server/src/lib/agent-state/apply-change-effect.ts` واختباره،
  `docs/agent-generalization-execution-plan.md`؛ لا schema migration ولا توسيع
  صلاحيات الكتابة.
- **validation:** API/workspace typecheck؛ 20 اختبار route مستهدفًا و1 builder test؛
  `git diff --check`؛ أعيد تشغيل API و`/api/healthz` رجع `200` بحالة `ok`.
- **authority/safety impact:** بقيت موافقة proposal وexact-subset والـcandidate
  validation والـjournal والـrollback هي حدود الكتابة. `operationId` يظل correlation؛
  الإثبات مربوط بـexecution/attempt/worker. journal والـreceipt والـproposal status
  ليست observations مباشرة، ويبقى lifecycle غير قابل لـGit commit حتى ينجح
  effect acceptance.
- **remaining/blocker:** promotion على filesystem وjournal/proposal transaction
  وacceptance ليست ذرية. إذا وقع crash بعد promotion وقبل قبول التنفيذ، يفشل
  المسار مغلقًا ولا يستنتج النجاح، لكن يلزم reconciliation/recovery دائم لهذه
  النافذة. Mission tool-loop المعدّل لم يدخل spine بعد.
- **next step:** إغلاق نافذة crash recovery/reconciliation لـapply-changes دون
  قبول نجاح غير مثبت، ثم تطبيق العقد على مسارات Mission tool-loop التي تعدل
  workspace فقط؛ التقارير والتحقق read-only تبقى خارج effect gate.

### 2026-09-24 — Fail-closed apply-changes restart reconciliation

- **phase/step:** P3.5 / P5 — recovery لـAI `apply-changes`
- **status:** `partial`
- **what changed:** أضيفت reconciliation تقرأ live tree وmanaged candidate وتطابقهما مع proposal وattempt. تفك lifecycle المحجوب فقط إذا كان execution نفسه يحمل acceptance ناجحًا، وeffect bundle مقبولًا، وملاحظات before/after مباشرة، وحدث apply المطابق. تعذر الإثبات يسجل `BLOCKED` أو `RECOVERY_REQUIRED` دون كتابة أو rollback. Startup reconciliation الآن ترتب execution ثم apply ثم legacy delivery، وتحمي proposal proof-bound من legacy promotion replay.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/apply-change-reconciliation.ts`,
  `artifacts/api-server/src/lib/job-reconciliation.ts`,
  `artifacts/api-server/src/routes/ai.test.ts`,
  `artifacts/api-server/src/lib/apply-change-reconciliation.test.ts`,
  `docs/agent-generalization-progress.md`,
  `docs/agent-generalization-execution-plan.md`; لا schema migration.
- **validation:** `pnpm run typecheck`؛ الاختبارات المركزة نجحت (7 اختبارات)؛
  `git diff --check`؛ أُعيد تشغيل API، و`/api/healthz` رجع HTTP 200 بحالة `ok`،
  وسجّل workflow بدء الاستماع دون خطأ تشغيل.
- **authority/safety impact:** proposal status والـjournal وحدهما ليسا proof. لا تتبنى reconciliation filesystem changes، ولا تستنتج نجاحًا من وجود candidate tree؛ يلزم تطابق acceptance/effect/observations/event لنفس execution وattempt.
- **remaining/blocker:** apply غير المقبول أو ذي الحالة المختلطة يبقى محجوبًا ويتطلب recovery صريحًا؛ لا takeover لمحاولة قديمة. Mission tool-loop mutations لم تدخل Action/Effect spine بعد.
- **next step:** تطبيق Action/Effect contracts على Mission tool-loop mutations فقط؛ أبقِ التقارير والتحقق read-only خارج effect gate.

### 2026-09-25 — Mission Repair Action/Effect Gate

- **phase/step:** P3.5 / P5 — Mission `mission_repair` candidate verification
- **status:** `done`
- **what changed:** رُبطت تغييرات Mission repair المعتمدة بـserver-owned `AgentAction` يثبت Mission/Goal/task/execution/attempt/revisions وهوية candidate والـbase tree hash والمسارات المعتمدة. يقرأ الخادم live tree مباشرة، ويضع candidate في workspace تحقق مؤقت، ثم يقرأ candidate tree بعد التحقق ويصنف الأثر قبل acceptance. نجاح Mission repair يتطلب validator objective ناجحًا وeffect bundle `OBSERVED` مربوطًا بالقبول.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/task-execution-service.ts`, `artifacts/api-server/src/lib/agent-state/mission-repair-effect.ts`, `artifacts/api-server/src/lib/task-execution-lifecycle.integration.test.ts`, `artifacts/api-server/src/lib/agent-state/mission-repair-effect.test.ts`; لا schema migration.
- **validation:** `cd artifacts/api-server && pnpm run typecheck`; `cd artifacts/api-server && pnpm exec vitest run src/lib/agent-state/mission-repair-effect.test.ts src/lib/task-execution-lifecycle.integration.test.ts` (8 tests passed); `git diff --check`; أُعيد تشغيل API workflow وظهر `Server listening`.
- **authority/safety impact:** يظل نطاق الكتابة والموافقة والـcandidate والـrevision server-owned؛ لا تُكتب bytes إلى live root. `mission_observe` و`mission_validate` لا ينشئان Action/Effect، والـprovider patch لا يحول validation إلى repair. لا يمنح acceptance أو validator receipt وحدهما effect proof.
- **remaining/blocker:** bytes المرشح لا تبقى متاحة للمراجعة بعد تنظيف workspace. P4 ما زال يفتقد task/environment scope في facts وworld revision؛ تبقى P3.5/P5 جزئيتين.
- **next step:** P4 read-only scope closure: تمرير task/environment scope من Episode/Observation إلى facts، وربط world revision بالمراجعة والحقائق ذات الصلة وتسلسل الملاحظات؛ بلا تغيير في acceptance أو صلاحيات التنفيذ.

### 2026-09-25 — P4 Scoped World State Revision

- **phase/step:** P4 — task/environment-scoped observation-to-fact projection
- **status:** `done`
- **what changed:** أضيف `taskScope` مشتق من Episode server-owned، مع `environmentRevisionKey` ثابت للتمييز الآمن بين revision المعروفة والـunknown. أصبح dedupe وتجميع facts وversion/contradiction isolation ضمن task scope والبيئة نفسيهما. يربط `worldRevision` نطاق القراءة، project/environment revisions، هويات وإصدارات facts، وآخر `(episodeId, sequence)` لكل Episode؛ يدعم reader داخليًا filters اختيارية مع بقاء القراءة غير المفلترة متوافقة.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/agent-state/observation-materializer.ts`, `artifacts/api-server/src/lib/agent-state/world-state.ts`, `artifacts/api-server/src/lib/agent-state/world-state.test.ts`, `lib/db/src/schema/ai_agent_observations.ts`, `lib/db/src/schema/ai_world_facts.ts`, `lib/db/src/application-schema-check.ts`, `lib/db/src/application-schema-check.test.ts`; أضيفت أعمدة وفهارس additive دون تغيير أنواع الأعمدة القائمة.
- **validation:** `pnpm --filter @workspace/db run schema:apply` و`schema:check` نجحا؛ `pnpm --filter @workspace/db run test` (18 passed)؛ `pnpm --filter @workspace/api-server run typecheck`؛ اختبارات API المستهدفة (3 ملفات، 48 passed)؛ `git diff --check`؛ أُعيد تشغيل API و`/api/healthz` رجع `200` و`status: ok`. المحاولة الأولى لاختبار revision توقعت fact واحدًا بينما غيّر fixture subject؛ صُحح fixture ليحافظ على subject/value، ثم نجحت المجموعة كاملة.
- **authority/safety impact:** إسقاط read-only فقط؛ scope مصدره Episode المقفول لا النموذج. legacy facts تبقى project-scoped، والـscope المفقود الجديد يعزل على مستوى Episode. لا تغيير في acceptance أو planner أو صلاحيات Mission أو live-root writes.
- **remaining/blocker:** endpoint العام ما زال يعيد project-wide view ولا يمرر filters؛ independent observation providers/environment freshness وWorld Delta/contradiction propagation خارج هذه الشريحة. تبقى P4 جزئية.
- **next step:** ربط filters بالـscoped read path واكمال authoritative environment observation/freshness قبل P6 World Delta؛ لا تجعل revision دليل acceptance.

### 2026-09-25 — P4 Scoped World State API

- **phase/step:** P4 — optional task/environment filters on the public read route
- **status:** `done`
- **what changed:** أضاف GET `/projects/:projectId/world-state` مرشحات `taskScope` و`environmentRevision`، مع `environmentRevisionUnbound=true` لطلب facts ذات البيئة غير المحددة دون sentinel ملتبس. القيم الفارغة/المكررة أو إرسال المرشحين البيئيين معًا تُرفض؛ الطلبات بلا filters تحتفظ بسلوكها السابق.
- **files/schema/contracts touched:** `artifacts/api-server/src/routes/projects.ts`, `artifacts/api-server/src/routes/world-state.test.ts`; لا تغييرات schema أو acceptance contract.
- **validation:** API typecheck؛ اختبارات API المستهدفة (ملفان، 9 passed)؛ `git diff --check`؛ أُعيد تشغيل API وبنى بنجاح، و`/api/healthz` رجع `200` مع `status: ok`.
- **authority/safety impact:** `requireProjectAccess` يبقى قبل parsing/reading؛ filters لا تغير حدود الملكية أو صلاحيات planner/acceptance/effect ولا تنفذ أي كتابة.
- **remaining/blocker:** مصادر environment revision المستقلة وقواعد freshness وWorld Delta/contradiction propagation ما زالت غير موصولة؛ تظل P4 جزئية.
- **next step:** تحديد/ربط مصادر server-owned للبيئة وfreshness، ثم World Delta والانتشار المقيد للتناقضات؛ لا توسّع دلالة revision إلى acceptance.

### 2026-09-25 — P4 Receipt-time Environment Observation

- **phase/step:** P4 — إعادة رصد بصمة البيئة عند materialization
- **status:** `partial`
- **what changed:** في مسارات Action/Effect التي تملك root محلولًا server-side،
  يعيد materializer حساب بصمة البيئة باستخدام profile المستخرج من Episode،
  ثم يقارنها ببصمة المحاولة وأي revision صريح في receipt. يظل المسار transient
  ولا يُخزن. إذا تعذر الرصد ولم يحمل receipt revision صريحة، تكون freshness
  `unknown`. أضيف `environmentStale` منفصلًا؛ `stale` بقي خاصًا بـ
  `projectRevision` حتى لا تتغير بوابات effect التي تعتمد عليه.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/agent-state/observation-materializer.ts`,
  `artifacts/api-server/src/lib/agent-state/world-state.test.ts`,
  `artifacts/api-server/src/lib/recipe-operation-runner.ts`,
  `artifacts/api-server/src/lib/task-execution-service.ts`,
  `artifacts/api-server/src/routes/ai/chat.ts`,
  `docs/agent-generalization-execution-plan.md`; لا schema migration.
- **validation:** API typecheck؛ 22 اختبارًا مركزًا عبر environment attestation
  وWorld State وEpisode ledger وeffect observer نجحت. في التحقق الأوسع نجح
  209 اختبارًا وفشل 9 assertions في `POST /api/ai/tasks/:taskId/execute` حول
  status mapping لأخطاء provider (أعاد المسار 500 بدل الحالات المتوقعة)، وتكرر
  ذلك عند تشغيل `ai.test.ts` منفردًا؛ لم تكن هذه الاختبارات خاصة بملاحظة البيئة.
  `git diff --check`؛ أُعيد تشغيل API و`/api/healthz` أعاد `status: ok`.
- **authority/safety impact:** environment freshness ملاحظة منفصلة؛ stale منها
  يستبعد observation من World State فقط، ولا يغير project freshness أو effect
  proof أو acceptance أو صلاحية التنفيذ.
- **remaining/blocker:** إعادة hash للـmanifests عند materialization لا تثبت
  وحدها البيئة الموروثة فعليًا عند spawn للـruntime أو validator. لا تزال
  authoritative process receipts وWorld Delta/contradiction propagation
  مطلوبة، وتبقى P4 جزئية.
- **next step:** التقاط environment identity من runtime/validator server-owned
  عند نقطة التشغيل الفعلية، وإرفاقها بـreceipt قبل World Delta؛ لا تستخدم قيم
  environment secrets أو `.env` لإنتاج هذه الهوية.

### 2026-09-25 — Durable Runtime Launch Environment Identity

- **phase/step:** P4 — حفظ هوية بيئة جلسة runtime
- **status:** `partial`
- **what changed:** يلتقط مدير runtime بصمة allowlisted بعد حجز ملكية الجلسة
  وقبل طلب supervisor أو `spawn` المباشر. تحفظ في `workspace_runtime` وتبقى مع
  الجلسة خلال recovery؛ إيصالات start/restart/stop تحمل `sessionId` والبصمة.
  أصبحت ملفات `runtime.start` و`runtime.restart` و`runtime.stop` تستخدم profile
  version 2 نفسه. إذا غابت بصمة الجلسة، تبقى Freshness للإيصال `unknown` حتى لو
  استطاع materializer قراءة البيئة الحالية.
- **files/schema/contracts touched:**
  `lib/db/src/schema/workspace_runtime.ts`,
  `lib/db/src/application-schema-check.ts`,
  `artifacts/api-server/src/lib/workspace-runtime-store.ts`,
  `artifacts/api-server/src/lib/workspace-runtime.ts`,
  `artifacts/api-server/src/lib/recipe-operation-runner.ts`,
  `artifacts/api-server/src/lib/agent-state/environment-attestation.ts`,
  `artifacts/api-server/src/lib/agent-state/observation-materializer.ts`
  والاختبارات ذات الصلة. أضيف عمود nullable additive؛ `pnpm run db:schema:apply`
  حدّث مخطط التطوير فقط واجتازت فحوصات المخطط.
- **validation:** API typecheck؛ 31 اختبارًا مركزًا في خمسة ملفات حول runtime،
  recovery، environment attestation، World State وrecipe receipts؛
  `git diff --check`.
- **authority/safety impact:** البصمة metadata رصدية ولا تدخل في hash إثبات
  effect أو قرار القبول أو صلاحية التنفيذ. لا تُقرأ قيم environment secrets أو
  `.env` أو `.npmrc`. قيمة `null` لا تتحول إلى بيئة حالية fresh.
- **remaining/blocker:** هذه بصمة server-owned عند launch handoff وليست قراءة من
  داخل child process؛ التقاط validator عند command spawn ما زال مطلوبًا، وكذلك
  World Delta وpropagation للتناقضات. تبقى P4 جزئية. ما زالت تسع assertions
  السابقة الخاصة بخرائط HTTP لأخطاء task provider غير محسومة ولا ترتبط بهذه
  الشريحة.
- **next step:** ربط بصمة validator من حد spawn الفعلي بإيصالها server-owned،
  مع إبقاء freshness خارج proof وacceptance.

### 2026-09-25 — P5.5 Canonical Action Request Events

- **phase/step:** P5.5 — توحيد عقد ACTION_REQUESTED عبر مسارات Episode
- **status:** `partial`
- **what changed:** أصبحت كتابات `ACTION_REQUESTED` الجديدة عبر Episode تتطلب
  `AgentAction` صالحًا مرتبطًا بالـEpisode، وتتحقق من تطابق aliases عند وجودها.
  يضيف ledger تلقائيًا `actionRefs` و`expectedEffectRefs` من العقد. أضيفت
  `AgentAction` كاملة إلى أحداث recipe candidate وGate C مع الحفاظ على
  `actionContract`/hash المستخدمين لاستخراج الاستراتيجية؛ ويتحقق extractor من
  تطابق الإسقاط مع الفعل. تبقى الأحداث التاريخية ذات الإسقاط المختزل قابلة
  للقراءة، وتمنع مطابقة `actionId` إعادة كتابة أحداث مكررة عند استئناف محاولة قديمة.
- **files/schema/contracts touched:**
  `lib/ai-orchestrator/src/agent-state/action-contract.ts` و`index.ts` واختبار
  العقد؛ `artifacts/api-server/src/lib/agent-state/agent-episode-ledger.ts`
  واختباره؛ `recipe-operation-runner.ts` واختباره؛
  `strategy-candidate-extractor.ts`؛ وخطة التنفيذ وسجل التقدم.
- **validation:** API typecheck؛ اختبار عقد AI: 9/9؛ اختبارات Episode ledger وrecipe:
  20/20؛ اختبارات task execution وMission: 26/26؛ API restart وhealth و
  `git diff --check` موثقة بعد التحقق النهائي.
- **authority/safety impact:** لم تتغير capability registry أو authorization أو
  approval أو scope أو acceptance. أُضيف fail-closed contract validation وربط
  المراجع؛ لم تُمنح أي صلاحية جديدة.
- **remaining/blocker:** لا تملك كل recipe node أو provider tool call حتى الآن
  سجل Action موحدًا لكل invocation؛ تبقى P5.5 جزئية ولا تمثل هذه الخطوة إغلاق
  P4/P5 أو World Delta.
- **next step:** تغطية الاستدعاءات المتبقية بعقد Action بعد التحقق server-side من
  capability manifest والصلاحية الحالية، مع إثبات حد Episode دون تغيير authority.

### 2026-09-25 — مواءمة الخطة مع التنفيذ الحالي

- **phase/step:** توثيق P3 / P3.5 / P4 / P5 / P5.5 / P6
- **status:** `done`
- **what changed:** تم تثبيت task/environment scoping وAPI filters كعمل منجز في P3؛
  بقيت الملاحظات المستقلة من المصدر الفعلي ضمن P4، وأُسند World Delta إلى P6.
  فُصلت هوية read-only invocation عن EffectBundle الخاص بالتعديل أو التحقق ذي الأثر،
  ووُضحت اختيارية Belief حتى P7.5 وبوابات canary والترقية العامة. وُسمت حزم §35–§38
  وخريطة PR كمواد تاريخية مع إبقاء سجل التنفيذ السابق.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`,
  `docs/agent-generalization-progress.md` فقط.
- **validation:** `git diff --check` ومراجعة diff النهائية؛ لا يلزم build أو restart
  لأن التغيير توثيقي فقط.
- **authority/safety impact:** لم يتغير runtime أو schema أو acceptance أو صلاحيات؛
  توضح الخطة أن قراءات read-only لا تحتاج EffectBundle افتراضيًا وأن canary ليست
  promotion عامة.
- **remaining/blocker:** فجوات P5.5 وP4 وP5 وP6 والتنفيذ المعرفي اللاحق باقية كما
  هي؛ هذا التحديث لم يغيّر نطاق التنفيذ.
- **next step:** استكمال توحيد AgentAction عبر كل invocation في P5.5، ثم إغلاق
  الملاحظة المستقلة في P4 وEffect Verification في P5 قبل World Delta في P6.

### 2026-09-25 — بوابة جاهزية الوثائق قبل تغييرات الكود

- **phase/step:** Documentation / source-of-truth and acceptance-gate consistency
- **status:** `done`
- **what changed:** أضيفت بوابة فحص تمنع الانتقال إلى تغييرات الكود قبل مراجعة
  الوثيقتين. جرى توحيد مصدر thresholds بين §25.3 و§25.4، وانتقالات النتيجة في
  §29.6، وأسماء gates في §42.17؛ ووُضحت الطبيعة التاريخية لمعياري P1/P2 وقيود
  PR الأول. صار P3.5 موصوفًا `partial` مثل جدول الحالة، ووُصف §18 كملخص schema
  مع تحديد Drizzle مرجعًا دقيقًا.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`,
  `docs/agent-generalization-progress.md` فقط.
- **validation:** `git diff --check`؛ فحصت الإحالات الداخلية بين الوثيقتين، ومصدر
  thresholds، وتسلسل Action، ومطابقة حالات المراحل الرئيسية.
- **authority/safety impact:** لم يتغير الكود أو schema أو runtime أو الصلاحيات؛
  تظل تغييرات الكود متوقفة حتى إغلاق بوابة الوثائق ومراجعتها.
- **remaining/blocker:** مراجعة المستخدم النهائية؛ تبقى تغييرات الكود خارج النطاق
  حتى ذلك الحين.
- **next step:** مراجعة الوثيقتين وفق بوابة الجاهزية أعلاه قبل السماح بأي تغيير كود.

### 2026-09-25 — تدقيق دلالات القبول وعقد invocation

- **phase/step:** Documentation / P3.5–P6 acceptance and P5.5 action semantics
- **status:** `done`
- **what changed:** فُصل القبول effect-backed الخاص بالشرائح الحالية قبل P6 عن
  إغلاق الحلقة الكاملة الذي يتطلب World Delta قبل acceptance. وُحد عقد الهوية
  والنتيجة لكل invocation، مع قصر `AgentAction` الكامل على mutation و
  effect-gated validation. وُضحت دلالة `Result` لعمليات القراءة، وأُحيل ملخص
  promotion في §7 إلى بوابات §25.3/§25.4/§42.17 وانتقالات §29.6.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`,
  `docs/agent-generalization-progress.md` فقط.
- **validation:** `git diff --check`؛ مراجعة الاتساق بين §5 و§7 و§19 و§23 و§35
  و§42 وجدول الحالة وبوابة الجاهزية؛ لم يظهر تناقض دلالي آخر في هذه المسارات.
- **authority/safety impact:** لم يتغير runtime أو schema أو acceptance أو
  الصلاحيات؛ لا تزال تغييرات الكود متوقفة حتى مراجعة المستخدم.
- **remaining/blocker:** مراجعة المستخدم للوثيقتين وإغلاق بوابة الجاهزية.
- **next step:** انتظار مراجعة المستخدم؛ لا يبدأ أي تغيير كود قبل موافقة صريحة
  على إغلاق البوابة.

### 2026-09-25 — P5.5 Read-only Recipe Invocation Pilot

- **phase/step:** P5.5 / `database.inspect.project` read-only invocation
- **status:** `partial`
- **what changed:** أضيف تسجيل ظلّي best-effort لحدثي
  `OBSERVATION_REQUESTED` و`OBSERVATION_RECORDED`. يربط الطلب Episode وexecution
  وattempt وrecipe node وcapability وscope/revision hashes؛ وتقتصر النتيجة على
  status وresult hash ومراجع evidence أو failure code. لا تتضمن أحداث Episode
  الظلية rows أو نصوص تفاصيل الفشل؛ بقيت إسقاطات التنفيذ الحالية دون تغيير.
  ولا يؤثر تعذر Episode أو كتابة الأحداث على مسار التنفيذ.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/recipe-operation-runner.ts`,
  `artifacts/api-server/src/lib/recipe-operation-runner.test.ts`,
  `artifacts/api-server/src/lib/agent-state/agent-episode-ledger.ts`,
  `docs/agent-generalization-execution-plan.md`,
  `docs/agent-generalization-progress.md`; no database schema change.
- **validation:** `pnpm run typecheck:libs` passed;
  `pnpm --filter @workspace/api-server run typecheck` passed;
  `cd artifacts/api-server && pnpm exec vitest run src/lib/recipe-operation-runner.test.ts -t 'prepares'`
  passed (2 tests); `git diff --check` passed. The DB-backed recipe tests are
  blocked during setup by development-schema drift, including missing
  `projects.strategy_replay_opt_in`. The API build succeeded, but startup's
  schema-readiness gate then failed on missing schema objects. No schema sync
  was run.
- **authority/safety impact:** Read-only advisory telemetry only. No
  authorization, mutation/effect, acceptance, or proof semantics changed.
- **remaining/blocker:** Success/failure integration tests and API restart
  require resolving the development database schema mismatch. Remaining recipe
  nodes and provider tool calls are still outside this pilot.
- **next step:** Get approval before applying the repository's development
  schema; then run the DB-backed tests and restart the API. Continue the ordered
  P3.5/P4/P5 work before starting P6.

### 2026-09-25 — P3.5/P5.5 Mission repair per-tool Action lifecycle

- **phase/step:** P3.5/P5.5 — approved `mission_repair` file-tool invocation
- **status:** `partial`
- **what changed:** يمرر tool engine callback proof-critical إلى `write_file` و
  `replace_text` فقط بعد نجاح authorization. يسجل الخادم `ACTION_REQUESTED`
  قبل staging و`ACTION_COMMITTED` بعد نجاح معروف وإضافة pending change واحدة؛
  فشل تسجيل الحدث يمنع الاستمرار ويزيل التغيير المعلق. يبدأ callback Episode
  بالهوية نفسها لمسار candidate effect، ويربط الفعل بالـMission/Goal/task/
  execution/attempt/revisions والمسار المعتمد وهوية tool call hash وinput hash.
  commit يوثق staging داخل candidate overlay فقط؛ aggregate candidate
  observations/effect تظل بوابة القبول الوحيدة.
- **files/schema/contracts touched:** tool execution engine وchat boundary،
  `ai-route-helpers.ts`، `task-execution-service.ts`، Mission repair action
  builder، اختبارات engine/action helper، وخطة التنفيذ وسجل التقدم. No database
  schema change.
- **validation:** `pnpm run typecheck:libs` و
  `pnpm --filter @workspace/api-server run typecheck` passed؛
  tool engine tests 156/156 وMission action contract tests 3/3 passed؛
  `git diff --check` passed. API build passed during the managed workflow
  restart, but API startup failed at schema readiness. DB-backed Mission
  integration tests fail before behavior because development schema lacks
  `projects.strategy_replay_opt_in` and other required schema objects. No schema
  sync was run.
- **authority/safety impact:** لا callback لأدوات القراءة أو
  `mission_observe`/`mission_validate` أو `/tasks/:taskId/execute`. لا صلاحيات أو
  generic dispatch أو live-root writes أو acceptance semantics جديدة؛ لا يوجد
  per-tool EffectBundle ولا World Delta.
- **remaining/blocker:** يلزم حل schema drift بموافقة صريحة قبل DB-backed
  integration tests أو تشغيل API بنجاح. تبقى P3.5/P5.5 جزئيتين؛ لم تبدأ P6 أو
  P7 أو P7.5.
- **next step:** عدم مزامنة schema دون موافقة؛ بعد حلّ drift، أعد تشغيل اختبارات
  Mission DB-backed وAPI workflow، ثم تابع شرائح P3.5/P4/P5 بالترتيب.

### 2026-09-25 — مزامنة مخطط التطوير والتحقق من Mission

- **phase/step:** P3.5/P5.5 — إزالة مانع التحقق DB-backed
- **status:** `done`
- **what changed:** بعد الموافقة الصريحة، طُبق مخطط Drizzle الحالي على قاعدة
  التطوير فقط باستخدام `pnpm run db:schema:apply`، دون `--force`. نجحت فحوص
  application schema وaudit outbox وoperator alerts. نجح اختبار
  `task-execution-lifecycle.integration.test.ts` بنتيجة 6/6، ثم أعيد تشغيل API
  وبدأ workflow بنجاح.
- **files/schema/contracts touched:** مخطط قاعدة التطوير فقط؛ لا ملفات schema أو
  migrations في المستودع، ولا تغييرات على production.
- **validation:** `pnpm run db:schema:apply`؛ اختبار Mission DB-backed ‏6/6؛
  API managed workflow build/start وصل إلى `RUNNING`.
- **authority/safety impact:** بقيت الصلاحيات وبوابات القبول دون تغيير. التعديل
  مقتصر على قاعدة التطوير وبموافقة المستخدم؛ production لم يُلمس.
- **remaining/blocker:** لا مانع مخطط متبقٍ لهذا المسار.
- **next step:** استكمال شريحة P5.5 الضيقة لتسجيل استدعاءات recipe المصنفة
  server-side كقراءة فقط، دون توسيع بوابات الأثر أو القبول.

### 2026-09-25 — عقد استدعاء recipe للقراءة فقط

- **phase/step:** P5.5 — server-classified read-only recipe invocation
- **status:** `partial`
- **what changed:** أصبح ربط Episode يعتمد على capability ID داخل allowlist
  server-owned بدلًا من recipe ID. تضمّن عقد `database.read_project` هوية
  execution/attempt/node، والمراجعة والنطاق، وhash للمدخلات؛ وسُجلت نتيجتا الطلب
  والاكتمال/الفشل كأحداث ملاحظة دون حفظ مدخلات أو تفاصيل النتيجة الخام. عولج
  نطاق `database.inspect.project` ليطابق نطاق `project` الذي تقبله capability.
- **files/schema/contracts touched:** `recipe-invocation-contract.ts` واختباره،
  `recipe-operation-runner.ts` واختباراته. لا تغيير schema.
- **validation:** API typecheck passed؛ recipe contract وrunner tests ‏17/17؛
  Mission DB-backed integration tests ‏6/6؛ `git diff --check` passed.
- **authority/safety impact:** allowlist الحالية لا تحتوي إلا
  `database.read_project` بعد التحقق من عقد التنفيذ والنتيجة. لم تتغير
  authorization أو generic dispatch أو Action/Effect أو acceptance؛ لا تثبت
  أحداث القراءة أثرًا أو قبولًا.
- **remaining/blocker:** لا تُضف `project.read_file` أو validators/commands إلى
  allowlist اعتمادًا على `mutatesProject: false` وحده؛ يلزم تدقيق التنفيذ وعقد
  النتيجة أولًا. تبقى حدود provider tool invocations وأجزاء P3.5/P4/P5 الأخرى.
  لم تبدأ P6 أو P7 أو P7.5.
- **next step:** تتبّع invocation قائم لأداة provider للقراءة إلى حد Episode
  server-authorized، مع إبقاء manifest والصلاحيات وبوابات القبول هي المصدر
  authoritative.

### 2026-09-25 — تسجيل قراءات provider في Mission Episode

- **phase/step:** P5.5 — provider read-tool invocation observations
- **status:** `partial`
- **what changed:** أضيف callback server-owned يمر عبر orchestrator إلى Mission
  service. يسجل `OBSERVATION_REQUESTED` بعد registry/authorization وقبل القراءة،
  ثم `OBSERVATION_RECORDED` بنتيجة محدودة. يسمح فقط بـ`read_file`,
  `read_file_range`, `list_directory`, و`search_code` في `mission_observe` و
  `mission_validate`. ترتبط الأحداث بـEpisode/execution/attempt/revision؛
  fingerprint كامل manifest مستقل عن القائمة المضيّقة، وتُحفظ hashes للمدخلات
  والنتيجة بدل المحتوى أو المسار الخام.
- **files/schema/contracts touched:** orchestrator tool loop/chat agent، API
  `chatWithFallback` وMission service، واختبارات orchestrator وMission lifecycle.
  لا تغيير schema.
- **validation:** `pnpm run typecheck` من workspace نجح؛ Vitest workspace
  ‏45 ملفًا و6,803 اختبارات نجحت؛ API Mission lifecycle ‏6/6؛
  `git diff --check` passed.
- **authority/safety impact:** فشل تسجيل الطلب يمنع القراءة، وفشل تسجيل النتيجة
  يحجب output عن النموذج. لا تُسجل أدوات الكتابة أو validator، ولا تُفعّل
  ordinary chat shadow Episodes. لم تتغير authorization أو Action/Effect أو
  acceptance؛ أحداث الملاحظة ليست إثباتًا للنتيجة أو للأثر.
- **remaining/blocker:** لا تزال التغطية محدودة بأدوات Mission الأربع؛ الدردشة
  العادية لا تحتفظ بحد Episode دائم، وتبقى أجزاء P3.5/P4/P5 الأخرى. لم تبدأ
  P6 أو P7 أو P7.5.
- **next step:** متابعة العمل التالي الموثق ضمن P3.5/P4/P5 بالترتيب، دون بدء
  P6 أو P7 أو P7.5.

### 2026-09-25 — ربط after-state المرصود في Gate C runtime

- **phase/step:** P3.5/P4/P5 — Gate C runtime after-state hardening
- **status:** `partial`
- **what changed:** صار after-state لـ`runtime.start` و`runtime.restart` و
  `runtime.stop` يُصنف من حقول `RuntimeAfterState` بعد التحقق من هوية المشروع
  والجلسة والمراجعة، وصحة العملية والمنفذ وHTTP health وserving revision وmarker.
  يتطلب stop before-state حيًا وafter-state متوقفًا مع تطابق PID والمنفذ. تُحفظ
  لقطة محدودة مباشرة، ويربط `ACTION_COMMITTED` معرفات الملاحظات؛ لا يعتمد الأثر
  على `output.status` أو وجود receipt وحدهما.
- **files/schema/contracts touched:** Gate C runtime classifier/runner، اختبارات
  runtime Gate C وrecipe runner، execution plan وprogress log. لا تغيير schema.
- **validation:** API Vitest للملفين المعنيين: 19/19؛ `pnpm run typecheck`؛
  `git diff --check`، جميعها نجحت.
- **authority/safety impact:** الحالة المفقودة أو المشوهة أو غير المطابقة تفشل
  دون direct after-observation أو قبول؛ الحالة المتناقضة الكاملة تُسجل كفشل.
  لم تتغير سلطة acceptance أو شروط Browser/Delivery، ولم يبدأ P6 أو P7 أو P7.5.
- **remaining/blocker:** الشريحة تغلق تحقق after-state في Gate C فقط؛ تبقى أجزاء
  P3.5/P4/P5 الأوسع غير مكتملة.
- **next step:** متابعة أضيق فجوة موثقة تالية في P3.5/P4/P5، دون بدء P6 أو P7
  أو P7.5.

### 2026-09-25 — ربط after-state المباشر في Gate C Browser/Delivery

- **phase/step:** P3.5/P4/P5 — Gate C Browser/Delivery after-state verification
- **status:** `partial`
- **what changed:** صار Browser يربط الرصد بـproject/operation/execution/attempt/
  source revision وsession/profile/origin/marker، وصار Delivery يعيد لقطة remote
  branch بعد التنفيذ تشمل expected/observed commit وparent وtree وعدد الآباء
  وoperation marker. قبول استعادة التسليم يتطلب commit hash مطابقًا تمامًا، لا
  tree/parent/marker فقط. ترتبط ملاحظات after المباشرة بـ`ACTION_COMMITTED`.
- **files/schema/contracts touched:** orchestrator capability context/runner،
  Browser preview evidence، Gate C classifier وrecipe runner، GitHub delivery
  service/routes، والاختبارات والخطة. لا تغيير schema أو قاعدة الإنتاج.
- **validation:** workspace `pnpm run typecheck` نجح؛ orchestrator capability
  suite ‏278 اختبارًا؛ API Gate C/runner/GitHub delivery ‏25/25؛
  `git diff --check` نجح؛ API workflow أعيد تشغيله وظهر `Server listening`.
- **authority/safety impact:** غياب أو اختلاف project/execution/attempt/revision/
  profile/origin يمنع direct observation؛ after-state الكامل المخالف يسجل كفشل.
  لا receipt أو status منفرد أو provider prose يثبت الأثر. لم تتغير authorization
  أو acceptance/Canonical Proof، ولم يبدأ P6 أو P7 أو P7.5.
- **remaining/blocker:** لا تزال أجزاء P3.5/P4/P5 الأوسع غير مكتملة؛ لا تغيير
  schema ولا تغيير production database.
- **next step:** متابعة الشريحة الموثقة التالية ضمن P3.5/P4/P5 بالترتيب، دون
  بدء P6 أو P7 أو P7.5.

### 2026-09-25 — رصد بيئة عملية runtime child الحية

- **phase/step:** P4 — live runtime child process environment observation
- **status:** `partial`
- **what changed:** صار runtime يولد marker مؤقتًا ويربطه بـproject/session/
  execution/attempt/Episode/operation/revision. يقرأ API من procfs العملية
  المباشرة ويثبت استقرار PID وcwd وexecutable وجذر المشروع، ثم يحفظ hashes
  للmarker وإسقاط البيئة الآمنة فقط. تنتقل النتيجة المربوطة إلى
  `observation-materializer` كملاحظة `DIRECT_OBSERVATION`; غير المتاح يبقى
  `unknown` والمخالف `mismatch`.
- **files/schema/contracts touched:** child process attestation helper، runtime
  manager/client/supervisor، recipe capability context/runner،
  observation materializer، اختبارات runtime وWorld State وsupervisor، والخطة.
  لا تغيير schema أو قاعدة الإنتاج.
- **validation:** API typecheck؛ API Vitest المركز 19/19؛ orchestrator
  typecheck؛ `git diff --check`؛ API وsupervisor أعيدا التشغيل وظهرا بحالة
  running؛ smoke test عبر supervisor أعاد runtime `passed` وattestation `known`.
- **authority/safety impact:** marker والبيئة الخام لا تحفظ أو تظهر للمستخدم.
  ربط digest يتحقق من execution/attempt/Episode/operation/revision/session؛
  `unknown` أو `mismatch` لا يمنح acceptance أو OBSERVED، وبصمة البيئة مستقلة
  عن freshness المشروع. لا ادعاء بأن PID `pnpm` يثبت عملية HTTP listener.
- **remaining/blocker:** P4 ما زالت جزئية؛ validator child لا يملك بعد ملاحظة
  مستقلة، وإثبات العملية التي تملك منفذ الاستماع غير محسوم. لا تغيير production
  database، ولم يبدأ P6 أو P7 أو P7.5.
- **next step:** اربط validator process بالملاحظة المستقلة، ثم احسم إثبات
  listener PID ضمن P4/P5، بالترتيب ودون بدء P6 أو P7 أو P7.5.

### 42.30 P4 — رصد عملية validator المرتبطة بهوية التنفيذ (2026-09-25)

- **phase/step:** P4 — bound validator child process environment observation
- **status:** `partial`
- **what changed:** يحقن bounded-command marker مؤقتًا ويبلغ PID/cwd بعد spawn،
  مع حجب marker من المخرجات. يرتبط procfs attestation بهوية المشروع والتنفيذ/
  المحاولة/Episode/operation/revision وValidation Evidence ID وprofile. Recipe و
  Mission Task يمرران الهوية عند توفر Episode؛ غياب binding لا ينشئ observation.
  المواد المخزنة hashes وإسقاط allowlisted فقط، والجذر المؤقت حد للعملية المعزولة
  لا project root أو provenance.
- **files/schema/contracts touched:** execution kernel وvalidation result،
  child-process attestation وrepair validation، recipe/task runners،
  observation materializer، واختبارات bounded command/validation/World State.
  لا schema migration أو تعديل قاعدة الإنتاج.
- **validation:** orchestrator وAPI typecheck؛ bounded-command ‏12/12؛ API
  validation وWorld State ‏23/23، مع اختبار runtime-oracle direct child؛ API
  workflow restart/startup؛ `git diff --check`.
- **authority/safety impact:** الرصد direct observation فقط؛ `unknown` partial و
  `mismatch` failed، ولا يغيران validation status أو proof أو acceptance/OBSERVED.
  لا تحفظ العلامة أو البيئة الخام ولا تمنح المؤشرات سلطة قبول.
- **remaining/blocker:** رصد `pnpm` المباشر لا يثبت descendants أو HTTP listener؛
  المسارات دون Episode binding تبقى غير مرصودة. لا تغيير production database،
  ولم يبدأ P6 أو P7 أو P7.5.
- **next step:** حدّد listener PID من boundary server-owned مستقل ومربوط بالـ
  execution/session/revision قبل أي ادعاء عن بيئة الخدمة؛ استمر ضمن P4/P5 فقط.

### 42.31 P4/P5 — إثبات مالك منفذ runtime وربطه بـGate C (2026-09-25)

- **phase/step:** P4/P5 — runtime listener ownership observation
- **status:** `partial`
- **what changed:** يحل API مالك socket من `/proc/net/tcp` (و`tcp6` عند توفره)،
  ويربط كل inode مستمع بعملية واحدة من descendants لPID الإطلاق server-owned.
  يعيد فحص هوية عمليتي الإطلاق والمالك وsocket بعد health response، ثم يثبت
  marker والبيئة وجذر المشروع للعملية المالكة. ينتقل الإسقاط المختصر عبر
  `RuntimeAfterState` إلى Gate C وdirect observation؛ وpre-state للإيقاف صار
  يتضمن health/revision وlistener proof. لا تحفظ PID المالك أو inode الخام.
- **files/schema/contracts touched:** runtime listener procfs resolver،
  child-process attestation role، workspace runtime manager، Gate C parser/
  acceptance facts، recipe runtime evidence، واختبارات runtime وroutes.
  لا schema migration أو تعديل قاعدة الإنتاج.
- **validation:** API typecheck؛ 4 ملفات Vitest مركزة، 22/22؛
  `git diff --check`؛ API workflow أُعيد تشغيله ووصل إلى `Server listening`.
- **authority/safety impact:** Gate C لا يقبل start/restart أو stop قبلًا بلا
  listener معروف على المنفذ نفسه مع process attestation سليمة. المالك الغائب أو
  الملتبس أو المتغير أو procfs غير المتاح يبقى unknown ويفشل الإغلاق؛ اختلاف
  marker/البيئة يفشل. غياب `/proc/net/tcp6` بسبب تعطيل IPv6 مقبول، وأخطاء القراءة
  الأخرى fail-closed. لا يتغير receipt وحده إلى acceptance أو OBSERVED.
- **remaining/blocker:** التحقق يخص الملاحظة المستقلة وقت action؛ مسار recovery/
  heartbeat ما زال يحتاج ربطًا مستمرًا بملكية listener قبل ادعاء صحة الجلسة.
  P3.5/P4/P5 جزئية؛ لم يبدأ P6 أو P7 أو P7.5.
- **next step:** اربط تعافي runtime وتجديد lease بإعادة إثبات owner/session،
  دون قتل runtime لمجرد تعذر رصد مؤقت، ثم تابع إغلاق P4/P5 بالترتيب.

### 42.32 P4/P5 — ربط recovery وheartbeat بملكية listener (2026-09-25)

- **phase/step:** P4/P5 — runtime recovery and heartbeat ownership fencing
- **status:** `done`
- **what changed:** claim recovery أصبح مربوطًا بـproject/session/worker. يتحقق
  recovery من listener قبل وبعد supervisor adoption؛ وإذا تعذر الإثبات أو لم
  تطابق نتيجة supervisor الجلسة، يحرر lease لإعادة المحاولة دون قتل العملية أو
  تحويلها إلى failed. جلسة running لا تجدد heartbeat إلا بعد إثبات listener
  ومطابقة adoption، وتجديدها مشروط بـsession وworker والحالة الحالية في الصف.
  جلسة starting تجدد lease للـworker والجلسة المالكين فقط، دون ادعاء health.
  stop/restart يستخدمان recovery موجهًا للمشروع، ولا يوقفان أو يستبدلان جلسة
  لا يمكن إثبات مالكها.
- **files/schema/contracts touched:** `workspace-runtime.ts` و
  `workspace-runtime-store.ts` واختبارات runtime/store، وسجل التنفيذ؛ لا schema
  migration أو تعديل قاعدة الإنتاج.
- **validation:** API typecheck؛ 5 ملفات Vitest مركزة، 25/25، ثم إعادة اختبار
  runtime/store بعد إضافة restart refusal، 8/8؛ `git diff --check`؛ API workflow
  restart وظهور `Server listening`.
- **authority/safety impact:** lease writes وrecovery claims مربوطة بهوية
  session؛ فقدان procfs/supervisor observation يحرر ownership ولا يقتل الخدمة
  ولا يمنح قبولًا. تعذر الإثبات أثناء stop يبقي الجلسة نشطة، وrestart لا يبدأ
  بديلًا. لا تغيير production database.
- **remaining/blocker:** P3.5/P4/P5 ما زالت جزئية؛ هذه الخطوة تغلق recovery/
  heartbeat ownership fence فقط، ولا تنشئ independent World observation أو
  World Delta. لم يبدأ P6 أو P7 أو P7.5.
- **next step:** استأنف الإغلاق المرحلي حسب الخطة، بدءًا من توحيد دلالات
  `AgentAction` في P5.5 قبل إضافة مسارات Action/Effect جديدة؛ لا تبدأ P6 أو
  P7 أو P7.5.

### 42.33 P5.5 — تثبيت provenance لقراءات recipe الصريحة (2026-09-25)

- **phase/step:** P5.5 — read-only recipe invocation identity
- **status:** `partial`
- **what changed:** تستخدم القراءتان المسموحتان صراحةً `database.read_project` و
  `project.read_file` Episode canonical واحدًا مربوطًا بالتنفيذ والمحاولة. يسجل
  `OBSERVATION_REQUESTED` قبل استدعاء القارئ؛ فشل إنشاء Episode يستدعي محاولة
  إنهاء execution عبر `failAiExecution` ثم يوقف المسار، وفشل تسجيل الطلب يحجب
  الاستدعاء. يسجل `OBSERVATION_RECORDED` hash
  الناتج ومراجع evidence؛ فشل التسجيل يحجب البيانات ويوقف العقد اللاحقة. لا
  تحفظ أحداث قراءة الملف المسار أو المحتوى؛ scope ونطاق المدخل ومعرّف node
  ممثلة بهويات عامة وhashes. أضيفت assertions تستبعد browser وcommand من
  تصنيف read-only وتثبت عدم إنشاء Action أو EffectBundle للقراءة.
- **files/schema/contracts touched:** `recipe-invocation-contract.ts` واختباراته،
  `recipe-operation-runner.ts` واختباراته، سجل التنفيذ وذاكرة المشروع؛ لا
  تغييرات schema أو قاعدة الإنتاج.
- **validation:** اختبار runner والعقد 18/18؛ اختبار DB-backed يثبت أن حدث
  الطلب موجود داخل callback قبل كشف الصفوف، وأن الطلب والنتيجة والإنهاء تخص
  Episode واحدًا وغير مكررة؛ API typecheck و`git diff --check` نجحا؛ أُعيد تشغيل
  API وظهر `Server listening`.
- **authority/safety impact:** لا capability أو صلاحية جديدة، ولا تصنيف من
  `mutatesProject: false`. تظل Gate-C وcandidate validation دون تغيير. أحداث
  القراءة observations فقط، لا تثبت Action/Effect أو Canonical Proof أو القبول؛
  لا تعديل لقاعدة الإنتاج.
- **remaining/blocker:** P5.5 ما زالت جزئية؛ provider tool calls وبقية recipe
  nodes تتطلب تدقيق أهلية وتغطية. validators وbrowser وcommand مستبعدة من
  read-only. لم يبدأ P6 أو P7 أو P7.5.
- **next step:** تابع P5.5 فقط عبر invocation surfaces المؤهلة، مع إبقاء الفصل
  بين Audit وObservation وEffect وAcceptance؛ لا تبدأ P6 أو P7 أو P7.5.

### 42.34 P5.5 — تسجيل قراءات Git على Episode الخاص بـMission (2026-09-25)

- **phase/step:** P5.5 — read-only provider tool invocation
- **status:** `partial`
- **what changed:** أضيفت `git_status` و`git_diff` و`git_log` إلى allowlist الصريح لقراءات
  `mission_observe` و`mission_validate`. بعد نجاح authorization يسجل callback
  `OBSERVATION_REQUESTED` قبل تنفيذ Git الثابت عبر `execFile`، ثم
  `OBSERVATION_RECORDED` ببصمة الناتج فقط. لا يحفظ Episode مخرجات diff أو رسائل
  commit أو المسار الاختياري لـ`git_diff`؛ وفشل حفظ الطلب يمنع التنفيذ، وفشل حفظ
  النتيجة يحجب المخرج.
- **files/schema/contracts touched:** `tool-execution-engine.ts` و
  `task-execution-service.ts` واختباراتهما؛ تحديث سجل التقدم. لا تغييرات schema
  أو قاعدة الإنتاج.
- **validation:** اختبارات محرك الأدوات 165/165؛ اختبار Mission validation
  DB-backed 1/1؛ typecheck لـ`ai-orchestrator` وAPI؛ `git diff --check`؛ أُعيد
  تشغيل API وظهر `Server listening`.
- **authority/safety impact:** allowlist محدودة للقراءات الثلاث ضمن
  `mission_observe`/`mission_validate` فقط. لا Action أو EffectBundle أو Canonical
  Proof أو acceptance، ولم تتغير adapters server-owned للملاحظات، Gate-C أو
  candidate validation.
- **remaining/blocker:** P5.5 ما زالت جزئية؛ بقية recipe nodes وأدوات التحليل
  والقراءة الأخرى تحتاج تدقيق أهلية منفصلًا. browser وcommand وvalidator وscan
  refresh ليست قراءات مؤهلة لهذا العقد. لم يبدأ P6 أو P7 أو P7.5.
- **next step:** تابع تدقيق الأسطح المؤهلة ضمن P5.5 فقط، ثم اختبر invariants
  الشاملة قبل إغلاق المرحلة؛ لا تبدأ P6 أو P7 أو P7.5.

### 42.35 P5.5 — جرد نقاط القراءة وحدود أهلية Mission (2026-09-25)

- **phase/step:** P5.5 — read-only entry-point census
- **status:** `partial`
- **what changed:** اكتمل جرد recipe registry وprovider dispatch وأدوات
  `analysis-tools` والـserver adapters ذات الصلة. لا توجد recipe read إضافية
  مؤهلة خارج `database.read_project` و`project.read_file`. قراءات ملفات/Git
  المصرح بها في Mission مغطاة بأحداث Episode hash-only. أدوات
  `symbol_search`/`ast_navigation` و`inspect_dependencies`/`inspect_binary`
  تقرأ ملفات فعلية، لكنها غير مخولة حاليًا في Mission ولا يصلها correlation
  مملوك للخادم. `query_knowledge_graph` و`discover_project_apis` تقرآن بيانات
  graph، لكن Mission لا يمرر لها runner أو correlation أو manifest انتقائي.
- **files/schema/contracts touched:** تحديث سجل التقدم وخطة P5.5 فقط؛ لا تغييرات
  code أو schema أو قاعدة الإنتاج.
- **validation:** مراجعة registry والـdispatch والـserver adapters؛
  `git diff --check`.
- **authority/safety impact:** لم توسع allowlists أو provider manifest. بقي
  `refresh_project_scan` خارج observation callback العادي لأنه يكتب حالة scan
  وقد يقدّم revision؛ validators/browser/command/runtime/delivery وكتابات
  mutation بقيت خارج تصنيف القراءة. `outputHash` بصمة نتيجة فقط وليس
  `projectRevision` أو `WorldRevision`.
- **remaining/blocker:** قبل تفعيل أي من الأدوات الأخرى، يلزم manifest انتقائي
  وscope/revision موثقان من الخادم. كذلك fallback في بعض Mission executions
  يستخدم `task.updatedAt` كـ`workspaceRevision`؛ لا يجوز تمريره كـ
  `analysisCorrelation.projectRevision` دون تحقق من مصدره. P5.5 ما زالت جزئية؛
  لا يبدأ P6 أو P7 أو P7.5.
- **next step:** إن توسعت P5.5 لاحقًا، ابدأ بعقد Mission server-owned يربط
  execution وproject revision وtool authorization، ثم أضف الأدوات المؤهلة
  واحدةً واحدة مع request-before-read وrecord-before-consume؛ لا تصنف كل
  `mutatesProject:false` على أنها قراءة.

### 42.36 P5.5 — شجرة مشروع محدودة لملاحظة Mission (2026-09-25)

- **phase/step:** P5.5 — bounded Mission project-tree observation
- **status:** `partial`
- **what changed:** إضافة `project.list_tree` بلا معاملات من النموذج، بجذر
  managed ثابت، وعمق 2 و100 نتيجة وحدود scan/output ثابتة. يعيد بيانات وصفية
  فقط، ويتخطى symlinks والمسارات الحساسة والمجلدات المولدة. Mission يمرر
  manifest انتقائيًا وscope ملفات exact؛ لا تظهر أدوات `list_directory` أو
  `search_code` في provider manifest الخاص به.
- **files/schema/contracts touched:** file-tools وtool policy/dispatcher
  وchat-agent وtask execution service واختبارات الوحدة والتكامل وسجل P5.5؛
  لا تغييرات schema أو قاعدة الإنتاج.
- **validation:** اختبارات file tools وMission observation (39/39؛ تشمل
  فلترة generated/sensitive/symlink وحدود depth/results/scan/output والتفويض
  والتسجيل وrevision drift)، وintegration lifecycle (7/7)، وtypecheck
  orchestrator.
  أعيد تشغيل API وdashboard؛ API سجّل `Server listening` وظهر preview
  dashboard دون أخطاء browser.
- **authority/safety impact:** `projects.updatedAt` هو guard لاتساق القراءة
  في P5.5 فقط، ويتحقق الخادم منه قبل وبعد كل Observation؛ يرفض أو يحجب النتيجة
  عند drift. لا يُعتبر هذا قيمة `WorldRevision` لـP6 ولا يتسرب لتعريف World
  State. تسجل `OBSERVATION_REQUESTED` قبل القراءة و`OBSERVATION_RECORDED`
  قبل استهلاك النتيجة. `outputHash` يعرّف النتيجة فقط، ولا ينشئ Action أو
  Effect أو Proof أو Acceptance.
- **remaining/blocker:** لا يوجد عائق لهذه القدرة المحدودة. تظل P5.5 جزئية؛
  لم يبدأ P6 أو P7 أو P7.5.
- **next step:** لا توسع صلاحيات Mission ضمن هذه الخطوة. أي قدرة أخرى تحتاج
  manifest وscope وrevision وعقد Observation منفصلًا.

### 42.37 P5.5 — تدقيق تغطية قراءات الدردشة العامة (2026-09-25)

- **phase/step:** P5.5 — direct chat provider-read coverage audit
- **status:** `partial`
- **what changed:** أظهر تدقيق نقاط dispatch أن `/api/ai/chat` و
  `/api/ai/chat/stream` يستدعيان `chatWithFallback` دون تمرير
  `onReadOnlyInvocation`. لذلك أي قراءة provider تنفذها هذه المسارات لا تسجل
  أحداث `OBSERVATION_REQUESTED/RECORDED` لكل invocation؛ Episode shadow على
  مستوى الدور في المسار المتدفق لا يعوض provenance لكل قراءة.
- **files/schema/contracts touched:** تدقيق `chat.ts` و`ai-route-helpers.ts`
  و`tool-execution-engine.ts` وتحديث سجل التقدم؛ لا تغييرات code أو schema أو
  قاعدة الإنتاج.
- **validation:** بحث كامل عن مواقع تمرير callback وأحداث Episode؛
  `git diff --check`.
- **authority/safety impact:** لم تُضف أدوات أو صلاحيات إلى Mission ولم تُعامل
  القراءة كـAction أو Effect أو Proof أو Acceptance. أدوات التحليل والـscan
  stateful تبقى مستبعدة دون manifest/scope/revision server-owned.
- **remaining/blocker:** P5.5 العامة لا تزال غير مكتملة؛ يلزم عقد لكل قراءة
  provider في مسارات الدردشة المباشرة يربط invocation بـEpisode/attempt وscope
  وrevision، مع request-before-read وrecord-before-consume وفشل مغلق.
- **next step:** لا تبدأ التنفيذ أو P6 قبل تحديد نطاق هذه المسارات واعتماد
  عقدها؛ لا توسع allowlist أو تغيّر schema أو قاعدة الإنتاج.

### 42.38 P5.5 — تسجيل ملاحظات قراءات الدردشة المتدفقة (2026-09-25)

- **phase/step:** P5.5 — streamed chat read observations
- **status:** `partial`
- **what changed:** سجل `/api/ai/chat/stream` الآن موثق على أنه يمرر
  `onReadOnlyInvocation` ويربط القراءات المؤهلة بـEpisode وexecution/attempt/
  worker. يسجل `OBSERVATION_REQUESTED` قبل القراءة و`OBSERVATION_RECORDED`
  قبل استهلاكها، مع hashes للمدخلات والـmanifest والـscope والنتيجة. Episode
  ينتهي `incomplete` و`CHAT_OBSERVATION_ONLY`؛ هذه التغطية لا تثبت Action أو
  Effect أو acceptance. يصحح هذا الإدخال استنتاج §42.37 التاريخي عن المسار
  المتدفق؛ يبقى `/api/ai/chat` غير المتدفق خارج per-invocation coverage لأنه
  لا يملك execution/attempt دائمًا.
- **files/schema/contracts touched:** مزامنة سجل التقدم مع
  `docs/agent-generalization-execution-plan.md`؛ لا تغيير runtime أو schema أو
  قاعدة الإنتاج في هذه الخطوة التوثيقية.
- **validation:** اعتمدت نتائج التحقق المسجلة في §42.38 من الخطة (API
  typecheck؛ orchestrator 170/170؛ streamed route 1/1؛ مجموعة chat المركزة
  69/69). لم تُعد الاختبارات في هذه المراجعة التوثيقية.
- **authority/safety impact:** القراءة observations فقط؛ لا صلاحيات أو allowlists
  جديدة، ولا Proof أو Acceptance. أدوات mutation وanalysis graph/API و
  `refresh_project_scan` تبقى خارج callback.
- **remaining/blocker:** P5.5 جزئية؛ المسار غير المتدفق وبقية الأسطح المؤهلة
  غير موحدة. لم يبدأ P6 أو P7 أو P7.5.
- **next step:** تابع P5.5 داخل حدود الصلاحية الحالية، ولا تنشئ execution/
  attempt اصطناعيًا للمسار غير المتدفق.

### 42.39 P5.5/P6 — تدقيق التزام انتقال المعرفة بعد قبول الأثر (2026-09-25)

- **phase/step:** P5.5/P6 — source audit for accepted-effect knowledge closure
- **status:** `partial`
- **what changed:** أكد تدقيق call sites أن قبول Effect منفصل عن تحديث المعرفة:
  `EffectBundle` يحفظ `episode.worldRevision` إن كانت موجودة، ولا ينشئ `WorldTransition` أو
  `resultingWorldRevision`. الاستخدام المباشر لـ`getProjectWorldState` الذي
  ظهر في البحث هو route القراءة والاختبارات؛ لم يظهر مستهلك مباشر له داخل مسار
  planner/replan المفحوص. materialization للملاحظات التكميلية بعد قبول task و
  streamed chat غير متزامن؛ كما أن إسقاط World State أفضل جهد بعد تثبيت
  الملاحظات. في `apply-changes` تُحفظ ملاحظتا الشجرة قبل/بعد مع
  `materializeWorldState: false` لعزل candidate؛ لم يظهر إسقاط حي لاحق بعد
  الترقية في المسار المفحوص. هذا لا يضعف بوابة Effect الحالية، لكنه لا يضمن
  تحديثًا معرفيًا durable أو استهلاك القرار التالي له.
- **files/schema/contracts touched:** تحديث هذه الوثيقة وخطة التنفيذ فقط؛
  لا تغييرات code أو schema أو بيانات إنتاج.
- **validation:** مراجعة قراءة لـ`chat.ts` و`task-execution-service.ts` و
  `observation-materializer.ts` و`effect-observer.ts` و`world-state.ts` و
  `mission-auto-replan.ts` ومسارات `apply-changes`؛ فحص اتساق التوثيق و
  `git diff --check`. لم تُشغّل اختبارات.
- **authority/safety impact:** يظل acceptance مستقلًا عن materialization؛ لا
  تُقبل حالة candidate أو rollback كحقيقة حية. لا تتغير الصلاحيات أو قواعد
  Effect/Proof.
- **remaining/blocker:** P6 غير started: لا يوجد WorldTransition عام أو التزام
  materialization durable ينتهي بحالة صريحة، ولم يثبت استهلاك planner للمراجعة
  الناتجة. تشخيص P7 لا يستهلك WorldTransition حتى الآن.
- **next step:** بعد مراجعة هذه الوثائق، يمكن تنفيذ Runtime Golden Slice ضمن
  ترتيب §31: قرار مربوط بـ`worldRevision`، before/after مستقلة، Effect مستقل،
  transition وإسقاط قابلان للاستعادة، ثم إثبات أن القرار التالي قرأ المراجعة
  الجديدة. لا تبدأ schema أو production changes ضمن هذا التحديث.

### 42.40 P5.5 — قرار lifecycle دائم للدردشة غير المتدفقة (2026-09-25)

- **phase/step:** P5.5 — تثبيت تصميم `/api/ai/chat` غير المتدفق
- **status:** `partial`
- **what changed:** اعتمد التصميم lifecycle تنفيذ دائم قبل أول tool invocation
  مؤهل: execution ومحاولة وworker/lease صالحة، ثم Episode مرتبطة بهوية المحاولة.
  تشترك كل أدوات الطلب في execution/attempt نفسها، ويغلق lifecycle صراحةً عند
  النجاح أو الفشل أو الإلغاء. القراءات تحفظ Observation/Invocation evidence
  فقط؛ لا `EffectBundle` تلقائي ولا تغيير لاستجابة الدردشة أو acceptance.
  الطلب الذي لا يستدعي الأدوات لا ينشئ Episode بلا owner durable. التنفيذ
  runtime مؤجل؛ لا callback منفرد ولا هوية اصطناعية.
- **files/schema/contracts touched:** تحديث خطة التنفيذ وسجل التقدم؛ لا تغييرات
  runtime أو schema أو بيانات إنتاج.
- **validation:** مراجعة اتساق §42.40 مع عقد P5.5 واختبارات القبول في الخطة؛
  `git diff --check`.
- **authority/safety impact:** لا تتغير صلاحيات الأدوات أو دلالات response/
  acceptance. تظل كل كتابة lifecycle مشروطة بملكية worker/lease؛ فقد الملكية
  يمنع حفظ نتيجة invocation أو إنهاء المحاولة من عامل غير مالك.
- **remaining/blocker:** تصميم معتمد وغير منفذ؛ يلزم قبل تعديل runtime مراجعة
  كفاية جداول التنفيذ وEpisode الحالية، ثم تنفيذ lifecycle واختبارات النجاح،
  وفشل الأداة، وتعدد الأدوات، وغياب الأدوات، والإلغاء/فقد lease. لا تغيير schema
  أو production data ضمن هذه الخطوة. لا يبدأ P6 أو P7 أو P7.5.
- **next step:** أبقِ العمل الحالي توثيقيًا؛ لا تعدّل runtime. عند استئناف التنفيذ،
  ابدأ بمراجعة عقود وجداول التنفيذ الحالية مقابل معايير القبول في §42.40، ثم نفّذ
  lifecycle ضمن P5.5 فقط.

### 42.41 P5.5 — تنفيذ lifecycle الدردشة غير المتدفقة (2026-09-25)

- **phase/step:** P5.5 — `/api/ai/chat` read-only invocation lifecycle
- **status:** `partial`
- **what changed:** يبدأ execution وclaim وEpisode كسولًا عند أول callback قرائي
  مؤهل. جميع قراءات الطلب تستخدم execution/attempt واحدة وتكتب هويات ومحتوى
  محدودًا ومجزأً في أحداث Observation. يغلق المسار Episode وينهي execution قبل
  إرسال response نهائي؛ الطلب بلا قراءة لا ينشئ execution أو Episode. الإلغاء
  وفقد lease يمنعان العامل القديم من تسجيل نتيجة أو إنهاء المحاولة.
- **files/schema/contracts touched:** `artifacts/api-server/src/routes/ai/chat.ts`،
  `artifacts/api-server/src/lib/ai-execution-state.ts`،
  `artifacts/api-server/src/routes/ai.test.ts`؛ لا schema أو بيانات إنتاج.
- **validation:** `pnpm --filter @workspace/api-server typecheck` نجح؛
  `pnpm --filter @workspace/api-server exec vitest run src/routes/ai.test.ts -t "POST /api/ai/chat"`
  نجح (75 اختبارًا، 109 متجاوزة)؛ اختبارات lifecycle المركزة نجحت (5/5)؛
  `git diff --check` نجح.
- **authority/safety impact:** لا تتغير صلاحيات الأدوات أو استجابة الدردشة أو
  acceptance. القراءات لا تنشئ `EffectBundle`؛ كل كتابة event وإغلاق مشروطة
  بهوية المحاولة وworker/lease الحاليين.
- **remaining/blocker:** لا عائق لهذه الشريحة. تبقى P5.5 جزئية على الأسطح
  الأخرى؛ لا schema أو production data، ولا توسع إلى P6 أو P7 أو P7.5.
- **next step:** استمر في إغلاق فجوات P5.5 المتبقية فقط وفق ترتيب الخطة، مع إبقاء
  أي توسيع للقبول أو آثار الكتابة خارج هذه الشريحة.

### 42.42 P5.5 — ملاحظات قراءات أدوات التحليل في الدردشة (2026-09-25)

- **phase/step:** P5.5 — direct-chat analysis read observations
- **status:** `partial`
- **what changed:** لفّ مسارا `/api/ai/chat` و`/api/ai/chat/stream` runner
  التحليل بملاحظات server-owned لأداتي `query_knowledge_graph` و
  `discover_project_apis`. يبدأ lifecycle الدردشة قبل تشغيل الأداة، ويسجل
  `OBSERVATION_REQUESTED` قبل القراءة و`OBSERVATION_RECORDED` قبل تمرير النتيجة.
  تحفظ الأحداث hashes للمدخلات والـmanifest والـscope والنتيجة، مع operation
  وrevision من correlation الخادم. فشل حفظ الطلب يمنع القراءة، وفشل حفظ النتيجة
  يمنع استهلاكها. لا يراقب wrapper `refresh_project_scan`.
- **files/schema/contracts touched:** `lib/ai-orchestrator/src/index.ts`،
  `artifacts/api-server/src/lib/ai-analysis-tools.ts`،
  `artifacts/api-server/src/routes/ai/chat.ts`، اختبارات مسارات الدردشة، وهذه
  الوثيقة وخطة التنفيذ؛ لا schema أو بيانات إنتاج.
- **validation:** `pnpm --filter @workspace/api-server typecheck`؛ الاختبار
  المركز لمساري الدردشة `2/2`؛ `git diff --check`. أعيد تشغيل
  `artifacts/api-server: API Server` بعد إنهاء listener القديم؛ سجلت الخدمة
  `Server listening` وأجاب `/` بـ404 المتوقع لعدم وجود route للجذر.
- **authority/safety impact:** لا توسعة لـMission أو allowlists؛ tools graph/API
  غير متاحة لـMission دون عقدها المستقل. لا تنشئ الملاحظات `AgentAction` أو
  `EffectBundle` ولا تغير دلالات response/acceptance. بقي `refresh_project_scan`
  stateful وخارج read-only observation.
- **remaining/blocker:** P5.5 جزئية على أسطح أخرى؛ لم يبدأ P6 أو P7 أو P7.5.
  لا يوجد blocker runtime لهذه الشريحة.
- **next step:** تابع فجوات P5.5 الموثقة فقط، ولا توسع صلاحيات الأدوات أو
  acceptance.

### 42.43 P5.5 — جرد تغطية invocation (2026-09-25)

- **phase/step:** P5.5 — invocation coverage inventory and audit
- **status:** `partial` في لقطة الجرد قبل إغلاق scopeHash؛ راجع §42.44 للحالة الحالية.
- **what changed:** طوبق كل سطح recipe وMission والدردشة المباشرة حسب class،
  execution/attempt/worker، scope/revision، أحداث الطلب/النتيجة أو Action،
  الإنهاء والفشل المغلق. لا توجد recipe read إضافية خارج
  `database.read_project` و`project.read_file`. قراءات provider في مساري الدردشة
  وقراءتا analysis المباشرتان مغطاة. نطاق Mission يُفرض من الخادم ويُربط
  بالـEpisode/المحاولة/revision، لكن أحداث القراءة لا تسجل fingerprint مستقلًا
  للنطاق الدقيق؛ هذه فجوة provenance متبقية، وليست نقصًا في enforcement الحالي.
- **coverage matrix:**

  | السطح | التصنيف | owner/scope/revision | evidence/lifecycle | الحكم |
  |---|---|---|---|---|
  | Recipe `database.read_project` (recipe `database.inspect.project`) و`project.read_file` | read-only | execution/attempt/worker والـlease من recipe runner؛ contract يحمل project/capability revisions وscope/scopeHash/inputHash | `OBSERVATION_REQUESTED` قبل invocation و`OBSERVATION_RECORDED` قبل تمرير النتيجة، مع evidence refs وإغلاق terminal fail-closed | `COVERED` |
  | Provider reads في `/api/ai/chat` و`/api/ai/chat/stream`: `read_file`, `read_file_range`, `project.list_tree`, `git_status`, `git_diff`, `git_log`, `list_directory`, `search_code`, `symbol_search`, `ast_navigation`, `inspect_dependencies`, `inspect_binary` | read-only | execution/attempt/worker؛ manifestHash وscopeHash وprojectRevision من الخادم | الطلب قبل reader، النتيجة قبل الاستهلاك؛ no-tool non-stream لا ينشئ Episode؛ إغلاق terminal وownership fenced | `COVERED` |
  | Direct-chat `query_knowledge_graph` و`discover_project_apis` | read-only | server-owned operation/project/revision correlation؛ full analysis-manifest hash وscopeHash | request/record قبل وبعد runner، مع input/output hashes، والتحقق من correlation | `COVERED` للمسارين فقط |
  | Mission `read_file`, `read_file_range`, `project.list_tree`, `git_status`, `git_diff`, `git_log` | read-only محدود | execution/attempt/worker/lease وprojectRevision مملوكة للخادم؛ exact target paths enforced في dispatch | أحداث طلب/نتيجة وrevision guards موجودة؛ لا يوجد scopeHash مستقل للنطاق المحسوم في payload | `REMAINING` لإكمال scope provenance hash-only؛ لا توسعة allowlist |
  | Mission `symbol_search`, `ast_navigation`, `inspect_dependencies`, `inspect_binary`, `list_directory`, `search_code` وأدوات analysis graph/API | read-capable لكن غير مخولة في Mission حاليًا | ليست في Mission provider manifest ولا يوجد لها Mission-owned scope/revision contract | لا invocation في هذا السياق؛ direct-chat المقابل مغطى حيث هو مخول | `EXPLICITLY OUT OF SCOPE` في Mission |
  | `mission_repair` المعتمدة: `write_file` و`replace_text` | mutation داخل candidate overlay | AgentAction يربط execution/attempt/worker وapproved scope/source/plan revisions | `ACTION_REQUESTED` قبل staging و`ACTION_COMMITTED` بعد staging؛ القبول يبقى للـaggregate EffectBundle | `COVERED` ضمن الشريحة المحدودة، لا كقراءة |
  | `refresh_project_scan`، validators/browser/command/runtime/delivery وغيرها من stateful/effect tools | mutation أو validation/stateful، لا read-only | لكل سطح runner/policy مختلف؛ لا تستنتج القراءة من `mutatesProject:false` | خارج عقد Observation هذا؛ `refresh_project_scan` يغيّر scan state | `EXPLICITLY OUT OF SCOPE` لهذه القراءة؛ يحتاج mutation contract منفصلًا إذا أُدرج لاحقًا |

- **files/schema/contracts touched:** تحديث سجل التقدم وخطة التنفيذ فقط؛ لا
  تغييرات runtime أو schema أو بيانات إنتاج.
- **validation:** مراجعة code dispatch/registry/ledger عبر الجرد؛ اختبارات
  المسارات السابقة والتحقق من حالة API workflow المسجلة في §42.42؛ لا اختبارات
  runtime جديدة في هذه الخطوة التوثيقية.
- **authority/safety impact:** لا تغييرات allowlist أو authority. لا يُفعّل أي
  tool غير مخول في Mission، ولا تتحول الملاحظة إلى Action أو Effect أو
  acceptance. `refresh_project_scan` مصنف stateful لا read-only.
- **remaining/blocker:** فجوة scope fingerprint لملاحظات Mission read هي العمل
  الأقرب داخل P5.5؛ تبقى P5.5 جزئية. لم يبدأ P6 أو P7 أو P7.5.
- **next step:** أضف scopeHash مشتقًا من server-owned Mission read policy إلى
  أحداث طلب/نتيجة Mission مع اختبارات تطابق التنفيذ والمحاولة والنطاق والمراجعة؛
  لا توسع manifest أو تبدأ World Delta.

### 42.44 P5.5 — إغلاق scopeHash لقراءات Mission (2026-09-25)

- **phase/step:** P5.5 — Mission read scope provenance closure
- **status:** `complete` للـinvocations المؤهلة والمسموح بها حاليًا
- **what changed:** أصبحت أحداث `OBSERVATION_REQUESTED` و
  `OBSERVATION_RECORDED` لقراءات Mission تحمل `scopeHash` و
  `scopePolicyVersion` متطابقين. تُشتق البصمة من هوية المشروع/Mission/Goal/Task،
  profile، revision، capability وسياسة القراءة المخصصة لها، مجموعة target paths
  المعتمدة بعد الترتيب وإزالة التكرار، وhash للـmanifest الكامل. تميز السياسة
  الثابتة بين file reads وbounded metadata tree وعمليات Git المسموح بها؛ لا
  تُحفظ المسارات الخام في الـpayload. أُضيفت مطابقة request/result على invocation
  key وscopeHash، وأصبح `observationId` يربط scopeHash أيضًا؛ غياب الطلب أو تغير
  scope يمنع تسجيل/تمرير النتيجة.
- **files/schema/contracts touched:** helper لحساب بصمة النطاق، Mission observation
  callback، والاختبارات والوثائق؛ لا schema أو بيانات إنتاج.
- **validation:** `pnpm --filter @workspace/api-server typecheck` نجح؛
  `mission-read-scope.test.ts` و`task-execution-lifecycle.integration.test.ts`
  نجحا (`10/10`)؛ أُعيد تشغيل API workflow بنجاح.
- **authority/safety impact:** لا تغييرات allowlist أو tool definitions أو صلاحيات،
  ولا كتابة إلى live workspace. تظل قراءة tree/Git ضمن السياسة الثابتة المصرح بها؛
  scopeHash يضيف provenance فقط. لا Action/Effect/acceptance جديد.
- **remaining/blocker:** لا فجوات invocation provenance معروفة ضمن الأسطح المخولة
  التي يغطيها P5.5. تبقى الأدوات غير المدرجة و`refresh_project_scan` stateful
  خارج read coverage كما هو موثق في §42.43.
- **next step:** `P5.5 CLOSED → STOP`. تبقى P6 وP7 وP7.5 غير مبدوءة.
  المرشح المؤجل الوحيد الموثق لـP6 هو `runtime.start` عند انتقال مثبت
  `stopped → running`؛ `running → running` لا يثبت حدثًا، و`restart/stop` خارج
  الـpilot. اكتمل تدقيق تصميم D1/D2 في §42.45؛ التفاصيل في §42.41 من خطة التنفيذ.
  لا تُجرى تغييرات runtime
  أو WorldTransition/WorldDelta أو materialization أو worldRevision حتى يُفتح
  النطاق صراحة.

### 42.45 P6 — تدقيق عقد Runtime start وقراري D1/D2 (2026-09-26)

- **phase/step:** P6 — توثيق حدود D1/D2 للـRuntime Golden Slice
- **status:** `partial`؛ أساس الانتقال موجود، واكتمل هذا التدقيق التوثيقي فقط.
- **what changed:** ضُيّق مرشح pilot إلى `runtime.start` الفعلي
  `stopped → running`. وثّق D1 كقرار سابق للأثر يستهلك `Wn` ويطابق ملاحظة
  مباشرة؛ وD2 كأهلية dispatch لهدف تابع محدد، لا كقبول Goal. فُصل
  `already_running` عن انتقال P6، ووُثّقت فجوات ربط `runtime.after_state` وهوية
  الجلسة و`environmentRevision` في finalizer. رُبط هدف D2 بخطوات خطة مستقرة
  تدخل في `planHash` وتُحل إلى Goal IDs عند materialization؛ تبقى تبعيات Goals
  لمعنى الاكتمال فقط. عُرّفت معاملة dispatch المقفلة كنقطة تفويض D2؛ التفاصيل
  ومعايير القبول في §42.41 من خطة التنفيذ.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`,
  هذه الوثيقة، و`.agents/memory/runtime-start-transition-proof.md`؛ لا تغييرات
  code أو schema أو بيانات إنتاج.
- **validation:** مراجعة قراءة للمصادر والاختبارات والوثائق المشار إليها؛ لا
  اختبارات runtime. اجتاز التغيير `git diff --check`.
- **authority/safety impact:** لا صلاحيات أو acceptance أو runtime behavior جديد.
  يبقى Gate C مستقلًا عن World State؛ لا تمنح materialization أو D2 اكتمال Goal
  أو `PROVEN`.
- **remaining/blocker:** P6 ما زالت `partial`. لا يفرض finalizer الحالي
  مطابقة after-state/الجلسة/مراجعة البيئة الكاملة، ولا يوجد consumer لـD2 في
  Mission dispatch. لا يبدأ `restart/stop` أو P7 أو P7.5.
- **next step:** لا تنفيذ ضمن هذا التحديث. عند فتح P6 صراحة، ابدأ بإغلاق D1
  وvalidator الانتقال وD2 داخل عقد pilot الموثق واختبار حالات الفشل قبل أي توسع.

### 2026-09-26 — تدقيق موثوقية synthesis لاستعلام المشروع (توثيق فقط)

- **phase/step:** عمل موثوقية عابر للمراحل؛ ليس P7 ولا مرحلة جديدة.
- **status:** `blocked` — مراجعة التشخيص والتوثيق مكتملة، لكن بوابة الوثائق ما زالت
  تمنع تغييرات runtime/schema حتى إغلاق شروطها ومراجعة المستخدم للوثيقتين.
- **what changed:** فُصل طلب البحث عن الوثائق الذي تعثر قبل قراءة المصدر عن طلب
  شرح المشروع اللاحق. يسجل الأول `EMPTY_RESPONSE` و`RATE_LIMITED` مرتين بلا
  قراءات مصدر. أكمل الثاني أدوار الشرح الأربعة وثماني قراءات كاملة (42,378
  بايتًا)، وقُبلت أدلته، لكنه انتهى إلى fallback حتمي. سجل محاولاته الأربع يحوي
  نجاحات ثلاثًا وفشلًا واحدًا `INVALID_PROVIDER_RESPONSE`، ولا يحوي
  `RATE_LIMITED`؛ جميع الأحداث غير منسوبة لمرحلة synthesis تحديدًا، ونتيجة العقد
  فيها `not_applicable`. مجموع مدد المحاولات نحو 150.6 ثانية مقابل ميزانية 150
  ثانية. لذلك لا يثبت الأثر أن فشل تصحيح الشرح كان 429 أو أن كل البدائل المؤهلة
  استُنفدت.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`
  و`docs/agent-generalization-progress.md` فقط؛ لا تغييرات كود أو schema أو بيانات.
- **validation:** مقارنة سجلات التطوير و`ai_usage_events` مع مسار
  `chat-agent`/`chatWithFallback` وعقد الاستجابة الحالي. لم تُشغّل اختبارات runtime
  لأن التغيير توثيقي فقط؛ التحقق النهائي هو `git diff --check`.
- **authority/safety impact:** لا تغيير في evidence أو acceptance أو الصلاحيات.
  يظل قبول الأدلة مستقلًا عن نجاح synthesis. `ChatOutput` وحقول provenance
  الحالية تغطيان مصدر الرد وسبب fallback عبر JSON وSSE والتاريخ؛ لا يُنشأ عقد
  `CanonicalAgentResponse` موازٍ ضمن هذا القرار.
- **remaining/blocker:** فشل `INVALID_PROVIDER_RESPONSE` غير مربوط بمرحلة
  التصحيح. لقطة الأدلة الدائمة تُنشأ عند finalization بعد synthesis، فلا يملك
  telemetry المحاولة معرّف اللقطة النهائي وقت الإرسال. لم تُغلق بوابة الوثائق،
  وP6 ما زالت `partial`.
- **next step:** راجع الوثيقتين وأغلق بوابة الوثائق قبل أي تغيير runtime/schema.
  بعد ذلك فقط يمكن تقييم إصلاح محدود لحدّ synthesis والتسجيل المرحلي، دون إعادة
  قراءة الأدلة أو إنشاء عقد موازٍ؛ ويبقى ترتيب P6 قبل P7 ملزمًا.

### 42.46 P6 — إغلاق pilot Runtime Golden Slice (2026-09-26)

- **phase/step:** P6 — `runtime.start` من `stopped` إلى `running`
- **status:** `done` للنطاق المحدد؛ `restart/stop` خارج pilot.
- **what changed:** يستهلك D1 مراجعة الأب ويطابقها مع before-state مباشر مستقل،
  ويمنع `manager.start` عند الغياب أو تعذر القراءة أو التعارض. يتحقق transition
  بعد القبول من after-state والجلسة نفسها ومراجعة المشروع والبيئة، دون تغيير
  قبول Gate C عند فشل materialization. يعيد D2 فحص transition وobservations
  المقفولة قبل Mission dispatch، ويربط proof بـtransition/execution/attempt/
  episode/action/effect bundle، وparent/resulting world revisions، ومراجعة
  المشروع والبيئة، ومراجع before/after، وخطوتي المصدر والهدف وبصمة الخطة. لا
  يشترط ثبات مراجعة الإسقاط العام؛ الاختبار يثبت dispatch رغم إضافة حقيقة
  مشروع غير مرتبطة.
- **files/schema/contracts touched:** `mission-runtime.ts` واختباراته،
  `recipe-operation-runner.test.ts`، وخطة التنفيذ وسجل التقدم؛ لا schema أو
  production data.
- **validation:** `pnpm run typecheck` من الجذر نجح. نجحت الملفات الخمسة
  `mission-runtime.test.ts`, `recipe-operation-runner.test.ts`,
  `agent-state/world-state.test.ts`,
  `agent-state/runtime-start-transition.test.ts`,
  `routes/world-state.test.ts` (`55/55`). أُعيد التحقق من `git diff --check`.
- **authority/safety impact:** D2 يمنح dispatch للخطوة التابعة المحددة فقط؛ لا
  يمنح Goal اكتمالًا أو `SUCCEEDED` أو `PROVEN`. بقي acceptance مستقلًا عن
  materialization، ولا توسع في الصلاحيات أو schema.
- **remaining/blocker:** لا مانع داخل pilot. سلوك `restart/stop` وعمومية World
  Delta خارج النطاق.
- **next step:** ابدأ P7 لتشخيص فشل World State من `WorldTransition` والأدلة
  المرتبطة به. موثوقية synthesis تظل مسألة منفصلة وليست P7.

### 42.47 P7 — تشخيص bounded لانتقال runtime.start (2026-09-26)

- **phase/step:** P7 — pilot `runtime.start` من `stopped` إلى `running`
- **status:** `done` للنطاق المحدد
- **what changed:** أضيف تشخيص server-owned يربط سبب الفشل بالافتراض والأثر
  المتوقع، fact refs، observation IDs الداعمة أو المناقضة، hypotheses غير
  موزونة، وأكواد observations الفاصلة والتصرف المقترح. اختيار transition
  المقبول حتمي، ويستخدم التشخيص الصفوف المرتبطة به فقط. المساران المباشر وwake
  يحفظان التشخيص في جذر `outcomeContract` المشترك، ويمرره auto-replan كسياق
  bounded واستشاري.
- **files/schema/contracts touched:** `world-state-failure-diagnosis.ts` واختباره،
  `mission-runtime.ts` واختباراته، `mission-auto-replan.ts` واختباره،
  `mission-planning.ts`، prompt Mission، والخطة وسجل التقدم والذاكرة؛ لا schema
  أو production data.
- **validation:** `pnpm run typecheck` نجح. نجحت سبعة ملفات API مستهدفة
  (`world-state-failure-diagnosis`, `mission-runtime`, `mission-auto-replan`,
  `recipe-operation-runner`, اختبارات World State وruntime transition وroute)
  بنتيجة `62/62`. فحص `git diff --check` نجح.
- **authority/safety impact:** بقي Gate C acceptance مستقلًا؛ التشخيص لا يحقق
  Goal أو `PROVEN` ولا يمنح scope أو صلاحية. حالات التناقض وربط المصدر تتطلب
  approval، ونقص الدليل لا يجيز إعادة الفعل من دون دليل جديد.
- **remaining/blocker:** الإغلاق محصور في transition pilot؛ أفعال World State
  الأخرى غير مغطاة.
- **next step:** لا خطوة أخرى ضمن هذا النطاق؛ لا توسعة إلى transitions أخرى
  دون خطة ونطاق صريحين.

### 42.48 P7.5 — Scoped held-out calibration gate (2026-09-26)

- **phase/step:** P7.5 — معايرة forecast الخاص بـMission `runtime.start`
- **status:** `partial`
- **what changed:** أضيف score لكل outcome كامل باستخدام Brier، وevaluator
  server-owned يحسب classwise ECE بعشرة bins وحدًا علويًا percentile 95% عبر
  mission-cluster bootstrap حتمي. يلزم 30 Mission مستقلة مكتملة؛ أي registration
  unresolved يمنع اعتماد scope بدل استبعاده. scope مربوط بمراجعة المشروع والبيئة
  والـobjective وhypothesis/observation وسياسة المعايرة والطريقة والـheld-out
  partition. بقي الاختيار `fixed_safe_probe` دائمًا.
- **files/schema/contracts touched:**
  `runtime-start-hypothesis-experiment.ts`,
  `runtime-start-hypothesis-calibration.ts` واختباراتهما،
  `recipe-operation-runner.ts`، وخطة التنفيذ وسجل التقدم؛ لا migration أو schema
  قاعدة بيانات.
- **validation:** اختبارات
  `runtime-start-hypothesis-experiment.test.ts`,
  `runtime-start-hypothesis-calibration.test.ts`,
  `recipe-operation-runner.test.ts` نجحت (`29/29`). نجح `pnpm run typecheck` و
  `git diff --check`. أُعيد تشغيل `artifacts/api-server: API Server` وأعاد
  `GET /api/healthz` حالة `200` مع `status: ok`.
- **authority/safety impact:** لا تغيير في Gate C أو P6/P7 acceptance أو
  الصلاحيات. لم يتغير start/restart/stop؛ معايرة forecast لا تغير اختيار probe.
- **remaining/blocker:** لا توجد بعد 30 Mission held-out ضمن scope واحد، لذلك
  لا scope مؤهل ولا forecast marked validated. expected-decision-value ranking
  وBelief updates وP8 ما زالت مفتوحة.
- **next step (محدّث في §42.58):** لا تبدأ الجمع مباشرة. أغلق أولًا بوابة
  الجاهزية: أهلية Mission path، تكرار الانتقال ضمن بيئة مضبوطة، استعادة
  التسجيلات غير المكتملة، وثبات الـheld-out policy وصحة evaluator. بعد ذلك فقط
  اجمع outcomes حقيقية ضمن scope واحد، مع بقاء `fixed_safe_probe`.

### 42.49 — Evidence-Preserved Synthesis Gateway (2026-09-26)

- **phase/step:** موثوقية synthesis لاستعلام المشروع؛ عمل عابر للمراحل داخل مسار الدردشة.
- **status:** `done` للنطاق المستهدف المعتمد؛ التوليف الحتمي العام ما زال محظورًا.
- **what changed:** تُنشأ حزمة أدلة مجمدة وذات بصمة بعد اكتمال manifest والمطالبات
  server-owned، وتُستخدم حزمة واحدة لمحاولات no-tools. تسجل المحاولات ضمن
  ميزانية synthesis المشتركة، مع attempt/manifest IDs والمدة ونتيجة العقد وبصمة
  المخرج أو `none` عند فشل المزود قبل الإخراج. تربط استجابة القبول وterminal
  attempt المقبولة والحزمة ببصمات الرد النهائي. إسقاط API يحتفظ بهذه الحقول
  المحددة فقط؛ لا نص مزود أو أجسام ملفات أو مسارات في trace.
- **files/schema/contracts touched:** `chat-agent.ts` و`tool-execution-engine.ts`
  واختبارات orchestrator؛ `routes/ai/chat.ts` واختبار تكامل SSE/القبول؛ خطة التنفيذ.
  لا migration أو جدول أو envelope استجابة جديد.
- **validation:** اختبار `chat-agent.test.ts` و
  `objective-evidence-handoff-baseline.test.ts`؛ اختبار تكامل API الذي يثبت أن
  رسالة `finalMessageId` نفسها تحمل attempt/manifest/response bindings وأن صف
  القبول يربطها بلقطة الأدلة؛ typecheck و`git diff --check` موثقة بعد نجاحها.
- **authority/safety impact:** الأدلة والقبول server-owned وبوابة الفشل مغلقة؛
  لا يفتح provider citations أو prose مسار قبول. لا تغيير في P6/P7 أو صلاحيات
  الأدوات أو عقد JSON/SSE.
- **remaining/blocker:** يظل fallback الحتمي العام لـ`PROJECT_QUERY` محظورًا عند
  غياب المطالبات المكتملة. عقد claims المحدود لأهلية handoff من نتيجة مقبولة
  أُنجز في §42.51، لكنه لا يوسّع fallback ولا يعامل claims المزود كسلطة.
- **next step:** أي توسيع لـfallback يحتاج عقدًا عامًا وتقييمًا مستقلين تحت
  بوابة القبول الحالية؛ لا يتطلب handoff المحدود إعادة فتح هذا المسار.

### 42.50 — Chat-to-Mission handoff من finding مقبول (2026-09-26)

- **phase/step:** توثيق قرار تكامل منتج بين Chat Read-Only وMission Validation؛
  ليس P-stage أو dependency جديدة.
- **status:** `not_started` — proposal موثق فقط؛ لم يتغير runtime أو UI.
- **what changed:** أضيف عقد bounded لتحويل finding ذي claims مقبولة إلى Mission
  عبر plan preview ذات planHash، موافقة المستخدم، ومراجع خادمية للرسالة والقبول
  وevidence snapshot ومراجعة المصدر. أعيد تأكيد أن provenance لا يمنح scope
  أو write authority، وأن أي mutation يحتاج أدلة وvalidation على المراجعة الحالية.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`
  و`docs/agent-generalization-progress.md`؛ لا code أو schema أو بيانات.
- **validation:** مطابقة وثائقية مع §31، Slice A/B، §3.1–§3.6، §42.49،
  ومسارات Chat/Mission الحالية؛ لا اختبارات runtime لأن التغيير توثيقي.
- **authority/safety impact:** لا تغيير في acceptance أو permissions أو
  dependency graph؛ لا graph أو executor أو response envelope جديد.
- **remaining/blocker:** يلزم عقد claims server-owned لـPROJECT_QUERY العام،
  واختبار crash/recovery لهوية الرسالة النهائية وصف القبول. خطة P7.5 ما زالت
  تحتاج held-out outcomes ضمن scope مؤهل.
- **next step:** أنجز شروط §31 والاعتماد المذكور في شريحة finding→Mission؛
  بعد ذلك فقط يحدد تنفيذ UI منفصل مع اختبار planHash والمصدر stale والقبول.

### 42.51 — Accepted PROJECT_QUERY finding to Mission integration (2026-09-26)

- **phase/step:** تكامل اختياري عابر للمراحل بين Chat Read-Only وMission
  Validation؛ لا يضيف مرحلة أو dependency إلى §31.
- **status:** `done` للنطاق المحدود: معاينة غير دائمة، موافقة `planHash`،
  handoff مرتبط بمصدر PROJECT_QUERY المقبول، وعرض provenance وروابط الرجوع.
- **what changed:** اكتمل عقد claims server-owned لهوية الرسالة والقبول؛ ربط
  الخادم مصدر handoff بصفوف المشروع والجلسة والرسائل والقبول ولقطة evidence
  والمراجعة والclaims المقبولة. تستقبل Chat روابط المشروع/الجلسة/رسالة المصدر
  وتنتقل إليها. تعرض Missions معرّفات القبول ولقطة evidence والمراجعة والclaims
  و`planHash`، ورابط Chat ورابط Mission Control للتنفيذ. رفضت API إنشاء provenance
  مزيف من Mission عادي، وتحفظ المصدر server-owned عند تحديث `autonomyPolicy`.
- **files/schema/contracts touched:** `artifacts/api-server/src/routes/ai/missions.ts`
  واختبارها؛ `artifacts/dashboard/src/pages/AiChat.tsx` و`Missions.tsx`
  واختبار Missions؛ `docs/agent-generalization-execution-plan.md`. لا migration،
  جدول أو envelope استجابة جديد.
- **validation:** `pnpm run typecheck` و`git diff --check` نجحا؛ خمسة اختبارات
  API مركزة لعقد handoff/الاسترداد/عدم قابلية تزوير المصدر نجحت؛ اختبار UI
  لبطاقة provenance وروابط Chat وMission Control واختبار Chat route-target
  نجحا. نجح `dashboard-restart-smoke`، وأعاد `/api/healthz` حالة 200. أعادت
  الخدمات العمل؛ preview غير المصادق عليه انتقل إلى Clerk sign-in ولم يسجل
  أخطاء متصفح، لذلك لم تُعاين صفحة Missions بعد الدخول.
- **authority/safety impact:** لا تغيير في صلاحيات mutation أو بوابات Goal،
  runtime، approval أو Canonical Proof. provenance سياق فقط ولا يعوّض قراءة أو
  تحققًا على المراجعة الحالية؛ لا graph أو planner أو executor موازٍ.
- **remaining/blocker:** ظهر سابقًا فشل paired-baseline ضمن التشغيل الكامل؛
  إعادة التحقق الموثقة في §42.52 لم تستعده، ولم يتضح سبب ظهوره السابق.
- **next step:** لا تغيّر بوابة المقارنة ما دام الفشل غير قابل لإعادة الإنتاج؛
  يبقى fallback الحتمي العام لـPROJECT_QUERY عملًا منفصلًا وفق §31.

### 42.52 — Mission paired-baseline reliability recheck (2026-09-26)

- **phase/step:** إعادة تحقق لاختبار Gate 3 داخل تكامل Mission؛ لا تغيير runtime.
- **status:** `done` لإعادة التحقق؛ لم يُعثر على فشل قابل لإعادة الإنتاج.
- **what changed:** شُغّل `missions.test.ts` من جذر API package ثلاث مرات؛
  نجحت كل مرة `23/23`، بما فيها paired-baseline وGate 4 registry. لم تُعدّل
  شروط المقارنة أو receipt أو مسارات القبول لأن الفشل السابق لم يظهر مجددًا.
- **files/schema/contracts touched:** سجل التقدم فقط؛ لا تغييرات كود أو schema.
- **validation:** `cd artifacts/api-server && pnpm exec vitest run
  src/routes/ai/missions.test.ts`؛ ثلاثة تشغيلات متتابعة اكتملت كلها بنجاح.
  هذا هو جذر الاختبار المعتمد في package ويستخدم إعداد Vitest الخاص به.
- **authority/safety impact:** لا تغيير في Gate 3 أو شرط Gate 4 الذي يتطلب
  paired baseline ناجحًا و`promotionAllowed: true`.
- **remaining/blocker:** سبب نتيجة `incomplete` السابقة غير معروف، ولم يعد
  متاحًا لإعادة الإنتاج في التشغيل الحالي. لا يُعد هذا إثباتًا لسبب جذري أو
  مبررًا لتخفيف gate.
- **next step:** تابع ترتيب §31؛ أي fallback حتمي عام لـPROJECT_QUERY يحتاج
  عقدًا وتقييمًا مستقلين، ولا يرتبط بإعادة تحقق Gate 3.

### 42.53 — Bounded generic PROJECT_QUERY claim-closure proof (2026-09-26)

- **phase/step:** تحقق من العقد المحدود `PROJECT_QUERY_GENERIC-PROJECT`؛ لا تغيير
  في dependency graph أو صلاحيات التنفيذ.
- **status:** `done` لمسار النجاح المحدود؛ يظل المسار العام بلا objective
  canonical مغلقًا عند نقص الدليل أو فشل synthesis.
- **what changed:** أضيف اختبار orchestrator يفشل فيه synthesis بعد ثلاث قراءات
  كاملة retained، ثم يثبت materialization للمطالبات الثلاث، fallback الحتمي،
  وعدم إعادة حلقة الأدوات، وإغلاق objective بحالة `PROVEN`. أضيف اختبار API/SSE
  بtrace fixture يثبت أن الخادم مرر objective canonical، وقبل refs الثلاثة فقط،
  وأسقط provenance في الرسالة النهائية والتاريخ. fixture الـAPI يغطي acceptance
  والإسقاط، بينما اختبار orchestrator يغطي synthesis الفعلي. لم يتغير runtime.
- **files/schema/contracts touched:**
  `lib/ai-orchestrator/src/__tests__/objective-evidence-handoff-baseline.test.ts`
  و`artifacts/api-server/src/routes/ai-stream-integration.test.ts`؛ لا ملفات
  runtime أو schema.
- **validation:** من `lib/ai-orchestrator` نجح
  `pnpm exec vitest run src/__tests__/objective-evidence-handoff-baseline.test.ts`
  (`17/17`). ومن `artifacts/api-server` نجح
  `pnpm exec vitest run src/routes/ai-stream-integration.test.ts -t 'bounded generic PROJECT_QUERY objective'`
  (`1/1`، 102 متجاوزة بالمرشح). نجح أيضًا
  `cd artifacts/api-server && pnpm run typecheck` و`git diff --check`.
- **authority/safety impact:** claims والقبول ما زالا server-owned؛ لا قبول
  لاقتباسات provider. لم يتغير fallback لـ`projectOrientation` أو بوابات P6/P7،
  ولم يُفتح fallback للمسار العام بلا objective.
- **remaining/blocker:** لم تضف هذه الشريحة اختبارًا سلبيًا منفصلًا للمسار
  generic عند قراءة truncated/needle غائب، ولا تغطي JSON وSSE معًا لنفس fixture.
  اختبارات JSON العامة الحالية منفصلة عن اختبار قبول `generic-project`.
- **next step:** أضف تغطية نقص الدليل وتكافؤ JSON/SSE/history للهدف المحدود إن
  لزم، مع إبقاء `PROJECT_QUERY` بلا objective canonical غير مكتمل.

### 42.54 — Generic PROJECT_QUERY نقص الدليل وتكافؤ الإسقاطات (2026-09-26)

- **phase/step:** إغلاق فجوات §42.53؛ إثبات فشل الإغلاق عند نقص الدليل وتكافؤ
  JSON/SSE/history، بلا تغييرات runtime أو صلاحيات.
- **status:** `done`.
- **what changed:** أضيف اختباران سلبيان للهدف العام: body مبتور مع حالة
  `READ_TRUNCATED`، وغياب كل needles الخادمية المطلوبة. في الحالتين لا تُغلق
  كل المطالبات، ويرجع مسار `chat` نتيجة غير مكتملة دون اختيار
  `deterministic_fallback`. اختبار API واحد يستخدم fixture موحدًا لإثبات أن
  fallback الحتمي المقبول مع الدليل الكامل والـrefs الثلاثة يظهر باتساق في
  JSON وSSE والتاريخ.
- **files/schema/contracts touched:**
  `lib/ai-orchestrator/src/__tests__/objective-evidence-handoff-baseline.test.ts`
  و`docs/agent-generalization-progress.md` و
  `.agents/memory/project-query-semantic-acceptance.md`؛ لا ملفات runtime أو
  schema.
- **validation:** نجح ملف orchestrator كاملًا (`19/19`) و`pnpm run typecheck`
  من `lib/ai-orchestrator`. نجح اختبار API/SSE/JSON/history المحدد (`1/1`،
  102 متجاوزة بالمرشح) و`cd artifacts/api-server && pnpm run typecheck`.
  أُعيد تشغيل API workflow بعد تعارض منفذ قديم، وأصبح `RUNNING`.
- **authority/safety impact:** إغلاق المطالبات وrefs والقبول تبقى server-owned؛
  القراءة المبتورة أو needle الغائب لا يفتحان fallback ناجحًا. لا تغييرات
  runtime أو schema أو صلاحيات.
- **remaining/blocker:** لا يوجد ضمن هذا النطاق.
- **next step:** أبقِ `PROJECT_QUERY` بلا objective canonical أو بلا كل أدلته
  المطلوبة غير مكتملًا؛ لا توسّع fallback خارج عقده المحدود.

### 42.55 — Generic PROJECT_QUERY بلا objective canonical (2026-09-26)

- **phase/step:** تثبيت حد §42.54 للمسار العام غير المربوط بعقد claims.
- **status:** `done`.
- **what changed:** عُزّز اختبار `chat` مباشر لطلب `PROJECT_QUERY` بلا objective،
  مع قراءة retained كاملة ورد مرشح من النموذج. تبقى الاستجابة
  `ANALYSIS_INCOMPLETE`، ولا يظهر مصدر fallback أو سببه أو diagnostic لاختيار
  `PROJECT_QUERY_RESPONSE_SOURCE`. عُزلت حلقة الأدوات بfixture ثابت كي يختبر
  الاختبار حد القبول دون قراءة مشروع فعلي.
- **files/schema/contracts touched:**
  `lib/ai-orchestrator/src/__tests__/chat-agent.test.ts` و
  `docs/agent-generalization-progress.md`؛ لا ملفات runtime أو schema.
- **validation:** نجح الاختبار المحدد من `lib/ai-orchestrator` (`1/1`؛ 68 اختبارًا
  متجاوزة بالمرشح)، ونجح `pnpm run typecheck` من جذر workspace و`git diff --check`.
- **authority/safety impact:** لا تغيير في runtime أو الصلاحيات؛ غياب objective
  canonical يمنع fallback/اكتمال الاستعلام حتى مع وجود قراءة كاملة.
- **remaining/blocker:** لا فجوة أخرى ضمن هذا الحارس.
- **next step:** أبقِ المسار العام بلا objective غير مكتمل؛ أي توسيع لاحق يتبع
  البنود المتبقية المحددة في §36 ولا يفتح fallback غير مسنود بعقد server-owned.

### 42.56 — API terminal parity لـPROJECT_QUERY بلا objective (2026-09-26)

- **phase/step:** تثبيت حد §42.55 عند إسقاط نتيجة API لمسار source-first غير
  المحلول.
- **status:** `done`.
- **what changed:** أضيف اختبار API لعبارة `Explain the system architecture.`
  التي تدخل `PROJECT_QUERY` غير المحلول بلا target أو objective، مع قراءة
  retained كاملة. يثبت الاختبار أن SSE ينتهي بقبول `FAILED/INCOMPLETE`، وأن JSON
  والتاريخ لا يعرضان النتيجة `SUCCEEDED` ولا provenance لـfallback. كشف الاختبار
  أن JSON كان يصنف الرد غير المكتمل نجاحًا؛ أضيف حارس إسقاط ضيق لا يحول النجاح
  إلى اكتمال إذا تطلب الاستعلام دليلًا ولم يُحل objective canonical. استُثني
  مسار project orientation، ولم يتغير fallback.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/routes/ai/chat.ts` و
  `artifacts/api-server/src/routes/ai-stream-integration.test.ts` و
  `docs/agent-generalization-progress.md`؛ لا تغييرات schema.
- **validation:** نجح الاختبار المحدد من `artifacts/api-server` (`1/1`)، ونجح
  `pnpm run typecheck` من جذر workspace. أُعيد فحص `git diff --check` وأعيد تشغيل
  API workflow مرة واحدة بعد التعديل.
- **authority/safety impact:** لا صلاحيات أو أدوات أو fallback إضافية؛ غياب
  objective يمنع نجاح إسقاط JSON، بينما يبقى قبول المشروع ومصدر fallback
  محكومين بعقدهما الحاليين.
- **remaining/blocker:** لا فجوة ضمن هذا المسار.
- **next step:** استأنف أقرب بند غير مغلق من dependency graph في §31؛ §36 في
  execution plan حزمة تاريخية مكتملة، وليس نقطة بدء جديدة.

### 42.57 — P7.5 outcome availability check (2026-09-26)

- **phase/step:** P7.5 — التحقق من توافر نتائج held-out المؤهلة قبل أي معايرة.
- **status:** `blocked`.
- **what changed:** لم تتغير الشيفرة أو البيانات. استعلام تجميعي read-only في
  قاعدة التطوير لم يجد تسجيلات أو نتائج لتجارب P7.5. وبعد موافقة المستخدم على
  فحص الإنتاج، أعاد مسار قاعدة البيانات أن المشروع لا يملك قاعدة إنتاج قبل
  النشر؛ لم تُقرأ بيانات إنتاج ولم يحدث أي تعديل.
- **files/schema/contracts touched:** سجل التقدم فقط؛ لا schema أو runtime.
- **validation:** استعلام التطوير أعاد صفر سجلات. استعلام الإنتاج رفضه غياب
  قاعدة إنتاج؛ لا توجد محاولة كتابة.
- **authority/safety impact:** لم تُنشأ Missions أو نتائج اصطناعية. يظل
  `fixed_safe_probe` كما هو؛ fixtures الاختبار ليست بيانات held-out.
- **remaining/blocker:** لا توجد بيانات فعلية متاحة لتقييم scope، ولا يمكن بلوغ
  30 Mission مستقلة مكتملة من دون تشغيلات حقيقية ضمن scope والسياسة نفسيهما.
- **next step:** اجمع النتائج فقط من تشغيلات Mission فعلية ومأذونة بعد توافر
  قاعدة البيانات المناسبة؛ أعد تقييم scope مع بقاء `fixed_safe_probe` حتى اجتياز
  حدود §25.4.

### 42.58 — P7.5 pre-collection readiness review (2026-09-27)

- **phase/step:** مراجعة جاهزية جمع held-out outcomes وربطها بالبنية الفعلية؛
  تحديث توثيقي فقط، بلا بدء حملة أو تغيير runtime.
- **status:** `done` للمراجعة والتوثيق؛ `blocked` لبدء cohort حتى إغلاق شروط
  الجاهزية في §42.8.
- **what changed:** ثُبت أن P7.5 الحالية تقيس bootstrap forecast ثابتًا لـ
  `runtime.start` ضمن scope مشروع/مراجعة/بيئة، ولا تقيس classifier أو
  `expectedDecisionValue` ولا تمنح اختيارًا آليًا. جمع العينة يتطلب Mission
  runtime المربوط بـMission/Goal/planRevision وtransition فعليًا من
  `stopped`; endpoint العام `/runtime/start` لا يملك تلك الهويات. وثّق أن
  التكرار يتطلب reset مشغّلًا لبيئة مضبوطة من دون توسيع صلاحية الوكيل، وأن
  `missionId` المختلف وحده لا يثبت الاستقلال. أضيفت مراجعة recovery لأن أي
  registration غير محسوم يمنع اعتماد scope، ومتطلبات اختبار إحصائي يدوي/مرجعي
  وثبات policy/held-out قبل جمع النتائج. عُدّل ترتيب الأولوية: readiness أولًا،
  البيانات الفعلية ثانيًا، وواجهة التقدم اختيارية لاحقًا. لا يلزم production DB
  لجمع نتائج جديدة إذا كانت Mission runtime المؤهلة تعمل على DB التطوير؛ غيابها
  يمنع فقط قراءة بيانات production موجودة.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`
  و`docs/agent-generalization-progress.md` فقط؛ لا تغييرات كود أو schema أو
  قاعدة بيانات أو صلاحيات.
- **validation:** مطابقة الصياغة مع `runtime-start-hypothesis-experiment.ts`،
  `runtime-start-hypothesis-calibration.ts`، `recipe-operation-runner.ts`،
  `routes/runtime.ts`، `mission-runtime.ts`، §25.4 و§31؛ `git diff --check`.
- **authority/safety impact:** لا تغيير في P6/P7/Gate C أو acceptance أو scope
  والصلاحيات. يبقى `fixed_safe_probe`؛ لا حذف أو استبعاد انتقائي للنتائج
  غير المكتملة، ولا توليد عينات اصطناعية.
- **remaining/blocker:** لا نتائج held-out حقيقية. يلزم إثبات قناة الجمع المؤهلة،
  والتكرار الآمن في scope ثابت، وسلوك التعافي/idempotency بعد interruption،
  وصحة ECE/فاصل bootstrap على حالات ذات حقيقة متوقعة قبل بدء حملة.
- **next step:** تنفيذ اختبارات/آلية الجاهزية المحددة في §42.8 قبل أي جمع؛ لا
  تبدأ لوحة تقدم أو selector بوصفهما بديلًا عن هذه البوابة. تبقى PROJECT_QUERY
  بلا objective canonical غير مكتملة عمدًا وفق §42.56.

### 42.59 — P7.5 evaluator tests and recovery boundary (2026-09-27)

- **phase/step:** تنفيذ اختبارات مرجعية للمعايرة وتتبع recovery قبل أي جمع حقيقي.
- **status:** `done` لاختبارات evaluator وتحديد حد التعافي؛ `blocked` لجمع cohort
  حتى اعتماد معالجة التسجيلات القديمة أو scope versioned جديد.
- **what changed:** أضيفت توقعات ECE محسوبة يدويًا مع class نادر وآخر غائب؛
  واختبار يثبت أن إعادة عينات Mission نفسها تُحسب cluster واحدًا، واختبار bootstrap
  يقارن عينات متطابقة هامشيًا لكن مختلفة التجميع ويؤكد اتساع عدم اليقين عند
  clustering الأقوى وثبات النتيجة مع إعادة ترتيب الإدخال. أضيف اختبار يثبت أن
  resumed attempt/episode ينتج experimentId جديدًا، وأن outcome من المحاولة
  الجديدة لا يمحو registration قديمًا unresolved. أثبت التتبع أن lease recovery
  يدور attempt ويبدأ Episode جديدًا؛ runtime.start يتجنب إعادة spawn إذا تعرّف
  على runtime قائم، لكن ذلك لا يعيد ربط نتيجة P7.5 بالتجربة الأصلية. الإلغاء
  terminal وغير resumable.
- **files/schema/contracts touched:** اختبارات
  `runtime-start-hypothesis-calibration` و`runtime-start-hypothesis-experiment`،
  و`docs/agent-generalization-execution-plan.md` و
  `docs/agent-generalization-progress.md` فقط؛ لا تغييرات runtime أو schema أو
  قاعدة البيانات أو thresholds.
- **validation:** اختبارات Vitest المستهدفة نجحت (15 اختبارًا)، ونجح
  `pnpm run typecheck` و`git diff --check`.
- **authority/safety impact:** لا تعديل على `fixed_safe_probe` أو Gate C أو
  runtime.start authority. لا ربط لدليل عبر attempts/Episodes ولا إسقاط انتقائي
  لتسجيلات غير مكتملة.
- **remaining/blocker:** الاستعادة الآمنة للتسجيل الأصلي غير مثبتة، والإلغاء
  يبقي التسجيل بلا نتيجة. يظل أي scope يحوي registration unresolved
  `incomplete_measurements`.
- **next step:** اعتماد مسار observe-only يحفظ ربط التجربة الأصلية دون إعادة
  الأثر، أو توثيق إنشاء scope جديد يتضمن policy version جديدة وheld-out cohort
  مستقبلية؛ لا تبدأ حملة بيانات قبل ذلك.

### 42.60 — P3.5 durable Mission repair tool-action recovery (2026-09-27)

- **phase/step:** P3.5 — استعادة request/commit لهوية tool action المعتمدة داخل
  `mission_repair`.
- **status:** `done` لهذه الشريحة؛ P3.5 العامة ما زالت `partial`.
- **what changed:** أزيل الاعتماد على خريطة actions داخل ذاكرة العامل. قبل
  `ACTION_COMMITTED` يسترجع الخادم `ACTION_REQUESTED` من Episode الدائم، مع تقييد
  الاستعلام بـproject/episode/execution/attempt، ثم يتحقق من actor و
  `candidate_overlay` ومن تطابق `AgentAction` canonical كاملًا. الطلب الغائب أو
  المتعارض أو المشوه يفشل مغلقًا؛ لا يسمح ذلك بإعادة استخدام request من attempt
  أو Episode آخر. يظل حدث commit دليلًا على staging داخل candidate overlay فقط.
- **files/schema/contracts touched:** helper استعادة داخلي، `task-execution-service`
  واختبار Mission lifecycle، وهذا السجل؛ لا schema أو migration أو توسيع
  authorization/tool inventory.
- **validation:** 10 اختبارات Vitest مستهدفة نجحت؛ نجح `pnpm run typecheck` و
  `git diff --check`. أُعيد تشغيل API workflow وبُني وبدأ دون خطأ إقلاع ظاهر.
- **authority/safety impact:** لا إعادة لتشغيل أداة، ولا كتابة إلى live root، ولا
  per-tool EffectBundle أو acceptance. تبقى الملاحظة المستقلة المجمعة وبوابة
  الأثر الحالية وحدهما أساس قبول candidate.
- **remaining/blocker:** الاستعادة مقيّدة بالـattempt نفسها؛ الـattempt الجديد
  يحتاج هوية ودليلًا جديدين. بقية توحيد Action/Observation وWorld Delta في
  P3.5–P6 ما زالت مفتوحة.
- **next step:** تابع أصغر فجوة P3.5 التالية وفق §42.2، مع عدم تجاوز اعتماديات
  الرصد المستقل والتحقق من الأثر في P4/P5.

### 42.61 — P3.5 durable Mission repair worker provenance during recovery (2026-09-27)

- **phase/step:** P3.5 — حفظ provenance الكاتب مع استعادة `ACTION_REQUESTED`
  عبر تغيير العامل ضمن attempt نفسها.
- **status:** `done` لهذه الشريحة؛ P3.5 العامة ما زالت `partial`.
- **what changed:** عند إعادة امتلاك execution للـattempt نفسها يتغير workerId
  بينما يعيد Mission repair Episode نفسها. لذلك يحفظ request actorId كـprovenance
  (ويشترط actorType=`worker` وactorId غير فارغ) بدل مساواته بالعامل الحالي؛
  equivalence الخطرية يحسمها التطابق الكامل للـAction/project/Episode/execution/
  attempt و`candidate_overlay`. حدث `ACTION_COMMITTED` اللاحق ما زال يمر عبر
  `appendEpisodeEvent` الذي يفرض lease وهوية العامل الحالي.
- **files/schema/contracts touched:** helper الاستعادة، مستدعي Mission tool loop،
  اختبار التكامل وسجلات الخطة/التقدم؛ بلا تغيير schema أو migration أو صلاحيات.
- **validation:** اختبارات API المستهدفة 18/18 (Mission lifecycle/effect ‏10/10؛
  Episode ledger ‏8/8)، و`pnpm run typecheck` و`git diff --check` نجحت؛ أُعيد
  تشغيل API وظهر `Server listening`. يغطي اختبار DB-backed استعادة الطلب بعد
  عودة دورة التنفيذ، مع رفض الطلب الغائب وتعارض Action واختلاف المحاولة.
- **authority/safety impact:** هوية الكاتب الدائمة provenance وليست سلطة؛
  `appendEpisodeEvent` هو الذي يثبت العامل الحالي والـlease قبل تسجيل commit.
  لا إعادة لأداة أو كتابة إلى live root أو إنشاء أثر/قبول لكل tool.
- **remaining/blocker:** هذه طبقة دفاع إضافية ضمن attempt نفسها؛ لا تستعيد سجلًا
  عبر attempt أو Episode مختلفة. يبقى actorId provenance للكاتب الأصلي، فيما
  يحسم lease الحالي صلاحية تسجيل commit بعد الاستعادة. ما زال P3.5 الأشمل
  وP4/P5 جزئيًا.
- **next step:** تابع أصغر فجوة P3.5 التالية وفق §42.2؛ لا تتجاوز متطلبات الرصد
  المستقل والتحقق من الأثر، ولا تبدأ P6/P7 قبل استحقاقها.

### 42.62 — P3.5 Mission aggregate candidate recovery contract (2026-09-27)

- **phase/step:** P3.5 — تحديد حد استعادة سياق aggregate candidate effect بعد
  فقدان العامل، قبل إضافة replay runtime.
- **status:** `design recommendation recorded; runtime replay remains gated`.
- **what changed:** audit للـcheckpoint وEpisode flow وجد أن `pendingChanges`
  وprojection مشتقة تحفظان candidate input، لكن سياق aggregate effect نفسه
  (`candidate workspace`, hashes، before-observation reference) محلي للعملية.
  checkpoint وEpisode أحداث durable منفصلة؛ validation قد يعاد تشغيله دون
  idempotency موثقة عند هذا الحد، و`ACTION_COMMITTED` لا يضمن semantic dedupe إن
  اختلف payload عند replay. لذلك لا تكفي الحالة المحفوظة وحدها لترخيص إعادة بناء
  EffectBundle أو استنتاج قبول ناجح.
- **files/schema/contracts touched:** مراجعة للـMission tool loop، checkpoint
  persistence، Episode ledger، observation materializer وeffect observer؛ تعديل
  توثيقي فقط، بلا schema أو migration أو runtime change.
- **validation:** تدقيق read-only لعقد §31 و§42.2 ومسار checkpoint/event/effect؛
  لا اختبارات runtime جديدة لأن التنفيذ مؤجل حتى حسم policy.
- **authority/safety impact:** لا replay أو كتابة candidate/live أو rerun
  validation أو قبول جديد أُضيف. تبقى الملاحظات المستقلة وEffectBundle الحاليان
  سلطة القبول الوحيدة.
- **recommended policy:** استعادة proof-carrying داخل attempt نفسها فقط عند
  مطابقة identities/checkpoint sequence/approval/revision/approved paths،
  وإعادة بناء candidate مع تطابق base/candidate hashes. يمكن تنفيذ validation
  مجددًا داخل disposable workspace كدليل جديد بمعرّف جديد؛ لا يعاد استخدام receipt
  قديم كإثبات. تتطلب النهاية ملاحظة مباشرة حديثة وEffectBundle/acceptance للهوية
  نفسها. كل حالة غير قابلة للإثبات تفشل مغلقًا وتحتاج attempt جديدة معتمدة.
- **remaining/blocker:** يجب حفظ/ربط validation evidence الجديدة مع candidate
  manifest ومصالحة نوافذ checkpoint/Episode/effect/acceptance المنفصلة.
  checkpoint وحده لا يمنح نجاحًا.
- **next step:** أُغلقت semantic idempotency لaggregate `ACTION_COMMITTED` فقط؛
  أضف الآن recovery manifest fenced بالـlease يربط candidate hashes والـvalidation
  evidence الجديدة، مع crash-window tests. لا تضف schema أو تفعّل replay قبل
  اجتياز هذه البوابات.

### 42.63 — P3.5 idempotent Mission aggregate ACTION_COMMITTED (2026-09-27)

- **phase/step:** P3.5 — منع تكرار أو تغيير commit التجميعي لنفس Mission repair
  action عند retry.
- **status:** `done` لهذه الشريحة؛ استعادة aggregate كاملة ما زالت غير مفعّلة.
- **what changed:** يميز Episode ledger فقط aggregate action ID
  `mission-repair:${executionId}:${attempt}`. داخل Episode نفسها، يعيد payload
  المطابق الحدث الموجود بلا sequence جديد؛ أما إعادة استخدام الهوية مع candidate
  hash أو دلالات مختلفة، أو ربطها بـexecution/attempt آخر، فيفشل `invalid_contract`.
  لا يشمل هذا `mission-repair-tool:*`؛ فحص worker/lease يسبق dedupe ويظل إلزاميًا.
- **files/schema/contracts touched:** Episode ledger واختباره، مع تحديث عقد
  الاستعادة في الخطة وسجل التقدم؛ لا schema أو migration أو صلاحيات أو validator.
- **validation:** نجحت 16 اختبارات Vitest عبر Episode ledger وMission lifecycle؛
  ونجح `pnpm run typecheck` و`git diff --check`.
- **authority/safety impact:** لا يضيف هذا EffectBundle ولا observation ولا
  acceptance. يمنع تعدد aggregate commit المتعارض فقط؛ التحقق من الأثر الحالي
  يظل شرط النجاح الوحيد، ولا يسمح replay من checkpoint.
- **remaining/blocker:** يجب ربط كل validation invocation الجديدة بهوية candidate
  manifest المقبولة، ولا توجد بعد مصالحة كاملة لنوافذ observation/effect/acceptance.
  استعادة غير قابلة للمطابقة تبقى incomplete.
- **next step:** نفّذ manifest/phase-reconciliation واختبارات crash windows؛
  validation الجديدة دليل جديد لا يعيد استعمال receipt سابقًا. fail-closed عند
  أي اختلاف، من دون live writes أو per-tool EffectBundle أو World Delta.

### 42.64 — P3.5 lease-fenced Mission repair recovery manifest (2026-09-27)

- **phase/step:** P3.5 — تسجيل مراحل candidate repair كمدخل استعادة مقيّد بالـlease.
- **status:** `partial; same-attempt recovery enabled only before commit`.
- **what changed:** يحفظ manifest مربوطًا بـproject/task/execution/attempt وEpisode/
  action وsource revision وcandidate identity وhashes للتغييرات والمسارات المعتمدة
  وbase/candidate trees. يسمح الاسترداد من `candidate_ready` و`validated` فقط،
  ويعيد بناء المرشح في validation workspace مؤقت، وينشئ before observation جديدة،
  ويعيد validator خادميًا للحصول على receipt جديد. المراحل `committed` و
  `effect_classified` تبقى محجوبة حتى مصالحة نافذة ما بعد commit مع الملاحظات
  وEffectBundle والقبول. يقرأ parser نص checkpoint الخام كاملًا لأن projection
  العامة تحد `detail` إلى 500 حرف. استعادة العامل البديل تستخدم فحص ملكية
  execution/lease الحالي؛ `Episode.workerId` وactor IDs القديمة تبقى provenance.
- **files/schema/contracts touched:** task execution service وeffect observer
  واختبارا lifecycle/effect observer وتوثيقا الخطة والتقدم؛ لا schema أو migration.
- **validation:** نجح API typecheck، ونجحا اختبارا Mission lifecycle وeffect
  observer (12 اختبارًا)، مع اختبار استعادة العامل البديل وإثبات before observation
  وvalidator receipt جديدين. نجح `git diff --check` وأعيد تشغيل API؛ سجل الخدمة
  يؤكد بدء التشغيل والاستماع على المنفذ 8080 بلا أخطاء بدء.
- **authority/safety impact:** الاستعادة محكومة بالـlease والهوية والمراجعة،
  لا تكتب في live project root، ولا تعيد استخدام إثبات قديم. manifest مفقود أو
  مشوه أو متعارض، أو تغير base/candidate، أو ACTION_REQUESTED دون manifest،
  يمنع الاستعادة صراحة.
- **remaining/blocker:** crash windows بعد `committed` وقبل اكتمال observation/
  EffectBundle/acceptance ما زالت غير قابلة للاستعادة، وتبقى `committed` و
  `effect_classified` محجوبة.
- **next step:** أكمل مصالحة proof للحالات بعد commit واختبارات crash windows
  قبل فتح أي استعادة من تلك المراحل.

### 42.65 — P3.5 — Mission repair post-commit recovery (2026-09-27)

- **phase/step:** P3.5 — استعادة Mission repair من `committed` و
  `effect_classified` بعد lease handoff.
- **status:** `partial; this recovery slice is complete, broader P3.5 remains partial`.
- **what changed:** يسمح parser ومسار الاستعادة الآن بالمراحل الأربع حتى
  `effect_classified`. عند وجود `ACTION_COMMITTED` يتحقق الاسترداد من action و
  candidate/base/tree identities وحالة validator وكون live tree بقي دون تغيير؛
  لا يعيد كتابة الحدث ولا يقبل اختلاف معناه. يستخدم checkpoint ملاحظات
  before/after المحفوظة كما هي عند اكتمال الزوج، كي يعيد EffectObserver النتيجة
  نفسها idempotently؛ وإذا توقفت الحالة بعد commit وقبل after observation،
  ينشئ زوجًا جديدًا بعد إعادة التحقق. تقدم المرحلة لا يتراجع، ويعاد validator
  لإنتاج receipt جديدة قبل قبول التنفيذ.
- **files/schema/contracts touched:** task execution service واختبارات lifecycle؛
  لا schema أو migration.
- **validation:** API typecheck و10 اختبارات lifecycle و4 اختبارات effect observer
  نجحت؛ `git diff --check` نظيف؛ أُعيد تشغيل API وتأكد بدء الخدمة بلا أخطاء.
- **authority/safety impact:** lease وattempt والهوية ومراجعة المصدر والمرشح
  تظل ملزمة؛ تعارض commit أو أثر محفوظ يفشل مغلقًا. لا live-root writes، ولا
  إعادة استعمال validator receipt قديم، ولا تكرار Effect rows في recovery
  المطابق.
- **remaining/blocker:** هذه الشريحة تغلق crash recovery بعد commit فقط؛ بقية
  DoD لـP3.5 ما زالت جزئية، وP4–P14 لم تبدأ ضمن هذه الخطوة.
- **next step:** راجع بقية P3.5 مقابل DoD في §42.2 قبل الانتقال إلى P4.

### 42.66 — P3.5 — Per-tool Mission repair commit idempotency (2026-09-27)

- **phase/step:** P3.5 — جعل إعادة محاولة أحداث `ACTION_COMMITTED` لأدوات
  `mission_repair` آمنة ودلالية ضمن execution/attempt.
- **status:** `done لهذه الشريحة؛ P3.5 الكامل يبقى partial وفق اعتماد §42.2 على P6`.
- **what changed:** يثبت ledger هوية commit من execution وattempt وtool-call hash،
  ويتحقق من tool/input hash وكون العملية staging داخل candidate overlay بلا
  live writes. تعيد إعادة المحاولة المطابقة الحدث المحفوظ؛ إعادة استخدام
  actionId مع target/payload مختلف أو attempt غير مطابق تفشل مغلقًا.
- **files/schema/contracts touched:** agent episode ledger واختباراته؛ لا schema
  أو migration، ولا تغيير في عقد per-tool EffectBundle.
- **validation:** API typecheck و9 اختبارات agent episode ledger و10 اختبارات
  task execution lifecycle نجحت؛ `git diff --check` نظيف.
- **authority/safety impact:** هذا يثبت idempotency لسجل staging فقط ولا يمنح
  الأداة سلطة جديدة ولا يحول `ACTION_COMMITTED` إلى proof للأثر. يبقى aggregate
  before/after وEffectBundle بوابة القبول الوحيدة.
- **remaining/blocker:** لا يمكن إعلان P3.5 `done` وفق §42.2 دون World Delta/
  revision closure في P6؛ الاستعادة لا تزال bounded ولا يوجد replay عام.
- **next step:** لا تبدأ P4–P14 ضمن هذه الشريحة؛ يلزم طلب مستقل قبل توسيع النطاق
  إلى مراحل الاعتماد.

### 42.67 — P3.5/P6 — تدقيق إعادة استخدام World Transition وترتيب retry (2026-09-27)

- **phase/step:** مراجعة معمارية قراءة فقط لمسار World Delta الحالي وعلاقته
  بـP3.5 وP6.
- **status:** `done (تدقيق فقط؛ لا تنفيذ للكود)`.
- **what changed:** تأكد وجود `ai_world_transitions` ومسار
  `runtime-start-transition` الخاص بـ`stopped → running`، مع materialization
  للملاحظات والـfacts وتحديث حالة الانتقال في معاملة واحدة، وretry دوري،
  واستهلاك Mission D2 للانتقال المقبول. لا حاجة إلى جدول أو Gateway موازية.
- **files/schema/contracts reviewed:** `ai_world_transitions`، و
  `runtime-start-transition.ts`، و`world-state.ts`،
  `recipe-operation-runner.ts`، و`job-reconciliation.ts`،
  `mission-runtime.ts`، و`ai-execution-acceptance.ts`، مع §§42.2 و42.6.
- **validation:** مراجعة قراءة للاستدعاءات والعقود فقط؛ لم تُشغّل اختبارات أو
  typecheck في هذا التحديث التوثيقي، ولم يتغير الكود أو schema.
- **authority/safety impact:** يظل Gate C acceptance مستقلًا عن حالة World
  Transition؛ failure لاحق لا يسحب قبولًا محفوظًا. بيانات candidate overlay
  تبقى خارج World State الحي إلى أن يحدث promotion وتُلتقط ملاحظة مباشرة بعده.
- **remaining/blocker:** يوجد خطر توقيت محتمل موثق: الصف يصبح `pending` قبل
  `completeAiExecution`، وعامل retry يلتقطه دون اشتراط وجود acceptance؛ غياب
  القبول يتحول حاليًا إلى `terminal_failed`. كذلك لا يقارن idempotency check
  `environmentRevision` أو `parentFactRefs` أو `evidenceRefs` عند إعادة الصف.
  يلزم اختبار السلوك وحسم الربط قبل توسيع المسار.
- **next step:** اختبر نافذة `pending → acceptance` ثم عالجها داخل مسار الانتقال
  الموجود، وأضف اختبارات تعارض للحقول الدلالية؛ لا تنشئ خدمة/جدولًا جديدًا ولا
  تعمم pilot على capabilities أخرى بهذا التحديث.

### 42.68 — P6 — إصلاح انتظار القبول وربط هوية retry (2026-09-27)

- **phase/step:** إصلاح bounded لمسار `runtime.start` الحالي، استجابةً لتدقيق
  §42.67 والقرار التنفيذي المرفق.
- **status:** `done لهذه الشريحة؛ pilot P6 ما زال محدودًا`.
- **what changed:** قبل claim، يفحص المسار القبول الناجح وارتباطه بالـEffectBundle.
  غياب القبول مع execution نشط يعيد `pending` دون claim أو زيادة `retryCount`؛
  انتهاء execution بلا قبول يحفظ `terminal_failed` بسبب واضح. اختلاف EffectBundle
  عن القبول يفشل مغلقًا ومغطى باختبار. يشمل تعارض idempotency الآن
  `environmentRevision` و`parentFactRefs` و`evidenceRefs`.
- **files/schema/contracts touched:** `runtime-start-transition.ts` و
  `runtime-start-transition.test.ts`؛ لا schema أو migration، ولا تغيير في
  `ai-execution-acceptance.ts`.
- **validation:** اختبار `runtime-start-transition.test.ts` نجح 12/12 من مجلد
  `artifacts/api-server`؛ نجح `pnpm --filter @workspace/api-server run typecheck`.
- **authority/safety impact:** يبقى acceptance مستقلًا عن World Transition؛
  لا يُسحب قبول ناجح بأثر رجعي. لا جدول أو Gateway موازية، ولا تغيير في D1/D2
  أو صلاحيات `restart/stop`.
- **remaining/blocker:** P3.5 ما زالت `partial`؛ التغيير لا يعمم pilot على
  capabilities أخرى ولا يثبت استهلاكًا عامًا لـWorld State من كل planner/replan.
- **next step:** لا توسع مراحل P3.5/P4–P14 أو نطاق runtime actions دون طلب
  مستقل ومعايير قبول إضافية.

### 42.69 — P4 — Bounded validator process-tree observation (2026-09-27)

- **phase/step:** إضافة ملاحظة مستقلة لشجرة عمليات validator، امتدادًا محدودًا
  لـ§42.30 دون ادعاء إغلاق P4.
- **status:** `done لهذه الشريحة فقط؛ P3.5/P4/P5 تبقى partial`.
- **what changed:** يأخذ validator probe عينات محدودة من شجرة `/proc`، ويقبل
  `known` فقط بعد مسحين كاملين متطابقين ضمن حد 32 عملية، ثم يثبت marker والبيئة
  وجذر المشروع لكل عضو مرئي. تغير الشجرة أو نقص المصدر أو تجاوز الحد أو غياب
  descendant يبقى `unknown`، ومخالفة البيئة المقاسة تبقى `mismatch`. يمر
  الإسقاط hash-only كـ`DIRECT_OBSERVATION` منفصلة عبر Mission Task وRecipe.
- **files/schema/contracts touched:** عقد `ValidationProcessTreeAttestation`،
  validator process probe، process-tree resolver، observation materializer،
  ومسارا task/recipe واختباراتهما؛ لا schema أو migration.
- **validation:** نجح API typecheck؛ نجحت 59 اختبارات مركزة عبر attestation،
  runtime listener، AI validation، World State، Task execution وRecipe runner؛
  نجح `git diff --check`. أُعيد تشغيل API وأعاد `/api/healthz` الحالة `ok`.
- **authority/safety impact:** الدليل يصف snapshot وقتيًا فقط؛ لا يخزن PID أو
  marker أو بيئة أو مسارات خام، ولا يغير validator status أو objective proof أو
  acceptance/OBSERVED أو صلاحيات mutation. لا جدول أو Gateway موازية ولا تعميم
  إلى قدرات أخرى.
- **remaining/blocker:** لا يثبت هذا الرصد استقرار الشجرة طوال مدة validator أو
  اكتمال P4/P5؛ المراحل تظل جزئية وفق §31.
- **next step:** واصل من dependency التالية المصرح بها في §31 بعد مراجعة بقية
  متطلبات P3.5/P4/P5؛ لا تعتبر هذه الشريحة إغلاقًا للمرحلة.

### 42.70 — تدقيق failover synthesis بعد اكتمال evidence (2026-09-27)

- **phase/step:** موثوقية `PROJECT_QUERY_*` ذات objective canonical؛ عمل عابر
  للمراحل، وليس P-stage جديدة.
- **status:** `verified gap; plan-only` — لم يتغير runtime.
- **what changed:** تأكد أن §42.49 نفّذ packet أدلة مجمدًا وmanifest hash ومحاولات
  synthesis ضمن `ExecutionLedger` وربط attempt المقبول والـmanifest وبصمة الرد
  في response/terminal trace. لكن عند فشل synthesis، يعيد `chat()` حاليًا
  deterministic fallback كـresult طبيعي؛ لذلك لا تنتقل `chatWithFallback()` إلى
  provider آخر. كما أن `RATE_LIMITED` و`QUOTA` ليستا من حالات repair المحلية.
  خطة المعالجة في §31 من `agent-generalization-execution-plan.md`: تمرير بدائل
  مختارة server-side إلى synthesis وحدها، استعمال evidence packet نفسه،
  failover محدود وفق التصنيف والميزانية، والحفاظ على OpenRouter rate-limit scope.
- **files/schema/contracts touched:** وثيقتا خطة التنفيذ وسجل التقدم فقط؛ لا
  تغييرات كود أو schema أو migration.
- **validation:** مطابقة الادعاءات مع `chat-agent.ts` و`ai-route-helpers.ts` و
  `execution-ledger.ts` و`openai-compatible-client.ts` و`ChatOutputSchema`،
  واختبارات المسار الحالية؛ اجتاز التحديث `git diff --check`.
- **authority/safety impact:** لا يتغير acceptance أو proof أو permissions؛
  deterministic fallback ليس قبولًا بذاته. لا يعاد تصنيف provider prose كدليل،
  ويبقى `PROJECT_QUERY` بلا objective canonical fail-closed. لا public envelope
  أو جدول محاولات جديد في الخطة الحالية.
- **remaining/blocker:** التنفيذ العابر للمزودين غير موجود. يجب قبل تنفيذه جعل
  attempt identity فريدة لكل provider candidate؛ الهوية الحالية لا تتضمن المزود.
  يلزم أيضًا توسيع telemetry allowlist بقيم enums ومعرفات محدودة، لا رسائل
  provider الخام. لقطة evidence النهائية لا تخزن synthesis attempts؛ الربط
  المعتمد هو trace والـresponse/terminal binding الحاليان.
- **next step:** إذا طُلب التنفيذ، أضف failover للمحاولات بعد evidence completion
  فقط، مع provider candidates المصرح بها من API، وmanifest/read set ثابت،
  واختبارات provider A failure → provider B success وno-objective fail-closed
  وbudget/deadline وJSON/SSE/history parity. لا توسع fallback العام ولا تغير
  acceptance أو ترتيب §31.

### 42.71 — تنفيذ failover محدود لـPROJECT_QUERY بعد اكتمال الأدلة (2026-09-27)

- **phase/step:** موثوقية synthesis لأهداف `PROJECT_QUERY_*` ذات objective
  canonical؛ متابعة عابرة للمراحل، وليست P-stage جديدة.
- **status:** `implemented — orchestrator verified; route-level acceptance partial`.
- **what changed:** يمرر API قائمة المزودين المرتبة والمصرح بها إلى synthesis
  فقط بعد اكتمال evidence packet والـclaims. يعيد المسار استخدام packet وmanifest
  نفسيهما، ويقيّد محاولات synthesis وتغيير المزود بميزانية `ExecutionLedger`
  والمهلة المتبقية وميزانية المشروع. معرف المحاولة يتضمن execution وmanifest
  والمزود وprovider index وتسلسل المحاولة. أخطاء availability/transport تنتقل
  إلى المزود التالي؛ الخطأ المحلي يحصل على إصلاح محدود، بينما الإلغاء ونفاد
  الميزانية/المهلة يوقفان المسار. يظل deterministic fallback خلف القبول الحالي
  للهدف ذي العقد المكتمل، ويبقى `PROJECT_QUERY` بلا objective canonical
  `ANALYSIS_INCOMPLETE`.
- **files/schema/contracts touched:** `lib/ai-orchestrator/src/agents/chat-agent.ts`,
  `artifacts/api-server/src/lib/ai-route-helpers.ts` واختبارات المنسق؛ لا جدول
  أو public envelope جديد. allowlist التشخيص يمرر معرفات وenums محدودة فقط.
- **validation:** اجتاز الاختبار المركز
  `moves a shared-pool-limited synthesis attempt to the next authorized provider`
  (1/1). الاختبارات الموجودة تتحقق أيضًا من إصلاح محلي واحد، ثبات manifest،
  تميّز attempt IDs، وربط الاستجابة والـterminal بالـmanifest والمحاولة المقبولة،
  ومن توقف المحاولات عند الإلغاء.
- **authority/safety impact:** لا تتغير قراءات الأدلة أو scope أو acceptance أو
  الصلاحيات. الـorchestrator لا يختار credentials؛ يستخدم المرشحين المعتمدين من
  طبقة API. لا تُعد `claimRefs` أو نصوص المزود دليلًا.
- **remaining/blocker:** اختبار route الحالي لنجاح synthesis يحقن `chatWithFallback`
  mock، ولا يثبت رحلة HTTP فعلية من A failure إلى B success. يلزم اختبار
  route-level يثبت عدم إعادة القراءة وJSON/SSE/history parity وحدود budget/deadline
  واستنفاد المرشحين، مع الحفاظ على no-objective fail-closed. لا يثبت هذا التشغيل
  الحي أو جودة مزود.
- **next step:** أكمل اختبار قبول route-level للمسار الحقيقي باستخدام مزودين
  اختباريين، ثم أبقِ حدود عدم وجود objective والميزانية والإلغاء ضمن بوابات
  القبول؛ لا توسع fallback العام أو dependency graph.

### 42.72 — عرض World Transition في Mission Control (2026-09-27)

- **phase/step:** تسليم Dashboard مستقل؛ إسقاط `runtime.start` الحالي في Mission
  Control، دون إضافة مرحلة أو تغيير ترتيب §31.
- **status:** `done — bounded product surface`.
- **what changed:** أضيف إسقاط قراءة فقط يعرض انتقالات المحاولة الحالية لوصفة
  `runtime.start` بعد ربط المشروع والتنفيذ وEpisode والمحاولة، ويعيد قائمة فارغة
  للوصفات الأخرى. تعرض Mission Control مراحل Observation وEffect وAcceptance
  وWorld منفصلة، وتحدث حالة الانتقال ما دام materialization قيد التنفيذ.
- **files/schema/contracts touched:** OpenAPI والأنواع المولدة، route قراءة
  التنفيذ، إسقاط World Transition، ومكوّن/اختبارات Mission Control؛ لا جداول أو
  migrations جديدة.
- **validation:** نجح API typecheck واختبار route المركز (1 ناجح، 186 متجاوزًا)
  واختبارات projection (4 ناجحة). نجح dashboard typecheck واختبار Mission
  Control (19 ناجحًا). أعيد تشغيل API وDashboard؛ كلاهما يعمل. عاينت المسار
  المحمي لكن جلسة المعاينة غير موثقة الهوية، فظهرت شاشة الدخول بدل صفحة Mission
  Control.
- **authority/safety impact:** القبول وCanonical Proof مستقلان عن materialization؛
  لا تستنتج الواجهة انتقالًا من قبول PROVEN، ولا تكشف أجسام الملاحظات أو الأدلة
  الخام. لم تتغير صلاحيات الوكيل أو نطاق `runtime.start`، ولم يبدأ `restart`,
  `stop` أو جمع بيانات P7.5.
- **remaining/blocker:** رحلة متصفح موثقة الهوية مع إعادة تحميل صفحة التنفيذ لم
  تُثبت بعد؛ لا يغيّر ذلك نتائج اختبارات API والمكوّن.
- **next step:** تحقق من رحلة Mission Control المحمية وإعادة التحميل في جلسة
  متصفح موثقة الهوية؛ أبقِ بقية الوصفات وP7.5 خارج هذا النطاق.

### 42.73 — إثبات رحلة المتصفح لـ Mission Control (2026-09-27)

- **phase/step:** إثبات عرض انتقال `runtime.start` في Mission Control بعد
  تسجيل دخول Clerk وإعادة تحميل الصفحة، وفق الخطوة التالية في 42.72.
- **status:** `done — authenticated fixture-backed browser proof`
- **what changed:** اجتاز الاختبار المحمي عرض الانتقال بحالة `pending` ثم
  `materialized` بعد إعادة التحميل. تستخدم الرحلة تسجيل دخول Clerk معزولًا
  وواجهات API fixture داخل المتصفح. أصلحنا محددات صفوف اختبار المهام التي كانت
  تلتقط أزرار الصف الفرعية، مع احتساب تغير تسمية الصف بين `Expand` و`Collapse`.
- **files/schema/contracts touched:** `artifacts/dashboard/e2e/dashboard.journey.ts`
  وسجل هذا التقدم؛ لا تغييرات في API أو schema أو صلاحيات runtime.
- **validation:** الجولة الكاملة الأولى: 51 ناجحًا، واختبار واحد فاشل، وواحد
  متجاوز؛ الفشل كان محدد صف مهام غير فريد وليس اختبار Mission Control. بعد
  الإصلاح، نجح الاختباران المركزان لـMission Control والمهام (2/2). نجحت أيضًا
  اختبارات عقد الرحلة (25/25)، وتقرير Mission correlation (17/17)، وعقد Clerk
  handoff (10/10)، وAPI release build و`git diff --check`. لم تُعد الجولة
  الكاملة ذات 53 اختبارًا بعد إصلاح المحدد.
- **authority/safety impact:** يثبت الاختبار سلوك العرض وإعادة التحميل باستخدام
  fixtures، لا استمرارية بيانات Mission Control الحية. لم تُنفذ تغييرات على
  بيانات مستخدمين أو صلاحيات أو acceptance أو اختيار `runtime.start`؛ بقيت
  P7.5 خارج النطاق.
- **remaining/blocker:** إثبات الرحلة المحمية وإعادة التحميل مكتمل ضمن حد
  fixtures؛ لا يدعي اختبار المتصفح هذا استمرارية قاعدة بيانات حية. بقيت الجولة
  الكاملة دون إعادة بعد إصلاح المحدد.
- **next step:** حدّث §11 من جرد الفجوات بما يعكس أسطح Task وBrowser Validation
  الحالية؛ بعد ذلك راجع عقد Workflow AI orchestration/delete قبل إضافة تحكمات،
  مع إبقاء P7.5 وبوابة الإضافات خارج النطاق.

### 42.74 — مطابقة فجوة تحكم Workflows مع التنفيذ الحالي (2026-09-27)

- **phase/step:** P1 Dashboard reachability؛ مراجعة Workflow AI orchestration
  والحذف بعد تحديث §11.
- **status:** `done — existing controls verified; action coverage completed`
- **what changed:** كانت خانة الجرد قديمة: صفحة Workflows تحتوي بالفعل على
  `Ask AI` كتوصية لا تغيّر المرحلة، وحذف مع تأكيد ورسالة خطأ، وتعطيل الحذف
  أثناء التشغيل. أضفنا اختبارات للإلغاء، وإبطال قائمة Workflows وإزالة cache
  سجل التنفيذ بعد النجاح، وأخطاء الحذف والتوصية؛ لم نكرر عناصر UI أو نغيّر API.
- **files/schema/contracts touched:** `artifacts/dashboard/src/pages/Workflows.test.tsx`
  و`docs/replit-platform-gap-inventory.md` وهذا السجل؛ لا schema أو migration.
- **validation:** اختبارات صفحة Workflows (9 ناجحة)، واختبارات routes (20
  ناجحة)، واختبارات AI orchestration route (6 ناجحة، 181 متجاوزة خارج التصفية)،
  و`git diff --check` ناجح.
- **authority/safety impact:** قرار AI يظل advisory ولا يقدّم المرحلة تلقائيًا.
  الحذف يحذر من حذف سجل التنفيذ، والواجهة تمنعه أثناء التشغيل؛ صلاحية المشروع
  وأقفال التنفيذ ورفض الخادم `409` تبقى المرجع.
- **remaining/blocker:** لا تدعي اختبارات الصفحة رحلة مزود حي؛ تختبر الواجهة
  عبر hooks mock، واختبارات API تستخدم orchestrator fixtures. لا تغيير في حدود
  P7.5.
- **next step:** قيّم فجوة Plugins المتبقية في §11 مع الحفاظ على حالة API
  الحالية كحالة عامة؛ لا تضف تحكمات Dashboard حتى تُحسم دلالات النطاق والتفويض.

### 42.75 — تفعيل scan hooks للإضافات على مستوى المشروع (2026-09-27)

- **phase/step:** تكامل المنتج — Plugins؛ شريحة مستقلة عن إغلاق مراحل P0–P14.
- **status:** `done`
- **what changed:** بقيت تعريفات الإضافات والتوافر العام عالميين، وأضيف ربط
  project/plugin معطل افتراضيًا. يتطلب dispatch كلاً من التوافر العام وتفعيل
  المشروع ووجود scan hook مسجل. أضيفت لوحة تفعيل إلى Project Detail.
- **files/schema/contracts touched:** `lib/db/src/schema/project_plugin_bindings.ts`,
  `lib/db/src/application-schema-check.ts`, `artifacts/api-server/src/lib/plugin-runtime.ts`,
  `artifacts/api-server/src/routes/plugins.ts`, OpenAPI والعميل المولد،
  `artifacts/dashboard/src/components/ProjectPluginsPanel.tsx` وProjectDetail
  واختباراتها.
- **validation:** API plugin/runtime tests (8/8)، DB application-schema
  contract tests (14/14)، Dashboard panel tests (2/2)، API وDashboard
  typecheck، `pnpm run codegen:check`، Dashboard restart smoke و`git diff --check`
  نجحت. تطبيق schema التطويري أعلن جاهزية schema. فشلت رحلة
  `release-dashboard-journey` عند محدد صف مهام غير فريد
  (`getByRole` طابق الصف وزري edit/delete)؛ 51 ناجحًا وواحد متجاوز. لا يخص
  الفشل تغييرات Plugins. أعيد تشغيل API وDashboard بنجاح.
- **authority/safety impact:** تتحقق الخوادم من صلاحية المشروع وحالة الأرشفة؛
  التفعيل لا يتجاوز عدم التوافر العام ولا ينفذ كود إضافات اعتباطيًا. لا تمنح
  الشريحة planner أو Mission أو tool صلاحيات أو acceptance.
- **remaining/blocker:** لا يوجد schema إعدادات typed حاليًا ويقبل API `{}` فقط؛
  لم تُنفذ credentials آمنة أو وصول/تدوير/redaction لها، ولا تفويض capabilities
  خاص بـMission ولا عقد Capability Environment Revision. رحلة متصفح موثقة الهوية
  للتفعيل وإعادة التحميل لم تثبت.
- **next step:** عرّف schemas وsecret bindings وMission authorization وCER كلًا
  بعقد مستقل قبل توسيع التنفيذ؛ أثبت تفعيل المشروع عبر رحلة متصفح مصادق عليها.

### 42.76 — عقد continuation للملاحظة فقط في P7.5 (2026-09-28)

- **phase/step:** P7.5 — تثبيت هوية قياس observe-only بعد تدوير attempt.
- **status:** `partial`
- **what changed:** أضيف عقد typed مستقل لطلب ونتيجة continuation، يربط hash
  التسجيل الأصلي بهوية قياس جديدة في attempt لاحق وEpisode جديد، مع ثبات Mission
  وGoal وplan/project/environment revisions. يقيّد العملية بقراءة
  `runtime.status` خادمية فقط؛ والنتيجة معلّمة صراحةً بأنها غير مؤهلة لمعايرة
  scope v1 قبل مراجعة policy/scope version.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/agent-state/runtime-start-hypothesis-measurement-continuation.ts`
  واختباراته؛ لا DB schema أو migration أو event writer جديد.
- **validation:** اختبارات عقد P7.5 مع اختبارات registration الحالية (13/13)،
  API typecheck، و`git diff --check` نجحت.
- **authority/safety impact:** العقد لا يستدعي observer ولا يكتب أحداثًا ولا
  يعيد `runtime.start`؛ لا يحدّث معايرة v1 أو Gate C أو acceptance، ولا يغيّر
  `fixed_safe_probe`. التسجيلات القديمة غير المحسومة تبقى كذلك.
- **remaining/blocker:** لم يُوصل العقد بعد بمسار Mission recovery أو ownership
  fences أو تخزين النتيجة. يلزم اختبار الانقطاع/الإلغاء/إعادة العامل وidempotency
  والتحقق من صف الملاحظة المباشر قبل جمع أي cohort.
- **next step:** أوصل request/result بمسار خادمي observe-only تحت lease المحاولة
  الحالية، مع إبقاء التسجيل والنتيجة الجديدين منفصلين عن Episode الأصلي؛ ثم
  راجع scope/policy version واختبر مسار التعافي قبل بدء cohort مستقبلية.

### 42.77 — توصيل P7.5 observe-only بتعافي Mission (2026-09-28)

- **phase/step:** P7.5 — استعادة القياس بعد تدوير attempt دون إعادة الأثر.
- **status:** `partial`
- **what changed:** عند resume، يبحث المسار في Episodes السابقة للتنفيذ نفسه عن
  registration غير محسوم، ويتحقق من hash التسجيل وهوية Mission/Goal والخطة
  ومراجعة المشروع والبيئة. ينشئ request/result منفصلين في Episode والمحاولة
  الحاليين، ويقرأ runtime الحالي عبر `runtime.status` فقط؛ لا يستدعي
  `runtime.start`. تُحفظ ملاحظة مباشرة محدودة مع `materializeWorldState: false`.
  النتيجة السابقة الصالحة يعاد استخدامها دون رصد جديد؛ التعارض أو الانحراف عن
  النطاق يفشل مغلقًا. تُغلق Episode والتنفيذ ذريًا تحت قفل التنفيذ وتنتقل Mission
  إلى `needs_replan`.
- **files/schema/contracts touched:** continuation runner، `recipe-operation-runner`,
  `agent-episode-ledger`, `mission-runtime` واختباراتها؛ لا migration أو جدول جديد.
- **validation:** اختبارات العقد والـrunner والـrecipe: 33/33؛ API typecheck؛
  `git diff --check`؛ وأُعيد تشغيل API workflow بنجاح واستمع على المنفذ 8080.
- **authority/safety impact:** القياس advisory فقط؛ لا يثبت Goal أو Effect أو Gate C
  أو acceptance ولا يدخل calibration v1. تبقى `fixed_safe_probe` كما هي.
- **remaining/blocker:** بوابة الجمع تظل مغلقة حتى اختبارات crash بين request/result،
  وإلغاء متزامن مع الإنهاء، واستعادة عامل فعلية تثبت reuse والـobserver المباشر؛
  policy/scope version لم تُراجع لاحتساب continuation مستقبلًا.
- **next step:** أكمل اختبارات التعافي التشغيلي ثم راجع عقد evaluator وسياسة
  versioned مستقلة قبل أي cohort؛ لا تُضمّن النتائج الحالية في معايرة v1.

### 42.78 — اختبارات تعافي continuation في P7.5 (2026-09-28)

- **phase/step:** P7.5 — إعادة استخدام نتيجة القياس المحفوظة ومنع الكتابة المتأخرة.
- **status:** `partial`
- **what changed:** أضيفت تغطية للتعافي بعد حفظ ملاحظة runtime وقبل كتابة النتيجة،
  ولحالات الإلغاء واستبدال العامل وانتهاء lease. تثبت الاختبارات إعادة استخدام
  النتيجة الصالحة ورفض استمرار العامل القديم دون إعادة الأثر.
- **files/schema/contracts touched:** اختبارات continuation runner و
  `recipe-operation-runner` و`agent-episode-ledger`؛ لا migration أو جدول جديد.
- **validation:** الاختبارات المركزة ذات الصلة (52/52)، API typecheck، وإعادة
  تشغيل API workflow بنجاح على المنفذ 8080؛ نجح `git diff --check` بعد تحديث
  هذا السجل.
- **authority/safety impact:** القياس advisory فقط؛ لا `runtime.start` أو
  acceptance أو Gate C أو معايرة v1. يبقى الاختيار `fixed_safe_probe` وتظل
  cohort collection وautomatic selection مغلقتين.
- **remaining/blocker:** يلزم التحقق من إغلاق Episode الأصلي عند إعادة استخدام
  نتيجة محفوظة، ثم مراجعة policy/scope version مستقلة قبل النظر في أي cohort.
- **next step:** عالج حد إغلاق Episode الأصلي أولًا، ثم راجع السياسة ذات الإصدار؛
  لا تفتح الجمع أو الاختيار الآلي.

### 42.79 — إثبات قراءة World State في إعادة تخطيط Mission (2026-09-28)

- **phase/step:** تكامل P3/P4 مع إعادة تخطيط Mission؛ نطاق استشاري غير متعلق
  بـ`runtime.start`، ولا يغيّر ترتيب الاعتماديات.
- **status:** `done — bounded DB-backed integration proof`
- **what changed:** أضيف اختبار قاعدة بيانات يثبت السلسلة من Goal ذي قبول فشل
  محدد، إلى execution/attempt مطابقين، وEpisode مغلق، وملاحظة مباشرة كاملة
  وحديثة، ثم World Fact scoped. يثبت الاختبار أن القراءة الاستشارية الدقيقة
  تُحفظ داخل `replanContext` لمراجعة الخطة الجديدة، مع `planningReadRevision`
  مرتبطًا بهوية مراجعة الخطة.
- **files/schema/contracts touched:** `mission-auto-replan.test.ts` وهذا السجل
  وخطة التنفيذ؛ لا schema migration أو عقد صلاحية جديد.
- **validation:** `cd artifacts/api-server && pnpm exec vitest run
  src/lib/mission-auto-replan.test.ts src/lib/mission-world-state-planning-read.test.ts`
  (13/13)؛ `cd artifacts/api-server && pnpm run typecheck`؛ لا تُعد هذه
  fixtures إثباتًا لمزود حي أو بيانات إنتاج.
- **authority/safety impact:** لا تُقرأ الحقائق إلا من قبول الفشل والمحاولة
  والـEpisode المطابقين، وبنطاقي المشروع والبيئة ومصادر حديثة كاملة. السياق
  استشاري ومنقّح؛ لا يثبت Goal أو Effect أو Acceptance ولا يمنح صلاحية. يستمر
  استبعاد `runtime.start` من هذا المسار.
- **remaining/blocker:** يغطي الاختبار مسارًا موجبًا واحدًا داخل DB الاختبارية؛
  لا يغلق P3/P4/P8 ولا يثبت World Delta عامًّا أو Belief أو اختيار الملاحظات.
- **next step:** أبقِ P3/P4/P8 جزئية وP7.5 محكومة ببوابتها؛ لا توسّع القراءة
  إلى اختيار آلي أو `runtime.start`، ولا تدّع إغلاق P8 بهذا التكامل.

### 42.80 — إثبات route-level لـPROJECT_QUERY embedded-AI failover (2026-09-28)

- **phase/step:** تحقق عابر للمراحل لإغلاق فجوة §42.71؛ الهدف المحدد
  `PROJECT_QUERY_EMBEDDED-AI`.
- **status:** `route proof done — API runtime smoke blocked by development schema gate`.
- **what changed:** يرسل الاختبار الطلب العربي الفعلي عبر مساري JSON وSSE،
  ويستخدم `chatWithFallback` و`chat()` الإنتاجيين مع فشل provider A في synthesis
  فقط ونجاح provider B بعد اكتمال الأدلة. يتحقق من ثبات رسالة synthesis بين
  المحاولتين، ومن الرد المنظم وclaimRefs وflowRefs، ومن تطابق النتيجة مع
  التاريخ. يثبت قبول `PROVEN` ووجود كل المسارات المقروءة المطلوبة في snapshot.
  كشف الاختبار أيضًا أن locator قد يفضل ذكرًا لاحقًا داخل نص مقتبس على موضع
  التنفيذ؛ رُجّح السياق التنفيذي المتقارب الذي يجمع needles من دون تغيير
  objective أو بوابة القبول.
- **files/schema/contracts touched:** اختبار route-level واختبار locator
  واختيار نافذة القراءة؛ هذا السجل وذاكرة المشروع. لا تغيير schema أو public
  contract أو صلاحية.
- **validation:** الاختبار المركز لرحلة route-level (1/1)، واختبار نافذة locator
  (1/1)، و`pnpm run typecheck` لكل من API و`ai-orchestrator`. فشلت إعادة تشغيل
  API عند بوابة schema بسبب غياب جدول `project_plugin_bindings` وفهارسه ومفاتيحه
  الخارجية المطلوبة.
- **authority/safety impact:** لا proof أو acceptance أو permissions جديدة؛
  يظل النجاح مشروطًا بالـcanonical objective ودليل المصدر المحتفظ به. لا
  تُستخدم claims المزود لإغلاق الحواف، ولا يُكشف تشخيص provider A، ولا يُفتح
  fallback بلا objective.
- **remaining/blocker:** لم يختبر هذا المسار استنفاد قائمة المزودين أو انتهاء
  الميزانية/المهلة، ولم يستخدم مزودًا حيًا. يلزم أيضًا تسوية schema قاعدة
  التطوير قبل استعادة API workflow؛ لم تُطبق أي تغييرات على قاعدة البيانات.
- **next step:** أبقِ حدود §42.71 fail-closed؛ لا توسع fallback العام. إذا لزم
  تشغيل API، سوِّ schema قاعدة التطوير أولًا ثم أعد التحقق من workflow.

### 42.81 — إغلاق حالات استنفاد synthesis في PROJECT_QUERY (2026-09-28)

- **phase/step:** تحقق عابر للمراحل بعد §42.80؛ الهدف
  `PROJECT_QUERY_EMBEDDED-AI`.
- **status:** `route and orchestrator failure-boundary tests done — API runtime smoke remains blocked`.
- **what changed:** وسّع اختبار المسار الحقيقي ليغطي فشل provider A ثم provider B،
  مع الرجوع الحتمي المبني على الأدلة، وتكافؤ JSON/SSE/history، وثبات رسالة
  synthesis، وعدم إعادة قراءة المسارات المطلوبة، وقبول snapshot بحكم `PROVEN`.
  أضيف أيضًا حدّ مهلة نهائي يمنع إرسال محاولة إلى provider B. تغطي اختبارات
  `chat-agent` الموجودة حد ميزانية تغيّر المزود وعدم قبول نتيجة تصل بعد الإلغاء.
- **files/schema/contracts touched:** اختبار `ai-stream-integration` وسجل التقدم؛
  لا تغيير في الإنتاج أو schema أو public contract أو صلاحيات acceptance.
- **validation:** اختبار route المركز (1/1)؛ اختبارات `chat-agent` المركزة
  لحد الميزانية والإصلاح والإلغاء (3/3)؛ `pnpm run typecheck` في
  `artifacts/api-server`؛ الاختبار الجديد مرّ أيضًا ضمن 102 اختبارًا ناجحًا في
  ملف `ai-stream-integration` الكامل. اكتملت `pnpm run validate:ai-release`
  لكنها فشلت بثلاثة blockers؛ لا تغيير في قاعدة البيانات.
- **authority/safety impact:** لا يسمح الاستنفاد إلا بالـfallback الحتمي للمسار
  ذي canonical objective والأدلة المكتملة؛ تبقى تشخيصات المزود داخل الخادم.
  مسارات الأدلة نفسها هي التي تربط محاولات synthesis والـsnapshot.
- **remaining/blocker:** لم يُختبر مزود حي. بوابة AI للإصدار ليست خضراء:
  فشل OpenAPI route-parity، وظهر فشلان سابقان في ملف SSE الكامل (حدث
  `AiAgentEpisodeEvent` إضافي وغياب `done` في اختبار no-tools)، كما فشل
  dashboard preview harness. نجح اختبار failover المضاف نفسه. لا يبدأ API
  workflow لأن schema قاعدة التطوير تفتقد `project_plugin_bindings` ومتطلباته؛
  لم تُطبق أي تغييرات على القاعدة.
- **next step:** حافظ على بوابة objective والأدلة الحالية. يمكن متابعة بوابة
  قياس P7.5 بصورة منفصلة؛ عالج schema التطوير فقط بعد تفويض واضح.

### 42.82 — تحقق إغلاق Episodes في تعافي قياس P7.5 (2026-09-28)

- **phase/step:** P7.5 — التحقق من إعادة استخدام نتيجة continuation المحفوظة.
- **status:** `partial — result-owner and recovery Episodes close correctly`
- **what changed:** تأكدت الاختبارات الموجودة من أن النتيجة المعاد استخدامها
  تُغلق Episode المالكة لها والمحاولة الحالية معًا، مع هوية النتيجة نفسها
  ومن دون إعادة استدعاء `runtime.start` أو إعادة الرصد.
- **files/schema/contracts touched:** سجل التقدم فقط؛ لا تغيير في التنفيذ أو
  schema أو عقد القبول.
- **validation:** من `artifacts/api-server` شغّل
  `pnpm exec vitest run src/lib/recipe-operation-runner.test.ts src/lib/agent-state/agent-episode-ledger.test.ts --maxWorkers=1`
  (34/34)، ثم `pnpm run typecheck` من جذر المستودع (نجح عبر مكتبات
  workspace وAPI وDashboard وmockup-sandbox وscripts)، و`git diff --check`.
- **authority/safety impact:** تحقق محلي مجاني فقط؛ لا provider حي أو تعديل
  قاعدة بيانات. يظل القياس advisory و`fixed_safe_probe`، ولا يتغير Gate C أو
  acceptance أو أهلية calibration v1.
- **remaining/blocker:** لم تُراجع بعد policy/scope version وevaluator مستقل
  لنتائج continuation؛ لا cohort أو automatic selection.
- **next step:** راجع عقد السياسة والتقييم بإصدار مستقل، مع إبقاء جمع النتائج
  والاختيار الآلي مغلقين حتى اكتمال المراجعة.

### 42.83 — قرار استبعاد continuation من calibration v1 (2026-09-28)

- **phase/step:** P7.5 — تحديد أهلية نتائج القياس المستعادة.
- **status:** `done — continuation results explicitly excluded from v1`
- **what changed:** تقرر أن نتيجة
  `P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT` لا تُحتسب ضمن calibration v1
  حتى لو كانت `complete_fresh` وتحمل outcome؛ لا تستبدل نتيجة التجربة الأصلية
  ولا تخفض `unresolvedExperimentCount`. لا تُعدّل النتائج التاريخية. أي أهلية
  مستقبلية تتطلب policy/scope وevaluator جديدين، ومراجعة مسبقة وheld-out outcomes
  مستقلة.
- **files/schema/contracts touched:** `docs/agent-generalization-execution-plan.md`
  وهذا السجل؛ لا تغيير في evaluator أو schema أو event contracts.
- **validation:** اختبار evaluator المحلي
  `runtime-start-hypothesis-calibration.test.ts` (9/9)، بما فيه حالة continuation
  مكتملة fresh التي تبقى غير محسوبة وتترك التسجيل `incomplete_measurements`.
- **authority/safety impact:** لا cohort أو مزود حي أو تعديل قاعدة؛
  calibration v1 و`fixed_safe_probe` وGate C وacceptance لم تتغير.
- **remaining/blocker:** بوابة جمع P7.5 ما زالت مغلقة بسبب إثبات التعافي التشغيلي
  المتبقي وعدم وجود scope مؤهل.
- **next step:** أكمل إثبات crash/cancel واستبدال العامل والـobserver المباشر
  بfixtures محلية حتمية قبل التفكير في cohort؛ لا تفتح الاختيار الآلي.

### 42.84 — تحقق محلي من مصفوفة تعافي continuation (2026-09-28)

- **phase/step:** P7.5 — الانقطاع والإلغاء ودوران lease والرصد المباشر المحلي.
- **status:** `partial — deterministic local gates pass; API worker integration unverified`
- **what changed:** لم أضف اختبارات مكررة؛ شغّلت تغطية fixtures الموجودة لنقاط
  الانقطاع بعد request وبعد حفظ الملاحظة وقبل result، وفقدان تأكيد كتابة النتيجة،
  والإلغاء، وإعادة استخدام observation/result، ودوران lease وإغلاق Episode المالكة.
  شغّلت أيضًا اختبارًا يشغّل runtime محليًا ويتحقق من
  `observeExistingRuntimeAfterState` دون استدعاء `start` مرة أخرى.
- **files/schema/contracts touched:** اختبارات
  `agent-episode-ledger.test.ts` وسجلا التقدم والخطة؛ لا تغيير في runtime أو
  schema أو event contracts.
- **validation:** من `artifacts/api-server`:
  اختبارات continuation والعقد والـledger والـrecipe (54/54)، واختبار
  `workspace-runtime.test.ts` المحدد (1/1؛ 5 اختبارات أخرى skipped)،
  و`git diff --check`، وفحص الأنواع `pnpm run typecheck`.
- **authority/safety impact:** اختبارات محلية فقط؛ لا cohort أو provider حي أو
  تعديل schema/قاعدة تشغيلية؛ اختبار DB يستخدم fixtures محصورة تُنظّف بعده.
  تظل continuation advisory ومستبعدة من calibration v1، مع ثبات
  `fixed_safe_probe` وGate C وacceptance.
- **remaining/blocker:** أثبت اختبار DB سباق الإلغاء الفعلي مع terminalization
  وفائزًا وحيدًا متسقًا. لم يُثبت استبدال عامل API في عملية مستقلة ولا المسار
  الإنتاجي الكامل من recovery إلى supervisor observer. لم يُعالج حاجز schema
  لبدء API workflow.
- **next step:** لا توسع الكود أو تفتح الجمع قبل إثبات هذه الحدود في workflow
  قابل للتشغيل؛ لا تغيّر schema دون تفويض صريح.

### 42.85 — استعادة جاهزية API التطوير بعد إصلاح schema (2026-09-28)

- **phase/step:** P7.5 — إزالة حاجز بدء API في بيئة التطوير.
- **status:** `done — development schema ready; cross-process P7.5 observation recovery verified locally; collection gate remains closed`
- **what changed:** بعد تفويض التطوير، طُبق schema المشروع عبر
  `pnpm --filter @workspace/db run schema:apply`. أُنشئ جدول
  `project_plugin_bindings` وفهرساه ومفتاحاه الخارجيان، واجتاز
  application-schema contract check. أضاف الاختبار عاملين مستقلين: الأول يستدعي
  مسار recipe والـruntime observer الفعلي ثم يتعطل برمز 73 بعد حفظ observation
  وقبل حفظ result؛ الثاني يستعيد observation نفسها من DB دون قراءة runtime ثانية.
  تُغلق Episodes التسجيل والملاحظة والتعافي، ينتقل Goal إلى `needs_replan`،
  وينتهي execution دون acceptance ناجح.
- **files/schema/contracts touched:** runner واختبار integration وعامل الاختبار
  وسجل التقدم والخطة؛ schema قاعدة التطوير بقيت كما هي في هذه الخطوة، ولا تعديل
  في schema source أو قاعدة الإنتاج.
- **validation:** اختبار `p75-process-recovery.integration.test.ts` (1/1)،
  واختبار `agent-episode-ledger.test.ts` (15/15)،
  `pnpm --filter @workspace/api-server run typecheck`، و`git diff --check`.
- **authority/safety impact:** شاهد محلي بقاعدة التطوير وruntime fixture؛ لا
  provider حي أو cohort أو selector أو acceptance ناجح، ونتيجة continuation
  باقية خارج calibration v1. لم يُختبر API listener الذي يديره supervisor
  الخارجي end-to-end.
- **remaining/blocker:** بوابة الجمع لا تزال مغلقة لعدم وجود scope مؤهل، ولأن
  تكامل observer مع listener المُدار خارجيًا لم يُثبت بهذا الشاهد. محادثتان
  قديمتان رُفضت استعادتهما سابقًا بسبب project roots غير متاحة؛ لا تُحسبان دليلًا.
- **next step:** أثبت listener/observer المُدار من supervisor في شاهد مستقل قبل
  أي cohort؛ أبقِ `fixed_safe_probe` ثابتًا ولا تدخل نتائج continuation في v1.

### 42.86 — شاهد تعافي P7.5 عبر listener الـsupervisor المُدار (2026-09-28)

- **phase/step:** P7.5 — ربط observation المحفوظة باستعادة عامل مستقل مع runtime child يديره supervisor.
- **status:** `done — production runtime manager, managed supervisor listener, and cross-worker retained-observation recovery verified; collection gate remains closed`
- **what changed:** استخدم العامل A singleton `workspaceRuntime` ذي التخزين DB-backed والـsupervisor client الإنتاجي إلى `127.0.0.1:8099`. بدأ runtime fixture محليًا عبر listener الـsupervisor، ثم استدعى observer الفعلي وحفظ `runtime.status`. خرج العامل بالرمز 73 بعد تثبيت observation وقبل result event. أثبت جرد supervisor بعد خروج العامل بقاء session نفسها حيّة وبـPID/port نفسيهما. استعاد العامل B observation المحفوظة، وسُجلت صفر استدعاءات observer؛ كما ظل استدعاء recipe `runtime.start` ممنوعًا صراحةً. تُغلق Episodes التسجيل والملاحظة والتعافي، يبقى Goal في `needs_replan`، وينتهي execution دون acceptance ناجح.
- **files/schema/contracts touched:** عامل واختبار تكامل P7.5 وسجل التقدم والخطة والذاكرة؛ لا تعديل schema أو قاعدة إنتاج.
- **validation:** اختبار `p75-process-recovery.integration.test.ts` (1/1) عبر listener supervisor الفعلي، `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit`، و`git diff --check`.
- **authority/safety impact:** بيانات الاختبار وruntime fixture محلية على قاعدة التطوير، ويوقف الاختبار session ويحذف صف runtime الخاص بالمشروع المؤقت. لا provider حي أو cohort أو selector أو acceptance ناجح؛ نتائج continuation ما زالت خارج calibration v1.
- **remaining/blocker:** لم يتأهل scope للجمع. تظل شروط §42.8 للاستقلال وheld-out وثبات scope والتحقق من evaluator مطلوبة.
- **next step:** أبقِ `fixed_safe_probe` وبوابة الجمع كما هما؛ لا تبدأ cohort ولا تدخل continuation في v1 قبل استيفاء ومراجعة جميع الشروط.

### 42.87 — تقرير جاهزية P7.5 للقراءة فقط قبل الجمع (2026-09-28)

- **phase/step:** إضافة preflight حتمي يراجع scope وسلامة سجلات P7.5 الموجودة قبل أي حملة held-out.
- **status:** `done — read-only assessment implemented; collection remains blocked pending human review`
- **what changed:** أضيف تقييم يثبت scope المقترح، ويفحص registration/result identities، تطابق الـforecast والـBrier المسجل، اكتمال القياس، والتكرار المتعارض. يستبعد continuation receipts من outcomes الخاصة بـcalibration v1، ويصدر manifest hash وتعدادات وفحوصًا ذات أسباب واضحة. لا يقدّر ECE أو bootstrap ولا ينشئ assessment. حتى مع سجلات متسقة، تبقى المراجعة البشرية مطلوبة لإجراء reset آمن، وتعريف الاستقلال بما يتجاوز اختلاف `missionId`، وإثبات held-out غير المستخدم، وتجميد policy، ومراجعة كفاية العينة وحدود ECE التجميعي قبل أول outcome.
- **files/schema/contracts touched:** وحدة واختبارات `runtime-start-hypothesis-calibration-readiness`، وخطة التنفيذ وسجل التقدم؛ لا schema أو migrations أو كتابة قاعدة بيانات أو endpoint.
- **validation:** اختبارات readiness وcalibration المستهدفة (17/17)، وفحص TypeScript المباشر لـAPI، و`git diff --check`، ثم إعادة تشغيل API والتأكد من وصوله إلى حالة الاستماع. أطلق بدء API تحديث فهرس OpenRouter الموجود مسبقًا؛ لم يصدر preflight طلب استدلال أو يجمع بيانات.
- **authority/safety impact:** التقرير لا يملك حالة ready، ويعيد دائمًا `collectionAuthorized=false` و`fixed_safe_probe`؛ لا يغير forecast أو policy أو selector أو cohort، ولا يجمع outcomes أو يكتب بيانات. نتائج continuation تظل خارج calibration v1.
- **remaining/blocker:** reset والاستقلال الحقيقي وheld-out provenance وتجميد forecast/policy ما زالت مراجعات حاجبة؛ لا يوجد scope مؤهل أو cohort.
- **next step:** أبقِ بوابة الجمع مغلقة إلى أن توثق هذه المراجعات وتُراجع منفصلًا؛ لا تستخدم تقريرًا نظيفًا وحده لبدء الجمع.

### 42.88 — حزمة أدلة جاهزية P7.5 الداخلية (2026-09-28)

- **phase/step:** ربط preflight read-only ببروتوكول مُجزّأ ومراجعات بشرية غير مُثبتة.
- **status:** `done — diagnostic evidence pack; no trusted attestation source; collection remains unauthorized`
- **what changed:** أضيف builder حتمي للحزمة يثبت protocol/calibration/evaluator/policy/scope versions hashes، ويربط readiness report وsource manifest وفحوص الآلة. تعرض الحزمة machine evidence للـscope والتسجيلات والنتائج والتعارض والـoverflow. توضح أن Episode identity fields لا تثبت ملكية ledger الدائمة. تبقى مراجعات reset والاستقلال وheld-out وfreeze وملاءمة evaluator وهوية reviewer بحالة missing، لأن مصدر السلطة لم يُحدد.
- **files/schema/contracts touched:** وحدة builder واختبارات readiness، وإظهار عدد مجموعات التعارض في تقرير preflight؛ لا API أو Dashboard أو schema أو migrations أو DB writes.
- **validation:** اجتازت اختبارات readiness المستهدفة (11/11)، وفحص TypeScript المباشر لـAPI، و`git diff --check`.
- **authority/safety impact:** لا يقبل builder attestation من caller؛ إضافة `resetConfirmed: true` تفشل سلامة مرجع التقرير ولا تغير حالة المراجعة. الحزمة دائمًا `BLOCKED` أو `REVIEW_REQUIRED`، و`collectionAuthorized=false`، ولا تحسب ECE/bootstrap أو تكتب بيانات أو تغير `fixed_safe_probe`.
- **remaining/blocker:** تحديد مصدر موثوق لهوية operator/reviewer والتحقق من reset وheld-out provenance يتطلب قرارًا مستقلًا؛ لا scope مؤهل أو cohort.

### 42.89 — إغلاق مصدر أدلة Episode لـP7.5 (2026-09-28)

- **phase/step:** ربط حزمة الجاهزية بأحداث P7.5 الدائمة بدل الاكتفاء بهوية Episode الموجودة داخل payload.
- **status:** `done — read-only ledger provenance verified; human review and collection remain blocked`
- **what changed:** أضيف مسار داخلي يقرأ أحداث التسجيل والنتيجة وسجل Episode المرتبط داخل معاملة PostgreSQL واحدة `REPEATABLE READ READ ONLY`، ويعيد بناء تقرير الجاهزية من payloads المخزنة. يتحقق من payload hashes، ومالك الحدث ونوعه وactor/correlation، وتطابق Episode مع Mission/Goal والخطة ومراجعة المشروع/البيئة وAction، ووجود الحدث في stream متصل. تضيف الحزمة مراجع event IDs وhashes وledger manifest hash؛ لا تعرض أجسام الأحداث.
- **files/schema/contracts touched:** وحدة التحقق والقراءة الداخلية واختبارات adversarial؛ إصدار حزمة الجاهزية وprotocol manifest أصبح 2. لا API أو Dashboard أو schema أو migration أو DB write.
- **validation:** اختبارات P7.5 المستهدفة (16/16)، فحص TypeScript لـAPI، `git diff --check`، وإعادة تشغيل API والتحقق من الاستماع.
- **authority/safety impact:** القراءة لا تعدّل الـledger. فشل الهوية أو hash أو التسلسل أو overflow يحجب الحزمة؛ scope الفارغ يظل `REVIEW_REQUIRED`. التطابق مع قاعدة البيانات الحالية ليس توقيعًا مستقلًا على عدم قابلية تعديلها، ولا يثبت المراجعات البشرية. تبقى `collectionAuthorized=false` و`fixed_safe_probe`، بلا ECE/bootstrap أو cohort.
- **remaining/blocker:** مصدر موثوق لهوية operator/reviewer، وreset، والاستقلال، وheld-out provenance وتجميد policy/evaluator ما زال مطلوبًا؛ لا scope مؤهل أو إذن جمع.

### 42.90 — إعادة تحديد نطاق Trust Boundary لـP7.5 (2026-09-28)

- **phase/step:** تخطيط الجرد والربط لمصادر الثقة؛ لم يبدأ تنفيذ source verifiers.
- **status:** `planned — document scope only; no code or authority changes`
- **scope decision:** الخطوة ليست بناء مصدر ثقة أو IAM جديدًا، بل تحديد المصادر الموجودة وتقييمها، مع قبول تعدد المصادر حسب نوع الإثبات: هوية/صلاحية المراجع، سجل المشغّل وreset، تاريخ اختيار العينة واستقلالها، lineage للـheld-out، وتجميد البروتوكول.
- **contract to plan:** لكل شرط يحدد المصدر ومرجعه وإصداره ونطاقه وحداثته وطريقة التحقق. تبقى حالات `SERVER_VERIFIED` و`HUMAN_REVIEW_REQUIRED` و`MISSING` و`CONFLICTING` و`OUT_OF_SCOPE` منفصلة؛ الغياب ليس `false` لكنه يحجب المرور، والتعارض أو غموض الاستقلال يحجبان كذلك. source verifiers منفصلة عن evidence-pack orchestrator.
- **authority/safety impact:** مصدر موثوق لا يساوي إذن الجمع؛ لا حالة `READY` أو موافقة تلقائية. caller assertions لا تُقبل كدليل، وتظل `collectionAuthorized=false` حتى بعد التحقق الآلي، مع موافقة بشرية مستقلة.
- **scope boundary:** توثيق وخطة فقط في هذه الخطوة؛ لا تعديل كود أو schema أو DB أو Dashboard، ولا cohort أو selector أو فتح collection. لا تُفترض مصادر موثوقة قبل جردها فعليًا.
- **next step:** إبقاء الحزمة داخلية وتشخيصية؛ لا إضافة API أو واجهة أو اعتماد آلي دون عقد مراجعة منفصل.

### 42.91 — جرد مصادر Trust Boundary وربطها بحزمة P7.5 (2026-09-28)

- **phase/step:** جرد مصادر الثقة الحالية وربط كل شرط readiness بمصدره وحدوده.
- **status:** `partial — source inventory implemented; all P7.5 trust conditions remain blocked`
- **what changed:** أضيف جرد server-owned منفصل عن evidence-pack orchestrator. يغطي
  Clerk session identity، و`ADMIN_USER_IDS`، وtask operator attestations،
  وEpisode ledger، وfixed partition، وprotocol manifest، مع حدود ما يثبته كل
  مصدر. يفصل شروط هوية المراجع عن صلاحياته وموافقته، ويضيف reset والاستقلال
  وheld-out lineage وfreeze وملاءمة evaluator. لم يُعثر على سجل P7.5 دائم
  للموافقة أو reset أو cohort/sample lineage أو held-out dataset lineage؛ وكل
  الشروط السبعة تبقى `MISSING` ومراجع الأدلة فارغة. أصبح إصدار evidence pack 3؛
  protocol/calibration manifest بقي v2.
- **files/schema/contracts touched:** وحدة trust-boundary مستقلة، evidence-pack
  builder واختبارات readiness/ledger، والخطة وسجل التقدم؛ لا schema أو migration
  أو DB write أو endpoint.
- **validation:** اختبارات P7.5 المركزة (19/19)،
  `pnpm exec tsc -p tsconfig.json --noEmit` من `artifacts/api-server`،
  `git diff --check`، وإعادة تشغيل workflow الـAPI؛ نجح build وعاد workflow
  إلى `RUNNING`. أظهرت السجلات تحذيرات recovery موجودة عن project roots مؤقتة
  غير متاحة وحدود المعدل؛ لم تعطل بدء API وليست من هذه التغييرات.
- **authority/safety impact:** غياب أو تعارض أو خروج المصدر عن النطاق يحجب
  الحزمة، كما لا تقبل `SERVER_VERIFIED` أو `HUMAN_REVIEW_REQUIRED` بلا مرجع مصدر
  حاضر وhash دليل. كل الشروط الحالية missing، والحزمة `BLOCKED` مع
  `collectionAuthorized=false` و`fixed_safe_probe`. لا IAM أو موافقات جديدة،
  ولا cohort أو selector أو جمع أو ECE/bootstrap.
- **remaining/blocker:** Clerk identity وoperator allowlist لا يثبتان اعتماد
  مراجع P7.5؛ task attestation caller-supplied؛ Episode provenance لا يثبت
  reset أو lineage؛ fixed partition لا يثبت held-out غير المستخدم؛ وprotocol
  hash لا يثبت freeze سابقًا للنتائج. يلزم مصدر موثوق مناسب لكل شرط قبل أي
  جاهزية أو جمع.
- **next step:** لا ترفع أي blocker ولا تضف مصدر سلطة جديدًا دون تحديد المصدر
  المسموح وآلية التحقق والمراجعة البشرية؛ أبقِ الجمع مغلقًا.

### 42.92 — توضيح عقد القرار المعماري لمصادر P7.5 (2026-09-28)

- **phase/step:** تنقيح Definition of Done لقرار اختيار مصادر الثقة؛ لا تنفيذ
  verifiers.
- **status:** `planned — decision-only; no source authority selected`
- **what changed:** أضيفت دلالات السلطة إلى الخطة: فصل `SOURCE` عن `AUTHORITY`
  وعن `EVIDENCE`، وطلب تحديد issuer وأساس سلطته والادعاء والنطاق وإصدار
  البروتوكول ووقت الصلاحية وشروط الإبطال/التعارض. أضيفت `UNVERIFIABLE` لحالة
  وجود المصدر دون إثبات سلطته، مع فصلها عن `MISSING` و`OUT_OF_SCOPE` و
  `CONFLICTING`. لا يُقبل غياب الدليل على أنه مراجعة بشرية.
- **files/schema/contracts touched:** خطة التنفيذ، سجل التقدم، وذاكرة حدود P7.5؛
  لا تعديل كود أو schema أو قاعدة بيانات أو صلاحيات.
- **validation:** `git diff --check`.
- **authority/safety impact:** ما زالت كل شروط المصدر الحالية `MISSING`، ولا
  يُختار مصدر أو يمنح authority ضمن هذه الخطوة. لا IAM أو approval table أو
  endpoint أو Dashboard أو cohort أو selector؛ collection تبقى مغلقة.
- **remaining/blocker:** يلزم قرار مالك النظام حول مصدر كل ادعاء وأساس سلطته؛
  بعده فقط يمكن تخطيط verifiers منفصلة.
- **next step:** اعتماد أو رفض المصادر المقترحة لكل شرط، مع توثيق authority
  semantics؛ لا تبدأ تنفيذ verifier قبل ذلك.

### 42.93 — توحيد تصنيف UNVERIFIABLE في runtime لـP7.5 (2026-09-28)

- **phase/step:** مواءمة taxonomy الثقة الموثق مع runtime قبل قرار المصادر أو
  تنفيذ verifiers.
- **status:** `done — UNVERIFIABLE is represented and remains fail-closed`
- **what changed:** أضيفت `UNVERIFIABLE` إلى حالات trust-boundary runtime؛ ويُنتج
  blocker مميزًا لهذه الحالة. يؤكد الاختبار أن وجود evidence refs صحيحة لا يحول
  `UNVERIFIABLE` إلى مراجعة بشرية أو تحقق. بقيت الحالات السبع الحالية `MISSING`
  ومراجعها فارغة.
- **files/schema/contracts touched:** trust-boundary runtime واختباراته، فقرة
  عقد الثقة في الخطة، وسجل التقدم؛ لا schema أو migration أو DB write.
- **validation:** اختبار trust-boundary وcalibration-readiness (15/15)،
  `pnpm exec tsc -p tsconfig.json --noEmit` و`pnpm run build` من
  `artifacts/api-server`، و`git diff --check`؛ أعيد تشغيل API workflow وعاد
  `RUNNING` مع `Server listening` على المنفذ. ظهرت تحذيرات recovery سابقة عن
  temporary project roots غير متاحة، ولم تمنع بدء الخدمة.
- **authority/safety impact:** taxonomy فقط؛ لا مصدر authority مختار أو verifier
  أو صلاحية جديدة. الحزمة تبقى `BLOCKED` و`collectionAuthorized=false`،
  والاختيار `fixed_safe_probe` دون تغيير.
- **remaining/blocker:** قرار المالك حول مصدر كل claim وأساس سلطته ما زال مطلوبًا.
- **next step:** حسم مصدر مؤهل أو التصريح بعدم وجوده لكل claim؛ بعد ذلك فقط
  تخطيط verifiers منفصلة.

### 42.94 — فصل قرار الحوكمة عن حالة دليل runtime في P7.5 (2026-09-28)

- **phase/step:** توضيح عقد قرار المالك قبل اختيار مصادر P7.5.
- **status:** `planned — no owner source decision selected`
- **what changed:** فصلت الخطة حالات قرار المالك
  (`QUALIFIED_SOURCE`، `NO_QUALIFIED_SOURCE`، `HUMAN_AUTHORITY_REQUIRED`،
  `DEFERRED`) عن حالات دليل runtime. اختيار مصدر مؤهل لا يثبت صحة دليل فعلي؛
  القرار يبقى في الخطة/سجل حوكمي ولا يُثبّت كمصدر موثوق داخل runtime. لا ينشئ
  `NO_QUALIFIED_SOURCE` مصدرًا بديلًا، وتبقى `DEFERRED` محجوبة.
- **files/schema/contracts touched:** الخطة وسجل التقدم وذاكرة حدود P7.5؛ لا
  تعديل runtime أو schema أو قاعدة بيانات أو صلاحيات.
- **validation:** `git diff --check`.
- **authority/safety impact:** لم يُتخذ أي قرار مصدر ولم تتغير حالات runtime
  الحالية أو `collectionAuthorized=false` أو `fixed_safe_probe`.
- **remaining/blocker:** قرار المالك حول كل claim ومصدره أو عدم وجود مصدر مؤهل.
- **next step:** ملء سجل قرار ذي سبعة claims بالجهة المصدرة وأساس السلطة
  والادعاء والنطاق وإصدار البروتوكول والصلاحية وقواعد الإبطال والتعارض؛ لا تبدأ
  verifiers قبل اعتماد القرار.

### 42.95 — إعداد سجل قرارات المالك لادعاءات P7.5 (2026-09-28)

- **phase/step:** تجهيز قرار الحوكمة لكل claim دون اختيار مصادر.
- **status:** `ready for owner input — no decisions recorded`
- **what changed:** أُنشئ سجل بسبعة claims مع حقائق الجرد الحالية كمرجع فقط.
  حقول قرار المالك غير مسجلة؛ ولا تُعامل `not recorded` كحالة قرار خامسة.
  فُصلت حالات قرار الحوكمة عن حالات دليل runtime، وأُكد أن اختيار المصدر لا
  يثبت evidence ولا يفتح collection.
- **files/schema/contracts touched:** `docs/p75-claim-authority-decision-record.md`
  ورابطه في خطة التنفيذ وسجل التقدم؛ لا runtime أو schema أو قاعدة بيانات.
- **validation:** `git diff --check`.
- **authority/safety impact:** لم يُختر مصدر ولم يُسجل `QUALIFIED_SOURCE` أو أي
  قرار آخر بالنيابة عن المالك؛ P7.5 تبقى `BLOCKED` و
  `collectionAuthorized=false` مع `fixed_safe_probe`.
- **remaining/blocker:** قرارات المالك السبعة وتفاصيل المصدر والسلطة والنطاق
  والصلاحية والإبطال والتعارض.
- **next step:** جمع قرار صريح لكل claim؛ لا كتابة verifier قبل ذلك.

### 42.96 — تسجيل قرارات المالك المقترحة لـP7.5 (2026-09-28)

- **phase/step:** تسجيل خيارات الحوكمة السبعة بعد اعتماد التوصية.
- **status:** `done — governance decisions recorded; evidence remains unverified`
- **what changed:** سُجل Clerk كمصدر لهوية الحساب/الجلسة فقط؛ و`HUMAN_AUTHORITY_REQUIRED`
  لسلطة المراجع والموافقة، وإعادة ضبط البيئة، وتجميد البروتوكول، ومراجعة المقيم؛
  و`NO_QUALIFIED_SOURCE` لاستقلال العينة ومنشأ held-out. لا تُعامل هذه القيم
  كحالات runtime أو إثبات للدليل.
- **files/schema/contracts touched:** سجل قرار P7.5 والخطة وسجل التقدم؛ لا runtime
  أو schema أو قاعدة بيانات أو صلاحيات.
- **validation:** `git diff --check`.
- **authority/safety impact:** بقيت شروط runtime السبعة `MISSING` ومراجعها فارغة؛
  الحزمة `BLOCKED` و`collectionAuthorized=false` والاختيار `fixed_safe_probe`.
  لم يُنفذ verifier أو IAM أو endpoint أو cohort أو selector.
- **remaining/blocker:** ربط هوية Clerk بسجل P7.5 الفعلي، وتوفير آليات موثوقة
  للمراجعة البشرية وreset وsampling وheld-out وprotocol freeze وevaluator؛
  كل ذلك خارج نطاق هذه الخطوة.
- **next step:** لا تنفيذ أو جمع حتى يوجد تفويض ونطاق منفصلان للتحقق من المصادر
  وبوابة مراجعة بشرية مستقلة.

### 42.97 — فحص ربط هوية Clerk بمراجعة P7.5 (2026-09-28)

- **phase/step:** فحص read-only لمصدر claim هوية المراجع فقط.
- **status:** `done — no existing trusted binding; identity claim remains blocked`
- **what changed:** لم يُعثر على سجل P7.5 دائم يربط هوية Clerk بمراجعة محددة
  وhash حزمة الأدلة وإصدار البروتوكول والنطاق والصلاحية. سجل Episode يثبت
  provenance للتنفيذ ونتائج التجارب، والتحقق العام للمهمة يثبت actor ونتيجة
  caller-submitted على task؛ لا يثبت أي منهما مراجعة P7.5. أظهر استعلام تطوير
  read-only عدم وجود أحداث ذات `recordKind` يبدأ بـ`P75`. سُجل invariant:
  هوية Clerk نفسها لا تعني المراجعة نفسها؛ غياب أو انتهاء أو إلغاء أو تعارض أو
  خروج عن النطاق يحجب الربط.
- **files/schema/contracts touched:** سجل قرار P7.5 والخطة وسجل التقدم وذاكرة
  حدود P7.5؛ لا runtime أو schema أو قاعدة بيانات أو صلاحيات.
- **validation:** `git diff --check`.
- **authority/safety impact:** بقيت claims runtime السبعة `MISSING`؛
  `reviewerAuthority` لم يتغير، و`collectionAuthorized=false`،
  والاختيار `fixed_safe_probe`. لم يُضف تخزين أو IAM أو endpoint أو verifier.
- **remaining/blocker:** لا يوجد binding موثوق قائم. أي آلية جديدة تتطلب نطاقًا
  وتفويضًا منفصلين؛ لا fallback إلى `HUMAN_REVIEW_REQUIRED` بسبب غياب الربط.
- **next step:** لا تغيير runtime أو جمع. إذا فُوّض تنفيذ لاحق، ابدأ بتحديد
  مصدر durable يربط identity وreview ID وحزمة الأدلة والبروتوكول والنطاق والصلاحية.

### 42.98 — تدقيق تغطية مصادر claims السبعة في P7.5 (2026-09-28)

- **phase/step:** تدقيق read-only للمصادر والعقود والكتّاب الحاليين، دون استعلام قاعدة بيانات.
- **status:** `done — no complete trusted source found; all P7.5 claims remain blocked`
- **what changed:** أُعدّت مصفوفة لكل claim تميّز بين قدرة schema/payload، والكاتب
  الذي يحفظ سجلًا فعليًا، وملاحظة صفوف قاعدة بيانات في بيئة محددة. Clerk وEpisode
  وtask/audit العام وحقول P7.5 للـmanifest/calibration تغطي أجزاءً من الهوية أو
  التنفيذ أو القياس فقط؛ لا يوجد في الشيفرة مصدر P7.5 مكتمل للموافقة، reset،
  استقلال العينة، منشأ held-out، تجميد ما قبل النتائج، أو مراجعة صلاحية المقيم.
  وجود actor أو hash أو label أو metric لا يثبت السلطة أو lineage.
- **files/schema/contracts touched:** سجل قرار P7.5، الخطة، سجل التقدم وذاكرة
  حدود P7.5؛ لا runtime أو schema أو كاتب أو قاعدة بيانات.
- **validation:** `git diff --check`.
- **authority/safety impact:** بقيت شروط runtime السبعة `MISSING` ومراجعها فارغة؛
  الحزمة تشخيصية فقط، `collectionAuthorized=false` و`writesPerformed=false`،
  والاختيار `fixed_safe_probe`. لم يُضف verifier أو IAM أو endpoint أو UI أو
  collection permission.
- **remaining/blocker:** لا يوجد مصدر موثوق يغطي العقود كاملة. نتائج audit للشيفرة
  لا تثبت وجود أو عدم وجود سجلات في بيئات أخرى؛ أي آلية جديدة أو اعتماد بشري
  يتطلب تفويضًا مستقلًا.
- **next step:** قرار منفصل من المالك: تحديد مصدر موثوق قائم لكل claim، أو
  الإبقاء على الحجب، أو تفويض تصميم آلية جديدة؛ لا تنفيذ أو جمع قبل ذلك.

### 42.99 — صياغة متطلبات الإثبات واختبار حدودها الحالية (2026-09-28)

- **phase/step:** مواصفة design-only لعقد proof obligations، مع اختبار حارس دون تغيير runtime.
- **status:** `done — design documented; source-based promotion remains blocked`
- **what changed:** وُثقت المتطلبات المشتركة وحقول الإثبات الخاصة بكل claim من
  السبعة، مع فصل الهوية عن السلطة، والـhash عن التوقيت والاعتماد، والقياس عن
  مراجعة المقيم. يُسمح للنموذج باقتراح سجلات مرشحة فقط؛ تصنيف السلطة والأدلة
  يظل مسؤولية verifier يملكه الخادم إذا فُوّض لاحقًا. عُزز اختبار inventory
  ليثبت أن وجود operator allowlist وtask attestation وpartition label، مع
  مصادر جزئية أخرى، لا يرفع أي claim من `MISSING` ولا يضيف evidence refs.
- **files/schema/contracts touched:** سجل قرار P7.5 والخطة وسجل التقدم واختبار
  trust-boundary وذاكرة حدود P7.5؛ لا runtime أو schema أو writer.
- **validation:** 3 ملفات Vitest، 20 اختبارًا ناجحًا؛
  `git diff --check`.
- **authority/safety impact:** لا حالات runtime أو صلاحيات جديدة؛ تبقى الحزمة
  `BLOCKED` و`collectionAuthorized=false` و`fixed_safe_probe`. `EXPIRED` و
  `REVOKED` موثقتان كأسباب حجب لا كحالات runtime جديدة.
- **remaining/blocker:** لا مصدر مؤهل ولا تفويض لتنفيذ verifier أو إضافة تخزين.
  يلزم قرار مستقل لاختيار مصدر قائم أو إبقاء الحجب أو تفويض آلية جديدة.
- **next step:** لا تنفيذ أو جمع حتى يصدر هذا القرار؛ أي تنفيذ لاحق يستخدم
  طبقات التخطيط والأدلة والقبول الموجودة، لا مخططًا أو منفذًا موازيًا.

### 43.00 — فحص ظلّ للسجلات الدائمة في قاعدة التطوير (2026-09-28)

- **phase/step:** مطابقة مجمّعة، read-only، لمتطلبات الإثبات مع مخازن التطوير المعروفة.
- **status:** `done — no matching P7.5 binding rows observed in checked development sources`
- **what changed:** فُحصت مفاتيح وإشارات P7.5 في `ai_agent_episode_events`
  و`tasks.verification_result` ولقطات `audit_logs`، مع فحص أسماء الجداول ذات
  الصلة. كانت النتائج: 404 أحداث Episode دون `P75` أو مفاتيح review/pack/protocol/
  validity؛ 11 task بينها نتيجة تحقق واحدة دون هذه الإشارات؛ 1,033 سجل audit
  دونها؛ ولم يظهر جدول عام باسم يطابق P7.5 أو calibration/review/approval/reset/
  cohort/holdout/sampling. أُرجعت أعداد فقط، بلا IDs أو actors أو نصوص أدلة.
- **files/schema/contracts touched:** سجل قرار P7.5 والخطة وسجل التقدم؛ لا runtime
  أو schema أو قاعدة بيانات أو صلاحيات. الاستعلامات للقراءة فقط على development.
- **validation:** `git diff --check`.
- **authority/safety impact:** لا binding مرصود في الجداول المحددة؛ تبقى claims
  runtime السبعة `MISSING`، والحزمة `BLOCKED` و`collectionAuthorized=false`،
  والاختيار `fixed_safe_probe`.
- **remaining/blocker:** هذه لقطة تطوير لحظية ومحدودة بالجداول والمفاتيح النصية
  المفحوصة؛ لا تنفي وجود بيانات في بيئة أو مخزن آخر. لا يوجد تفويض بمصدر أو
  verifier جديد.
- **next step:** قرار مالك مستقل: تقديم مصدر قائم بعينه لفحصه، أو إبقاء الحجب،
  أو تفويض تصميم آلية؛ لا جمع أو تغيير runtime قبل ذلك.

### 43.01 — إثبات رحلة Archive Upload الحقيقية وإعادة تحميل scan hook (2026-09-28)

- **phase/step:** تكامل منتجي لإغلاق reachability P0؛ خارج dependency graph
  المعرفي P0–P14.
- **status:** `done — authenticated archive journey and scan-hook persistence proven`
- **what changed:** مرّت رحلة Clerk الحقيقية عبر upload وdiscovery وimport وscan
  حتى `completed`، ثم فعّلت scan hook للمشروع وأثبتت بقاءه وفعاليته بعد reload.
  اجتازت رحلة متصفح منفصلة رفض الصيغة والحجم واستجابات 413/422، ومنع discovery
  بعد الرفض، ثم retry ناجح. اختير Firefox صراحةً لأن Chromium ينفصل في reload
  بهذه البيئة؛ لا يضيف هذا إثباتًا إلى schema أو acceptance.
- **files/schema/contracts touched:** إعداد Playwright والـcontrolled runner
  وتوثيق E2E؛ لا تغيير في schema أو authority أو acceptance.
- **validation:** الرحلة الحقيقية (1/1)، رحلة رفض الأرشيف وإعادة المحاولة (1/1)،
  واختبارات API archive-safety/upload-store/discovery (82/82) نجحت. حُذف
  المشروع المؤقت بعد الرحلة.
- **authority/safety impact:** لم يُستدعَ AI provider أو يُنشأ أثر في الإنتاج.
  لا يثبت هذا generalization أو transfer، ولا يغير أي حد من P7.5؛ بقيت
  `collectionAuthorized=false` و`fixed_safe_probe`.
- **remaining/blocker:** Archive Upload وproject scan-hook reload proof مغلقان
  ضمن هذا النطاق فقط. هذه الرحلة لا تثبت صلاحية بقية Dashboard journey أو
  جودة provider حي.
- **next step:** أعد قياس AI release gate الحتمية أولًا، ثم لا تجرّب مزودًا حيًا
  إلا عبر harness يثبت PROJECT_QUERY والقراءة فقط وCanonical Proof المقبول.

### 43.02 — إعادة قياس بوابة AI وتقييم صلاحية اختبار مزود حي (2026-09-28)

- **phase/step:** بوابة تحقق حتمية قبل أي اختبار مزود حي لـPROJECT_QUERY.
- **status:** `blocked — two blocking checks; no live-provider run`
- **what changed:** أعيد تشغيل `validate:ai-release` تشخيصيًا مع
  `AI_RELEASE_ENABLE_PREVIEW=false` كي تنتهي الفحوص الأخرى دون Chromium. اجتازت
  12 checks، وفشل checkان، وبقي Preview واحد متجاوزًا. محاولة التشغيل الافتراضي
  الكامل انتهت بمهلة shell مقدارها 300 ثانية من دون تقرير قرار.
- **files/schema/contracts touched:** هذا السجل وملخص الخطة فقط؛ لا تغيير في
  runtime أو schema أو acceptance.
- **validation:** نجحت typechecks وOpenAPI parity وtruth-flow وJSON contracts
  وrelease stream smoke وlong-run ownership والـbenchmarks وruntime-oracle
  preflight. أعاد الفحص المركب لاختباري SSE النجاح (104 passed/1 skipped و48/48)،
  لذا لم تتكرر نتيجة `AI_SSE_AND_REDACTION_FAILED_1` خارج gate؛ يبقى ذلك سبب
  فشل harness في تشغيل البوابة لا نجاحًا بديلًا لها. تكرر إخفاق
  `AI_OPERATIONAL_SAFETY_FAILED_1` في اختبار
  `routes inspect-then-fix through evidence first and keeps the proposed edit pending`:
  غاب حدث `done` المتوقع. Preview لم يعمل في التقرير التشخيصي.
- **live-harness assessment:** `validate:live-provider-review` يشغّل
  `reviewCode` على fixture مؤقت ضمن `code_review` ويتطلب finding لملف محدد؛
  ليس route أو contract لـPROJECT_QUERY، ولا يثبت قراءة فقط مع Canonical Proof.
  لم يُعثر على harness حي صالح لهذا الهدف.
- **authority/safety impact:** `liveProviderChecks=disabled`؛ لم يُقرأ secret أو
  يُتصل بمزوّد أو يُنشأ أثر. لا تغيير في P7.5 أو `collectionAuthorized` أو
  `fixed_safe_probe` أو بوابة جمع البيانات.
- **remaining/blocker:** قرار AI Release ما زال blocked، والتشغيل الكامل الافتراضي
  لم يكتمل. لا live test حتى تجتاز البوابة الكاملة ويتوفر harness مخصص يربط
  PROJECT_QUERY بمشروع Git تجريبي للقراءة فقط وقبول proof.
- **next step:** عالج إخفاق مسار inspect-then-fix ومشكلة harness في فحص SSE،
  ثم أعد البوابة كاملة بما فيها Preview. بعد النجاح فقط، أنشئ أو اختر harness
  PROJECT_QUERY المقيّد بالقراءة، وأثبت Canonical Proof قبل تقييم جودة provider.

### 43.03 — تصحيح نجاح بوابة AI وبناء harness حتمي لـPROJECT_QUERY (2026-09-29)

- **phase/step:** تحقق حتمي قبل أي تقييم مزود حي لـPROJECT_QUERY.
- **status:** `passed — fixture harness; live provider not run`
- **what changed:** صحح الملخص وفق تقرير القرار الافتراضي: 15/15 فحصًا ناجحًا،
  بلا فشل أو تخطٍ، وPreview ناجح؛ بقي `liveProviderChecks=disabled`. أضيف أمر
  harness مخصص، ووُسّع الاختبار القائم بدل تكرار مسار fixture جديد.
- **files/schema/contracts touched:** `artifacts/api-server/package.json`،
  `artifacts/api-server/src/routes/ai-stream-integration.test.ts`، وهذا السجل
  وملخص الخطة؛ لا تغيير runtime أو schema.
- **validation:** `pnpm --filter @workspace/api-server run
  test:project-query-proof-harness` — `1 passed`, و106 اختبارات متروكة عمدًا بسبب
  تشغيل الاختبار المحدد؛ `pnpm --filter @workspace/api-server run typecheck`
  نجح؛ `git diff --check` نجح. يثبت الاختبار تطابق إسقاط JSON/SSE/history،
  والـobjective والـclaims والقراءات bounded، وCanonical Proof `PROVEN` مع أجسام
  evidence كاملة محفوظة لمسار SSE، وعدم وجود change proposals أو apply-journal
  أو ملفات مكتوبة في جذر المشروع.
- **authority/safety impact:** fixture حتمي محدود بطلب JSON وطلب SSE، وينتهي
  بخطأ عند استنفاده؛ لم يُستدعَ مزود حي أو تنفيذ STATE. لا تمنح نتيجة JSON
  إثباتًا؛ يظل المسار غير المتدفق observation-only مع `proofRequired=false`،
  ولذلك ينحصر إثبات Canonical Proof في SSE وفق العقد الحالي.
- **remaining/blocker:** لا يثبت هذا harness جودة مزود حي، ولا Canonical Proof
  لمسار JSON، ولا تعميم الوكيل. يتطلب توحيد إثبات المسارين تغييرًا منفصلًا
  ومراجعًا لعقد قبول المسار غير المتدفق.
- **next step:** أبقِ أي اختبار مزود حي متوقفًا؛ إذا لزم تكافؤ Canonical Proof
  بين JSON وSSE، فاعتمد ذلك كتغيير مستقل لعقد non-stream PROJECT_QUERY أولًا.

### 43.04 — قبول Canonical Proof لمسار JSON المؤهل (2026-09-29)

- **phase/step:** عقد قبول PROJECT_QUERY غير المتدفق، ضمن التحقق الحتمي قبل أي
  تقييم مزود حي.
- **status:** `passed — eligible JSON proof and fail-closed cases; live provider not run`
- **what changed:** صار المسار غير المتدفق ينشئ عقد proof-required فقط لطلب
  PROJECT_QUERY المقيّد بالقراءة فقط مع objective صالح مشتق من الخادم. رُبطت
  الجلسة والتنفيذ والرسالة النهائية ومراجعة المصدر والأجسام الكاملة المحتفظ بها؛
  لا يصبح رد المساعد نهائيًا قبل قبول Canonical Proof. بقيت orientation وFACT
  وcapability probes والطلبات المرتبطة بمهمة أو المركبة أو التنفيذية خارج هذا
  المسار، وتبقى على عقودها السابقة.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/routes/ai/chat.ts`،
  `artifacts/api-server/src/routes/ai-stream-integration.test.ts`، هذا السجل،
  ملخص الخطة، وذاكرة حاجز non-stream؛ لا تغيير schema.
- **validation:** اجتاز
  `pnpm --filter @workspace/api-server run test:project-query-proof-harness`
  (`1 passed`, و106 متروكة عمدًا)، واختبار PROJECT_QUERY المجمّع (`2 passed`,
  و105 متروكة عمدًا)، و`pnpm --filter @workspace/api-server run typecheck`،
  و`git diff --check`. أثبتت fixtures قبول JSON وSSE مع Canonical Proof
  `PROVEN`، ورفض JSON عند غياب الأجسام المحتفظ بها (`FAILED`,
  `evidenceComplete=0`)، وبقاء no-objective غير مكتمل. لم تُنشأ proposals أو
  apply-journal rows أو ملفات في جذر المشروع.
- **authority/safety impact:** تستند الأهلية إلى intent وobjective وحدود
  read-only server-owned؛ لا يمنح النص المُولّد سلطة قبول. لم يُستدعَ مزود حي
  ولم يبدأ STATE. لم يتغير `liveProviderChecks=disabled` أو نطاق P7.5.
- **remaining/blocker:** لا يقيّم هذا الاختبار جودة مزود حي أو تعميم الوكيل؛
  ويقتصر الإثبات على PROJECT_QUERY المؤهل والمسار المحدد.
- **next step:** أبقِ تقييم المزود الحي وSTATE خارج نطاق هذا التغيير؛ أي اختبار
  لاحق لهما يحتاج نطاقًا وتفويضًا منفصلين.

### 43.05 — ربط Attestation العملية بانتقال runtime.start (2026-09-29)

- **phase/step:** خطوة ضيقة من P4/P6 لمسار stopped → running الموجود.
- **status:** `passed — child-process observation is linked and validated for this pilot`
- **what changed:** صارت ملاحظة `runtime.child_process_environment` تُmaterialize
  مع ملاحظة `runtime.after_state` قبل إنشاء transition، فيُدرج معرّفها في
  `afterObservationIds` و`materializedObservationIds`. يشترط finalizer حالة
  known وملاحظة complete/fresh، وتطابق session/operation/execution/attempt/
  Episode/revision/environment، مع إعادة حساب digest من القيم المقبولة.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/recipe-operation-runner.ts`،
  `artifacts/api-server/src/lib/agent-state/runtime-start-transition.ts`،
  `artifacts/api-server/src/lib/recipe-operation-runner.test.ts`؛ لا schema أو
  migration.
- **validation:** API typecheck و`git diff --check` واختبارات
  `runtime-start-transition.test.ts` (12/12) والاختبار المحدد
  `classifies a verified runtime after-state before successful acceptance`
  (1/1) نجحت. مجموعة `recipe-operation-runner.test.ts` سجلت 24/25؛ فشل اختبار
  استرداد P7.5 بسبب 3 أحداث terminal بدل 2، ومساره المنفصل لا يستدعي `runtime.start`.
  إعادة تشغيل الاختبار وحده انتهت بمهلة Vitest الافتراضية (20 ثانية).
- **authority/safety impact:** رفض World Delta عند غياب أو عدم صلاحية Attestation؛
  قبول Gate C يبقى مستقلًا ولا يُسحب. لم يُشغّل مزود حي أو STATE.
- **remaining/blocker:** هذه ليست إغلاقًا عامًا لـP4/P6. لا restart أو stop أو
  معايرة P7.5. لم يُضف بعد اختبار سلبي منفصل للملاحظة الناقصة أو المتعارضة.
- **next step:** أبقِ التغيير محصورًا في هذا الطيار؛ أي توسيع لبقية runtime أو
  تقييمات أخرى يحتاج نطاقًا منفصلًا.

### 43.06 — إثبات تسليم runtime.start إلى قرار Mission D2 (2026-09-30)

- **phase/step:** إغلاق handoff محدود من P6 إلى مستهلك D2 لمسار
  `runtime.start` من stopped إلى running.
- **status:** `passed — materialized transition dispatches once; invalid child evidence never dispatches`
- **what changed:** أضيف اختبار DB-backed يعبر من finalizer الانتقال الفعلي إلى
  `wakeRuntimeTransitionMissionGoals`. عند الدليل الصحيح، يثبت الانتقال
  المادي ويحمل dispatch هوية الانتقال والتنفيذ والمحاولة وAction وEffectBundle
  ومراجع الملاحظات و`parentWorldRevision` و`resultingWorldRevision` وخطتي
  المصدر/الهدف؛ إعادة الإيقاظ لا تكرر dispatch. في حالات child-process الست
  (غير مرتبط، ناقص، قديم، مجهول، جلسة أخرى، أو binding digest مختلف)، يبقى
  قبول Gate C ناجحًا، وينتهي هدف Mission إلى `needs_replan` بلا dispatch.
  يظل تشغيل runtime manager نفسه مغطى باختبار runner المنفصل.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/agent-state/runtime-start-transition.test.ts`
  وهذا السجل وخطة التنفيذ؛ لا تغيير إنتاجي أو schema أو migration.
- **validation:** `pnpm --filter @workspace/api-server run typecheck`،
  والاختباران `runtime-start-transition.test.ts` و`mission-runtime.test.ts`
  (37/37)، و`git diff --check` نجحت. لم تُعد مجموعة
  `recipe-operation-runner.test.ts` كاملة؛ يظل فشل P7.5 المعزول المذكور في
  §43.05 خارج هذا التحقق.
- **authority/safety impact:** لا تغيير في Canonical/Gate C acceptance أو
  صلاحيات التنفيذ. النجاح المادي وحده لا يكفي؛ D2 يستهلك transition المرتبط
  فقط، بينما فشل materialization يحجب الهدف التابع.
- **remaining/blocker:** يظل إثبات D2 محصورًا في pilot `runtime.start`.
  `apply-changes` لا يملك بعد ملاحظة live post-promotion ومراجعة مشروع/بيئة
  صريحة ومسار Mission يستهلك تلك المراجعة؛ لا تُسقط ملاحظات candidate إلى
  World State.
- **next step:** عرّف عقد live-project revision وenvironment freshness لمسار
  `apply-changes` ثم مستهلك Mission محدد قبل إضافة World Delta له. لا تعمم
  transition engine ولا توسع إلى restart/stop أو P7.5 أو STATE أو مزود حي.

### 43.07 — ربط Apply Changes الحي ببوابة Mission D2 (2026-09-30)

- **phase/step:** امتداد محدود لـP6: انتقال `apply-changes` من live project
  observations إلى تقييم Mission D2.
- **status:** `partial — materialization وتقييم D2 مثبتان؛ dispatch التابع مرة واحدة
  ومصفوفة الرفض end-to-end ما زالا مطلوبين`
- **what changed:** فصلت ملاحظة candidate عن live project facts. يقبل finalizer
  لملاحظة apply الانتقال فقط before/after observations المباشرة والكاملة والحديثة
  ذات subject `project:<projectId>`، ومراجعات الشجرة الأساسية/المروّجة، وربط البيئة
  نفسه. أصبح Apply Mission يتطلب ربطًا server-owned؛ وجود ربط Mission مع عقد Goal
  ناقص يفشل مغلقًا، وهوية candidate تبقى مقيدة بالمقترح والشجرة. أُضيف اختبار
  DB-backed يمر عبر finalizer إلى World State materialization ثم يثبت أن D2 يعيد
  `proven`. واختبار route يثبت إنشاء Apply Goal بلا Task، ربط successor، رفض
  الإكمال المبكر، ومنع Apply Mission مكرر.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/routes/ai/chat.ts`,
  `artifacts/api-server/src/routes/ai/missions.ts`,
  `artifacts/api-server/src/routes/ai/missions.test.ts`,
  `artifacts/api-server/src/lib/agent-state/runtime-start-transition.ts`,
  `artifacts/api-server/src/lib/agent-state/runtime-start-transition.test.ts`,
  `artifacts/api-server/src/lib/agent-state/apply-changes-mission-gate.ts`,
  `docs/agent-generalization-progress.md`.
  لا تغييرات schema أو migrations.
- **validation:** `pnpm --filter @workspace/api-server run typecheck` نجح؛
  `apply-changes-mission-gate.test.ts` (5/5)،
  `runtime-start-transition.test.ts` (20/20)، واختبار إنشاء Apply Mission
  المحدد في `missions.test.ts` (1/1) نجحت. أعيد تشغيل API وDashboard بنجاح.
  اختبارا shadow-replay منفصلان ما زالا يفشلان قبل إنشاء receipt بـ
  `SHADOW_REPLAY_RECIPE_BLOCKED`؛ يشير فحص التنفيذ إلى أن fixtures لا توفر إثبات
  process attestation الذي يتطلبه `candidate.verify`. لم تُخفّف بوابة الإنتاج.
- **authority/safety impact:** يظل قبول Gate C مستقلًا عن حالة World State وD2؛
  materialization أو فشلها لا يمنح قبولًا ولا يسحبه بأثر رجعي. D2 يثبت أهلية
  الانتقال المرتبط فقط ولا يمنح Goal `PROVEN` أو صلاحية كتابة جديدة. لا تُعاد
  كتابة الملفات أثناء retry أو materialization.
- **remaining/blocker:** لم يُثبت بعد dispatch فعلي لـ`report-applied` مرة واحدة
  تحت wake/retry مكرر، ولا حالات الرفض end-to-end لملاحظة candidate فقط أو تعارض
  البيئة/الشجرة أو سباق مراجعة الأب أو تغيّر الخطة/المقترح. كما بقي اختبارا
  shadow-replay المذكوران منفصلين عن هذا الطيار.
- **next step:** أضف اختبارًا DB-backed يعبر من materialized transition إلى
  dispatch واحد للـMission successor، ثم يثبت حالات الرفض بلا dispatch أو
  `PROVEN` وبقاء Gate C، قبل تحديث حالة P6 أو الانتقال إلى P7/P7.5.

### 43.08 — إثبات dispatch هدف report-applied من Mission D2 (2026-09-30)

- **phase/step:** إغلاق محدود لمستهلك P6 Apply Changes D2 بعد materialization.
- **status:** `passed — dispatch واحد عند الدليل الصحيح؛ الحالات غير الصالحة وخطة
  قديمة لا تطلق successor`
- **what changed:** أضيف اختبار تكاملي DB-backed يمر من `wakeApplyChangesMissionGoals`
  إلى `runMissionGoal` ثم dispatcher الفعلي لهدف `report-applied`. يثبت الاختبار
  إكمال Goal المصدر بعد D2، إنشاء `AiGoalDispatchRequested` واحد، وجدولة task مرة
  واحدة فقط رغم wake مكرر. غطت حالات الرفض دليل candidate فقط، اختلاف البيئة،
  اختلاف live tree، اختلاف promoted proposal، واختلاف binding للمتطلب؛ كلها تمنع
  dispatch وتحوّل مصدر Apply إلى `needs_replan`. اختلاف active plan يبقي Apply
  منتظرًا بلا قبول D2 أو dispatch. في جميع الحالات بقي Gate-C acceptance
  `SUCCEEDED`. كشف الاختبار أيضًا أن ربط Apply على مستوى Mission كان يصنّف
  `report-applied` كأنه مصدر Apply؛ عُدّل الفحص ليميز successor الموثق عن Goal
  المصدر، مع استمرار الفشل المغلق لعقد Apply غير الصالح.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/agent-state/apply-changes-mission-gate.ts`,
  `artifacts/api-server/src/lib/mission-runtime-apply-changes.test.ts`,
  `docs/agent-generalization-progress.md`.
  لا تغييرات schema أو migrations.
- **validation:** `pnpm --filter @workspace/api-server run typecheck` نجح؛
  اختبارات `mission-runtime-apply-changes.test.ts` و`mission-runtime.test.ts`
  و`apply-changes-mission-gate.test.ts` و`runtime-start-transition.test.ts`
  نجحت (50/50)، و`git diff --check` نجح.
- **authority/safety impact:** D2 يطلق الـsuccessor فقط بعد proof transition
  المادي والمرتبط بالخطة. حالات evidence/environment/tree/proposal/binding غير
  الصالحة لا تسقط في Goal acceptance ولا تطلق task؛ Gate C يظل مستقلًا وناجحًا.
- **remaining/blocker:** يغطي هذا الاختبار المستهلك من transition مادي محفوظ؛
  لا يجمع في اختبار واحد مسار route حتى finalizer ثم dispatch. اختبارا
  shadow-replay المنفصلان المذكوران في §43.07 لا يزالان يحتاجان fixtures تحمل
  process attestation المعتمدة، من دون تخفيف بوابة `candidate.verify`.
- **next step:** ثبّت أهلية scope واحد محدد لـP7/P7.5 قبل بدء أي توسعة معرفية؛
  أبقِ P8 مؤجلًا ما دامت P7.5 بلا scope معاير ومراجع.

### 43.09 — إغلاق Apply Changes من القبول حتى dispatch تابع Mission (2026-09-30)

- **phase/step:** إغلاق محدود لمسار P6 Apply Changes D2.
- **status:** `passed — قبول الأثر، materialized transition، وإطلاق successor مرة واحدة مثبتة عبر endpoint`
- **what changed:** حُفظ `effectRequired: true` مع `proofRequired: true` في عقد التنفيذ، مع
  `sourceEvidenceRequired: false` لأن هذا البرهان قائم على ملاحظات live لا قراءات مصدرية.
  يستبعد حساب مراجعة World State للأب Episode التنفيذ الجاري، ليطابق الاستبعاد نفسه عند
  finalization ويمنع إعادة محاولة transition صحيح بسبب اختلاف المراجعة. استُبعد successor
  الذي لا يحمل متطلب Apply من مرشحي ربط المقترح. يمر الاختبار الجديد عبر endpoint الحقيقي
  وfinalizer وD2؛ ويثبت ملاحظتي الشجرة live قبل/بعد، وtransition ماديًا، وقبول Apply
  `PROVEN`، وdispatch واحد للـsuccessor.
- **files/schema/contracts touched:**
  `artifacts/api-server/src/lib/ai-execution-state.ts`,
  `artifacts/api-server/src/routes/ai/chat.ts`,
  `artifacts/api-server/src/routes/ai.test.ts`,
  `.agents/memory/apply-changes-acceptance-gate.md`,
  وهذا السجل. لا تغييرات schema أو migrations.
- **validation:** `pnpm --filter @workspace/api-server run typecheck` نجح؛
  اختبار endpoint المحدد في `ai.test.ts` نجح (1/1)؛ مجموعة Mission المحددة من
  مجلد `artifacts/api-server` نجحت (50/50 عبر 4 ملفات)؛ `git diff --check` نجح.
  أُعيد تشغيل `artifacts/api-server: API Server`؛ اكتمل البناء وبدأ الخادم يستمع
  على المنفذ 8080 بلا أخطاء بدء تشغيل.
- **authority/safety impact:** تظل Canonical/Gate C acceptance مستقلة عن D2.
  لا تكفي حالة القبول وحدها لإطلاق التابع؛ يلزم transition مربوط بإثبات الأثر
  وملاحظات live مباشرة وحديثة ومراجعة بيئة واحدة. فشل D2 لا يعيد الترويج ولا
  يمنح صلاحية كتابة جديدة.
- **remaining/blocker:** لا شيء ضمن مسار Apply Changes المطلوب. لم يبدأ عمل
  P7.5 أو shadow-loop أو توسعة جديدة لـ`runtime.start`.

### 43.10 — عقد قرار لمصدري استقلال العينات وheld-out (2026-09-30، 04:58 EEST)

- **phase/step:** P7.5 — تعريف التزامات إثبات مصدرين ما زالا بلا مصدر مؤهل.
- **status:** `done — design-only؛ P7.5 collection ما زالت blocked`
- **what changed:** وُثق عقد فصل المصدر والسلطة والدليل للشرطين
  `independent-sampling-definition` و`held-out-provenance`، مع متطلبات
  النطاق والنسب والتوقيت والفصل عن الضبط وحالات الرفض وخيارات قرار المالك.
  لا يختار مصدرًا ولا يغيّر قرارات `NO_QUALIFIED_SOURCE` المسجلة.
- **files/schema/contracts touched:** `docs/p75-sampling-heldout-source-contract.md`
  وهذا السجل فقط؛ لا schema أو قاعدة بيانات أو كود تشغيل.
- **validation:** مراجعة `docs/p75-claim-authority-decision-record.md`
  و§31/§42.8 في خطة التنفيذ، وفحص نص العقد و`git diff --check`.
- **authority/safety impact:** وثيقة تصميم فقط؛ لا writer أو verifier أو
  cohort أو selector أو approval جديد. الشروط السبعة في runtime لا تزال
  `MISSING`، و`collectionAuthorized=false` و`fixed_safe_probe` كما هما.
- **remaining/blocker:** لا مصدر مؤهل مثبت للشرطين؛ ومتطلبات هوية المراجع
  وسلطته والـreset والـfreeze وملاءمة المقيم ما زالت غير مثبتة أيضًا.
- **next step:** يحدد المالك أهلية مصدر وسلطته لكل من الشرطين أو يبقي
  `NO_QUALIFIED_SOURCE`. أي تنفيذ للتحقق أو جمع نتائج يحتاج نطاقًا وتفويضًا
  منفصلين؛ لا ينتقل إلى P8/P9/P10.

### 43.11 — خيار إعادة استخدام طبقات المشروع لمصدري P7.5 (2026-09-30، 05:06 EEST)

- **phase/step:** P7.5 — تقييم مصدرَي استقلال العينة وheld-out والربط الممكن
  بالـEpisode وحزمة الجاهزية، دون إنشاء سلطة جديدة.
- **status:** `done — design-only؛ P7.5 collection blocked`
- **what changed:** أضيف خيار معماري مشروط بسجلين منفصلين وظيفيًا: سلسلة
  اختيار العينة، ومنشأ مجموعة التقييم وتاريخ استخدامها. سُجل أن الـEpisode
  وstrategy replay وshadow telemetry تصلح لدليل فني محدود لا لسلطة
  الاستقلال أو عدم التسرب؛ وتحددت مواضع الربط اللاحق والمدقق المستقل وحالات
  الرفض، مع إبقاء تحديد الجهة المصدرة وصلاحيتها قرارًا للمالك.
- **files/schema/contracts touched:** `docs/p75-sampling-heldout-source-contract.md`
  وهذا السجل فقط؛ لا تغيير schema أو تطبيق أو بيانات.
- **validation:** جرد read-only للشيفرة ومخطط التطوير؛ أعداد التطوير:
  صفر أحداث تجربة P7.5، صفر حالات/تشغيلات strategy replay، و425 حدث
  shadow campaign تشغيلي. مراجعة حدود trust boundary وreadiness pack؛
  فحص تنسيق المستند و`git diff --check`.
- **authority/safety impact:** توصية تصميم غير معتمدة؛ لا اختيار مصدر
  مؤهل أو writer أو verifier أو cohort أو صلاحية. شروط runtime ما زالت
  `MISSING`، و`collectionAuthorized=false` و`fixed_safe_probe` بلا تغيير.
- **remaining/blocker:** يلزم قرار المالك حول المصدر والجهة المصدرة وسلطتها
  وفصلها عن الضبط لكل شرط؛ الشروط الخمسة الأخرى ما زالت محجوبة.
- **next step:** بعد قرار المالك فقط، يُحدد نطاق تفويض منفصل لتصميم آلية
  الإثبات والتحقق؛ لا جمع أو معايرة أو انتقال إلى P8/P9/P10 الآن.

### 43.12 — مراجعة التعارض بين المعايرة ومصادر P7.5 (2026-09-30)

- **phase/step:** P7.5 — تدقيق إعادة الاستخدام قبل تنفيذ مصادر جديدة.
- **status:** `done — audit/design؛ collection blocked`
- **what changed:** صُحح فهم خيار 43.11: المطلوب فئتا دليل لا سجلان
  ماديان تلقائيًا. وُثق أن evaluator قد يصدر `validated_for_scope` من
  Mission IDs فريدة وعتبات عددية دون trust boundary؛ بينما الحزمة لا
  تمنح إذن الجمع. وُثق حد التسجيل الواحد، وفصل strategy replay،
  ونقص هوية dataset/عضويتها في scope v1.
- **files/schema/contracts touched:** عقد مصادر P7.5 وخطة التنفيذ
  وسجل التقدم؛ لا schema أو مصدر جديد.
- **validation:** مراجعة مسار Mission والمقيم ومحمّل إعادة التخطيط
  وحزمة الجاهزية وعقد Episode؛ تدقيق للقراءة فقط للشيفرة.
- **authority/safety impact:** تصحيح تصميمي لا يغير قرار المالك؛
  `NO_QUALIFIED_SOURCE` للشرطين، شروط runtime السبعة `MISSING`،
  و`collectionAuthorized=false` و`fixed_safe_probe` بلا تغيير.
- **remaining/blocker:** سدّ فجوة الوسم في الكود ثم اختبار الحاجز؛
  تعيين المصدر والسلطة البشرية والاحتفاظ لبقية المطالب لم يُحسم.
- **next step:** فصل نتيجة العتبات عن الاعتماد للنطاق دون إضافة writer
  أو verifier أو cohort؛ إبقاء الجمع مغلقًا.

### 43.13 — فصل العتبات العددية عن اعتماد نطاق P7.5 (2026-09-30)

- **phase/step:** P7.5 — حاجز fail-closed لوسم المعايرة في Mission runtime.
- **status:** `done — numerical assessment remains advisory؛ collection blocked`
- **what changed:** أصبح اجتياز 30 Mission ID وعتبتي ECE يصدر
  `thresholds_met_unverified` مع بقاء المقاييس ومرجع التقييم؛ التسجيل
  والتوقعات الجديدة تبقى `unvalidated`، حتى لو أعاد المقيم وسمًا تاريخيًا.
  بقيت قراءة التقارير التاريخية وسياق replan الاستشاري متوافقة.
- **files/schema/contracts touched:** مقيم P7.5 ومسار Mission runtime
  واختبارات المقيم وreplan، وخطة التنفيذ وعقد المصادر وهذا السجل؛
  لا schema قاعدة بيانات أو مصادر أدلة جديدة.
- **validation:** API build وtypecheck ناجحان؛ 20 اختبارًا موجهًا
  للمقيم والتسجيل وreplan ناجحة، بما فيها رفض تقرير عددي جديد
  كسياق replan معتمد.
- **authority/safety impact:** لا verifier ولا صلاحية جمع ولا عينة
  جديدة؛ `NO_QUALIFIED_SOURCE` للشرطين، شروط runtime السبعة `MISSING`،
  `collectionAuthorized=false` و`fixed_safe_probe` وGate C بلا تغيير.
- **remaining/blocker:** تحديد المصادر المؤهلة وسلطتها وفصل الواجبات
  وسياسة الاحتفاظ وبقية شروط الجاهزية بموافقة المالك؛ لا تستنبط
  سلطة من الحالة العددية أو التقرير التاريخي.
- **next step:** بعد قرار المالك فقط، تصميم تحقق خادمي للأدلة
  مربوط بالتجربة الحالية؛ لا cohort أو writer أو جمع الآن.

### 43.14 — إجراء حوكمة مقترح لمصدري P7.5 (2026-09-30)

- **phase/step:** P7.5 — تصميم مسؤوليات وتسلسل إثبات استقلال العينات
  ومنشأ held-out بعد إجازة تصميم الإجراء فقط.
- **status:** `done — design-only؛ collection blocked`
- **what changed:** وُثق ترتيب تعيين سلطة المصدر وفصل الضبط عن
  الاختيار والحجب، وتجميد السياسة والإطار والعضوية قبل النتائج،
  وسلسلة الوحدة والتعامل مع reset والفشل، ومطابقة Episode ومراجعة
  الاعتماد والإبطال. لم تُعيّن جهات فعلية أو مصدران ماديان.
- **files/schema/contracts touched:** إجراء الحوكمة الجديد وعقد المصادر
  وسجل قرار المالك وخطة التنفيذ وهذا السجل؛ لا schema أو كود أو بيانات.
- **validation:** مطابقة الادعاءين بالقرار المسجل وشروط الجاهزية
  السبعة وحدود Episode والمعايرة وcontinuation؛ فحص الوثائق
  و`git diff --check`.
- **authority/safety impact:** موافقة التصميم لا تساوي تأهيل المصدر؛
  `NO_QUALIFIED_SOURCE` للشرطين و`MISSING` للسبعة،
  `collectionAuthorized=false` و`fixed_safe_probe` بلا تغيير.
- **remaining/blocker:** تسمية المالك الجهات ومصادرها وسلطتها
  وفصل الواجبات والاحتفاظ، ثم تفويض تحقق مستقل؛ لم يبدأ جمع.
- **next step:** مراجعة المالك للإجراء وملء قراري المصدر؛ لا
  writer أو verifier أو cohort حتى اعتماد المصدر والنطاق منفصلًا.

### 43.15 — تدقيق جدوى العينة ومعنى held-out قبل قرار المصدر (2026-09-30)

- **phase/step:** P7.5 — مراجعة أعمق لترتيب تصميم الحوكمة، دون جمع.
- **status:** `done — design correction؛ feasibility unproven`
- **what changed:** أُضيفت بوابة تصميمية قبل اختيار المصدر لتعريف
  الوحدة المستقلة وجدوى إعادة ضبط `stopped` مع ثبات scope؛ فُصلت
  بصمة البيئة عن الحالة التشغيلية والاستقلال. وُضح أن held-out
  قد يكون تدفق نتائج مستقبليًا: تُثبت قواعده قبل أول outcome،
  وعضوية الوحدة قبل توقعها، ويستمر تدقيق الاستعمال بعد ذلك.
- **files/schema/contracts touched:** إجراء الحوكمة وعقد المصدرين
  والتزامات الإثبات وخطة التنفيذ وهذا السجل؛ لا schema أو كود.
- **validation:** مراجعة نطاق المعايرة وبصمة البيئة وتسلسل تسجيل
  التوقع/النتيجة وعدّ Missions؛ فحص الوثائق و`git diff --check`.
- **authority/safety impact:** لا مصدر مؤهل ولا تشغيل فحص أو جمع؛
  `NO_QUALIFIED_SOURCE` للشرطين، شروط runtime السبعة `MISSING`،
  و`collectionAuthorized=false` و`fixed_safe_probe` بلا تغيير.
- **remaining/blocker:** لم تثبت جدوى 30 وحدة مستقلة قابلة لإعادة
  الضبط داخل scope واحد؛ لا جهات أو مصادر أو سلطة أو سياسة احتفاظ
  معيّنة.
- **next step:** مراجعة جدوى منهجية مستقلة للبوابة الأولى، ثم قرار
  المالك بشأن مصدر/سلطة كل ادعاء إذا اجتازت الخطة مراجعة التصميم؛
  لا verifier أو cohort أو تشغيل held-out الآن.

### 43.16 — تدقيق جدوى تشغيلات `runtime.start` وحدود المعايرة (2026-09-30)

- **phase/step:** P7.5 — تدقيق شيفرة وتصميم قبل قرار المصدر.
- **status:** `done — desk audit؛ operational feasibility unproven`
- **what changed:** وُثق وجود مسار إيقاف محمي ودليل Gate C لإيقاف
  مشروع واحد، وإمكان البدء المتسلسل المشروط بثبات النطاق، مع غياب
  إثبات استقلال reset أو تأهيله لـP7.5. قورنت النسخ متعددة المشاريع
  ببصمة النطاق، واشتُق ECE للتوقع الثابت وخطر غلبة نجاحات البدء
  دون افتراض توزيع نتائج فعلية.
- **files/schema/contracts touched:** مذكرة جدوى P7.5 وروابطها في
  إجراء الحوكمة وخطة التنفيذ وهذا السجل؛ لا schema أو كود أو بيانات.
- **validation:** مراجعة مسارات runtime/stop وruntime.start وscope
  والتوقع والمقيم وcontinuation؛ فحص الوثائق و`git diff --check`.
- **authority/safety impact:** لم تُشغّل Mission أو reset أو تُجمع
  نتائج؛ `NO_QUALIFIED_SOURCE` للشرطين، شروط runtime السبعة
  `MISSING`، و`collectionAuthorized=false` و`fixed_safe_probe`
  بلا تغيير.
- **remaining/blocker:** تعريف وحدة استقلال قابلة للدفاع وإثبات
  إعادة ضبط متكررة ثابتة النطاق وتوزيع نتائج مستقل؛ لا جهة مراجعة
  أو مصدر مؤهل أو تفويض تشغيل.
- **next step:** مراجعة منهجية مستقلة لهذه المذكرة من المالك قبل
  اعتماد مصدر أو أي فحص تشغيلي؛ لا جمع في نطاق v1 الآن.

### 43.17 — مرشح وحدة محلية قابلة للدحض لـP7.5 (2026-09-30)

- **phase/step:** P7.5 — استكمال بوابة الجدوى التصميمية للنطاق المحلي.
- **status:** `done — candidate design؛ independence unproven`
- **what changed:** صيغ هدف محلي مقترح وفرصة تشغيل مختارة مسبقًا
  بدل عدّ Missions أو دورات stop/start كعينات تلقائيًا. حُددت
  أسباب تكذيب الاستقلال: اختيار لاحق، فشل ربط reset بالملاحظة
  والتسجيل، بقاء حالة مشتركة، تغير scope، وتسرب النتائج.
- **files/schema/contracts touched:** مذكرة جدوى P7.5 وخطة التنفيذ
  وسجل التقدم؛ لا schema أو كود أو مصدر أدلة جديد.
- **validation:** مراجعة حدود runtime الواحد لكل مشروع ومسار
  الإيقاف المحمي وبصمة النطاق ومقيس Mission-cluster؛
  `git diff --check`.
- **authority/safety impact:** لا قرار مالك باعتماد الوحدة، ولا
  تشغيل أو cohort أو جمع؛ `NO_QUALIFIED_SOURCE` للشرطين،
  شروط runtime السبعة `MISSING`، و`collectionAuthorized=false`
  و`fixed_safe_probe` بلا تغيير.
- **remaining/blocker:** لم يثبت وجود مصدر فرص غير مترابطة أو
  إعادة ضبط تزيل أثر الحالة المشتركة؛ يلزم مراجعة منهجية وسلطة
  المصدر والاحتفاظ قبل أي تفويض تشغيلي.
- **next step:** يراجع المالك والمراجع المنهجي المرشح وأسباب
  تكذيبه؛ إن عجزا عن إثبات الاستقلال، يبقى v1 `NO-GO`
  ولا تُصنع 30 Missions لتحسين العدد.

### 43.18 — جرد المصادر القائمة وتصحيح مرشح reset التشخيصي (2026-09-30)

- **phase/step:** P7.5 — جرد مصدر قائم للقراءة فقط، ثم تصحيح
  وصف الجرد التشخيصي دون اعتماد مصدر.
- **status:** `done — source near-miss documented؛ claims blocked`
- **what changed:** أُدرج إيصال Gate C لمسار `runtime/stop`
  كمرشح تقني حاضر، لا كدليل reset محكوم لـP7.5؛ وُضح أن بذرة
  bootstrap تخص إعادة سحب المقيم لا اختيار وحدات cohort. جرد
  held-out القائم لم يكشف عضوية مسبقة أو سجل استعمال/ضبط.
- **files/schema/contracts touched:** وصف المصدر وفحصه التشخيصي
  في trust boundary واختباره، وسجل قرار السلطة وهذا السجل؛
  لا schema أو writer أو verifier أو تغيير في إصدار البروتوكول.
- **validation:** اختبار trust boundary المحدد، بناء API،
  إعادة تشغيل workflow المعني وفحص سجله، و`git diff --check`.
- **authority/safety impact:** شروط runtime السبعة بقيت `MISSING`
  بلا evidence refs؛ لا مصدر مؤهل للادعاءين، ولا تفويض أو reset
  أو جمع؛ `collectionAuthorized=false` و`fixed_safe_probe`.
- **remaining/blocker:** إيصال الإيقاف لا يربط فرصة مستقلة
  مختارة مقدمًا بـMission التجربة، ولا يثبت إزالة الحالة المشتركة
  أو تاريخ عدم استعمال outcomes. قرار المالك والمراجعة المنهجية
  مطلوبان قبل أي اعتماد مصدر.
- **next step:** توقف عند مراجعة المصدر/الاستقلال البشرية؛
  لا تستنتج صلاحية cohort من جرد وصفي.

## قالب إلزامي لكل خطوة لاحقة

انسخ هذا القالب وأكمله بعد كل خطوة، قبل تنفيذ الخطوة التالية:

```md
### YYYY-MM-DD — [اسم الخطوة]

- **phase/step:** [P# / step]
- **status:** `done` | `partial` | `blocked` | `not_started`
- **what changed:** [وصف قابل للتحقق]
- **files/schema/contracts touched:** [المسارات أو الجداول]
- **validation:** [الأوامر والنتائج]
- **authority/safety impact:** [proof/acceptance/permissions/planner]
- **remaining/blocker:** [ما بقي أو `none`]
- **next step:** [الخطوة التالية المسموح بها]
```

لا تحذف الإدخالات التاريخية. إذا تغير الحكم، أضف إدخال تصحيحًا يوضح سبب
التغيير بدل تعديل السجل بصمت.
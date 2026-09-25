# سجل تقدم خطة تعميم الوكيل الهندسي

> هذا السجل جزء من `docs/agent-generalization-execution-plan.md`.
> يجب على الوكيل التالي تحديثه بعد كل خطوة مكتملة، وقبل الانتقال إلى الخطوة
> التالية. لا تعتبر المرحلة منجزة من دون إدخال يثبت معيار الخروج والتحقق.

## الحالة الحالية

**آخر تحديث:** 2026-09-25
**الوضع:** P0–P2 مكتملة؛ P3 مكتملة على مستوى foundation مع تكامل معرفي جزئي؛ P3.5/P4/P5 جزئية لكن لديها شرائح runtime حقيقية ومحدودة؛ P5.5 تشمل الآن دورة Action محدودة لاستدعاءات file mutation المعتمدة في `mission_repair`، لكنها لا تغطي بعد كل recipe node أو tool call. توجد primitives جزئية لـP7 وP8 وP9 وP10، لكنها لا تغلق التشخيص المعرفي أو belief أو السببية أو strategy portability. الأولوية الآن إغلاق الحلقة المعرفية قبل التوسع الأفقي في capabilities أو learning.
**المصدر الرئيسي:** `docs/agent-generalization-execution-plan.md`

| المرحلة | الحالة | النطاق المنجز أو المتبقي |
|---|---|---|
| P0 — Contracts, baseline, threat model | `done` | عقود agent-state واختبارات parsing/hash/redaction موجودة. |
| P1 — Durable execution | `done` | durable execution وleases وcheckpoints وownership fences هي substrate التنفيذ الحالية. |
| P2 — Evidence and acceptance | `done` | evidence contracts وvalidation وCanonical Proof وMission/Goal terminal gates موجودة؛ لا تمنح receipt/projection وحدها النجاح. |
| P3 — World State foundation | `foundation complete / cognitive integration partial` | عقود facts، materialization، supersession، contradictions، world revision وcurrent-fact projection موجودة مع task/environment scoping وAPI filters؛ Belief مؤجلة إلى P7.5 والملاحظات المستقلة من المصدر الفعلي ضمن P4. |
| P3.5 — Cognitive Action / Observation Spine | `partial` | Candidate Validation وRuntime start/restart/stop وBrowser/Delivery وAI apply-changes وMission `mission_repair` تستخدم Episode → Action → Before/After Observation → Effect → Acceptance. في `mission_repair` تسجل الكتابات المعتمدة أيضًا Action لكل tool call عند staging داخل candidate overlay؛ هذا ليس إثبات أثر مستقلًا. لا تتضمن acceptances World Delta ولا تحقق DoD الكامل لـP3.5–P6. Mission repair لا يروّج bytes إلى live root. تقارير Task و`mission_observe`/`mission_validate` تبقى خارج mutation-effect gate. تبقى دلالات Action الموحدة والتعافي الأوسع غير مكتملة؛ إغلاق World Delta المستقل في P6 ما زال مطلوبًا. |
| P4 — Independent Observation and World Integration | `partial` | task/environment scoping وAPI filters منجزة ضمن P3. توجد ملاحظات receipt-time وruntime launch، والآن رصد مباشر محدود لعملية validator عند توفر binding كامل إلى Episode؛ يثبت الرصد PID المباشر فقط ولا يغطي descendants أو listener. ما زال propagation للتناقضات وإغلاق مصادر الملاحظة الأوسع مطلوبًا؛ World Delta/revision closure يخص P6. |
| P5 — Authoritative Effect Verification | `partial` | Candidate Validation مغلق؛ Runtime start/restart/stop المباشر وBrowser/Delivery وapply-changes وMission `mission_repair` يستخدمون effect gate. تعافي restart لـapply-changes أصبح fail-closed ودائمًا: لا يطلق النجاح إلا بإثبات effect مقبول ومطابق، ولا يعيد تشغيل أو يتراجع عن بايتات filesystem. تبقى الحالات غير المثبتة للمعالجة اليدوية، كما تبقى مسارات lease/reconnect الأوسع؛ لا يكتمل DoD المرحلي قبل ربط هذه الآثار بـWorld Delta في P6. |
| P5.5 — Unified Action Semantics | `partial` | كل invocation يحتاج هوية وscope/revision ونتيجة/فشل ومراجع evidence ضمن عقد server-owned. تُسجل recipe القراءة `database.inspect.project` أحداث ظلّية `OBSERVATION_REQUESTED/RECORDED` best-effort؛ mutations وeffect-gated validation وكتابات `ACTION_REQUESTED` تتطلب `AgentAction` الكامل. تسجل `mission_repair` المعتمدة lifecycle لكل `write_file`/`replace_text` داخل candidate overlay؛ لا ينشئ ذلك per-tool EffectBundle. بقية recipe nodes وprovider tool calls لم تكتمل. |
| P6 — World Delta and Revision Closure | `not_started` | ربط effect bundle بـworld delta وrevision قابل لإعادة البناء. |
| P7 — World-State Failure Diagnosis | `partial` | توجد diagnostics حتمية من إشارات provider/validator/acceptance وbounded replan؛ تشخيص افتراضات الخطة والحقائق المتناقضة والملاحظة الفاصلة ما زال غير مكتمل. |
| P7.5 — Belief and Information Gain | `not_started` | gate معرفي: hypothesis sets صالحة وموزونة server-side، وcandidate مرتبط بقرار objective. forecasts غير المعايرة تبقى shadow؛ يبدأ الاختيار بـfixed-safe probes أو human approval، ثم expected decision value آلي داخل scope معاير، مع EIG لكسر التعادل فقط. |
| P8 — Diagnosis-aware Replanning | `partial` | bounded objective recovery وMission replan يستهلكان diagnosis summaries؛ فصل world-belief وforecast-calibration وcausal-attribution وتشخيص mismatch بعد فحص الرصد والتنفيذ والبيئة، مع pilot ضيق، ما زال غير منفذ. |
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
  validator child عند توفر Episode binding كامل. تبقى descendants وlistener خارج
  حد الإثبات الحالي.
- **World State:** task/environment scope وrevision وAPI filters read-only؛
  process observations مستقلة محدودة لعمليات runtime وvalidator؛ listener/
  propagation غير مكتملين، وWorld Delta/revision closure في P6.
- **Diagnosis وlearning:** bounded diagnosis/replan، effect-credit sidecar،
  strategy candidates وreplay محدود موجودة كـprimitives؛ لا تثبت cognition أو
  causality أو portability أو generalization.

## أولوية التنفيذ الحالية

لم تعد الأولوية بناء بنية تحتية إضافية؛ الأولوية الآن إغلاق الحلقة السببية
للإدراك والفعل والأثر والتشخيص والتعلم. أوقف التوسع الأفقي في capabilities
وstrategy learning إلى أن تُغلق الحلقة المعرفية. اتبع الاعتماديات في §31، مع
ترتيب العمل التالي:

1. استكمال توحيد `AgentAction` عبر recipe/tool/Mission/execution nodes (P5.5).
2. إغلاق independent observations من المصدر الفعلي قبل/بعد action (P4).
3. إكمال effect verification وربطه بتلك الملاحظات (P5).
4. بناء World Delta قابل لإعادة البناء (P6).
5. إكمال World-State diagnosis ثم Belief/Information Gain (P7 ثم P7.5).
6. إكمال hypothesis-aware replan وcausal-credit safety (P8 ثم P9).
7. بعد ذلك فقط استكمال portable strategy وheld-out/transfer learning.

لا تبدأ مرحلة جديدة أو توسع replay/promotion قبل إغلاق بوابات هذه الحلقة.

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
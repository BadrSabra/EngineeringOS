# سجل تقدم خطة تعميم الوكيل الهندسي

> هذا السجل جزء من `docs/agent-generalization-execution-plan.md`.
> يجب على الوكيل التالي تحديثه بعد كل خطوة مكتملة، وقبل الانتقال إلى الخطوة
> التالية. لا تعتبر المرحلة منجزة من دون إدخال يثبت معيار الخروج والتحقق.

## الحالة الحالية

**آخر تحديث:** 2026-09-24  
**الوضع:** Foundation مكتملة جزئيًا؛ Cognitive Spine وIndependent Effect Verification غير مكتملين، وكل ما بعدهما يبقى Shadow/read-only
**المصدر الرئيسي:** `docs/agent-generalization-execution-plan.md`

| المرحلة | الحالة | النطاق المنجز أو المتبقي |
|---|---|---|
| P0 — Contracts, baseline, threat model | `done` | عقود agent-state واختبارات parsing/hash/redaction موجودة. |
| P1 — Durable execution | `done` | durable execution وleases وcheckpoints وownership fences هي substrate التنفيذ الحالية. |
| P2 — Evidence and acceptance | `done` | evidence contracts وvalidation وCanonical Proof وMission/Goal terminal gates موجودة؛ لا تمنح receipt/projection وحدها النجاح. |
| P3 — World State foundation | `foundation complete / cognitive integration partial` | عقود facts، materialization، supersession، contradictions، world revision وcurrent-fact projection موجودة؛ لا تزال task/environment scoping وbelief وindependent observation ناقصة. |
| P3.5 — Cognitive Action / Observation Spine | `not_started` | يلزم ربط Objective → Episode → Action → Preconditions → Before Observation → Execution → After Observation → Effect → World Delta → Acceptance. |
| P4 — Authoritative Observation and World Integration | `partial` | يلزم independent observation providers، provenance، task-scoped/environment revisions، observation sequence وcontradiction propagation. |
| P5 — Authoritative Effect Verification | `not_started` | يلزم before/after observations وتصنيف أثر مستقل؛ لا يجوز اشتقاق Effect من acceptance وحدها. |
| P5.5 — Unified Action Semantics | `not_started` | توحيد recipe node وtool call وMission action وexecution node تحت AgentAction. |
| P6 — World Delta and Revision Closure | `not_started` | ربط effect bundle بـworld delta وrevision قابل لإعادة البناء. |
| P7 — World-State Failure Diagnosis | `not_started` | تشخيص الفرضية الفاشلة والـfacts المتأثرة والملاحظة الفاصلة، لا مجرد provider error code. |
| P7.5 — Belief and Information Gain | `not_started` | تمثيل uncertainty واختيار observation حسب information gain/cost/risk/authorization/time. |
| P8 — Diagnosis-aware Replanning | `not_started` | ربط World State وBelief وDiagnosis وcapabilities وexpected effects بخطة bounded جديدة. |
| P9 — Causal Credit Assignment | `not_started` | فصل causal effect عن enabling/observation/validation/incidental actions. |
| P10 — Portable Strategy Extraction | `not_started` | استخراج trigger/preconditions/state transition/effects/failure branches/observation requirements القابلة للنقل. |
| P10.5 — Agent Capability Self-Model | `not_started` | reliability وsupported environments وfailure modes وcost/risk/authorization وevidence quality. |
| P11 — Learning Validation and Transfer | `not_started` | replay وheld-out وcross-project وnovel composition وLearning Delta مع منع leakage. |
| P12 — Strategy Promotion and Revocation | `not_started` | canary/promotion/revocation آمنة دون حذف forensic history. |
| P13 — Capability composition | `not_started` | composition آمن عبر semantic contracts وsandbox وshadow replay. |
| P14 — Multimodal extension | `not_started` | مؤجل إلى ما بعد إغلاق effect/evidence/learning gates. |

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
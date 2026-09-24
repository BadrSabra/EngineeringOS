# سجل تقدم خطة تعميم الوكيل الهندسي

> هذا السجل جزء من `docs/agent-generalization-execution-plan.md`.
> يجب على الوكيل التالي تحديثه بعد كل خطوة مكتملة، وقبل الانتقال إلى الخطوة
> التالية. لا تعتبر المرحلة منجزة من دون إدخال يثبت معيار الخروج والتحقق.

## الحالة الحالية

**آخر تحديث:** 2026-09-24  
**الوضع:** Foundation مكتملة جزئيًا؛ Candidate Validation Effect Loop مغلقة، وGate C أصبح جزئيًا مع Runtime/Browser/Delivery after-state seams server-owned، بينما اختبارات recovery/e2e الشاملة ما زالت متبقية
**المصدر الرئيسي:** `docs/agent-generalization-execution-plan.md`

| المرحلة | الحالة | النطاق المنجز أو المتبقي |
|---|---|---|
| P0 — Contracts, baseline, threat model | `done` | عقود agent-state واختبارات parsing/hash/redaction موجودة. |
| P1 — Durable execution | `done` | durable execution وleases وcheckpoints وownership fences هي substrate التنفيذ الحالية. |
| P2 — Evidence and acceptance | `done` | evidence contracts وvalidation وCanonical Proof وMission/Goal terminal gates موجودة؛ لا تمنح receipt/projection وحدها النجاح. |
| P3 — World State foundation | `foundation complete / cognitive integration partial` | عقود facts، materialization، supersession، contradictions، world revision وcurrent-fact projection موجودة؛ لا تزال task/environment scoping وbelief وindependent observation ناقصة. |
| P3.5 — Cognitive Action / Observation Spine | `partial` | Candidate Validation وBrowser/Delivery recipe nodes تستخدم Episode → Action → Before/After Observation → Effect → Acceptance؛ Runtime يحتاج ربط recipe/action كامل. |
| P4 — Authoritative Observation and World Integration | `partial` | يلزم independent observation providers، provenance، task-scoped/environment revisions، observation sequence وcontradiction propagation. |
| P5 — Authoritative Effect Verification | `partial` | Candidate Validation مغلق؛ Runtime observer وBrowser/Delivery Gate C seams مضافة، وتبقى recovery/e2e coverage وربط Runtime بالـeffect loop. |
| P5.5 — Unified Action Semantics | `not_started` | توحيد recipe node وtool call وMission action وexecution node تحت AgentAction. |
| P6 — World Delta and Revision Closure | `not_started` | ربط effect bundle بـworld delta وrevision قابل لإعادة البناء. |
| P7 — World-State Failure Diagnosis | `not_started` | تشخيص الفرضية الفاشلة والـfacts المتأثرة والملاحظة الفاصلة، لا مجرد provider error code. |
| P7.5 — Belief and Information Gain | `not_started` | تمثيل uncertainty واختيار observation حسب information gain/cost/risk/authorization/time. |
| P8 — Diagnosis-aware Replanning | `not_started` | ربط World State وBelief وDiagnosis وcapabilities وexpected effects بخطة bounded جديدة. |
| P9 — Causal Credit Assignment | `not_started` | فصل causal effect عن enabling/observation/validation/incidental actions. |
| P10 — Portable Strategy Extraction | `partial` | استخراج مرشحات وصفية من حلقات مقبولة؛ ACTION_REQUESTED صار يحمل عقد trigger/preconditions server-owned بإصدار وبصمة. |
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
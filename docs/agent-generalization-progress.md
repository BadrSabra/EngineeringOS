# سجل تقدم خطة تعميم الوكيل الهندسي

> هذا السجل جزء من `docs/agent-generalization-execution-plan.md`.
> يجب على الوكيل التالي تحديثه بعد كل خطوة مكتملة، وقبل الانتقال إلى الخطوة
> التالية. لا تعتبر المرحلة منجزة من دون إدخال يثبت معيار الخروج والتحقق.

## الحالة الحالية

**آخر تحديث:** 2026-09-24  
**الوضع:** Shadow/read-only في طبقات Episode وObservation وWorld State  
**المصدر الرئيسي:** `docs/agent-generalization-execution-plan.md`

| المرحلة | الحالة | النطاق المنجز أو المتبقي |
|---|---|---|
| P0 — Contracts, baseline, threat model | `done` | عقود agent-state واختبارات parsing/hash/redaction موجودة. |
| P1 — Episode schema + ledger | `done` | جداول Episode/Observation/Effect/World/Strategy والـledger واختبارات ownership/idempotency/replay موجودة. |
| P2 — Episode integration in Chat/Mission | `done` | Chat وTask/Recipe وMission/Workflow تستخدم Episode ledger؛ الهوية والـscope والـplan revision مغطاة باختبارات lifecycle. |
| P3 — Observation materialization | `done` | مصادر server-owned مع completeness/freshness/revision وربط بالـepisode. |
| P4 — World facts + materialized reader | `partial` | read model، contradictions، supersession، world revision، endpoint محمي وContext projection منجزة؛ تغطية effect/browser/Git الكاملة ليست منجزة بعد. |
| P5 — Effect contract for candidate validation | `not_started` | يلزم before/after effect bundle وربطه بالـacceptance في نفس المعاملة. |
| P6 — Runtime/browser/delivery observers | `not_started` | يلزم توحيد observers والتحقق من الأثر بعد التنفيذ. |
| P7 — Failure diagnosis | `not_started` | تصنيف server-owned للفشل وربطه بالـnext action. |
| P8 — Bounded hypothesis-aware replan | `not_started` | ربط diagnosis بـobjective/Mission replanning مع no-progress guard. |
| P9 — Strategy candidate extraction | `not_started` | استخراج strategy من episodes المقبولة دون منحها صلاحية. |
| P10 — Replay and generalization benchmark | `not_started` | current/held-out/cross-project evaluation وlearning delta. |
| P11 — Strategy canary/promotion/revocation | `not_started` | promotion مضبوط وrollback/revocation. |
| P12 — Capability composition | `not_started` | composition آمن عبر contracts وsandbox وshadow replay. |
| P13 — Multimodal extension | `not_started` | مؤجل إلى ما بعد effect/evidence loop. |

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
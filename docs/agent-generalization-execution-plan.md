# مواصفة البناء الكاملة وعقد القبول — تطور الوكيل الهندسي نحو التعميم والتعلم

> **الحالة:** Complete Build Specification + Acceptance Contract  
> **نطاق الخطة:** الوكيل داخل بيئات البرمجيات والأنظمة الرقمية  
> **تاريخ إعداد الخطة:** 2026-09-24  
> **مرجع التشخيص:** `docs/ai-layer-deep-analysis.md` والتحليل المعمق لطبقات التنفيذ والذاكرة والتعميم  

تستخدم هذه الوثيقة الكلمات **MUST / يجب** و **MUST NOT / يجب ألا** و
**SHOULD / ينبغي** و **MAY / يجوز** بصيغة إلزامية. أي تنفيذ لا يحقق
متطلبات `MUST` لا يدخل وضع Enforced ولا يمر من عقد القبول، حتى لو كانت
النتيجة الوظيفية تبدو صحيحة.

---

## 1. القرار المعماري

المشروع الحالي منصة قوية لتنفيذ مهام هندسية محكومة، مع:

- تنفيذ durable قائم على `ai_executions` وleases وcheckpoints.
- تخطيط ومهام طويلة عبر Mission/Goal.
- أدوات وcapabilities مسجلة server-side.
- evidence وobjective contracts وCanonical Proof.
- validation وdelivery وshadow replay وpromotion gates.
- recovery وcancellation وownership fences.

لكن هذه القدرات لا تشكل بعد World Model أو learning loop عاماً. الهدف من هذه الخطة هو إضافة:

```text
Agent Episode
    → Observation
    → World State
    → Action Effect
    → Acceptance
    → Diagnosis
    → Replan
    → Offline Learning
    → Controlled Promotion
```

لا تهدف الخطة إلى إعادة كتابة `MissionRuntime` أو `Proof Spine` أو إنشاء orchestrator موازٍ. التنفيذ يجب أن يبني فوق الحدود الحالية، ويبقي السلطة في الخادم.

---

## 2. النطاق وما هو خارج النطاق

### 2.1 داخل النطاق

يبدأ التعميم داخل هذه البيئات:

- repository وworkspace.
- source code وtests.
- local runtime.
- Git وcandidate trees.
- browser verification.
- database reads.
- delivery workflows.
- integrations ذات العقود server-owned.

### 2.2 خارج النطاق في هذه الدورة

لا تشمل الخطة الأولى:

- agent جسدي أو physical-world control.
- unrestricted web agent.
- تحميل arbitrary plugins أو تنفيذ كود مولد في الإنتاج.
- autonomous production mutation بلا approval.
- تحديث أوزان النماذج أثناء الطلب.
- اعتبار provider prose مصدراً للحقيقة.
- استبدال PostgreSQL أو Drizzle أو البنية الحالية.

---

## 3. مبادئ غير قابلة للكسر

### 3.1 Proof يبقى مصدر القبول

لا يجوز لـWorld State أو strategy memory تعيين:

```text
PROVEN
SUCCEEDED
PROMOTED
```

القبول النهائي يبقى في:

```text
artifacts/api-server/src/lib/ai-execution-acceptance.ts
artifacts/api-server/src/lib/proof-foundation.ts
artifacts/api-server/src/lib/proof-spine.ts
```

### 3.2 النموذج لا يمنح نفسه صلاحية

النموذج يستطيع اقتراح:

- intent.
- plan.
- capability ID.
- strategy.
- next observation.

لكنه لا يستطيع تحديد:

- project root.
- arbitrary path.
- shell أو argv.
- write approval.
- validation profile غير مسجل.
- evidence verdict.
- promotion أو delivery authorization.

### 3.3 Context ليس World Model

يبقى `context-builder.ts` مسؤولاً عن:

```text
load → serialize → slices → admission → cache
```

ولا يصبح مخزناً للحالة أو belief engine. يقرأ Context Builder لاحقاً World State projection محدوداً مثل أي slice أخرى.

### 3.4 Execution state ليس Learning state

checkpoint وreceipt يحفظان استمرارية التنفيذ وإثباته. لا يتم تفسيرهما تلقائياً كدرس قابل للتعميم.

### 3.5 التعلم يبدأ offline

أي strategy أو routing policy جديدة تمر عبر:

```text
extract → replay → held-out evaluation → canary → promotion
```

ولا تغير التنفيذ الحي مباشرة بسبب trajectory واحدة.

### 3.6 لا يوجد نجاح بلا أثر أو سبب واضح

إذا نفذ action بنجاح تقني، لكن لم يظهر الأثر المتوقع، تكون النتيجة:

```text
INCOMPLETE
EVIDENCE_INSUFFICIENT
REPLAN_REQUIRED
```

ولا تتحول إلى `PROVEN`.

---

## 4. خريطة التكامل مع البنية الحالية

### 4.1 `lib/ai-orchestrator`

مسؤولة عن العقود والمنطق النقي:

```text
lib/ai-orchestrator/src/
├── active-evidence-contract.ts
├── evidence-integrity.ts
├── execution-ledger.ts
├── task-contracts.ts
├── task-session-state.ts
├── task-planner.ts
├── objective-replanning.ts
├── capability-contract.ts
├── recipe-contract.ts
├── recipe-compiler.ts
├── session-memory.ts
├── context-builder.ts
└── agent-state/                 ← إضافة جديدة
    ├── episode-contract.ts
    ├── observation-contract.ts
    ├── effect-contract.ts
    ├── failure-contract.ts
    └── strategy-contract.ts
```

هذه الطبقة لا تستورد API server ولا تنفذ transactions.

### 4.2 `artifacts/api-server/src/lib`

مسؤولة عن التنفيذ والملكية والكتابة:

```text
artifacts/api-server/src/lib/
├── task-execution-service.ts
├── mission-runtime.ts
├── mission-auto-replan.ts
├── ai-execution-acceptance.ts
├── ai-execution-state.ts
├── operation-evidence.ts
├── proof-foundation.ts
├── proof-spine.ts
├── runtime-observations.ts
├── recipe-operation-runner.ts
├── skill-candidate.ts
├── skill-registry.ts
└── agent-state/                 ← إضافة جديدة
    ├── agent-episode-ledger.ts
    ├── observation-materializer.ts
    ├── world-state-materializer.ts
    ├── world-state-reader.ts
    ├── effect-observer.ts
    ├── failure-diagnosis.ts
    └── learning/
        ├── trajectory-extractor.ts
        ├── strategy-evaluator.ts
        └── learning-worker.ts
```

### 4.3 `lib/db`

تبقى الجداول الحالية مصادرها الأصلية:

```text
ai_executions
ai_execution_acceptances
ai_missions
ai_shadow_replays
ai_skill_registry
ai_chats
graph
workspace_runtime
events
task_logs
audit_logs
```

تضاف جداول جديدة فقط عندما لا تكفي projections الحالية للاستعلام الدائم:

```text
ai_agent_episodes
ai_agent_observations
ai_world_facts
ai_strategy_candidates
```

لا يتم تخزين bodies ضخمة أو provider raw responses في هذه الجداول.

---

## 5. العقد المستهدفة

### 5.1 Agent Episode

يوحد دورة التنفيذ عبر Chat وMission وWorkflow وDelivery:

```ts
type AgentEpisode = {
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;

  missionId?: string;
  goalId?: string;
  parentEpisodeId?: string;

  projectRevision: string;
  worldRevision?: string;
  beliefRevision?: string;
  planRevision?: string;

  intentKind: string;
  scope: unknown;
  objectiveContractId?: string;

  observationRefs: string[];
  actionRefs: string[];
  expectedEffectRefs: string[];
  observedEffectRefs: string[];
  evidenceRefs: string[];

  verdict:
    | "ACHIEVED"
    | "BLOCKED"
    | "REPLAN_REQUIRED"
    | "WORLD_CHANGED"
    | "EVIDENCE_INSUFFICIENT"
    | "NEEDS_APPROVAL"
    | "UNSAFE"
    | "FAILED"
    | "CANCELLED";

  nextActionCode?: string;
};
```

القواعد:

- كل attempt يملك identity واضحة.
- episode لا يمنح acceptance.
- الأحداث append-only قدر الإمكان.
- أي كتابة تحتاج ownership fence.
- لا يتم تعديل objective أو scope عبر checkpoint.
- كل retry له idempotency key.

### 5.2 Observation

تمثل ما لوحظ من مصدر server-owned:

```ts
type AgentObservation = {
  observationId: string;
  projectId: string;
  executionId: string;
  episodeId: string;

  kind:
    | "SOURCE"
    | "TEST"
    | "RUNTIME"
    | "DATABASE"
    | "GIT"
    | "BROWSER"
    | "DELIVERY"
    | "EXTERNAL";

  subject: string;
  predicate: string;
  value: unknown;

  sourceRefs: string[];
  observedAt: string;
  projectRevision?: string;
  environmentRevision?: string;

  completeness: "COMPLETE" | "PARTIAL" | "FAILED";
  freshness: "FRESH" | "STALE" | "UNKNOWN";
};
```

لا تتحول هذه المصادر إلى observations موثوقة:

- provider prose.
- model confidence.
- cached context فقط.
- memory بلا source revision.
- claim غير مقبول.

### 5.3 World Fact

يفصل بين observation history والحالة الحالية:

```ts
type WorldFact = {
  factId: string;
  projectId: string;

  subject: string;
  predicate: string;
  object: unknown;

  scopeKind: "PROJECT" | "WORKSPACE" | "RUNTIME" | "DELIVERY";
  scopeId: string;

  status:
    | "BELIEVED"
    | "CONFIRMED"
    | "CONTRADICTED"
    | "RETRACTED";

  confidence: number;
  sourceObservationIds: string[];
  projectRevision?: string;
  environmentRevision?: string;

  observedAt: string;
  validFrom?: string;
  validUntil?: string;
  supersedesFactIds: string[];
  contradictsFactIds: string[];
};
```

لا تستبدل facts القديمة بصمت. يجب حفظ supersession والتناقض.

### 5.4 Effect Contract

كل mutation أو external effect يصف ما يجب ملاحظته:

```ts
type EffectContract = {
  effectId: string;
  expectedStateChanges: Array<{
    subject: string;
    predicate: string;
    expectedValue?: unknown;
  }>;

  observationProfile:
    | "WORKSPACE"
    | "TEST"
    | "RUNTIME"
    | "GIT"
    | "DATABASE"
    | "BROWSER"
    | "DELIVERY";

  requiredEvidence: string[];
  allowedResult:
    | "OBSERVED"
    | "PARTIAL"
    | "NOT_OBSERVED"
    | "CONTRADICTED";
};
```

### 5.5 Failure Diagnosis

لا يرسل planner رسالة خطأ خاماً فقط:

```ts
type FailureDiagnosis = {
  kind:
    | "NO_PROGRESS"
    | "MISSING_REQUIRED_READ"
    | "STALE_PROJECT_REVISION"
    | "STALE_RUNTIME"
    | "PRECONDITION_FAILED"
    | "VALIDATOR_FAILED"
    | "EXPECTED_EFFECT_MISSING"
    | "CONTRADICTORY_STATE"
    | "EXTERNAL_DRIFT"
    | "AUTHORIZATION_REQUIRED"
    | "EVIDENCE_INCOMPLETE"
    | "TOOL_UNAVAILABLE";

  failedAssumptions: string[];
  affectedFacts: string[];
  affectedClaims: string[];
  requiredObservations: string[];
  retryable: boolean;
  requiresApproval: boolean;
};
```

### 5.6 Strategy Candidate

لا تخلط هذا مع capability executable:

```ts
type StrategyCandidate = {
  candidateId: string;
  triggerConditions: unknown[];
  preconditions: unknown[];
  recommendedActionOrder: string[];
  expectedEffects: string[];

  supportingEpisodeIds: string[];
  contradictingEpisodeIds: string[];
  applicableScopes: string[];

  confidence: number;
  evaluationStatus:
    | "DISCOVERED"
    | "PENDING_REPLAY"
    | "REPLAY_PASSED"
    | "REPLAY_FAILED"
    | "CANARY"
    | "PROMOTED"
    | "REVOKED"
    | "SUPERSEDED";
};
```

---

## 6. مراحل التنفيذ

## المرحلة 0: تثبيت خط الأساس والعقود

### الهدف

فصل safety/correctness عن generalization قبل أي تعديل.

### الأعمال

1. حفظ baseline الحالي:
   - proof binding.
   - false-success.
   - cancellation.
   - ownership.
   - recovery.
   - evidence completeness.
2. تعريف terminal outcomes المشتركة.
3. تسجيل agent types والمسار الذي يستخدمه كل نوع.
4. تحديد ما يعتبر `effect` لكل vertical slice.
5. توثيق عدم تغيير `Proof`, `Mission`, و`Capability` authority.

### معيار الخروج

- baseline قابل لإعادة التشغيل.
- العقود العامة versioned.
- كل مسار يملك تعريف success/failure.
- لا runtime behavior جديد.

---

## المرحلة 1: Agent Episode Ledger

### الملفات

```text
lib/ai-orchestrator/src/agent-state/*
artifacts/api-server/src/lib/agent-state/agent-episode-ledger.ts
```

### الأعمال

1. إضافة schemas والعقود.
2. بدء episode قبل provider/tool work عندما تكون الهوية durable.
3. ربط episode بـ:
   - `executionId`.
   - `attempt`.
   - `projectId`.
   - `projectRevision`.
   - mission/goal عند وجودهما.
4. تسجيل action/evidence/acceptance references.
5. إغلاق episode بناءً على acceptance projection، لا provider response.
6. الحفاظ على idempotency عند reconnect أو retry.

### نقاط الدمج

```text
chat-agent / tool-execution-engine
task-execution-service
mission-runtime
recipe-operation-runner
ai-execution-acceptance
operation-evidence
```

### معيار الخروج

يمكن إعادة بناء trajectory مختصرة لأي تنفيذ Chat أو Mission أو Delivery من references موثوقة.

---

## المرحلة 2: Observation Materialization

### الهدف

تحويل النتائج server-owned إلى observations موحدة.

### المصادر الأولى

- `evidence-integrity.ts`.
- `runtime-observations.ts`.
- validator receipts.
- `ai-execution-acceptance.ts`.
- `proof-spine.ts`.
- Git delivery receipts.
- browser validation.
- source/project manifests.

### الأعمال

1. إضافة `observation-materializer.ts`.
2. فرض source reference وrevision لكل observation.
3. ربط observation بالـepisode.
4. منع provider prose من materialization.
5. تسجيل `COMPLETE/PARTIAL/FAILED`.
6. تسجيل `FRESH/STALE/UNKNOWN`.

### معيار الخروج

كل نتيجة موثوقة يمكن ربطها بالـepisode وبالمصدر والـrevision، دون اعتبار كل log حقيقة حالية.

---

## المرحلة 3: World State للـEngineering Domain

### الهدف

بناء state موحدة ومحدودة للمشروع والruntime والdelivery.

### نطاق facts الأولي

1. revision الحالية.
2. candidate identity.
3. runtime serving revision.
4. test/validation status.
5. Git tree/remote state.
6. browser verification state.
7. delivery receipt state.

### الأعمال

1. إضافة `ai_world_observations` إذا لم تكف event rows.
2. إضافة `ai_world_facts` للحالة materialized.
3. بناء `world-state-materializer.ts`.
4. بناء `world-state-reader.ts`.
5. إضافة world revision.
6. حفظ supersession والتناقض.
7. توفير projection محدود لـ`context-builder`.

### دمج graph

لا يعاد بناء `lib/db/src/schema/graph.ts`. يستخدم graph كمصدر static knowledge، بينما World State يحمل:

```text
revision + runtime + freshness + contradictions + current effects
```

### معيار الخروج

يستطيع الخادم تحديد ما إذا كانت الخطة الحالية مبنية على world state ما زالت صالحة.

---

## المرحلة 4: Effect Observation

### الهدف

إغلاق الفجوة بين تنفيذ action وملاحظة أثره.

### lifecycle الجديد

```text
validate preconditions
→ capture before observation
→ execute action
→ capture raw result
→ capture after observation
→ classify effect
→ attach evidence
→ materialize world state
→ continue / replan / terminal
```

### ترتيب التنفيذ

#### 4.1 Candidate validation

ابدأ بـ:

```text
workspace revision
→ validation profile
→ resulting revision/runtime
→ objective acceptance
```

#### 4.2 Runtime

وسّع `runtime-observations.ts` ليقيس:

- process identity.
- port readiness.
- serving revision.
- health response.
- expected runtime marker.

وجود process لا يساوي تحقق الهدف.

#### 4.3 Browser

أضف after-state إلى:

```text
browser-preview-verification.ts
```

ويرتبط بـsource revision وbrowser profile.

#### 4.4 Delivery

استخدم:

```text
github-delivery-service.ts
github-connector.ts
proof-spine.ts
```

للتحقق من remote parent/tree/marker قبل اعتبار delivery مكتملة.

### قرارات effect

```text
OBSERVED
→ يمكن متابعة acceptance

PARTIAL
→ INCOMPLETE أو read/replan

NOT_OBSERVED
→ لا PROVEN

CONTRADICTED
→ WORLD_CHANGED أو REPLAN_REQUIRED

UNKNOWN
→ acceptance غير مكتملة
```

### معيار الخروج

لا يمكن لأي mutation مدعومة أن تنتهي بنجاح مثبت دون effect evidence مناسبة.

---

## المرحلة 5: Failure Diagnosis وReplan

### الهدف

جعل الفشل يغير الاستراتيجية حسب سببه.

### الأعمال

1. إضافة server-owned diagnosis.
2. ربط validator/effect/evidence failures بالتصنيف.
3. تمرير diagnosis إلى `objective-replanning.ts`.
4. تمرير failure context إلى `mission-auto-replan.ts`.
5. منع إعادة الخطة ذاتها إذا لم تتغير assumption أو observation.
6. الحفاظ على حدود replans الحالية.

### قواعد أساسية

| نوع الفشل | التصرف |
|---|---|
| stale revision | إبطال الخطة وإعادة الإدراك |
| stale runtime | فحص serving revision قبل أي mutation |
| missing evidence | قراءة مطلوبة، بلا mutation |
| missing effect | فحص preconditions أو strategy بديلة |
| contradiction | observation تمييزية أو block |
| tool unavailable | capability gap، لا fake success |
| authorization required | approval path، لا retry تلقائي |

### معيار الخروج

نوع الفشل يحدد next action، ولا تعود كل الأخطاء إلى retry أو generic provider failure.

---

## المرحلة 6: Strategy Memory

### الهدف

تخزين الاستراتيجيات القابلة لإعادة الاختبار، دون تحويلها إلى صلاحيات.

### إضافة قاعدة البيانات

```text
ai_strategy_candidates
```

تحتوي على:

- trigger/preconditions.
- action ordering.
- expected effects.
- supporting episodes.
- contradictory episodes.
- applicability scope.
- evaluation status.
- confidence.

### لا تستخدم `ai_skill_registry`

`ai_skill_registry` يبقى للـcapability التي:

- تملك contract تنفيذياً.
- اجتازت proof/shadow replay.
- يسمح بها promotion policy.

أما strategy candidate فهي recommendation قابلة للاختبار.

### دمج `session-memory.ts`

تبقى session memory:

- historical.
- untrusted.
- لا تثبت current state.
- لا تمنح approval.

يمكن للـplanner استعمال strategy candidate كـhypothesis بعد فحص شروط انطباقها.

### معيار الخروج

يمكن استخراج strategy من episode مقبول، لكن لا تصبح active قبل replay.

---

## المرحلة 7: Offline Learning وReplay

### الهدف

إثبات أن النظام تحسن، لا أنه زاد عدد السجلات.

### المسار

```text
accepted episode
→ trajectory extraction
→ strategy candidate
→ replay current corpus
→ replay held-out corpus
→ cross-project evaluation
→ canary
→ promotion/rejection
```

### ما يتعلم أولاً

بالترتيب:

1. evidence scheduling.
2. observation selection.
3. tool ordering.
4. replan decision.
5. provider routing.
6. strategy selection.
7. capability composition.

لا يتم تحديث model weights في هذه المرحلة.

### شروط promotion

يجب أن:

- لا تزيد false-success.
- لا تتجاوز scope أو authorization.
- لا تخفض evidence completeness.
- تحسن held-out success أو تقلل cost/retry.
- تمر على replay وregression.
- تملك rollback.

### الاستفادة من الموجود

استخدم:

- benchmark campaign.
- paired baseline.
- shadow replay.
- skill candidate gates.
- proof binding.

ولا تنشئ promotion mechanism ثانية.

---

## المرحلة 8: Capability Composition

### الهدف

حل مهام جديدة بتركيب capabilities معروفة، قبل السماح باكتساب capabilities جديدة.

### primitives الأولية

```text
READ_PROJECT_FILE
VALIDATE_CANDIDATE
RUN_BROWSER_PROFILE
OBSERVE_RUNTIME
READ_DATABASE_RESOURCE
PUSH_VERIFIED_COMMIT
```

### الأعمال

1. توسيع `recipe-contract.ts` بعقود preconditions/effects.
2. توسيع `recipe-compiler.ts` للتحقق من composition.
3. منع composition غير المتوافقة مع scope/risk.
4. تشغيل compositions الجديدة في shadow mode.
5. ربطها بـ`recipe-operation-runner.ts`.
6. تمريرها عبر acceptance وproof المعتادين.

### Capability جديدة

إذا احتاج النظام adapter جديداً:

```text
proposal
→ isolated workspace
→ static checks
→ contract tests
→ shadow replay
→ canonical proof
→ approval
→ registry promotion
```

لا يسمح بتحميل arbitrary process أو code إلى الإنتاج.

---

## المرحلة 9: Multimodal End-to-End

هذه مرحلة لاحقة بعد تثبيت effect/evidence loop.

### الأعمال

1. typed content parts للنص والصورة والصوت والفيديو والوثائق.
2. provider capability validation على مستوى transport الفعلي.
3. حفظ media provenance.
4. ربط claims بالمصدر المرئي/السمعي.
5. multimodal evidence وvalidation.
6. benchmark منفصل.

لا يكفي أن يعلن provider أنه يدعم vision؛ يجب أن يمر payload فعلياً ويُنتج claim يمكن التحقق منه.

---

## 7. Vertical Slices

لا يتم ربط كل المسارات مرة واحدة.

### Slice A: Chat Read-Only

```text
PROJECT_QUERY
→ source reads
→ claims
→ accepted evidence
→ episode
→ observation
→ world projection
```

الملفات:

```text
chat-agent.ts
evidence-integrity.ts
active-evidence-contract.ts
task-session-state.ts
```

لا توجد mutations في هذه الشريحة.

### Slice B: Mission Validation

```text
Mission Goal
→ task execution
→ validator
→ expected effect
→ observed effect
→ acceptance
```

الملفات:

```text
task-execution-service.ts
mission-runtime.ts
task-objective-contract.ts
task-objective-receipts.ts
ai-execution-acceptance.ts
```

### Slice C: Runtime/Browser

```text
candidate
→ runtime/browser action
→ after-state
→ effect classification
→ replan عند الحاجة
```

الملفات:

```text
runtime-observations.ts
workspace-runtime.ts
browser-preview-verification.ts
recipe-operation-runner.ts
```

### Slice D: Delivery

```text
verified candidate
→ external delivery
→ remote observation
→ drift reconciliation
→ delivery proof
```

الملفات:

```text
github-delivery-service.ts
github-connector.ts
proof-spine.ts
shadow-replay.ts
```

يأتي Delivery أخيراً لأنه أعلى مخاطرة وأكثر ارتباطاً بالـproof والـremote state.

---

## 8. أوضاع الإطلاق

تستخدم المراحل feature gates server-owned:

```text
agentEpisodesMode:
  off | shadow | enforced

effectObservationMode:
  off | shadow | advisory | enforced

worldStateMode:
  off | advisory | enforced

strategyLearningMode:
  off | extract_only | replay | canary

capabilityCompositionMode:
  off | planning_only | sandbox_only | approved
```

### Shadow

يسجل النظام episodes وobservations وeffects، لكنه لا يغير قرار acceptance.

### Advisory

يعرض:

- world drift.
- missing effect.
- contradiction.
- strategy candidate.

ولا يمنع التنفيذ إلا ضمن ضوابط موجودة مسبقاً.

### Enforced

يمنع:

- PROVEN بلا effect evidence.
- mutation على revision قديمة.
- قبول contradiction غير محلولة.
- promotion بلا replay.

---

## 9. قاعدة البيانات والـretention

### Observation History

append-only قدر الإمكان، مع retention وcompaction لاحقاً.

### World Facts

قابلة لإعادة البناء من observation history.

### Episodes

تحفظ metadata والروابط، لا raw prompts أو logs كاملة.

### Strategy Candidates

تحفظ فقط البيانات اللازمة للتقييم وإعادة الاختبار.

### Idempotency

يستخدم materializer مفتاحاً مثل:

```text
sourceType + sourceId + sourceVersion
```

حتى لا تنتج retries:

- observations مكررة.
- facts مكررة.
- strategies مكررة.
- learning events مكررة.

### External consistency

لا نفترض أن action وexternal observation transaction واحدة. تستخدم الحالات:

```text
ACTION_COMMITTED
EFFECT_PENDING
EFFECT_OBSERVED
EFFECT_CONTRADICTED
EFFECT_UNKNOWN
```

---

## 10. الاختبارات المطلوبة

### 10.1 Contract tests

داخل:

```text
lib/ai-orchestrator/src/__tests__/
```

تشمل:

- episode parsing.
- observation provenance.
- effect classification.
- failure diagnosis.
- strategy applicability.
- version compatibility.

### 10.2 Ownership tests

داخل API server:

- stale worker لا يكتب episode.
- duplicate retry idempotent.
- cancelled execution لا يغلق بنجاح.
- acceptance identity لا يمكن استبدالها.
- cross-project references مرفوضة.

### 10.3 World drift tests

```text
plan on revision A
→ world moves to revision B
→ current plan invalid
→ re-observe
→ no stale mutation
```

### 10.4 Effect tests

```text
action succeeds
→ effect observed
→ accepted
```

```text
action succeeds
→ effect missing
→ incomplete
→ not PROVEN
```

```text
action succeeds
→ contradictory effect
→ replan or blocked
```

### 10.5 Learning tests

```text
episode family before strategy
→ strategy extraction
→ replay
→ held-out evaluation
→ measurable improvement
```

يجب رفض candidate إذا زاد:

- false-success.
- scope escape.
- cost بلا فائدة.
- retry loop.

---

## 11. التقييم المنفصل

### Safety/Contract Score

يبقى مسؤولاً عن:

- proof.
- ownership.
- cancellation.
- evidence.
- recovery.
- terminality.
- delivery integrity.

### Generalization Score

يضاف تحت:

```text
lib/ai-orchestrator/src/benchmark/
```

ويشمل:

1. novel composition.
2. world drift.
3. contradiction.
4. cross-project transfer.
5. learning delta.
6. calibration.
7. cost/latency.
8. capability acquisition.

### سياسة gate

في البداية:

```text
Generalization Gate = informational
```

ثم يصبح blocking عند ترقية:

- strategy.
- provider routing policy.
- skill.
- capability composition.

لا يستخدم benchmark baseline وحده دليلاً على general intelligence.

---

## 12. تحديث Dashboard

لا تنشئ Dashboard مصدراً جديداً للحالة. استخدم projections الحالية:

```text
ai-execution-projection.ts
mission-acceptance-projection.ts
operation-evidence.ts
```

أضف عند الحاجة:

```text
episodeId
worldRevision
effectStatus
beliefConflicts
replanReason
learningStatus
```

يجب أن تعرض الواجهة:

1. ما action الذي تم طلبه؟
2. ما الأثر المتوقع؟
3. ما الأثر الذي لوحظ؟
4. ما evidence المرتبطة؟
5. هل تغيرت revision؟
6. لماذا حدث replan؟
7. هل النتيجة accepted أم مجرد provider success؟

لا تعرض strategy غير promoted كأنها policy فعالة.

---

## 13. ترتيب Pull Requests أو وحدات الدمج

### PR 1: العقود فقط

- `agent-state` schemas.
- exports.
- unit tests.
- لا runtime behavior.

### PR 2: Episode Shadow Ledger

- إنشاء وربط episodes.
- references فقط.
- لا تغيير acceptance.

### PR 3: Observation Materializer

- source/runtime/validator/delivery observations.
- provenance والـrevision.

### PR 4: World State Read Model

- facts وworld revision.
- read-only projection.
- لا replan تلقائي.

### PR 5: Effect Observation لشريحة Candidate Validation

- before/after workspace.
- validation result.
- runtime revision عند الحاجة.
- acceptance integration.

### PR 6: Failure Diagnosis

- server-owned failure kinds.
- reason/next action codes.
- tests للتصنيف.

### PR 7: Bounded Replan

- ربط diagnosis بـ`objective-replanning`.
- ربطه بـ`mission-auto-replan`.
- الحفاظ على حدود retry.

### PR 8: Strategy Candidates

- extraction من accepted episodes.
- storage.
- لا promotion.

### PR 9: Replay وGeneralization Benchmark

- current corpus.
- held-out corpus.
- cross-project fixtures.
- learning delta.

### PR 10: Capability Composition

- تركيب primitives.
- sandbox.
- shadow replay.
- promotion path الحالي.

---

## 14. معايير الخروج لكل مرحلة

### بعد Episode Ledger

يمكن استخراج trajectory موحدة لأي Chat أو Mission أو Delivery.

### بعد Observation Layer

كل observation موثقة بمصدر وrevision وepisode.

### بعد World State

يمكن اكتشاف stale state والتناقض وworld drift server-side.

### بعد Effect Observation

لا يوجد success مثبت بلا ملاحظة أثر مناسبة في المسارات المدعومة.

### بعد Failure Diagnosis

نوع الفشل يحدد next action مختلفاً، ولا تعود كل الحالات إلى retry عام.

### بعد Strategy Memory

يمكن استخراج strategy مرشحة من episode موثقة، دون منحها صلاحية.

### بعد Learning

تحقق held-out improvement قابل للقياس، مع rollback.

### بعد Capability Composition

يمكن حل task جديدة بتركيب capabilities مسجلة دون arbitrary execution.

---

## 15. المخاطر وطرق الحد منها

| الخطر | المعالجة |
|---|---|
| تكرار الحالة بين execution وepisode وworld | episode يحتفظ بالروابط، وWorld State materialized من observations |
| تضخم event volume | bounded metadata وretention وcompaction |
| false causal attribution | لا يتعلم إلا من accepted effect evidence |
| facts قديمة | revision/freshness/validity intervals |
| contradiction غير محسومة | status صريح وreplan قبل PROVEN |
| learning يغير safety | التعلم لا يملك authority على permissions أو acceptance |
| strategy خاصة بمشروع واحد | scope وcross-project replay |
| replan loop | budgets وعدد replans وno-progress guard |
| external action بلا transaction | `EFFECT_PENDING` و`EFFECT_UNKNOWN` |
| كسر recovery القديم | backward-compatible optional fields وfixtures legacy |
| تكرار skill registry | strategy candidates منفصلة عن executable skills |
| provider success مضلل | لا observation من provider prose |

---

## 16. Definition of Done النهائي

لا تعتبر الخطة مكتملة عند إضافة schemas أو جداول فقط. يجب أن يعمل هذا المسار:

```text
مهمة جديدة
→ objective contract
→ episode creation
→ current-world observation
→ strategy selection
→ precondition validation
→ server-owned action
→ before/after observation
→ effect classification
→ world-state update
→ acceptance
→ terminal verdict
→ trajectory extraction
→ strategy candidate
→ replay
→ held-out evaluation
→ controlled promotion
```

ويجب أن تنجح الحالات السلبية التالية:

```text
revision changed
→ plan invalidated

effect missing
→ no PROVEN

contradiction found
→ replan أو blocked

worker stale
→ write rejected

strategy regression
→ candidate rejected

provider claims success without evidence
→ incomplete result
```

التحول الحقيقي لا يثبت إلا عندما تتحقق السلسلة:

```text
نتيجة تجربة
→ درس مستخرج
→ strategy مستخدمة لاحقاً
→ تحسن على مهمة لم تنتج الدرس
→ دون زيادة false-success أو تجاوز الصلاحيات
```

حتى ذلك الوقت، يبقى المشروع منصة تنفيذ هندسي موثوقة ذات تكيف محلي، وليس نظام تعلم عام مكتمل.

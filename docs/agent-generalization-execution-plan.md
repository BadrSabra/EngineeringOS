# مواصفة البناء الكاملة وعقد القبول — تطور الوكيل الهندسي نحو التعميم والتعلم

> **الحالة:** مواصفة البناء وعقد القبول — التنفيذ المرحلي قيد التقدم
> **نطاق الخطة:** الوكيل داخل بيئات البرمجيات والأنظمة الرقمية  
> **تاريخ إعداد الخطة:** 2026-09-24  
> **مرجع التشخيص:** `docs/ai-layer-deep-analysis.md` والتحليل المعمق لطبقات التنفيذ والذاكرة والتعميم  
> **آخر حالة تنفيذية:** P0 وP1 وP3 ولبّ P4 منجزة؛ P2 جزئية؛ P5–P13 متبقية
> **سجل التقدم الإلزامي:** `docs/agent-generalization-progress.md`

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

---

# الملحقات الإلزامية — مواصفة البناء وعقد القبول

الأقسام التالية تحول الخطة إلى مواصفة يمكن تنفيذها ومراجعتها واختبارها دون
اتخاذ قرارات معمارية أساسية جديدة أثناء التنفيذ. إذا تعارض أي اقتراح سابق
في الوثيقة مع ملحق إلزامي هنا، تكون الملحقات هي المرجع الأقوى.

---

## 17. المتطلبات المعيارية

### 17.1 متطلبات الهوية

كل episode وobservation وeffect وworld fact وstrategy candidate يجب أن يرتبط
بـ:

```text
projectId
```

ويجب أن يرتبط execution-backed record أيضاً بـ:

```text
executionId
attempt
operationId أو correlationId عند توفره
```

ويجب أن يملك أي record يعتمد على مصدر ملفات أو runtime:

```text
projectRevision أو sourceRevision
environmentRevision عند الحاجة
```

يجب رفض الكتابة إذا:

- كان `projectId` لا يطابق execution أو source.
- كان `attempt` مختلفاً عن المحاولة الحالية.
- كان worker لا يملك lease.
- كان source revision غير متاح لمسار يتطلب proof.
- كانت observation من مشروع آخر.

### 17.2 متطلبات السلطة

يجب أن تبقى القرارات التالية server-owned:

```text
tool authorization
scope
project root
write approval
validation profile
acceptance verdict
proof completeness
skill promotion
delivery authorization
```

لا يجوز أن يكتب النموذج أو provider مباشرة إلى:

- `ai_execution_acceptances`.
- `ai_skill_registry`.
- `ai_world_facts`.
- `ai_strategy_candidates` بحالة promoted.
- `ai_agent_episodes` بحالة terminal مقبولة.

النموذج يرسل proposal إلى adapter server-owned، والـadapter يتحقق من
schema والهوية والـpolicy.

### 17.3 متطلبات الثقة

كل نص قادم من:

- repository.
- tool output.
- memory.
- checkpoint detail.
- provider response.
- generated strategy.

يُعامل كبيانات غير موثوقة ما لم يمر عبر validator أو materializer server-owned.

لا يجوز استخدام النص غير الموثوق لتحديد:

- صلاحية مسار.
- approval.
- project root.
- terminal success.
- promotion.

### 17.4 متطلبات الحجم

الحدود الأولية الإلزامية:

| العنصر | الحد |
|---|---:|
| episode event payload | 32 KiB |
| observation value | 16 KiB |
| effect expected/observed payload | 16 KiB |
| failure diagnosis | 8 KiB |
| strategy candidate | 32 KiB |
| episode references | 128 عنصر |
| observation references | 128 عنصر |
| strategy supporting episodes | 64 عنصر |
| strategy contradicting episodes | 64 عنصر |
| world facts injected into one prompt | 64 fact |
| strategies injected into one planner call | 8 strategy |

يجب رفض payload الأكبر من الحد، لا تقليمه بصمت في records التي تدخل proof
أو learning. يمكن عمل truncation فقط في public display projection مع marker
واضح.

### 17.5 متطلبات الزمن

كل record زمني يستخدم UTC مع timezone-aware timestamps.

لا تستخدم timestamps القادمة من provider لتحديد ترتيب الأحداث. ترتيب الأحداث
يحدده server sequence وdatabase transaction time.

---

## 18. مخطط البيانات النهائي

### 18.1 مبدأ التخزين

تستخدم الجداول الحالية كمصادر أصلية:

- `ai_executions`: control plane.
- `ai_execution_acceptances`: terminal acceptance.
- `ai_execution_evidence_snapshots`: retained proof evidence.
- `ai_missions` و`ai_goals`: durable objectives.
- `events`: project event feed.
- `ai_skill_registry`: promoted executable skills.

تضاف جداول متخصصة لأن كل نوع من البيانات له lifecycle مختلف. لا يوضع
world state أو learning state في `checkpoint` أو `recipeReceipt`.

### 18.2 جدول `ai_agent_episodes`

المخطط المنطقي الإلزامي:

```text
id                  text primary key
project_id          text not null → projects.id
execution_id        text not null → ai_executions.id
attempt             integer not null
episode_type        text not null
parent_episode_id   text nullable → ai_agent_episodes.id
mission_id          text nullable → ai_missions.id
goal_id             text nullable → ai_goals.id
operation_id        text nullable
correlation_id      text nullable
project_revision    text not null
world_revision_start text nullable
world_revision_end  text nullable
plan_revision       text nullable
scope               jsonb not null
objective_hash      text not null
state               enum not null
verdict             text nullable
reason_code         text nullable
next_action_code    text nullable
worker_id           text nullable
lease_epoch         integer nullable
idempotency_key     text not null
created_at          timestamp not null
updated_at          timestamp not null
closed_at           timestamp nullable
```

القيود:

```text
FK project_id → projects.id ON DELETE CASCADE
FK execution_id → ai_executions.id ON DELETE CASCADE
FK parent_episode_id → ai_agent_episodes.id ON DELETE SET NULL
FK mission_id/goal_id → existing mission tables
UNIQUE(execution_id, attempt, idempotency_key)
INDEX(project_id, state, updated_at)
INDEX(execution_id, attempt)
INDEX(goal_id, plan_revision)
```

`objective_hash` هو hash لنسخة server-owned من objective contract. لا يحسب
من prompt خام.

### 18.3 جدول `ai_agent_episode_events`

للحفاظ على الترتيب وإعادة البناء:

```text
id                  text primary key
episode_id          text not null → ai_agent_episodes.id
project_id          text not null → projects.id
execution_id        text not null → ai_executions.id
attempt             integer not null
sequence            integer not null
event_type          text not null
payload             jsonb not null
actor_type          text not null
actor_id            text nullable
correlation_id      text nullable
created_at          timestamp not null
```

القيود:

```text
UNIQUE(episode_id, sequence)
UNIQUE(episode_id, event_type, payload_hash)
INDEX(project_id, created_at)
INDEX(execution_id, attempt, sequence)
```

`payload_hash` يحسب server-side من canonical JSON. لا يستخدم provider-generated
hash.

أنواع الأحداث المسموحة في الإصدار الأول:

```text
EPISODE_CREATED
OBSERVATION_REQUESTED
OBSERVATION_RECORDED
PLAN_SELECTED
ACTION_REQUESTED
ACTION_COMMITTED
EFFECT_PENDING
EFFECT_CLASSIFIED
CLAIM_UPDATED
REPLAN_REQUESTED
ACCEPTANCE_LINKED
EPISODE_PAUSED
EPISODE_RESUMED
EPISODE_CANCELLED
EPISODE_TERMINAL
```

أي event type جديد يحتاج contract version وتحديثاً في replay reducer.

### 18.4 جدول `ai_agent_observations`

```text
id                    text primary key
project_id            text not null → projects.id
episode_id            text not null → ai_agent_episodes.id
execution_id          text nullable → ai_executions.id
attempt               integer nullable
kind                  text not null
observation_role      text not null
source_type           text not null
source_id             text not null
source_version        text nullable
subject               text not null
predicate             text not null
value                 jsonb not null
value_hash            text not null
source_revision       text nullable
environment_revision  text nullable
completeness          text not null
freshness             text not null
evidence_refs         jsonb not null default []
observed_at           timestamp not null
created_at            timestamp not null
```

القيود:

```text
FK project_id → projects.id ON DELETE CASCADE
FK episode_id → ai_agent_episodes.id ON DELETE CASCADE
UNIQUE(source_type, source_id, source_version, predicate, value_hash)
INDEX(project_id, kind, observed_at)
INDEX(project_id, subject, predicate, observed_at)
INDEX(episode_id, observation_role)
```

`source_type` لا يساوي `kind`. مثال:

```text
kind = RUNTIME
source_type = runtime_validation_receipt
```

### 18.5 جدول `ai_agent_effects`

يخزن مقارنة action قبل وبعد:

```text
id                    text primary key
project_id            text not null → projects.id
episode_id            text not null → ai_agent_episodes.id
execution_id          text not null → ai_executions.id
attempt               integer not null
action_id             text not null
capability_id         text not null
effect_contract_hash  text not null
before_observation_ids jsonb not null
after_observation_ids  jsonb not null
expected_effects       jsonb not null
status                 text not null
missing_effects        jsonb not null default []
contradiction_refs     jsonb not null default []
evidence_refs          jsonb not null default []
created_at             timestamp not null
```

القيود:

```text
FK episode_id → ai_agent_episodes.id ON DELETE CASCADE
UNIQUE(execution_id, attempt, action_id, effect_contract_hash)
INDEX(project_id, status, created_at)
INDEX(episode_id, action_id)
```

حالات effect:

```text
PENDING
OBSERVED
PARTIAL
NOT_OBSERVED
CONTRADICTED
UNKNOWN
```

### 18.6 جدول `ai_world_facts`

يستخدم versioned facts بدلاً من update صامت:

```text
id                    text primary key
project_id            text not null → projects.id
fact_key              text not null
version               integer not null
scope_kind            text not null
scope_id              text not null
subject               text not null
predicate             text not null
object_value          jsonb not null
object_hash           text not null
status                text not null
confidence             numeric not null
world_revision        text not null
source_observation_ids jsonb not null
supersedes_fact_id    text nullable
valid_from            timestamp nullable
valid_until           timestamp nullable
observed_at           timestamp not null
created_at            timestamp not null
```

القيود:

```text
UNIQUE(project_id, fact_key, version)
INDEX(project_id, fact_key, status, version)
INDEX(project_id, scope_kind, scope_id, status)
INDEX(project_id, world_revision)
```

لا يوجد `UNIQUE` يمنع التناقضات؛ التناقض يجب أن يكون قابلاً للتسجيل حتى
يتم حسمه. projection الحالية تختار facts المقبولة وفق سياسة التعارض.

### 18.7 جدول `ai_strategy_candidates`

```text
id                    text primary key
strategy_key          text not null
strategy_version      integer not null
scope_kind            text not null
scope_id              text nullable
trigger_contract      jsonb not null
precondition_contract jsonb not null
action_order          jsonb not null
expected_effects      jsonb not null
supporting_episode_ids jsonb not null
contradicting_episode_ids jsonb not null
source_revision       text nullable
evaluation_contract   jsonb not null
evaluation_status     text not null
confidence             numeric not null
created_by             text not null
created_at             timestamp not null
updated_at             timestamp not null
promoted_at            timestamp nullable
revoked_at             timestamp nullable
```

القيود:

```text
UNIQUE(strategy_key, strategy_version, scope_kind, scope_id)
INDEX(scope_kind, scope_id, evaluation_status)
INDEX(evaluation_status, updated_at)
```

هذا الجدول لا يملك foreign key إلى `ai_skill_registry` لأن strategy ليست skill
تنفيذية. عند تحويلها إلى capability، يجب إنشاء proposal وcandidate وshadow
replay عبر المسار الحالي.

### 18.8 تصدير schemas

يجب تصدير كل جداول Drizzle من:

```text
lib/db/src/schema/index.ts
```

ويجب أن تبقى كل أنواع JSONB محمية بـZod عند حدود API أو worker. لا تعتبر
`jsonb` وحدها تحققاً من schema.

---

## 19. State Machines

### 19.1 Episode state machine

```text
CREATED
  → RUNNING
  → PAUSED
  → RUNNING
  → VERIFYING
  → COMPLETED

RUNNING
  → EFFECT_PENDING
  → RUNNING

RUNNING
  → NEEDS_REPLAN
  → RUNNING

RUNNING
  → WAITING_APPROVAL
  → RUNNING

CREATED/RUNNING/PAUSED/VERIFYING
  → CANCELLING
  → CANCELLED

CREATED/RUNNING/PAUSED/VERIFYING
  → BLOCKED
  → FAILED
```

القواعد:

- `COMPLETED`, `CANCELLED`, `BLOCKED`, و`FAILED` terminal.
- لا يمكن فتح episode terminal.
- resume ينشئ attempt جديداً فقط وفق عقد execution الحالي؛ لا يعيد فتح row
  terminal.
- `NEEDS_REPLAN` ليست terminal إذا كانت الميزانية تسمح بإعادة التخطيط.
- `WAITING_APPROVAL` لا يستهلك action budget أثناء الانتظار.
- لا يكتب الانتقال إلا worker المالك أو transaction recovery المصرح بها.

### 19.2 Action state machine

```text
PLANNED
  → PRECONDITIONS_CHECKED
  → BEFORE_CAPTURED
  → DISPATCHED
  → ACTION_COMMITTED
  → EFFECT_PENDING
  → EFFECT_CLASSIFIED
```

من `EFFECT_CLASSIFIED`:

```text
OBSERVED      → CONTINUE أو ACCEPTANCE
PARTIAL       → READ_MORE أو REPLAN
NOT_OBSERVED  → REPLAN أو INCOMPLETE
CONTRADICTED  → WORLD_CHANGED أو BLOCKED
UNKNOWN       → INCOMPLETE
```

لا يجوز الانتقال من `ACTION_COMMITTED` إلى `PROVEN` مباشرة في mutation أو
delivery action.

### 19.3 World fact state machine

```text
OBSERVED
  → BELIEVED
  → CONFIRMED

BELIEVED/CONFIRMED
  → SUPERSEDED
  → RETRACTED
  → CONTRADICTED
```

الانتقال إلى `CONFIRMED` يحتاج مصدر server-owned يحقق policy الخاصة بنوع fact.

### 19.4 Strategy candidate state machine

```text
DISCOVERED
  → PENDING_REPLAY
  → REPLAY_PASSED
  → CANARY
  → PROMOTED

DISCOVERED/PENDING_REPLAY/REPLAY_PASSED/CANARY
  → REPLAY_FAILED أو REJECTED

PROMOTED
  → REVOKED
  → SUPERSEDED
```

لا يجوز الانتقال إلى `PROMOTED` من provider response أو benchmark aggregate
فقط.

---

## 20. العقود الداخلية والـAPI

### 20.1 Episode Ledger

```ts
startEpisode(input): Promise<{
  episodeId: string;
  created: boolean;
  state: EpisodeState;
}>;

appendEpisodeEvent(input): Promise<{
  sequence: number;
  duplicate: boolean;
}>;

closeEpisode(input): Promise<{
  closed: boolean;
  duplicate: boolean;
  verdict: EpisodeVerdict;
}>;

loadEpisodeForOwner(input): Promise<AgentEpisode | null>;
replayEpisode(input): Promise<ReplayedEpisode>;
```

كل دالة يجب أن:

- تتحقق من project ownership.
- تتحقق من execution attempt.
- تتحقق من worker lease عند الكتابة.
- تستخدم idempotency.
- لا تعرض raw provider diagnostics.

### 20.2 Observation Materializer

```ts
materializeObservation(input): Promise<{
  observationId: string;
  duplicate: boolean;
}>;

materializeFromAcceptance(input): Promise<{
  observationIds: string[];
}>;

materializeFromRuntimeReceipt(input): Promise<{
  observationIds: string[];
}>;
```

لا تقبل هذه الواجهات `value` غير محدود. يجب أن تمر القيمة عبر schema نوع
المصدر، ثم عبر redaction وsize validation.

### 20.3 World State Reader

```ts
readWorldState(input: {
  projectId: string;
  scope: WorldScope;
  requiredFacts?: RequiredFact[];
  maxFacts: number;
  asOfRevision?: string;
}): Promise<{
  worldRevision: string;
  facts: WorldFact[];
  staleFacts: WorldFact[];
  contradictions: FactConflict[];
  missing: RequiredFact[];
}>;
```

`readWorldState` read-only. لا يكتب facts ولا يرفع confidence.

### 20.4 Effect Observer

```ts
captureBefore(input): Promise<ObservationRef[]>;
captureAfter(input): Promise<ObservationRef[]>;
classifyEffect(input): Promise<EffectObservationResult>;
```

كل observer profile يملك:

```text
timeout
max reads
required revision
allowed scope
evidence requirement
failure mapping
```

### 20.5 Failure Diagnosis

```ts
diagnoseFailure(input: {
  episodeId: string;
  actionId?: string;
  validatorReceipt?: unknown;
  effectResult?: unknown;
  acceptanceProjection?: unknown;
}): FailureDiagnosis;
```

الدالة deterministic قدر الإمكان، ولا تجعل تفسير provider المصدر الوحيد للـkind.

### 20.6 Strategy Evaluation

```ts
extractStrategy(input): Promise<StrategyCandidate | null>;
evaluateStrategy(input): Promise<StrategyEvaluation>;
promoteStrategy(input): Promise<PromotionDecision>;
revokeStrategy(input): Promise<RevocationDecision>;
```

`promoteStrategy` لا ينشئ `ai_skill_registry` row مباشرة إلا إذا تحولت
strategy إلى executable capability واجتازت مسار candidate/shadow/proof الحالي.

---

## 21. المعاملات والتزامن والاسترداد

### 21.1 إنشاء episode

عند إنشاء execution جديد:

1. ينشئ route أو service execution كما هو حالياً.
2. ينشئ root episode في نفس transaction إن أمكن.
3. إذا تعذر ذلك، ينفذ `startEpisode` idempotently بعد commit.
4. لا يبدأ worker provider work قبل توفر execution identity.

### 21.2 إضافة event

يجب أن تنفذ transaction الآتي:

```text
BEGIN
  SELECT episode FOR UPDATE
  verify owner/attempt/state
  compute next sequence
  validate event contract
  INSERT event
  UPDATE episode updated_at/state if required
COMMIT
```

لا يعتمد sequence على memory أو process-local counter.

### 21.3 Materialize observation

يجب أن تكون insert idempotent. عند duplicate:

```text
return existing observation
```

ولا تنشئ observation جديدة بسبب retry أو reconnect.

### 21.4 Materialize fact

تستخدم transaction مع lock على:

```text
projectId + factKey
```

يمكن استخدام advisory lock الموجود في:

```text
artifacts/api-server/src/lib/advisory-lock.ts
```

ثم:

1. قراءة آخر version.
2. مقارنة observation.
3. إنشاء version جديدة.
4. تحديث supersession/contradiction.
5. إنشاء world revision.

### 21.5 قبول execution

لا تغير `ai-execution-acceptance.ts` ترتيب الحماية الحالي. قبل terminal success:

1. verify owner.
2. verify attempt.
3. verify objective contract.
4. verify retained evidence.
5. verify effect bundle عند الحاجة.
6. verify candidate/delivery identity.
7. write acceptance and public message transactionally.

### 21.6 crash بين action وeffect

إذا توقف worker بعد `ACTION_COMMITTED` وقبل `EFFECT_CLASSIFIED`:

```text
recovery sees EFFECT_PENDING
→ reacquire execution lease
→ run only idempotent observer
→ never blindly repeat mutation
```

إذا لم يكن observer idempotent أو آمناً، تصبح النتيجة:

```text
EFFECT_UNKNOWN
```

ولا يعاد action تلقائياً.

### 21.7 lease fences

كل كتابة جديدة يجب أن تتحقق من:

```text
executionId
attempt
workerId
leaseUntil
checkpointVersion/sequence عند الحاجة
```

لا يكفي التحقق من `workerId` وحده.

---

## 22. سياسة World State

### 22.1 أولوية المصادر

الترتيب الأولي من الأقوى إلى الأضعف:

```text
server-owned acceptance/proof
→ complete validator receipt
→ complete runtime/browser/delivery observation
→ complete retained source evidence
→ static graph evidence
→ typed validated memory
→ unconfirmed hypothesis
```

الترتيب لا يعني أن المصدر الأقوى يحذف مصدراً أقدم؛ بل يحدد status عند التعارض.

### 22.2 Freshness

يجب أن يملك كل fact أحد أسباب freshness:

```text
revision_match
environment_revision_match
time_window
explicitly_immutable
```

إذا لم يوجد سبب، تكون freshness `UNKNOWN`.

### 22.3 Confidence

لا يدخل provider confidence في الحساب. يشتق confidence من:

```text
source strength
source completeness
revision match
source diversity
contradictions
age
repeated observation
```

يجب حفظ مكونات الحساب ضمن server-only metadata حتى يمكن تفسير القرار.

### 22.4 التناقض

عند وجود factين متناقضين:

1. لا تحذف أياً منهما.
2. أنشئ conflict reference.
3. اجعل projection الحالية `CONTRADICTED` أو `UNRESOLVED`.
4. أضف required observation تميز بينهما.
5. امنع claims التي تعتمد على conflict من PROVEN.

### 22.5 نطاق النقل

كل fact تصنف إلى:

```text
PROJECT_LOCAL
ENVIRONMENT_LOCAL
DOMAIN_REUSABLE
GLOBAL_SAFE
```

الافتراضي `PROJECT_LOCAL`. لا تنقل fact بين المشاريع إلا بعد strategy/evidence
evaluation صريحة.

---

## 23. مواصفة Action وEffect لكل المسارات

### 23.1 قراءة ملف

```text
Action: READ_PROJECT_FILE
Before: project revision + root identity
After: retained complete read or explicit failure
Effect: requested source evidence available
Proof: evidence read binding
Failure: incomplete evidence; no source-grounded claim
```

### 23.2 قراءة تحليلية

```text
Action: ANALYSIS_TOOL
Before: operation/correlation/revision/root
After: complete analysis result with matching correlation
Effect: analysis evidence available
Proof: analysis correlation + retained evidence
Failure: reject cross-operation/stale result
```

### 23.3 Candidate validation

```text
Action: VALIDATE_CANDIDATE
Before: candidate tree hash + source revision + scope
After: validator receipt + observed candidate bytes
Effect: validation profile passed on immutable candidate
Proof: candidate validation boundary
Failure: incomplete/failed validation; no promotion
```

### 23.4 Runtime start/restart

```text
Action: RUN_RUNTIME_PROFILE
Before: runtime ownership + candidate/revision
After: process identity + port + health + serving revision
Effect: expected runtime is serving target bytes
Proof: runtime observation bound to session/revision
Failure: process alive alone is not success
```

### 23.5 Browser verification

```text
Action: RUN_BROWSER_PROFILE
Before: preview path + runtime revision + profile
After: DOM/assertion/console evidence
Effect: expected user-visible behavior observed
Proof: browser validation receipt
Failure: no DOM/effect proof; incomplete
```

### 23.6 Git delivery

```text
Action: PUSH_VERIFIED_COMMIT
Before: verified local commit + expected remote parent
After: remote parent/tree/marker observation
Effect: exact candidate tree delivered
Proof: delivery receipt + proof spine
Failure: drift reconciliation; never record uncertain push as success
```

### 23.7 Database read

```text
Action: READ_DATABASE_RESOURCE
Before: authorized logical resource + project scope
After: bounded typed result + schema/version metadata
Effect: requested database claim observed
Proof: resource contract and query boundary
Failure: incomplete/unauthorized; no claim acceptance
```

---

## 24. خوارزمية التخطيط وإعادة التخطيط

### 24.1 مدخلات planner

يستلم planner:

```text
server-owned intent
objective contract
current world revision
required claims/effects
available capability catalog
accepted strategy candidates
failure diagnosis إن وجدت
request budget
risk/approval policy
```

لا يستلم صلاحية mutation لمجرد استلام catalog.

### 24.2 مخرجات planner

```ts
type StrategyProposal = {
  proposalId: string;
  baseWorldRevision: string;
  steps: PlannedStep[];
  assumptions: Assumption[];
  requiredObservations: ObservationRequest[];
  expectedEffects: ExpectedEffect[];
  fallbackStrategyIds: string[];
  estimatedCost: number;
  estimatedRisk: number;
  informationGain: number;
};
```

كل `PlannedStep` يجب أن يحتوي:

```text
capabilityId
recipeVersion
inputRef
preconditions
expectedEffects
observationProfile
evidenceRequirements
approvalRequirement
```

### 24.3 التقييم

التقييم server-owned:

```text
utility =
  successProbability
  + informationGainWeight * informationGain
  - costWeight * cost
  - riskWeight * risk
  - staleRiskPenalty
  - contradictionPenalty
```

القيم والأوزان تحفظ في execution plan أو policy snapshot، ولا يغيرها النموذج.

### 24.4 حدود البحث

النسخة الأولى:

```text
max strategies per replan: 3
max depth per strategy: 16
max replans per execution: 2
max observation-only steps per replan: 4
max total planner time per execution: request ledger budget
```

أي تجاوز يتحول إلى:

```text
REPLAN_BUDGET_EXHAUSTED
```

ولا يستمر loop مفتوح.

### 24.5 قواعد replan

يجب إعادة التخطيط إذا:

- تغير `worldRevision`.
- فشل precondition.
- لم يظهر expected effect.
- ظهرت contradiction.
- أصبحت evidence غير كاملة.
- أصبح capability غير متاح.
- تغيرت approval أو scope policy.

لا تعاد نفس الخطة إذا لم يتغير:

```text
world observation
failure diagnosis
strategy candidate
or allowed budget
```

ويجب حفظ hash للخطة السابقة للمقارنة.

---

## 25. مواصفة التعلم والترقية

### 25.1 ما يدخل learning dataset

فقط trajectories التي:

- تملك episode مكتملة.
- تملك objective contract.
- تملك effect classification.
- تملك evidence acceptance مناسبة.
- تملك source/environment revision.
- لم تنته بـ`CANCELLED` أو `EFFECT_UNKNOWN`.

الـ`PARTIAL` و`NOT_PROVEN` تستخدم لتعلم failure patterns فقط، لا لاستخراج
strategy نجاح.

### 25.2 Credit assignment

لكل action يحسب server-side:

```text
claim_contribution
effect_contribution
information_gain
failure_contribution
redundancy_score
```

مصادر الحساب:

- claims التي أغلقت بعد action.
- effects التي ظهرت بعد action.
- observations التي أزالت uncertainty.
- validator outcome.
- subsequent replan.

لا يعتبر التتابع الزمني وحده سببية.

### 25.3 Minimum evidence للـstrategy

لا تدخل strategy `PENDING_REPLAY` إلا إذا:

```text
supporting accepted episodes >= 2
or
one episode with explicit controlled experiment
```

ولا تدخل `CANARY` إلا إذا:

```text
replay pass rate >= 95%
zero critical safety failures
zero false PROVEN
held-out improvement or cost reduction
```

### 25.4 بوابة الترقية الرقمية

الحدود الأولية:

```text
critical safety violations: 0
cross-project scope violations: 0
false PROVEN increase: 0
held-out cases: >= 30
independent transfer fixtures: >= 3
success regression versus baseline: <= 2 percentage points
required improvement: >= 5 percentage points
or tool/retry reduction: >= 15% with no safety regression
confidence calibration ECE: <= 0.15
```

إذا لم تتوفر 3 مشاريع أو fixtures مستقلة، تبقى strategy غير قابلة للترقية
العامة وتظل project-scoped.

### 25.5 Revocation

يجب إبطال strategy إذا:

- ظهرت safety violation واحدة critical.
- زادت false-success.
- ظهرت regression مستمرة في حالتين متتاليتين.
- أصبحت source/capability contract غير متوافقة.
- اكتشفت contradiction غير معالجة.

الإبطال لا يحذف history. يغير الحالة إلى `REVOKED` ويوقف استخدامها فوراً.

---

## 26. نموذج التهديد والضوابط

### 26.1 Prompt injection من repository

الخطر: ملف يطلب من agent تجاهل policy أو كشف أسرار أو توسيع scope.

الضوابط:

- repository content evidence فقط.
- tool policy server-owned.
- approval مستقل عن prompt.
- tests تحتوي ملفات injection.
- لا يكتب content إلى policy أو action contract.

### 26.2 Memory poisoning

الخطر: finding أو strategy خاطئة تصبح قابلة لإعادة الاستخدام.

الضوابط:

- لا memory authoritative بلا evidence.
- source revision وscope إلزاميان.
- strategy لا تترقى من prose.
- contradictory episodes تحفظ.
- revocation وexpiry.

### 26.3 Cross-project leakage

الخطر: fact أو strategy من مشروع تظهر في مشروع آخر بلا إذن.

الضوابط:

- كل query تبدأ بـproject ownership.
- default scope `PROJECT_LOCAL`.
- cross-project transfer عبر held-out evaluation فقط.
- indexes وforeign keys project-scoped.
- public projections لا تعرض foreign references.

### 26.4 Capability escalation

الخطر: composition تحول read capability إلى write capability.

الضوابط:

- capability risk لا يورث صلاحية من composition تلقائياً.
- أعلى risk/approval في أي node يطبق على composition.
- كل input/output schema server-validated.
- no raw command/argv/cwd/env من النموذج.
- promotion عبر registry الحالي فقط.

### 26.5 Replay attack

الخطر: إعادة استخدام observation أو approval من revision قديمة.

الضوابط:

- source/environment revision binding.
- effect contract hash.
- candidate tree hash.
- acceptance attempt binding.
- stale observation لا تدخل PROVEN.

### 26.6 Malicious generated adapter

الخطر: adapter مولد يقرأ أسراراً أو يتجاوز root أو ينفذ network غير مصرح.

الضوابط:

- isolated disposable workspace.
- allowlisted dependencies.
- static checks.
- network egress deny-by-default.
- secrets لا تصل إلى sandbox إلا عبر scoped adapter.
- shadow replay لا يكتب production.
- explicit approval قبل promotion.

### 26.7 Data volume denial of service

الخطر: strategy أو observation أو episode payload ضخم.

الضوابط:

- limits في Zod وDB boundary.
- bounded arrays.
- no raw body في event payload.
- per-project quotas.
- rejection لا truncation صامت.

---

## 27. الترحيل والتوافق

### 27.1 ترتيب migration

```text
1. Add enums/tables/indexes
2. Export schemas
3. Add startup schema readiness checks
4. Backfill no historical facts by default
5. Enable episode shadow writes
6. Verify row counts and idempotency
7. Enable observations
8. Enable world projection
9. Enable effect enforcement per slice
```

لا يتم backfill للـWorld Facts من provider prose أو raw chat history. يجوز
backfill فقط من server-owned accepted receipts إذا كان source revision متاحاً.

### 27.2 Legacy execution

الـexecutions القديمة التي لا تملك episode:

```text
legacy = true
```

وتبقى قابلة للعرض والاسترداد وفق العقود القديمة. لا تعاد كتابتها بأثر رجعي
إلى learning dataset إلا بعد materialization موثقة.

### 27.3 Rollback migration

لا يحذف rollback الجداول إذا كانت تحتوي على references إلى acceptance أو proof.

الترتيب:

1. disable write flags.
2. drain active workers.
3. retain rows and projections.
4. revert code readers.
5. keep additive tables for forensic recovery.

### 27.4 Backward-compatible deployment

كل worker جديد يجب أن يعمل مع:

- execution rows القديمة.
- checkpoint envelopes القديمة.
- acceptance rows القديمة.
- missing episode refs.
- missing world revisions.

ولا يجوز للworker القديم أن يكتب event لا يستطيع worker الجديد إعادة قراءته.

---

## 28. التشغيل والـSLO

### 28.1 Feature flag ownership

الـflags:

- server-owned.
- لا تأتي من client body.
- لا يحددها provider.
- تسجل في audit عند تغييرها.
- تطبق على worker جديد بعد restart أو config refresh معروف.

### 28.2 أهداف الأداء الأولية

في shadow mode:

```text
episode ledger overhead p95: < 50 ms لكل event
observation materialization p95: < 200 ms
world-state read p95: < 150 ms
extra execution latency: < 10% median
duplicate materialization rate: 0
```

إذا تجاوزت القراءة أو الكتابة هذه الحدود، تتوقف مرحلة Enforced وتبقى
Shadow/Advisory.

### 28.3 Health signals

يجب مراقبة:

- episode creation failures.
- event sequence conflicts.
- stale worker write rejections.
- observation duplicates.
- materializer lag.
- unresolved contradictions.
- `EFFECT_UNKNOWN` rate.
- acceptance blocked بسبب effect.
- strategy replay failures.
- promotion/revocation counts.

### 28.4 Recovery

يجب أن يوجد job reconciliation يفحص:

```text
episodes RUNNING with expired lease
effects PENDING beyond timeout
observations missing source
facts with broken supersession
strategy CANARY beyond deadline
```

لا يعيد reconciliation mutation. يعيد فقط observation idempotent أو يرفع
حالة blocked/unknown.

---

## 29. عقد الاختبار والقبول

### 29.1 بوابة schema

يجب أن تنجح:

- TypeScript build.
- Zod contract tests.
- Drizzle schema readiness.
- migration apply على disposable database.
- migration rollback procedure.
- serialization/redaction tests.

### 29.2 بوابة ownership

المطلوب:

```text
100% stale-writer rejection
100% cross-project rejection
100% duplicate idempotency
100% attempt mismatch rejection
100% terminal state immutability
```

أي failure في هذه المجموعة blocking.

### 29.3 بوابة proof

المطلوب:

```text
0 false PROVEN from incomplete evidence
0 PROVEN from provider prose only
0 acceptance with mismatched revision
0 acceptance with mismatched candidate identity
0 delivery success without remote effect evidence
```

### 29.4 بوابة effect

لكل capability مدعومة:

- before observation موجودة.
- action identity موجودة.
- after observation أو explicit unknown موجود.
- effect contract hash مطابق.
- failure mapping deterministic.
- no mutation success بلا effect status.

### 29.5 بوابة recovery

يجب اختبار:

- crash بعد action وقبل effect.
- crash بعد effect وقبل acceptance.
- reconnect بعد SSE EOF.
- resume بعد lease expiry.
- cancellation قبل controller registration.
- retry بعد duplicate finalization.
- world revision change أثناء انتظار worker.

### 29.6 بوابة generalization

الترقية العامة تحتاج:

```text
>= 30 held-out cases
>= 3 independent transfer fixtures
0 critical safety failures
0 false PROVEN increase
<= 2pp success regression
>= 5pp improvement أو >=15% cost/retry reduction
ECE <= 0.15
```

إذا فشل شرط واحد، تبقى candidate في `REPLAY_FAILED` أو project-scoped
`CANARY`.

---

## 30. مصفوفة القبول النهائية

| القدرة | دليل القبول | مصدر السلطة |
|---|---|---|
| استمرار التنفيذ | episode + execution + attempt متطابقة | execution state |
| ملكية التنفيذ | lease/worker fence | API server |
| إدراك الحالة | observations مرتبطة بمصدر وrevision | materializer |
| تحديث العالم | versioned facts وworld revision | world-state materializer |
| تنفيذ action | capability/recipe contract صالح | tool policy |
| تحقق الأثر | before/after + effect classification | effect observer |
| صحة النتيجة | objective/evidence/validator | acceptance |
| منع false success | لا PROVEN بلا required evidence/effect | proof/acceptance |
| إعادة التخطيط | diagnosis + تغير strategy أو observation | planner |
| الذاكرة | source-bound strategy candidate | strategy store |
| التعلم | held-out improvement | evaluation gate |
| capability جديدة | sandbox + replay + proof + approval | skill/capability registry |
| التعميم | transfer على fixtures مستقلة | generalization gate |
| الرجوع | revoke/rollback دون حذف forensic history | promotion controller |

---

## 31. ترتيب التنفيذ المعتمد

يجب تنفيذ الوحدات بهذا الترتيب:

```text
P0  Contracts, baseline, threat model
P1  Episode schema + ledger
P2  Episode integration in Chat/Mission
P3  Observation materialization
P4  World facts + materialized reader
P5  Effect contract for candidate validation
P6  Runtime/browser/delivery observers
P7  Failure diagnosis
P8  Bounded hypothesis-aware replan
P9  Strategy candidate extraction
P10 Replay and generalization benchmark
P11 Strategy canary/promotion/revocation
P12 Capability composition
P13 Multimodal extension
```

### الاعتماديات

```text
P0 → P1 → P2 → P3 → P4
P4 → P5 → P6
P5/P6 → P7 → P8
P8 → P9 → P10 → P11
P11 → P12
P5/P6/P10 → P13
```

لا يبدأ `P9` قبل أن تكون effects وacceptance موثوقة، ولا يبدأ `P12` قبل أن
تعمل sandbox/replay/promotion.

---

## 32. قائمة مراجعة تنفيذية قبل كل مرحلة

قبل دمج أي مرحلة، يجب الإجابة بـنعم عن الأسئلة التالية:

### الهوية

- هل كل row مرتبط بالمشروع والتنفيذ والمحاولة الصحيحة؟
- هل revision موجودة ومتحقق منها؟
- هل retry idempotent؟

### السلطة

- هل القرار server-owned؟
- هل provider أو repository content يستطيع التأثير في permission؟
- هل public projection خالية من diagnostics؟

### الحالة

- هل يمكن إعادة بناء state من events؟
- هل التناقض محفوظ ولا يُحذف؟
- هل stale state مميزة؟

### الأثر

- هل action يملك expected effect؟
- هل after-state ملاحظ؟
- ماذا يحدث عند observer failure؟
- هل يمنع المسار false success؟

### التعلم

- هل source evidence مقبولة؟
- هل strategy candidate قابلة لإعادة الاختبار؟
- هل يوجد held-out evaluation؟
- هل يوجد rollback؟

### التشغيل

- هل يعمل worker القديم والجديد معاً؟
- هل migration قابلة للتطبيق والرجوع؟
- هل feature flag قابلة للإيقاف؟
- هل توجد metrics وalerts؟

---

## 33. المعنى الدقيق للهدف النهائي

هذه المواصفة لا تدعي أن إضافة الجداول أو planners تجعل النظام AGI. الهدف المحدد
والقابل للقبول هو:

> وكيل هندسي عام نسبياً يستطيع العمل عبر مشاريع وبيئات برمجية مختلفة، ويحافظ
> على حالة عالم مرتبطة بالأدلة، يلاحظ أثر أفعاله، يعيد التخطيط عند تغير العالم،
> يستخرج استراتيجيات من trajectories المقبولة، ويثبت تحسنها على مهام held-out،
> دون أن يتجاوز سلطة الخادم أو يحول provider output إلى حقيقة.

ولا يعد النظام “قابلاً للتعلم” إلا إذا تحققت هذه الدورة:

```text
accepted outcome
→ attributable trajectory
→ strategy candidate
→ replay
→ held-out improvement
→ controlled canary
→ revocable promotion
```

ولا يعد “قابلاً للتعميم” إلا إذا نجحت strategy أو capability في سياق مستقل عن
السياق الذي أنتجها، مع بقاء:

```text
proof integrity
ownership integrity
scope integrity
evidence completeness
```

---

## 34. Definition of Complete Build

يعتبر البناء كاملاً فقط عند تحقق جميع المجموعات التالية:

### Control Plane

- execution durable.
- leases وownership fences.
- checkpoints وresume.
- cancellation.
- idempotent terminalization.

### Evidence Plane

- retained reads.
- objective claims.
- validator receipts.
- effect evidence.
- proof identity.

### Cognitive State Plane

- observations append-only.
- versioned world facts.
- freshness.
- contradictions.
- world revision.

### Planning Plane

- preconditions/effects.
- bounded strategy search.
- diagnosis-aware replanning.
- no-progress protection.

### Learning Plane

- trajectory extraction.
- credit assignment.
- strategy candidates.
- replay.
- held-out evaluation.
- canary/revocation.

### Capability Plane

- typed capability contracts.
- composition.
- sandbox.
- shadow replay.
- proof-bound promotion.

### Evaluation Plane

- safety score.
- generalization score.
- transfer score.
- learning delta.
- calibration.
- cost/latency.

### Operational Plane

- migrations.
- feature flags.
- dashboards.
- alerts.
- reconciliation.
- rollback.
- retention.

إذا غابت أي مجموعة، يكون النظام في مرحلة وسيطة محددة، ولا يجوز وصفه بأنه
وصل إلى الهدف العام الكامل.

---

## 35. Architecture Freeze — قرارات ملزمة قبل أول Migration

هذا القسم يحسم القرارات التي كانت قابلة للتفسير في الخطة العامة. لا يبدأ
التنفيذ الذي يغير schema أو acceptance قبل اعتماد هذه القرارات كما هي.

### 35.1 مصدر الحقيقة لكل نوع بيانات

| البيانات | المصدر الأصلي | ما لا يجوز فعله |
|---|---|---|
| execution ownership/status | `ai_executions` و`ai-execution-state.ts` | إنشاء queue أو lease ثانية |
| mission/goal lifecycle | `ai_missions` و`mission-runtime.ts` | إنشاء Mission state machine موازية |
| terminal acceptance | `ai_execution_acceptances` و`ai-execution-acceptance.ts` | إنشاء acceptance row بديلة |
| retained source proof | `ai_execution_evidence_snapshots` و`evidence-integrity.ts` | نسخ body إلى world/episode |
| project event feed | `events` | استخدامه وحده لإعادة بناء episode |
| episode lifecycle | `ai_agent_episodes` | وضع lifecycle داخل checkpoint فقط |
| episode ordering | `ai_agent_episode_events` | الاعتماد على timestamp وحده |
| semantic observations | `ai_agent_observations` | اعتبار كل provider output observation |
| current world projection | `ai_world_facts` | تعديل fact قديم بلا version |
| executable promoted skill | `ai_skill_registry` | تخزين strategy غير قابلة للتنفيذ فيه |
| reusable strategy candidate | `ai_strategy_candidates` | تفعيلها دون replay وevaluation |

### 35.2 العلاقة بين `events` و`ai_agent_episode_events`

لا تستبدل الجداول بعضها:

- `events` سجل عام مرتبط بالمشروع، وقد يحتوي task/workflow/goal events
  قديمة أو غير مرتبطة بـepisode.
- `ai_agent_episode_events` سجل خاص قابل لإعادة بناء episode، ويملك sequence
  إلزامياً وFK إلى episode وattempt.

يجب أن يكتب adapter واحد الحدثين عند الحاجة:

```text
episode transition
    → ai_agent_episode_events (canonical episode order)
    → events (dashboard/audit projection)
```

لا يقرأ planner أو recovery episode من `events` العامة إذا كان
`ai_agent_episode_events` متاحاً.

### 35.3 ربط الأثر بالقبول

يضاف إلى `ai_execution_acceptances` عمود اختياري:

```text
effect_bundle_id text nullable
```

ويرتبط بجدول:

```text
ai_agent_effect_bundles
```

المخطط:

```text
id              text primary key
project_id      text not null
execution_id    text not null
attempt         integer not null
episode_id      text not null
effect_ids      jsonb not null
effect_contract_hashes jsonb not null
verdict         text not null
world_revision  text nullable
created_at      timestamp not null
```

القيود:

```text
UNIQUE(execution_id, attempt)
FK execution_id → ai_executions.id ON DELETE CASCADE
FK episode_id → ai_agent_episodes.id ON DELETE CASCADE
INDEX(project_id, created_at)
```

يتم إنشاء effect bundle قبل terminal acceptance، وتكتب acceptance وeffect
binding في نفس transaction. لا يستخدم `disposition` وحده لهذا الربط؛ يمكن
أن يحتوي `disposition` على projection مختصرة فقط.

### 35.4 الـenums والـchecks

يجب أن تكون الحالات server-owned enums أو Zod enums متطابقة:

```text
episode_state:
  created, running, paused, effect_pending, verifying,
  waiting_approval, needs_replan, completed, blocked,
  failed, cancelling, cancelled

episode_verdict:
  achieved, incomplete, blocked, replan_required,
  world_changed, needs_approval, unsafe, failed, cancelled

observation_completeness:
  complete, partial, failed

observation_freshness:
  fresh, stale, unknown

effect_status:
  pending, observed, partial, not_observed, contradicted, unknown

fact_status:
  believed, confirmed, contradicted, superseded, retracted
```

يجب أن يفرض database وZod معاً:

```text
confidence >= 0 AND confidence <= 1
sequence >= 0
attempt >= 0
version >= 1
```

### 35.5 `worldRevision`

يحسب server-side فقط:

```text
worldRevision =
  sha256(canonicalJson({
    projectRevision,
    environmentRevision,
    relevantFactVersions,
    latestObservationSequence
  }))
```

يشمل `relevantFactVersions` facts التي تدخل scope الحالي، وليس كل facts
المشروع. يجب حفظ inputs أو references اللازمة لإعادة الحساب دون حفظ raw
provider text.

### 35.6 rollout configuration

في P0/P1 تكون flags process configuration server-owned، ولا تأتي من client.
عند الحاجة إلى project-scoped rollout، يضاف لاحقاً جدول:

```text
ai_agent_rollout_controls
```

ولا يسمح بوجود قيم مختلفة بين workers دون revision/config generation موحدة.
كل تغيير flag يسجل في audit، ولا يؤثر على execution بدأ بpolicy snapshot
مختلفة.

### 35.7 الوثائق المتداخلة

تعد هذه الوثيقة المصدر الرئيسي لمبادرة generalization. الوثيقة:

```text
docs/ai-agent-improvement-plan.md
```

مرجع تاريخي للتحسينات السابقة المتعلقة بالـbudget وquery planning والذاكرة،
ولا تنشئ خطة تنفيذ موازية. أي اقتراح من الوثيقة القديمة يجب أن يمر عبر
العقود وExecutionPlan وEpisode/Effect boundaries الموجودة هنا.

---

## 36. أول حزمة تنفيذية ملزمة: P0 وP1

هذه الحزمة هي نقطة البدء الوحيدة المسموح بها قبل World State أو learning.

### 36.1 P0-A — إنشاء العقود

الملفات:

```text
lib/ai-orchestrator/src/agent-state/episode-contract.ts
lib/ai-orchestrator/src/agent-state/observation-contract.ts
lib/ai-orchestrator/src/agent-state/effect-contract.ts
lib/ai-orchestrator/src/agent-state/failure-contract.ts
lib/ai-orchestrator/src/agent-state/strategy-contract.ts
lib/ai-orchestrator/src/agent-state/index.ts
```

المطلوب:

1. Zod schema لكل عقد.
2. TypeScript inferred types.
3. schema version.
4. canonical hash helper.
5. size limits.
6. public/private projection types.
7. parse functions لا تقبل unknown values غير bounded.
8. تصدير العقود من `src/index.ts`.

لا يضيف P0 أي import إلى:

- `lib/db`.
- API server.
- provider clients.
- filesystem.

### 36.2 P0-B — الاختبارات

يجب إنشاء:

```text
lib/ai-orchestrator/src/__tests__/agent-episode-contract.test.ts
lib/ai-orchestrator/src/__tests__/agent-observation-contract.test.ts
lib/ai-orchestrator/src/__tests__/agent-effect-contract.test.ts
lib/ai-orchestrator/src/__tests__/agent-failure-contract.test.ts
```

وتغطي:

- valid/invalid parsing.
- maximum sizes.
- unknown enum rejection.
- hash stability.
- redaction projection.
- no raw provider diagnostics.
- backward-compatible optional fields.

### 36.3 P1-A — Drizzle migrations

الملفات الجديدة:

```text
lib/db/src/schema/ai_agent_episodes.ts
lib/db/src/schema/ai_agent_observations.ts
lib/db/src/schema/ai_agent_effects.ts
lib/db/src/schema/ai_agent_effect_bundles.ts
lib/db/src/schema/ai_world_facts.ts
lib/db/src/schema/ai_strategy_candidates.ts
```

في P1 تنشأ الجداول، لكن لا يكتب World State أو Strategy Learning بعد.
تضاف فقط:

- episode root.
- episode event.
- references اللازمة.

يجب أن يمر schema readiness قبل تشغيل worker:

```text
schema exists
→ enum values match
→ indexes exist
→ foreign keys exist
→ unique constraints exist
→ startup continues
```

### 36.4 P1-B — Episode Ledger

الملف:

```text
artifacts/api-server/src/lib/agent-state/agent-episode-ledger.ts
```

الدوال الإلزامية:

```ts
startEpisode()
appendEpisodeEvent()
loadEpisodeForOwner()
closeEpisode()
replayEpisode()
```

كل write:

```text
transaction
→ lock episode
→ verify project/execution/attempt
→ verify worker lease
→ verify state transition
→ verify sequence
→ insert idempotently
→ commit
```

### 36.5 P1-C — Shadow integration

يرتبط ledger أولاً مع:

```text
artifacts/api-server/src/lib/task-execution-service.ts
artifacts/api-server/src/lib/mission-runtime.ts
artifacts/api-server/src/routes/ai/chat.ts
```

التكامل في هذه المرحلة:

- ينشئ episode.
- يسجل references.
- لا يغير `terminalStatus`.
- لا يمنع tool.
- لا يغير provider routing.
- لا يغير planner.
- لا يغير acceptance verdict.

### 36.6 P1-D — اختبارات القبول

يجب إضافة اختبارات:

```text
episode-start-idempotency
episode-attempt-mismatch
episode-cross-project-rejection
episode-stale-worker-rejection
episode-sequence-coherence
episode-terminal-immutability
episode-resume-replay
episode-cancellation
episode-crash-before-close
episode-public-redaction
```

مع fixtures provider-free قدر الإمكان.

---

## 37. عقد انتقال P1 إلى P2

لا يبدأ Observation Materialization إلا إذا تحققت الشروط التالية:

```text
all P0 contract tests pass
all P1 schema readiness checks pass
episode writes are idempotent
stale writes are rejected
legacy executions remain readable
no acceptance regression
no public diagnostic leakage
shadow overhead p95 < 50ms per event
```

ويجب أن تكون نتائج shadow متاحة لمدة campaign كاملة قبل تحويلها إلى مصدر
لـworld state.

---

## 38. ما لا يجوز تنفيذه في أول Pull Request

لا يضم أول PR أياً من التالي:

- `ai_world_facts` تؤثر في قرار planner.
- effect enforcement.
- تغيير `ai_execution_acceptances` terminal logic.
- automatic replan.
- strategy extraction.
- model/provider policy learning.
- skill promotion.
- capability composition.
- generated adapters.
- تغيير public Dashboard contracts.

الهدف من أول PR هو إثبات الهوية والتتبع فقط، وليس جعل الوكيل أكثر استقلالية.

---

## 39. مراجعة القبول قبل كل تفعيل

قبل تحويل أي flag من Shadow إلى Advisory أو Enforced، يجب تسجيل:

```text
implementation commit/checkpoint
schema revision
contract versions
policy snapshot
benchmark campaign id
rollback procedure
operator owner
```

ويجب أن تكون الإجابة عن الأسئلة التالية موجودة في release evidence:

1. هل يمكن إعادة بناء episode بعد restart؟
2. هل يرفض worker قديم الكتابة بعد فقد lease؟
3. هل source/effect identity مرتبطة بنفس revision؟
4. هل public projections خالية من raw diagnostics؟
5. هل يستطيع rollback إيقاف المسار دون حذف evidence؟
6. هل لا يزال acceptance هو مصدر terminal truth؟
7. هل توجد fixture تثبت الفشل الآمن عند missing effect؟
8. هل توجد fixture تثبت رفض cross-project state؟

إذا كانت إجابة واحدة `لا`، يبقى المسار Shadow.

---

## 40. إلزام تحديث الحالة بعد كل خطوة

هذا القسم إلزامي لأي وكيل أو منفذ يواصل هذه الخطة. لا يكفي تنفيذ الكود أو
نجاح الاختبارات؛ يجب أن تبقى حالة الخطة قابلة لإعادة البناء من المستندات.

### 40.1 قاعدة الانتقال

بعد إنجاز **كل خطوة قابلة للتحديد**، وقبل بدء الخطوة التالية، يجب على الوكيل:

1. تحديث `docs/agent-generalization-progress.md`.
2. تحديث حالة المرحلة أو البند المقابل في هذه الوثيقة إذا تغيرت الحالة.
3. تسجيل الملفات أو الجداول أو العقود التي تغيرت.
4. تسجيل أوامر التحقق ونتائجها، بما في ذلك الاختبارات الفاشلة إن وجدت.
5. تسجيل حدود الإنجاز: ما الذي لم يُنفذ، وما إذا كان التنفيذ Shadow أو Advisory
   أو Enforced.
6. تسجيل العائق أو القرار المؤجل صراحةً، وعدم تحويله إلى نجاح ضمني.

لا يجوز للوكيل أن يبدأ خطوة لاحقة أو يعلن أن المرحلة مكتملة إذا لم يُحدّث
السجل بعد الخطوة السابقة. إذا توقفت الخطوة بسبب عائق، يسجل الوكيل الحالة
`blocked` مع السبب والمحاولة التالية المقترحة، ولا يضع علامة `done`.

### 40.2 الحد الأدنى لكل إدخال

كل تحديث في سجل التقدم يجب أن يحتوي على:

```text
date/time
phase or step
status: done | partial | blocked | not_started
what changed
files/schema/contracts touched
validation commands and result
authority/safety impact
next step
```

يجب أن تكون الصياغة وصفية وقابلة للتحقق، مثل:

```text
P4 / World State reader
status: done
validation: API typecheck; 11 targeted tests; healthz=ok
authority impact: read-only; no acceptance/planner/permission changes
next: P5 Effect Observation
```

### 40.3 قواعد منع الادعاء الزائد

- نجاح typecheck وحده لا يثبت إنجاز مرحلة.
- وجود schema أو migration وحده لا يثبت إنجاز runtime behavior.
- نجاح provider لا يثبت acceptance أو effect.
- لا يجوز وضع `done` إذا بقي معيار خروج إلزامي غير متحقق.
- عند وجود اختلاف بين الخطة والكود، يسجل الوكيل الاختلاف أولاً ثم يختار
  صراحةً: تعديل الخطة، أو استكمال الكود، أو إبقاء البند `partial`.

### 40.4 تحديث الإغلاق

عند إغلاق أي مرحلة، يجب إضافة ملخص إغلاق يتضمن:

- معايير الخروج المحققة واحدًا واحدًا.
- الاختبارات والـfixtures المستخدمة.
- أثر التغيير على authority وproof وacceptance.
- migration/rollback أو سبب عدم الحاجة إليهما.
- المرحلة التالية المسموح ببدئها حسب dependency graph.

هذا الإلزام توثيقي وتشغيلي، ولا يمنح الوكيل صلاحية جديدة. تبقى حدود
`Proof` و`Acceptance` و`Mission` و`Capability` كما هي محددة في هذه الوثيقة.

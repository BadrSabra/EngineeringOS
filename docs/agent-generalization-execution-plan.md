# مواصفة البناء الكاملة وعقد القبول — تطور الوكيل الهندسي نحو التعميم والتعلم

> **الحالة:** مواصفة البناء وعقد القبول — التنفيذ المرحلي قيد التقدم
> **نطاق الخطة:** الوكيل داخل بيئات البرمجيات والأنظمة الرقمية  
> **تاريخ إعداد الخطة:** 2026-09-24  
> **مرجع التشخيص:** `docs/ai-layer-deep-analysis.md` والتحليل المعمق لطبقات التنفيذ والذاكرة والتعميم  
> **آخر حالة تنفيذية:** P0–P2 مكتملة؛ P3 مكتملة على مستوى foundation مع تكامل معرفي جزئي؛ P3.5/P4/P5 تحتوي شرائح runtime فعلية ومحدودة تشمل Candidate Validation وRuntime وBrowser/Delivery وapply-changes وMission repair. P4 لديها environment identity وscoped World State، لكن identity ليست independent observation ولا يوجد World Delta. توجد primitives جزئية لـP7/P8/P9/P10؛ الأولوية إغلاق cognitive loop لا التوسع الأفقي في capabilities أو strategy learning.
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
    → (optional until P7.5) Belief / Hypothesis
    → Action
    → Preconditions
    → Before Observation
    → Execution
    → After Observation
    → Effect Classification
    → World Delta
    → Acceptance
    → Diagnosis
    → Replan
    → Causal Credit
    → Portable Strategy
    → Held-out / Cross-project Transfer
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
promoted
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

### 3.7 Observation Provenance

كل observation يجب أن يعلن provenance صريحًا:

```text
DIRECT_OBSERVATION
SERVER_DERIVED
MODEL_INFERRED
```

القواعد:

- `DIRECT_OBSERVATION` يجوز أن يثبت evidence عن حالة العالم.
- `SERVER_DERIVED` يجوز أن يثبت fact مشتقًا مع حفظ مراجع المصدر.
- `MODEL_INFERRED` يجوز أن يكوّن hypothesis فقط.

يجب ألا تعاد تسمية acceptance أو validation أو model output كـindependent
runtime observation. وبذلك لا يجوز أن يتحول `PROVEN` المستنتج من acceptance
إلى دليل runtime مستقل.

هوية البيئة قاعدة رصدية لا قاعدة إثبات:

```text
Episode.environmentRevision ≠ independent environment observation
environmentRevision match ≠ proof that a child process ran in that environment
```

server-attested identity عند Episode creation أو receipt/launch/validator handoff
لا تثبت وحدها البيئة التي ورثها child process فعليًا. لا تغلق هذه القيمة P4/P5،
ولا تصبح proof لمجرد تطابق revision؛ يلزم independent observation من مصدر الفعل
الفعلي. تعذر الرصد يبقى `unknown`، ولا يجوز استبداله بقراءة `.env` أو قيم البيئة.

### 3.8 Contract completion ليس Runtime cognitive integration

يجب تسجيل الحكم على محورين منفصلين:

1. **Feature/contract completion:** وجود schema وcontract وstorage وprojection
   واختبارات القبول.
2. **Runtime cognitive integration:** ربط Objective وAction بالملاحظة المستقلة
   وEffect وWorld Delta وDiagnosis وReplan داخل runtime.

لذلك:

```text
Contract/schema existence ≠ runtime integration
Derived acceptance state ≠ independent observation
World-state materialization ≠ full belief/world model
Episode persistence ≠ closed-loop agent cognition
Strategy schema ≠ strategy learning
Replay infrastructure ≠ generalization
```

### 3.9 Non-Goals

لا تعني Generalization:

- unrestricted autonomy.
- تجاوز authorization أو ownership أو scope.
- self-modifying production code.
- اعتبار model output evidence.
- التعلم مباشرة من provider prose.
- تحسين benchmark معروف دون held-out validation.
- حفظ project-specific command sequences كـstrategy قابلة للنقل.
- إعلان النجاح من acceptance دون independent effect verification.

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
    ├── belief-contract.ts
    ├── hypothesis-experiment-contract.ts
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
    ├── hypothesis-experiment-ledger.ts
    ├── belief-updater.ts
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
  schemaVersion: number;
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;

  missionId?: string;
  goalId?: string;
  parentEpisodeId?: string;

  projectRevision: string;
  environmentRevision?: string;
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

  state:
    | "created"
    | "running"
    | "paused"
    | "effect_pending"
    | "verifying"
    | "waiting_approval"
    | "needs_replan"
    | "completed"
    | "blocked"
    | "failed"
    | "cancelling"
    | "cancelled";

  verdict?:
    | "achieved"
    | "incomplete"
    | "blocked"
    | "replan_required"
    | "world_changed"
    | "needs_approval"
    | "unsafe"
    | "failed"
    | "cancelled";

  reasonCode?: string;
  nextActionCode?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};
```

حالات Episode وverdict تستخدم lowercase كما في Zod وPostgreSQL؛ أما `EpisodeEventType`
فيبقى uppercase لأنه اسم حدث.

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
  schemaVersion: number;
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

  provenance: "DIRECT_OBSERVATION" | "SERVER_DERIVED" | "MODEL_INFERRED";
  observationRole: string;
  sourceType: string;
  sourceId: string;
  sourceVersion?: string;

  subject: string;
  predicate: string;
  value: unknown;

  sourceRefs: string[];
  evidenceRefs: string[];
  observedAt: string;
  projectRevision?: string;
  environmentRevision?: string;
  environmentFreshness?: "fresh" | "stale" | "unknown";

  completeness: "complete" | "partial" | "failed";
  freshness: "fresh" | "stale" | "unknown";
};
```

`kind` و`provenance` قيم uppercase، بينما completeness وfreshness قيم lowercase.

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
  taskScope: string;
  environmentRevision: string | null;

  subject: string;
  predicate: string;
  value: unknown;
  valueHash: string;
  version: number;

  status: "believed" | "confirmed" | "contradicted" | "superseded" | "retracted";
  sourceObservationIds: string[];
  projectRevision: string;
  environmentFreshness: "fresh" | "stale" | "unknown";
  supersedesFactId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

`taskScope` و`environmentRevision` يحددان هوية نطاق fact. تصنيف النقل في §22.5
بُعد منفصل، ولا يوسع scope أو يمنح fact صلاحية أو قابلية نقل تلقائية. حالات fact
lowercase، وتشمل `superseded`. قد تبقى `environmentRevision` nullable؛ يستخدم
المخطط `environmentRevisionKey` منفصلًا وغير nullable لهوية uniqueness والفهرسة.

لا تستبدل facts القديمة بصمت. يجب حفظ supersession والتناقض.

### 5.4 Effect Contract

يصف `EffectContract` الحالة المتوقعة بعد mutation أو external effect، وكذلك
validation الذي يعلن صراحةً expected effect. نتيجة القراءة read-only هي invocation
outcome مع evidence refs، وليست state effect ولا `EffectBundle`. لا تدخل القراءة
في effect gate إلا إذا كان عقدها المسجل effect-gated validation؛ عندها ينطبق
عليها عقد الأثر رغم أن operation الأصلية قد تكون read-only.

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
    | "CONTRADICTED"
    | "UNKNOWN";
};
```

### 5.5 Unified Action Semantics

كل capability invocation يحتاج سجل هوية server-owned مربوطًا بـEpisode/attempt
وcapability وscope وrevision. القراءة read-only تحفظ كذلك النتيجة المحدودة أو
الفشل ومراجع evidence، لكنها لا تتطلب كل حقول `AgentAction` ولا
`EffectBundle`.

الـmutation وeffect-gated validation يستخدمان `AgentAction` الكامل أدناه، حتى
لا تبقى semantics موزعة بين recipe node وtool call وMission action وexecution
node. ينطبق هذا التمييز أيضًا على provider tool calls: هوية ونتيجة لكل call؛
والعقد الكامل عند mutation أو effect-gated validation. تغطية الاستدعاءات
المتبقية جزء من P5.5:

```ts
type AgentAction = {
  actionId: string;
  episodeId: string;
  capabilityId: string;
  intent: string;
  scope: unknown;
  preconditions: unknown[];
  expectedEffects: string[];
  authorization: unknown;
  risk: "LOW" | "MEDIUM" | "HIGH";
  idempotencyKey: string;
  observationProfile: string;
  failureSemantics: string[];
};
```

يربط الخادم `episodeId` بالمحاولة والمراجعة؛ ولا يختار النموذج `scope` أو
revision أو authorization.

لا تمنح `AgentAction` صلاحية تنفيذ بذاتها؛ تظل capability registry وapproval
وprofile server-owned.

### 5.6 Belief and Information Gain

يمثل `World State` ما نعرفه، بينما يمثل `Belief State` ما نعتقد أنه قد يكون
صحيحًا:

تمثيل Belief اختياري حتى P7.5، وليس شرطًا لكل invocation أو للقراءة العادية.

```ts
type Belief = {
  beliefId: string;
  hypothesis: string;
  supportingObservationIds: string[];
  contradictingObservationIds: string[];
  confidence: number;
  affectedObjective: string;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  environmentScope?: string;
  requiredObservations: string[];
};
```

عقد P7.5/P8 يسجل الاختبار والتوقع قبل تشغيل observation، ثم يضيف نتيجة منفصلة
append-only:

```ts
type HypothesisOutcomeForecast = {
  hypothesisId: string;
  observationRef: string;
  outcomes: Array<{ outcomeKey: string; probability: number }>;
  provenance: "MODEL_INFERRED" | "SERVER_DERIVED";
  calibrationStatus: "unvalidated" | "validated_for_scope" | "out_of_scope";
  calibrationScopeRef?: string;
  calibrationEvidenceRef?: string;
  calibrationPolicyVersion: string;
};

type ExperimentCandidateAssessment = {
  observationRef: string; // server-owned observation profile/reference
  decisionRef: string; // objective-bound pending decision/evidence question
  outcomeDecisionMap: Array<{
    outcomeKey: string;
    nextDecisionCode: string; // server-owned decision branch
  }>;
  decisionValuePolicyVersion?: string;
  expectedDecisionValue?: number; // server-computed in objective-contract units
  forecasts: HypothesisOutcomeForecast[];
  expectedInformationGain: number; // server-computed
  estimatedCost: number; // versioned server-owned units
  estimatedRisk: number;
  estimatedTimeMs: number;
  authorizationDecision: "allowed" | "requires_approval" | "denied";
};

type RegisteredHypothesisExperiment = {
  experimentId: string;
  episodeId: string;
  objectiveContractId: string;
  beliefRevision: string;
  hypothesisSetId: string;
  competingHypothesisIds: string[];
  hypothesisWeights: Array<{ hypothesisId: string; beliefWeight: number }>;
  candidates: ExperimentCandidateAssessment[];
  selectedObservationRef: string;
  selectionMode:
    | "fixed_safe_probe"
    | "human_approved"
    | "calibrated_decision_value";
  selectionPolicyVersion: string;
  predictionRegisteredAt: string; // before observation dispatch
};

type HypothesisExperimentResult = {
  experimentId: string;
  observationRefs: string[];
  actualOutcomeKey?: string;
  verdict: "matched" | "contradicted" | "inconclusive";
  predictionErrorScore?: number; // server-computed categorical Brier score
  resultPolicyVersion: string;
  beliefRevisionAfter?: string;
  resolvedAt: string;
};
```

تكون `hypothesisWeights` server-owned ومطبّعة إلى 1 عبر البدائل النشطة، مع
`OTHER/UNKNOWN` عندما لا يغطي فضاء الفرضيات كل الاحتمالات. لا يستخدم provider
confidence بدل هذه الأوزان.

لا يصح هذا التوزيع إلا إذا كانت hypotheses في `hypothesisSetId` بدائل متنافية
وشاملة للسؤال والنطاق نفسيهما، مع `OTHER/UNKNOWN` لأي احتمال غير ممثل. إذا كانت
الفرضيات متداخلة أو تصف أبعادًا مستقلة، لا يعاد تطبيعها قسرًا ولا يستخدم عليها
حساب entropy هذا؛ تبقى التجربة unresolved حتى يوجد تمثيل احتمالي مناسب.

هذه عقود مستهدفة وليست schema منفذة. يحفظ التسجيل snapshot غير قابل للتعديل من
المراجعة والفرضيات والتوقعات وتقييم المرشحين؛ تحفظ النتيجة وتحديث Belief كأحداث
لاحقة، لا بتغيير التوقع بأثر رجعي.

عند توفر outcome كاملة، يحسب الخادم خطأ forecast لكل تجربة باستخدام Brier score
للتوزيع الهامشي المسجل للتجربة المختارة:

```text
p(outcome) = Σ_h beliefWeight(h) × P(outcome | h, observation)
Brier      = Σ_k (p(outcome_k) - 1[outcome_k = actualOutcome])²
```

الدرجة ومقارنة `matched/contradicted` إسقاطان لتقييم التوقع، لا evidence مستقلان.
يربط Belief updater الملاحظة الفعلية المقبولة بالـforecast وبنسخة Belief السابقة؛
ويحدّث الأوزان فقط عبر قاعدة server-owned versioned تستخدم outcomes موثوقة
واحتمالات صالحة/مقيسة. إذا غابت هذه الشروط يسجل خطأ التوقع عند إمكان حسابه،
لكن يترك Belief unresolved بدل فرض posterior. لا يكفي Brier score منفردًا
لتغيير World Fact أو قبول الهدف.

يجب أن يوازن اختيار observation بين:

```text
expected objective decision value (primary)
expected information gain
execution cost
risk
authorization
time
```

ولا يجوز استخدام confidence الصادر من النموذج كبديل عن هذه الحسابات
server-owned.

يبدأ الاختيار باستبعاد ما لا يحقق authorization وقيود السلامة والتكلفة/الوقت
server-owned، أو لا يمكن تقييم outcome space الخاص به. ثم يرتب المرشحين المؤهلين
وفق `expectedDecisionValue` أولًا: يحسبه الخادم من forecast المعاير و
`outcomeDecisionMap` وسياسة قيمة versioned مشتقة من objective contract. يمثل
انخفاض الخسارة المتوقعة للهدف عند السماح للقرار التالي باستخدام observation:

```text
expectedDecisionValue(a) =
  best expected objective loss before observing a
  - expected best objective loss after observing a and choosing an allowed branch
```

لا يصبح المرشح آليًا مؤهلًا إذا كانت هذه القيمة غير معرفة أو غير موجبة؛ وإذا
لم يعرّف objective contract سياسة قيمة قابلة للحساب، يستخدم النظام fixed-safe
probe أو اختيارًا بشريًا بدل استبدالها بـEIG. يكون `expectedInformationGain`
مقياسًا مساعدًا لكسر التعادل بين مرشحين متساويي قيمة القرار وفق policy نفسها؛
ثم ترجح الكلفة الأقل، فالمخاطر الأقل، فالوقت الأقصر. بذلك لا يكفي أن تزيد
observation المعلومات: يجب أن تحسن قرارًا مأذونًا أو evidence مطلوبًا للهدف.
إذا لم يوجد مرشح موجب القيمة أو كانت التوقعات غير قابلة للتقييم، يبقى belief
غير محسوم ولا تنفذ تجربة تخمينية.
يتطلب `calibrated_decision_value` وجود `decisionValuePolicyVersion` و
`expectedDecisionValue` محسوبين خادميًا معًا؛ غياب أحدهما يمنع هذا النمط.

التوقعات غير المعايرة أو الخارجة عن scope تبقى shadow/advisory ولا تقود اختيارًا
آليًا. في bootstrap يختار الخادم probe ثابتًا وآمنًا لا يعتمد على forecast، أو
يختار الإنسان observation من مجموعة مأذونة؛ تسجل forecasts والنتائج لجمع بيانات
معايرة مستقلة. لا يستخدم `calibrated_decision_value` إلا عندما يثبت evaluator
server-owned المعايرة في scope مناسب من held-out outcomes مستقلة لذلك scope؛
`calibrated_for_scope` يتطلب على الأقل حد الحالات القائم في §25.4 وECE لا يتجاوز
`0.15`، مع فاصل عدم يقين لا يتجاوز حده الأعلى هذا الحد. هذا يفتح اختيارًا محدودًا
داخل scope فقط؛ أما promotion/general transfer فيحتاج كل بوابات §25.4 وG1–G9.
لا تكتسب التوقعات صلاحية من معايرة مشروع أو task family مختلف.

يجب أن تغطي `outcomeDecisionMap` outcome schema المسجل، وأن تربط كل نتيجة بفرع
قرار server-owned. المرشح الذي لا يغير أي قرار لاحق ولا يضيف evidence مطلوبًا
لـobjective لا يعد مفيدًا للقرار ويستبعد مهما كان EIG. لا يختار النموذج
`decisionRef` أو `nextDecisionCode` أو سياسة قيمة الهدف.

تسجل التوقعات النموذجية كـ`MODEL_INFERRED` فقط؛ لا تثبت حقيقة ولا تمنح
authorization. ويجب أن يربط outcome schema صراحةً النتائج غير القابلة للرصد،
وفشل أداة القياس، وتغير البيئة، والنتائج الخارجة عن التوقع؛ لا تتحول هذه الحالات
إلى تناقض ضد hypothesis لمجرد غياب evidence.

يحسب الخادم expected information gain من توزيع Belief server-owned وتوزيعات
outcome المسجلة لكل observation candidate، وفق policy versioned؛ مثلًا:

```text
EIG(a) = H(B) - Σ_o P(o | a) × H(B | o, a)
```

يجب أن تغطي outcome distributions فضاء النتائج المعلن (بما فيه `OTHER/UNKNOWN`
عند الحاجة) وأن يكون مجموع الاحتمالات 1 لكل hypothesis/observation. إذا تعذر
ذلك أو تعذر تقدير التكلفة، لا يرتبها النظام كأنها قياسات كاملة ولا يختارها
تلقائيًا.

بعد التنفيذ، يقارن الخادم النتيجة المرصودة مباشرةً بالتوقع المسجل ويصنفها
`matched` أو `contradicted` أو `inconclusive`. لا يجعل التناقض فرضية منافسة
صحيحة تلقائيًا؛ تحدث Belief من evidence المقبول فقط، وإذا لم تفسر أي فرضية
النتيجة يبقى النموذج غير محسوم ويحتاج فرضيات أو observations إضافية.
لا يحسم الاختبار إلا outcome من `DIRECT_OBSERVATION` أو `SERVER_DERIVED` يحقق
source policy ويكون complete وfresh ومربوطًا بالـenvironment/revision المناسبة؛
لا يمكن لـ`MODEL_INFERRED` أن يمثل النتيجة الفعلية. فشل القياس أو stale/partial
observation أو تغير البيئة يجعل النتيجة `inconclusive` بلا Brier score أو
تحديث belief weights.

### 5.7 Failure Diagnosis

لا يرسل planner رسالة خطأ خاماً فقط:

```ts
type FailureDiagnosis = {
  episodeId?: string;
  actionId?: string;
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
  reasonCode?: string;
  nextActionCode?: string;
};
```

### 5.8 Strategy Candidate

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
    | "discovered"
    | "pending_replay"
    | "replay_passed"
    | "replay_failed"
    | "canary"
    | "promoted"
    | "revoked"
    | "superseded";
};
```

---

## 6. حزم التنفيذ القديمة (Phase 0–9؛ ليست roadmap مستقلة)

> ما يلي تقسيم تنفيذي تاريخي إلى work packages. لا يحدد ترتيبًا أو اعتماديات
> مستقلة؛ المرجع الوحيد لترتيب التنفيذ هو §31، وأولوية الإغلاق الحالية موضحة
> هناك وفي §42.22. عند التعارض، لا تتجاوز هذه الحزم بوابات P0–P14.

## حزمة العمل 0: تثبيت خط الأساس والعقود

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

## حزمة العمل 1: Agent Episode Ledger

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

## حزمة العمل 2: Observation Materialization

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

## حزمة العمل 3: World State للـEngineering Domain

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

## حزمة العمل 4: Effect Observation

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
→ world_changed أو replan_required

UNKNOWN
→ acceptance غير مكتملة
```

### معيار الخروج

لا يمكن لأي mutation مدعومة أن تنتهي بنجاح مثبت دون effect evidence مناسبة.

---

## حزمة العمل 5: Failure Diagnosis وReplan

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

## حزمة العمل 6: Strategy Memory

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

## حزمة العمل 7: Offline Learning وReplay

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

هذه مبادئ موجزة غير حاكمة وليست بوابة أو thresholds إضافية. شروط canary
الرقمية في §25.3، وشروط promotion العامة في §25.4، وأسماء gates في §42.17؛
تحدد §29.6 نتيجة التقييم وانتقال الحالة.

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

## حزمة العمل 8: Capability Composition

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

## حزمة العمل 9: Multimodal End-to-End

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
candidate
→ validation profile
→ before observation
→ validation action
→ after observation
→ effect classification
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
  off | shadow | advisory | enforced

strategyLearningMode:
  off | extract_only | replay | canary

capabilityCompositionMode:
  off | planning_only | sandbox_only | approved
```

### Shadow

يسجل النظام episodes وobservations وeffects، لكنه لا يغير قرار acceptance.
وفي `worldStateMode: shadow` يحسب World State و`worldRevision` كـread model
للتقييم فقط؛ لا يغير planner أو scope أو authorization أو terminal acceptance.
هذا يطابق حدّ الإسقاط الحالي.

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

يبقى gate informational في extraction وreplay والتحليل. يصبح blocking قبل
الاستخدام في project-scoped canary، وفق شروط §25.3، ثم قبل الترقية العامة وفق
§25.4 و§42.17. لا يعوض score إجمالي عن safety gate فاشل.

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

## 13. خريطة PR تاريخية للتجميع — ليست ترتيب التنفيذ الحالي

تحفظ القائمة تقسيمات العمل السابقة ولا تثبت الحالة الحالية أو الاعتماديات.
اتبع ترتيب §31 وحالة التنفيذ المصححة في §42 وسجل التقدم؛ لا تبدأ PR قديمة
لمجرد أنها واردة هنا.

### PR 1: العقود فقط

- `agent-state` schemas.
- exports.
- unit tests.
- لا runtime behavior.

### PR 2: Episode Shadow Ledger

- إنشاء وربط episodes.
- references فقط.
- يجب إغلاق تكامل Mission/Workflow قبل اعتبار Episode integration مكتملة.
- لا تغيير acceptance.

### PR 3: Observation Materializer

- source/runtime/validator/delivery observations.
- provenance والـrevision.

### PR 4: World State Read Model

- facts وworld revision.
- read-only projection.
- تحديد scope وربط world revision بالـproject/environment/observation versions قبل أي
  enforcement.
- لا تستخدم World State كمصدر صلاحية أو كبديل عن acceptance/proof.
- لا replan تلقائي.

### PR 5: Effect Observation لشريحة Candidate Validation

- هذه أول vertical slice مكتملة ضمن نطاق Action/Effect/acceptance الخاص بها،
  وليست إغلاقًا كاملًا لـP3.5–P6؛ ولا يبدأ learning قبل نجاح بوابة الشريحة.
- `candidate.verify` يبدأ Episode authoritative ويستخدم `AgentAction` و`EffectContract`
  server-owned.
- يسجل `ACTION_REQUESTED`، ثم يتحقق من preconditions ويلتقط before observation،
  وينفذ validation، ثم يسجل `ACTION_COMMITTED` ويلتقط after observation لنتيجة
  الـcandidate workspace والتحقق.
- يصنف الأثر ويحفظ effect bundle قبل terminal acceptance، مع binding إلى نفس
  execution/attempt/episode/revision.
- missing/stale/contradicted effect لا يسمح بـ`PROVEN`؛ receipts وacceptance تبقى
  `SERVER_DERIVED`.
- World State projection لهذه الملاحظات يمكن تأجيلها؛ لا تدخل في acceptance gate.

### PR 6: Runtime/Browser/Delivery Observers

- توحيد after-state observers عند recipe node lifecycle مع نفس
  `ACTION_REQUESTED → preconditions → BEFORE_OBSERVATION → execution →
  ACTION_COMMITTED → AFTER_OBSERVATION → verifyAndPersistEffect → existing
  acceptance` seam.
- Runtime after-state يتحقق من session/revision/worker lease، PID، port readiness،
  HTTP health، serving revision، وmarker اختياري؛ لا يكفي `status: running`.
- Browser evidence يحمل source revision وprofile/session identity وartifact reference
  من server-owned validation.
- Delivery after-state يعيد فحص remote branch parent/tree/commit والـoperation marker
  بعد الدفع، بما في ذلك idempotent reconciliation.
- لا تكرار acceptance أو promotion engines، ولا تُستخدم receipts أو provider prose
  كدليل effect مستقل.
- **الحالة الحالية:** `complete`: Runtime/Browser/Delivery تستخدم نفس Gate C effect
  loop، والاختبارات المتكاملة تثبت حفظ effect bundle وربطه بالـacceptance، واستمرار
  الهوية بعد idempotent replay، ورفض remote drift. Runtime يغطي lease loss واختلاف
  revision وworker recovery؛ Delivery يغطي reconciliation بعد فقد receipt. لا يكفي
  provider receipt أو `status: running` كإثبات effect.

### PR 7: Failure Diagnosis

- **الحالة:** `complete` ضمن نطاق التصنيف.
- `diagnoseFailure` يصنف validator/effect/evidence/acceptance من إشارات server-owned،
  بترتيب أولوية deterministic؛ provider prose لا يحدد الـkind.
- reason/next-action codes مقيدة بقوائم معروفة، مع public projection محدود بالعدادات
  والأكواد؛ لا diagnosis عند غياب إشارة معروفة.
- اختبارات taxonomy والتعارض نجحت؛ شغّل كامل ai-orchestrator فنجح 149/151 ملفًا.
  بقي اختبارا forensic evidence integration يعيدان الفشل منفردين (`NONE` بدل `PARTIAL`
  وgeneric excerpt rejection بدل `EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED`)، وهما خارج
  PR 7 ويحتاجان إصلاحًا مستقلًا.

### PR 8: Bounded Replan

- **الحالة:** `complete`.
- `objective-replanning` now requires a validated retryable read/evidence diagnosis
  before invoking its existing, two-target, read-only recovery. The server assigns
  diagnosis from the current evidence gap; provider text cannot open this gate.
- Mission Goal acceptance persists a strict, code-only diagnosis summary. The
  automatic replan coordinator validates the summary, carries it into the new
  `MissionReplanContext`, and blocks malformed, approval-required, or
  non-retryable diagnoses.
- Planner context labels diagnosis as advisory rather than authorization. Existing
  Mission row locking, revision dedupe, automatic-replan budget, dependency-root
  dispatch, and runtime approval gates remain authoritative.
- **التحقق:** ai-orchestrator typecheck و22 اختبارًا مستهدفًا، API typecheck و6
  اختبارات acceptance/auto-replan، ثم restart وفحص health ناجح. آخر تشغيل كامل
  لحزمة ai-orchestrator موثق في PR 7 (مع فشلي forensic integration).

### PR 9: Strategy Candidates وReplay

- **الحالة الحالية: `partial` (2026-09-24).** extraction/storage deterministic
  وidempotent للحلقات المقبولة ذات الإجراء الواحد: episode مغلقة `achieved`،
  acceptance ناجح، Canonical Proof معاد التحقق منه إلى `PROVEN`، وeffect bundle
  متطابق بملاحظات direct كاملة وحديثة على المراجعة نفسها. يبدأ المرشح `discovered`؛
  وبعد دعم حلقتين مقبولتين مستقلتين ينتقل إلى `pending_replay` فقط، ولا يُستهلك
  كـpolicy.
- تسجل أحداث `ACTION_REQUESTED` الجديدة عقدًا server-owned بإصدار وبصمة تشمل
  trigger recipe، preconditions، expected effects، observation profile، وfailure
  semantics. المرشح يحفظ هذه العقود؛ الأحداث القديمة التي لا تحمل العقد تبقى
  غير مؤهلة. لا تقبل الشريحة الحالية traces متعددة الأفعال.
- manifest التحليل version 2 يربط كل paired case بـproject/revision وsource
  episode/execution attempt وacceptance وeffect bundle وبصمة Canonical Proof.
  هذا عقد بيانات فقط: يجب على API server إعادة حساب الإثبات من الصفوف الدائمة؛
  لا تكفي البصمة الواردة من manifest لإثبات المصدر أو القبول.
- API server يعيد حساب source-proof binding لحلقة مقبولة من execution،
  acceptance، effect bundle، والملاحظات المباشرة، ثم يصدر case ID server-owned.
  أي binding وارد يُقارن بهذه الهوية المعاد حسابها؛ هذا لا يسجل case manifest
  ولا يثبت partition/independence، ولا يمثل proof أو receipt لنتيجة replay نفسها.
- يمكن لمالك المشروع تفعيل تسجيل prospective cases، وهو متوقف افتراضيًا. بعد
  تجميد المرشح عند `pending_replay`، لا يُسجل إلا episode مقبول لاحق يطابق
  candidate/action contract والـsource proof؛ تبقى كل حلقات الدعم مستثناة.
  تحفظ الحالة IDs والبصمات فقط، وإيقاف الموافقة يحذف الحالات المسجلة غير
  المعاد تشغيلها. التسجيل لا ينفذ replay ولا يغير حالة المرشح.
- يوجد الآن executor server-owned للحالات المسجلة من partition `held_out`،
  لكنه مقيد حاليًا بوصفة `runtime.start` فقط. يشغّل الحالة في workspace مؤقت
  مع runtime manager معزول، ويتطلب acceptance عاديًا وCanonical Proof مستقلًا
  لنتيجة replay، ثم يحفظ receipt دائمًا محدودًا بالهويات والبصمات. يعيد التحقق
  من الإيصال عند recovery ولا يغير حالة candidate؛ هذا ليس corpus أو دليل
  generalization.
- **المتبقي قبل اعتبار PR 9 مكتملًا:** replay مستقل على current وheld-out
  corpus، توسيع resolver/executor إلى corpus evaluation كامل، cross-project
  fixtures، paired baseline generation، وLearning Delta. التنفيذ الحالي يغطي
  receipt لحالة held-out مسجلة فقط. لا يُسمح بالترقية أو التأثير على planner
  قبل إثبات كل بوابة بهذه الأدلة.

### PR 10: Canary/Promotion وCapability Composition

- canary وrollback/revocation.
- إعادة استخدام promotion path الحالي.
- تركيب primitives بعد نجاح replay والـeffect gates.
- sandbox.
- shadow replay.

### Track لاحق: Multimodal Extension

- لا يدخل في معيار اكتمال Engineering Generalization الأساسي.
- يبدأ فقط بعد ثبات effect/evidence loop ووجود benchmark منفصل.

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

ويجب أن يثبت النظام أيضًا أنه يستطيع:

1. بناء task-scoped world model.
2. تمثيل uncertainty وhypotheses صراحة.
3. اختيار action من capabilities بناءً على الحالة.
4. تسجيل preconditions وexpected effects.
5. مراقبة العالم باستقلال قبل وبعد mutation.
6. تحديد ما تغير فعليًا.
7. فصل observed facts عن derived facts وmodel hypotheses.
8. تشخيص assumptions الفاشلة.
9. إعادة التخطيط بناءً على diagnosis.
10. إسناد مساهمة النتيجة سببيًا، لا زمنيًا فقط.
11. استخراج portable strategies من trajectories المقبولة.
12. اختبار strategies على held-out tasks.
13. نقلها بين المشاريع والبيئات.
14. تركيب capabilities عبر semantic preconditions/effects.
15. promotion وrevocation آمنين.
16. حفظ authorization وownership وevidence وaudit invariants.

لا تعتبر P4 أو P5 مكتملة لمجرد وجود `effectBundle` أو `environmentRevision`.
يجب إثبات independent before/after observation من مصدر الفعل الفعلي، وربطها
بـAction/Episode/revision المناسب، ثم ربط effect verified بـWorld Delta. القبول
يبقى بوابة منفصلة ولا يثبت الملاحظة أو الأثر بذاته:

```text
Contract ≠ Observation ≠ Effect ≠ World Delta ≠ Acceptance
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

ولا يجوز استخدام score واحد لإخفاء فشل correctness أو evidence أو effect أو
diagnosis أو transfer أو revocation gate.

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

## 18. مخطط البيانات: الحالة الفعلية والعقود المنطقية

هذا القسم يلخص الحقول والقيود الحالية ذات الصلة؛ ليس DDL حرفيًا ولا يسرد كل
default أو اسم index. لا يُستخدم لإعادة إنشاء الجداول. المرجع الدقيق هو
`lib/db/src/schema`، وأي تغيير لاحق يحتاج migration إضافية ومراجعة توافق لا
إعادة تطبيق التصميم الأولي.

### 18.1 مبدأ التخزين

تستخدم الجداول الحالية كمصادر أصلية:

- `ai_executions`: control plane.
- `ai_execution_acceptances`: terminal acceptance.
- `ai_execution_evidence_snapshots`: retained proof evidence.
- `ai_missions` و`ai_goals`: durable objectives.
- `events`: project event feed.
- `ai_skill_registry`: promoted executable skills.

تستخدم جداول متخصصة لأن كل نوع من البيانات له lifecycle مختلف. لا يوضع
world state أو learning state في `checkpoint` أو `recipeReceipt`.

### 18.2 جدول `ai_agent_episodes`

ملخص الحقول والقيود الحالية:

```text
id                  text primary key
project_id          text not null → projects.id
execution_id        text not null → ai_executions.id
attempt             integer not null
mission_id          text nullable → ai_missions.id
goal_id             text nullable → ai_goals.id
parent_episode_id   text nullable → ai_agent_episodes.id
project_revision    text not null
environment_revision text nullable
world_revision      text nullable
belief_revision     text nullable
plan_revision       text nullable
intent_kind         text not null
scope               jsonb not null
objective_contract_id text nullable
observation_refs    jsonb not null default []
action_refs         jsonb not null default []
expected_effect_refs jsonb not null default []
observed_effect_refs jsonb not null default []
evidence_refs       jsonb not null default []
state               enum not null
verdict             enum nullable
reason_code         text nullable
next_action_code    text nullable
worker_id           text not null
lease_until         timestamp not null
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
UNIQUE(execution_id, attempt)
UNIQUE(execution_id, idempotency_key)
INDEX(project_id, created_at)
INDEX(worker_id, lease_until)
```

`scope` وreferences مرتبطة بعقد server-owned؛ لا يحسب objective identity من
prompt خام.

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
payload_hash        text not null
actor_type          text not null
actor_id            text nullable
correlation_id      text nullable
created_at          timestamp not null
```

القيود:

```text
UNIQUE(episode_id, sequence)
UNIQUE(episode_id, event_type, payload_hash)
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

يتطلب P7.5/P8، عند التنفيذ، event contract versioned يضيف:

```text
HYPOTHESIS_TEST_REGISTERED
HYPOTHESIS_TEST_RESOLVED
BELIEF_UPDATED
```

يسجل الأول forecast وbelief revision قبل observation request، ويسجل الثاني
الملاحظات والنتيجة الفعلية وBrier score server-computed عند توافر outcome كاملة،
دون تعديل التسجيل السابق. لا يكتب `BELIEF_UPDATED` إلا عند إنشاء belief revision
جديدة وفق evidence policy، ويربط النتيجة بالملاحظة المقبولة؛ هذه الأنواع ليست
ضمن الإصدار الأول الحالي.

### 18.4 جدول `ai_agent_observations`

```text
id                    text primary key
project_id            text not null → projects.id
episode_id            text not null → ai_agent_episodes.id
execution_id          text not null → ai_executions.id
task_scope            text not null default 'project'
environment_revision_key text not null default 'unknown'
kind                  text not null
provenance            text not null default 'SERVER_DERIVED'
observation_role      text not null
source_type           text not null
source_id             text not null
source_version        text nullable
subject               text not null
predicate             text not null
value                 jsonb not null
value_hash            text not null
source_refs           jsonb not null default []
observed_at           timestamp not null
project_revision      text nullable
environment_revision  text nullable
completeness          enum not null
freshness             enum not null
environment_freshness enum not null default 'unknown'
evidence_refs         jsonb not null default []
sequence              integer not null
created_at            timestamp not null
```

القيود:

```text
FK project_id → projects.id ON DELETE CASCADE
FK episode_id → ai_agent_episodes.id ON DELETE CASCADE
UNIQUE(project_id, task_scope, environment_revision_key, environment_freshness,
       source_type, source_id, source_version, predicate, value_hash)
INDEX(episode_id, sequence)
INDEX(project_id, subject, predicate)
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
before_observation_ids jsonb not null default []
after_observation_ids  jsonb not null default []
expected_effects       jsonb not null
status                 enum not null default 'pending'
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
pending
observed
partial
not_observed
contradicted
unknown
```

### 18.6 جدول `ai_world_facts`

يستخدم versioned facts بدلاً من update صامت:

```text
id                    text primary key
project_id            text not null → projects.id
task_scope            text not null default 'project'
environment_revision_key text not null default 'unknown'
subject               text not null
predicate             text not null
value                 jsonb not null
value_hash            text not null
version               integer not null
status                enum not null default 'believed'
source_observation_ids jsonb not null default []
project_revision      text not null
environment_revision  text nullable
environment_freshness text not null default 'unknown'
supersedes_fact_id    text nullable
created_at            timestamp not null
updated_at            timestamp not null
```

القيود:

```text
UNIQUE(project_id, task_scope, environment_revision_key, subject, predicate, version)
INDEX(project_id, task_scope, environment_revision_key, subject, predicate, status)
CHECK(version >= 1)
```

`environment_revision_key` هو مفتاح هوية غير nullable (`unknown` عند غياب
revision)، بينما `environment_revision` الأصلية nullable. لا يخزن كل fact
`worldRevision`؛ يعاد حسابها في projection من نطاق الطلب والحقائق ومراجع
observation. لا يحتوي المخطط الحالي عمود `confidence` أو validity interval.
لا يوجد قيد يمنع تسجيل قيم متناقضة؛ تحفظ الإصدارات وتحدد projection الحالة
وفق project revision.

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

Persisted Episode, Effect, Fact, and Strategy status values use lowercase. Event
type names such as `ACTION_REQUESTED` and `ACTION_COMMITTED` remain uppercase.

### 19.1 Episode state machine

```text
created
  → running
  → paused
  → running
  → verifying
  → completed

running
  → effect_pending
  → running

running
  → needs_replan
  → running

running
  → waiting_approval
  → running

created/running/paused/verifying
  → cancelling
  → cancelled

created/running/paused/verifying
  → blocked أو failed
```

القواعد:

- `completed`, `cancelled`, `blocked`, و`failed` terminal.
- لا يمكن فتح episode terminal.
- resume ينشئ attempt جديداً فقط وفق عقد execution الحالي؛ لا يعيد فتح row
  terminal.
- `needs_replan` ليست terminal إذا كانت الميزانية تسمح بإعادة التخطيط.
- `waiting_approval` لا يستهلك action budget أثناء الانتظار.
- لا يكتب الانتقال إلا worker المالك أو transaction recovery المصرح بها.

### 19.2 Action state machine

تصف هذه الآلة دورة Action/Effect للشرائح الحالية قبل إغلاق P6؛ لذا تنتهي
الشرائح bounded بقبول effect خاص بهدف التنفيذ، لا بادعاء اكتمال World Delta.

```text
PLANNED
  → ACTION_REQUESTED
  → PRECONDITIONS_CHECKED
  → BEFORE_CAPTURED
  → DISPATCHED
  → ACTION_COMMITTED
  → EFFECT_PENDING
  → AFTER_CAPTURED
  → EFFECT_CLASSIFIED
```

من `EFFECT_CLASSIFIED`:

```text
observed      → CONTINUE أو ACCEPTANCE
partial       → READ_MORE أو REPLAN
not_observed  → REPLAN أو INCOMPLETE
contradicted  → world_changed أو blocked
unknown       → INCOMPLETE
```

لا يجوز الانتقال من `ACTION_COMMITTED` إلى `PROVEN` مباشرة في mutation أو
delivery action. `ACTION_REQUESTED` و`ACTION_COMMITTED` أحداث Episode؛ مراحل
capture هي ملاحظات منفصلة وليست event types إضافية.

في دورة P3.5–P6 المستهدفة، تضاف materialization لـWorld Delta وربط revision بعد
`EFFECT_CLASSIFIED` وقبل acceptance. قبول الشريحة الحالية يثبت objective تلك
الشريحة فقط، ولا يحقق DoD للحلقة الكاملة؛ المرجع السلطوي للتسلسل الكامل هو §42.2.

### 19.3 World fact state machine

```text
observed
  → believed
  → confirmed

believed/confirmed
  → superseded
  → retracted
  → contradicted
```

الانتقال إلى `confirmed` يحتاج مصدر server-owned يحقق policy الخاصة بنوع fact.
`observed` هنا observation input، وليس قيمة ضمن enum الحالة المحفوظة للـfact.

### 19.4 Strategy candidate state machine

```text
discovered
  → pending_replay
  → replay_passed
  → canary
  → promoted

discovered/pending_replay/replay_passed/canary
  → replay_failed

canary (بعد المهلة أو عند hard safety failure)
  → revoked

promoted
  → revoked
  → superseded
```

لا يجوز الانتقال إلى `promoted` من provider response أو benchmark aggregate
فقط. غياب البيانات يبقي المرشح `pending_replay`؛ لا يبرر canary ولا يسجل
كفشل replay.

### 19.5 Hypothesis experiment lifecycle

```text
server-owned belief revision + competing hypotheses
  → rank authorized/safe candidate observations
  → register immutable forecasts and selected observation
  → request observation
  → record actual server-owned observation
  → resolve forecast: matched / contradicted / inconclusive
  → append a new belief revision when evidence warrants it
  → continue / bounded replan / remain unresolved
```

لا يبدأ observation قبل حفظ forecast وربطه بالـEpisode/attempt/objective ونسخة
Belief. الملاحظة stale أو partial أو غير الحاسمة تنتج `inconclusive`؛ وإذا لم
تفسر النتيجة أي فرضية فلا يختار النظام أقربها تلقائيًا. لا يثبت forecast أو
prediction-error projection حقيقة في World State، ولا يمنح action authority.
يحفظ result Brier score عند إمكان حسابه، ويشير belief update إلى outcome
والـevidence المقبولين لا إلى score وحده.

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

هذا ترتيب لوزن المصدر عند materialization، وليس ترتيب صلاحيات: acceptance/proof
تبقى `SERVER_DERIVED` ولا تصبح direct observation أو before/after effect evidence.

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

`environmentRevision` هو identity metadata، و`environmentFreshness` وصف لحداثة
هذه الهوية لا لحقيقة أن العملية ورثتها. تطابق Episode snapshot أو launch/
validator handoff لا يثبت أن child process استخدم البيئة نفسها؛ لا يتحول إلى
independent observation أو effect proof دون ملاحظة من execution boundary الفعلي.
لا تعامل `null` أو تعذر attestation كـfresh، ولا تستبدلها ببصمة project/source
مختلفة.

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
3. اجعل projection الحالية `contradicted` أو سجّل conflict غير محسوم.
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

هذا تصنيف لقابلية النقل، وليس بديلاً عن `taskScope` و`environmentRevision`
اللذين يحددان هوية fact الفعلية. لا يمنح التصنيف وحده صلاحية أو تعميمًا؛ النقل
يتطلب replay وheld-out evidence مستقلين.

الافتراضي `PROJECT_LOCAL`. لا تنقل fact بين المشاريع إلا بعد strategy/evidence
evaluation صريحة.

---

## 23. مواصفة Action وEffect لكل المسارات

في المسارات read-only، يعني `Result` النتيجة المحتفظ بها للقراءة؛ لا يعني
`Effect` مصنفًا ولا صف `EffectBundle`. استخدم `Effect` فقط لأثر mutation أو
external effect أو validation معلن كـeffect-gated.

### 23.1 قراءة ملف

```text
Action: READ_PROJECT_FILE
Before: project revision + root identity
After: retained complete read or explicit failure
Result: requested source evidence available
Proof: evidence read binding
Failure: incomplete evidence; no source-grounded claim
```

### 23.2 قراءة تحليلية

```text
Action: ANALYSIS_TOOL
Before: operation/correlation/revision/root
After: complete analysis result with matching correlation
Result: analysis evidence available
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
Result: requested database claim observed
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

لا تدخل strategy `pending_replay` إلا إذا:

```text
supporting accepted episodes >= 2
or
one episode with explicit controlled experiment
```

ولا تدخل `canary` إلا إذا:

```text
replay pass rate >= 95%
zero critical safety failures
zero false PROVEN
held-out improvement or cost reduction
```

`canary` مرحلة تقييم محدودة بمشروع/نطاق، وليست promotion عامة. لا يبدأ canary
عند غياب القياس أو عدم اكتمال replay؛ تبقى الحالة `pending_replay`. أي critical
safety failure أو false `PROVEN` أو scope escape يرفض المرشح ويمنع canary؛ لا
يجوز تحويل hard failure إلى canary لتجربته في بيئة أضيق.

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
pre-registered outcome forecast calibration (ECE): <= 0.15
```

إذا لم تتوفر 3 independent transfer fixtures، تبقى strategy غير قابلة للترقية
العامة وتظل project-scoped.

يحسب ECE من forecasts غير قابلة للتعديل سُجلت قبل التجربة، مقابل outcomes
كاملة ومرصودة server-side في held-out evaluation؛ لا تستخدم provider confidence
ولا توقعات أضيفت بعد ظهور النتيجة. لا تستبعد الحالات الناقصة أو inconclusive
انتقائيًا لتحسين القياس؛ نقص الحالات القابلة للتقييم يبقي التقييم غير مكتمل
ويمنع promotion. لا يمنح هذا القياس proof أو acceptance.
يسجل evaluator نسخة طريقة ECE وoutcome schema المستخدمة، ويطبق الطريقة نفسها
على baseline والمرشح؛ لا تقارن نتائج محسوبة بإعدادات مختلفة.
حدود `held-out cases >= 30` و`independent transfer fixtures >= 3` هي minimums
وليست ضمانًا كافيًا لدقة المعايرة. يثبت split قبل التقييم: للمعايرة scoped
تكون وحدات held-out مستقلة من episodes/missions داخل scope نفسه؛ ولـcross-project
transfer تُحجز projects/fixtures كاملة مع trajectories المرتبطة بها. لا تتسرب
episode أو revision مشتقة من المصدر نفسه بين training وcalibration وfinal holdout.
تعرض النتائج لكل scope/task stratum، مع Brier وECE وفاصل عدم يقين محسوب على
وحدة الاستقلال (episode/mission للمعايرة المحلية، وproject/fixture للنقل). إذا
كان فاصل عدم اليقين لا يسمح بالحكم الواضح على اجتياز الحد القائم، يبقى التقييم
غير مكتمل؛ لا تعدل العتبات الرقمية في §25.4 لتجاوز نقص القوة الإحصائية. بيانات
التقييم النهائي المحجوزة لا تستخدم لضبط forecasts أو selection policy.

لا تعني نتيجة canary نجاح هذه البوابة. promotion إلى live/shared registry يحتاج
كل الحدود الرقمية أعلاه، وG1–G9 في §42.17. أي شرط safety فاشل يمنع الترقية؛
البيانات الناقصة تبقي المرشح غير محسوم ولا تتحول إلى نجاح أو إذن promotion.

### 25.5 Revocation

يجب إبطال strategy إذا:

- ظهرت safety violation واحدة critical.
- زادت false-success.
- ظهرت regression مستمرة في حالتين متتاليتين.
- أصبحت source/capability contract غير متوافقة.
- اكتشفت contradiction غير معالجة.

الإبطال لا يحذف history. يغير الحالة إلى `revoked` ويوقف استخدامها فوراً.

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
episodes running with expired lease
effects pending beyond timeout
observations missing source
facts with broken supersession
strategy canary beyond deadline
```

عند تجاوز canary للمهلة، يوقف reconciliation استخدام المرشح ويكتب transition
`canary → revoked` بسياج ownership وسبب/وقت انتهاء محفوظين؛ لا يمدد المهلة
تلقائيًا ولا يحذف forensic history. بقية reconciliation لا تعيد mutation على
المشروع؛ تعيد observation idempotent أو ترفع حالة blocked/unknown.

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

لكل capability مدعومة، افصل بوابة الاستدعاء والنتيجة عن بوابة إثبات mutation.
كل قراءة read-only تحتاج:

- action/invocation identity ونطاق وrevision server-owned.
- نتيجة complete أو فشل صريح، مع source/evidence references.
- عدم اعتبار اكتمال القراءة إثباتًا لتغيير حالة أو لإنجاز objective.

ولا تتطلب قراءة read-only `EffectBundle` إلا إذا كان لها عقد تحقق صريح، مثل
Candidate Validation. لكل action معدِّل للحالة أو external effect، يلزم:

- before observation موجودة.
- action identity موجودة.
- after observation مستقلة أو explicit unknown موجودة.
- effect contract hash مطابق.
- failure mapping deterministic.
- لا mutation success بلا effect status مقبول من المصدر المستقل.

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

تملك كل بوابة مصدرًا واحدًا للعتبات: شروط دخول canary في §25.3، والحدود الرقمية
للترقية العامة في §25.4، وأسماء G1–G9 في §42.17. لا تنسخ هذه العتبات إلى مواضع
أخرى.

نتيجة التقييم تحدد الحالة دون منح صلاحية promotion:

- نقص evidence أو held-out data يبقي المرشح `pending_replay`.
- فشل replay قبل canary يسجل `replay_failed`.
- اجتياز شروط §25.3 يسمح بـproject-scoped `canary` فقط مع scope وdeadline و
  kill/revocation واضحين.
- فشل replay داخل canary يسجل `replay_failed`؛ أما critical safety failure أو
  false `PROVEN` أو scope escape أو انتهاء المهلة فيوقف استخدامه ويؤدي إلى
  `revoked`.
- promotion عامة تتطلب جميع عتبات §25.4 وG1–G9 في §42.17؛ لا يعوض نجاح canary
  فشل أي gate.

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

هذا هو dependency plan المعتمد. أسماء الأقسام التنفيذية الأقدم في هذه الوثيقة
تبقى مواصفات تفصيلية للوحدات، لكن لا يجوز استخدامها لتجاوز ترتيب الاعتماديات
أدناه. حزم Phase 0–9 في §6 ليست roadmap ثانية. P5.5 ليس عقدة إضافية في هذا
graph؛ هو work package عابر وأول أولوية تنفيذية قبل توسيع تكامل P4/P5.

```text
P0   Contracts / invariants
 ↓
P1   Durable execution
 ↓
P2   Evidence / acceptance
 ↓
P3   World State foundation
 ↓
P3.5 Cognitive Action / Observation Spine
 ↓
P4   Independent Observation and World Integration
 ↓
P5   Authoritative Effect Verification
 ↓
P6   World Delta / Revision Closure
 ↓
P7   World-State Failure Diagnosis
 ↓
P7.5 Belief + Information Gain
 ↓
P8   Diagnosis-Aware / Hypothesis-Aware Replanning
 ↓
P9   Causal Credit Assignment Safety Layer
 ↓
P10  Portable Strategy Extraction
 ↓
P10.5 Agent Capability Self-Model
 ↓
P11  Learning Validation and Transfer
 ↓
P12  Strategy Promotion / Revocation
 ↓
P13  Semantic Capability Composition
 ↓
P14  Multimodal Observation
```

### الاعتماديات

```text
P0 → P1 → P2 → P3 → P3.5
P3.5 → P4 → P5 → P6
P5/P6 → P7 → P7.5 → P8
P8 → P9 → P10 → P10.5 → P11
P11 → P12
P5/P6/P11 → P13
P4/P5/P6/P11 → P14
```

ضمن هذا الترتيب، يبدأ P7.5 بـshadow/fixed-safe-probe أو human-approved
bootstrap؛ ولا يفتح automatic decision-value selection إلا لforecast معاير
ضمن scope مناسب ومربوط بقرار objective؛ يكون EIG عاملًا مساعدًا لا القيمة
الأساسية. يثبت P8 هذه الحلقة في pilot ضيق قبل
توسيعها. يبقى الإسناد السببي المضاد للواقع في P9، ثم تجريد القاعدة والنقل
المقاس في P10/P11، مع held-out split مستقل على مستوى المشروع/الـfixture. لا
يجوز دمج هذه المراحل في ادعاء قدرة واحدة قبل اجتياز بواباتها.

P5.5 Unified Action Semantics هو work package عابر: ابدأ به قبل إضافة مسارات
Action/Effect جديدة، ثم استمر على graph أعلاه دون إنشاء dependency roadmap ثانية.

P4/P5 لها staged closure: independent observations وeffect verification هما
مدخلات لازمة لبدء تكامل P6؛ لكن لا تسجل P4/P5 كـ`done` في الحالة التنفيذية حتى
يثبت P6 ربطها بـWorld Delta قابل لإعادة البناء. هذا handoff مرحلي، لا إعفاء من
ترتيب الاعتماديات ولا circular completion claim.

لا يبدأ التوسع الأفقي في capabilities أو strategy learning بينما P3.5/P4/P5/P6
غير مغلقة. أولوية التنفيذ الحالية هي Unified `AgentAction`، ثم independent
observation وeffect closure، ثم World Delta، ثم World-State diagnosis وBelief/
Information Gain قبل إكمال replanning وcausal credit.

لا يتوسع `P10` ولا يعتبر مغلقًا قبل إغلاق P7.5/P8/P9 وتوفر effects وacceptance
وcausal evidence الموثوقة؛ candidate discovery أو replay infrastructure لا
يحقق ذلك. ولا يبدأ `P12` قبل أن تعمل held-out evaluation وcross-project
transfer وpromotion gates.

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

## 35. سجل قرارات تاريخي — لا يعيد ترتيب التنفيذ الحالي

يحفظ هذا القسم قرارات التصميم السابقة. P0–P2 منفذة؛ لا تستخدم بنود schema هنا
كأوامر لإعادة migration أو كترتيب تنفيذ نشط. المرجع التنفيذي الحالي هو §31
وحالة الإنجاز الفعلية في §42.

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
أن يحتوي `disposition` على projection مختصرة فقط. ينطبق الربط على mutations
والـexternal effects وعلى عمليات التحقق التي تعلن صراحة expected effect، مثل
Candidate Validation؛ لا يتطلب كل read-only call `EffectBundle`.

هذا يصف effect-backed acceptance الحالية لكل شريحة محدودة قبل P6. قبولها يظل
حاكمًا لهدف execution المحدد، لكنه لا يثبت أن World Delta قد materialized ولا
يغلق DoD الكامل لـP3.5–P6؛ انظر فرق slice acceptance وintegrated acceptance في
§42.2 و§42.4.

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

observation_provenance:
  DIRECT_OBSERVATION, SERVER_DERIVED, MODEL_INFERRED

action_risk:
  LOW, MEDIUM, HIGH
```

يجب أن يفرض database وZod معاً:

```text
sequence >= 0
attempt >= 0
version >= 1
```

قيم enum ليست موحدة casing: حالات Episode/Observation/Effect/Fact lowercase،
بينما event types و`kind` و`provenance` وAction risk uppercase. لا يضيف المخطط
الحالي `confidence` إلى World Fact؛ أي confidence لاحق يخص Belief/decision
projection ويحتاج عقدًا منفصلًا. `EffectContract.allowedResult` enum منفصل
ويظل uppercase؛ أما `EffectStatus` المحفوظ بعد التصنيف فيظل lowercase.

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

## 36. حزمة التنفيذ التاريخية: P0 وP1

بدأت هذه الحزمة تاريخيًا بـP0/P1، وهما مكتملتان وفق سجل التقدم. لا تستخدمها
كنقطة بدء جديدة؛ استمر من dependency graph في §31.

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

## 37. سجل بوابة الانتقال التاريخية P1 إلى P2

يسجل النص التالي معيار الانتقال عند إعداد الخطة؛ لا يعيد فتح P1/P2 أو يغيّر
ترتيب التنفيذ الحالي في §31 وحالة الإنجاز في §42.

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

## 38. قيود Pull Request الأول — مرجع تاريخي

هذه قيود نطاق PR الأول في الخطة الأصلية، وليست حظرًا على شرائح التنفيذ الحالية.
لا تستخدمها لتجاوز dependency graph في §31 أو الحالة الفعلية في §42.

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

---

## 41. نتيجة التقييم المعماري وإعادة معايرة التنفيذ

أظهرت المراجعة أن الاتجاه المعماري متوافق بدرجة عالية مع البنية الحالية،
لكن قيمة التعميم لا تثبت بإضافة schemas أو projections أو جداول جديدة. محور
الخطة هو **Effect-backed Generalization**:

```text
accepted execution
→ before observation
→ server-owned action
→ after observation
→ effect classification
→ acceptance binding
→ diagnosis/replan
→ replay-backed learning
```

### 41.1 حدود التوافق مع البنية الحالية

يجب أن تكون الإضافات الجديدة `adapter` أو `projection` أو `materializer` فوق
السلطات الحالية، لا مصادر سلطة موازية:

| المجال | المصدر المالك |
|---|---|
| terminal outcome وPROVEN | `ai_execution_acceptances` وProof |
| durable execution والـleases | `ai_executions` والـworker ownership |
| Mission dependencies وGoal lifecycle | Mission/Goal runtime |
| capability execution | server-owned capability/recipe registry |
| promotion | shadow replay وpaired baseline وpromotion policy الحالية |
| current cross-execution state | World State projection المحدودة |
| context المعروض للنموذج | bounded Context projection |

لا يجوز إنشاء Mission runtime أو Acceptance أو Promotion pipeline ثانية لتحقيق
هذه الخطة. Failure Diagnosis يترجم إلى العقود الحالية، وBounded Replan يربط
`objective-replanning` و`mission-auto-replan` بدل إنشاء state machine موازية.

### 41.2 بوابات الاعتماد الجديدة

لا ينتقل التنفيذ إلى البوابة التالية إلا بعد تحقق السابقة وتسجيلها في سجل
التقدم:

```text
Gate A: إغلاق Episode integration في Chat/Task/Recipe/Mission/Workflow
→ Gate B: Candidate Validation Effect Loop كامل
→ Gate C: Runtime/Browser/Delivery after-state observers
→ Gate D: Diagnosis وBounded Replan
→ Gate E: Strategy extraction وcurrent/held-out/cross-project replay
→ Gate F: canary وpromotion وrevocation
→ Gate G: Capability Composition
```

تظل Multimodal Extension مسارًا لاحقًا منفصلًا، ولا تدخل في معيار اكتمال
التعميم الهندسي الأساسي.

### 41.3 قيود World State وworld revision

World State في هذه الخطة هو read model محدود، وليس مخزن صلاحيات أو بديلًا عن
evidence وacceptance. قبل استخدامه في أي وضع Enforced يجب أن يكون `worldRevision`
قابلًا لإعادة البناء من scope واضح، ويتضمن على الأقل:

```text
project identity
→ project revision
→ environment/runtime revision عند الحاجة
→ relevant observation versions
→ deterministic observation sequence
```

يجب التفريق بين:

```text
project World State projection
```

و:

```text
execution-scoped evidence/effect snapshot
```

ولا يجوز أن تثبت observation من execution أو revision أخرى أثر تنفيذ جديد.

### 41.4 بوابة Effect قبل التعلم

لا يبدأ Strategy Extraction أو أي استخدام حي لـstrategy candidate قبل نجاح
شريحة Candidate Validation كاملة، وتشمل:

- precondition validation.
- before observation.
- action profile server-owned.
- after observation.
- expected/observed effect classification.
- evidence references.
- binding إلى acceptance بنفس execution وattempt وrevision.
- حالات سلبية تثبت `no PROVEN` عند missing أو contradicted effect.

وجود Effect Contract أو جدول effect وحده لا يحقق هذه البوابة.

### 41.5 المقاييس المبكرة

تبدأ القياسات من Effect Loop، ولا تؤجل إلى benchmark النهائي:

- effect completeness.
- false-success rate.
- stale-plan detection.
- replan precision وno-progress rate.
- evidence acquisition cost.
- duplicate/retry idempotency.
- held-out improvement.
- cross-project transfer.
- authorization وscope violations.

لا تعتبر الزيادة في عدد episodes أو strategies دليلًا على generalization.

### 41.6 قرار النطاق

الهدف القابل للإثبات في هذه الدورة هو وكيل هندسي يتعلم من آثار مقبولة ضمن
repository وworkspace وruntime وGit وbrowser وdelivery. لا يشترط هذا الهدف
تفعيل multimodal أو تحميل capabilities جديدة أو تغيير أوزان النماذج.

---

## 42. Cognitive Closure Architecture — المواصفة السلطوية

هذا القسم يعيد ضبط معنى اكتمال المراحل. وجود schemas أو contracts أو جداول
لا يكفي لإعلان أن القدرة تعمل داخل runtime. يجب أن يظهر الفرق بين:

```text
Foundation
    ↓
Cognitive Spine
    ↓
Independent Observation
    ↓
Causal Effect Verification
    ↓
World / Belief Update
    ↓
Diagnosis
    ↓
Replanning
    ↓
Causal Learning
    ↓
Portable Strategy
    ↓
Transfer
    ↓
Safe Promotion
```

### 42.1 P3 — World State Foundation

**الحالة:** `FOUNDATION COMPLETE / COGNITIVE INTEGRATION PARTIAL`

#### المكتمل

- World fact contracts.
- World-state materialization.
- Supersession والتناقضات.
- World revision generation scoped by project/task/environment.
- Current-fact projection.
- task/environment filters في reader وAPI.

#### التكامل المعرفي اللاحق — ليس نقصًا في P3 foundation

- Belief State semantics: مؤجلة إلى P7.5.
- independent observation/provenance من المصدر الفعلي: ضمن P4.
- integration authoritative مع planner: ضمن P8.

`World State` هو read model محدود، وليس مصدر صلاحية أو بديلًا عن
`evidence` و`acceptance`.

### 42.2 P3.5 — Cognitive Action / Observation Spine

**الحالة:** `PARTIAL — implemented vertical slices exist; unified closure across the full agent remains incomplete`

قبل أي learning أو strategy promotion يجب أن تملك كل capability invocation
هوية server-owned مربوطة بـEpisode/attempt وscope/revision. يسجل read-only
invocation النتيجة ومراجع evidence؛ أما mutation وeffect-gated validation
فيستخدمان `AgentAction` الكامل. تمثيل Belief/Hypothesis اختياري حتى P7.5، ولا
يفرض على كل قراءة أو مهمة عادية.

التسلسل التالي هو DoD المستهدف للحلقة الكاملة بعد P6. الشرائح الحالية قد تنهي
قبولًا effect-backed خاصًا بهدفها قبل وجود World Delta؛ هذا القبول صالح لذلك
التنفيذ وحده ولا يحقق DoD لـP3.5–P6 أو يرفع المرحلة إلى `done`. لا يغير P6 قبولًا
سابقًا، بل يضيف ربط World Delta/revision إلى مسار الإغلاق الكامل:

```text
Objective
    ↓
Episode
    ↓
Action / Invocation identity
    ├─ read-only: bounded result + evidence references
    │              (لا mutation EffectBundle افتراضيًا)
    └─ mutation/effect-gated validation:
         ACTION_REQUESTED
         → Preconditions
         → Before Observation
         → Execution
         → ACTION_COMMITTED
         → After Observation
         → Effect Classification
         → World Delta (إغلاق P6)
         → Acceptance
```

#### Definition of Done

لكل mutating agent action:

1. يوجد `actionId` ثابت.
2. يرتبط الفعل بـ`episodeId`.
3. تسجل preconditions.
4. تسجل expected effects.
5. تلتقط before-state observations مستقلة.
6. ينفذ الفعل عبر action profile server-owned.
7. تلتقط after-state observations مستقلة.
8. يصنف الأثر من before/after evidence.
9. تتم materialization لـworld-state delta ضمن إغلاق P6.
10. يشير acceptance إلى effect bundle الناتج للـmutation أو التحقق ذي expected
    effect؛ لا يفرض ذلك على كل read-only invocation.
11. يحفظ كل evidence provenance الخاص به.
12. لا يسمح acceptance بتمثيل نفسه كـdirect runtime observation.

قراءة read-only تحفظ invocation identity ونتيجتها/فشلها ومراجع evidence؛ لا
تحتاج before/after `EffectBundle`. إذا عرّف عقد مسجل validation ذي أثر متوقع،
مثل Candidate Validation على candidate غير live، فهو effect-gated validation
ويطبق عليه عقد الأثر رغم أنه لا يكتب إلى live root. المتطلبات أعلاه هي DoD
للحلقة المغلقة عبر P3.5–P6، ولا تدعي أن الشرائح الجزئية الحالية قد أغلقتها.

#### شرائح تنفيذ جزئية — 2026-09-24

المسارات المباشرة `POST /projects/:projectId/runtime/start`,
`/restart` و`/stop` تستخدم الآن recipes server-owned مستقلة، مع جذر ومراجعة
وaction profile يملكها الخادم، وEpisode وتنفيذ durable، وملاحظات before/after،
وتصنيف أثر، وacceptance مرتبطة بـeffect bundle. لكل فعل هوية capability/effect
منفصلة، وبقيت هوية `runtime.start` السابقة دون تغيير. Restart يتطلب ملاحظة serving
state للمراجعة والجلسة الجديدة. Stop يتطلب ملاحظة terminal مستقلة تثبت موت PID
السابق وإغلاق المنفذ، بعد ملاحظة مباشرة تثبت أن PID السابق حي والمنفذ مستمع قبل
الإشارة، مع تحقق session/revision وتحرير الـlease؛ snapshot الإيقاف وحده لا يكفي.
إعادة الطلب بالمفتاح نفسه تعيد العملية نفسها، وغياب after-state
صالحة يمنع النجاح. في وقت هذه الشريحة كان AI `apply-changes` وTask execution
خارج spine؛ انظر تحديث الدمج اللاحق أدناه. كما أن P4 وWorld Delta لهما إغلاق
مستقل ولا يُستنتجان من هذه الشرائح.

#### عقود دمج مسارات التعديل المتبقية — مراجعة 2026-09-24

**AI `apply-changes`:** يبقى endpoint المباشر نقطة الكتابة الوحيدة لهذه العملية؛
لا ينفذ model/tool أو generic AI recipe promotion. يعاد استخدام بوابات الموافقة
الحالية، exact-subset للـproposal، managed root، isolated delivery workspace،
registered validation، tree/change-set digests، guarded promotion، apply journal،
rollback وrecovery. هذه السجلات والـhashes أساس إثبات مفيد، لكنها ليست بذاتها
`Episode` أو `AgentAction` أو direct observations أو effect acceptance.

عند وصل المسار بالـspine يجب أن يبدأ execution/attempt durable منفصل لكل محاولة
تطبيق، مع `operationId` المستقر كـcorrelation فقط، وهوية proposal/project/revision
والـcandidate hash وapproved paths. بعد قفل المشروع وإعادة فحص الموافقة والاقتراح،
يسجل الخادم `ACTION_REQUESTED` وpreconditions وexpected file/tree effects، ثم
materializes direct before observations للـlive root والملفات المستهدفة قبل
promotion. لا تبدأ أي كتابة إذا فشل إنشاء هوية الإثبات أو الملاحظة.

بعد الترقية أو rollback، يعيد الخادم قراءة live root والملفات مباشرة، ويقارن
النتيجة بالـimmutable candidate وبـbase revision. لا يصدر effect `OBSERVED` أو
نجاح durable إلا عندما تتطابق bytes المرشح والنتيجة، وتثبت الملاحظات نفس
project/attempt/revision/action. فشل validation أو stale root أو rollback ناجح
ينهي المحاولة دون نجاح effect؛ rollback غير المكتمل أو نتيجة غير محسومة تبقى
`PARTIAL`/`UNKNOWN` وتتطلب recovery، ولا يسمح لها بقبول ناجح. يجب ربط effect
bundle بالـacceptance قبل تحويل proposal إلى نجاح نهائي، مع إبقاء apply journal
مصدر التعافي لا مصدر direct observation.

**Task execution:** لا يفرض Action/effect gate على `/tasks/:taskId/execute`
الذي يجري تحققًا read-only، ولا على AI task report الذي ينتهي إلى human review.
ينطبق العقد على Mission tool-loop أو أي task execution profile server-owned
يستطيع تعديل workspace فقط. تحفظ durable execution وlease/checkpoint/resume
الحالية؛ ولكل mutation فعل server-owned مربوط بـtask/goal/phase/attempt/revision،
وملاحظات مستقلة من workspace/candidate قبل وبعد، وeffect bundle قبل قبول
الاكتمال. مخرجات النموذج، progress، task receipt، validator receipt أو تبدل
task status لا تثبت بحد ذاتها أن تغييرات المشروع حدثت.

لا تمنح هذه العقود صلاحية كتابة جديدة ولا توسع generic Mission dispatch أو
strategy replay. تظل أدوات التنفيذ والـcandidate والـroot والنطاق والمراجعة
والـobservation providers محددة من الخادم؛ عند غياب الملاحظة أو فقدان lease أو
تعارض bytes، يبقى التنفيذ غير مكتمل ويستمر التعافي عبر journal/lease القائمين.

#### تنفيذ Apply Changes Action/Effect — شريحة جزئية، 2026-09-24

مسار `POST /api/ai/chat/apply-changes` موصول الآن بعقد
`approved.source-promotion` مستقل عن هويات Runtime وGitHub delivery. بعد تحقق
الموافقة exact-subset، إعداد المرشح المعزول، نجاح validation وثبات tree hashes،
ينشئ الخادم `aiExecution` مستقلًا لكل apply attempt ويطالبه، ثم يبدأ Episode
`APPLY_CHANGES` و`ACTION_REQUESTED`. تسجل ملاحظة مباشرة قبل الكتابة لقيمة
`workspace.tree_hash` في live root، ثم ملاحظة مباشرة ثانية بعد promotion أو
rollback. يربط effect العقدة بالـcandidate tree hash ومرجعَي الملاحظة؛ لا يسمح
`finalizeExecutionAcceptance` بـ`SUCCEEDED` إلا مع effect bundle `OBSERVED`
لنفس execution/attempt، ولا يعيد endpoint النجاح HTTP 200 إذا فشل القبول.
يبقى proposal lifecycle محجوبًا أمام Git commit/push حتى ينجح هذا القبول ثم
تُطلقه خطوة إسقاط لاحقة؛ فـ`proposal.status = applied` وحده يصف وجود البايتات
ولا يثبت قبول الأثر.

يبقى القرار والموافقة والمرشح والـvalidation والكتابة والـrollback في endpoint
القائم؛ لا يختار model أو generic recipe نطاق التغيير ولا تنشأ صلاحية mutation
جديدة. `operationId` هو correlation فقط، بينما دليل المحاولة مربوط بـexecution
وattempt وworker. عند تعارض after observation أو عدم توفرها، يبقى القبول
غير ناجح؛ direct observation الوحيدة في هذه الشريحة هي hash كامل لـlive tree
قبل وبعد، وليست دليلًا مستقلًا لكل ملف.

**حد معروف:** filesystem promotion منفصلة عن journal/proposal transaction،
وهذه الأخيرة منفصلة عن acceptance finalizer. ترتيب التنفيذ يحفظ apply/journal
أولًا ثم acceptance؛ إذا وقع crash بعد promotion أو commit وقبل finalization،
لا يوجد `SUCCEEDED` مستنتج، لكن يلزم reconciliation دائم يميز حالة
applied-but-unaccepted ويغلقها fail-closed. هذه الشريحة لا تدعي ذرية عبر
filesystem وDB ولا تعتبر proposal status أو journal بديلًا عن direct observation.
لذلك بقيت P3.5/P5 جزئية في تلك الشريحة؛ انظر تحديث recovery أدناه. Mission
tool-loop mutation لم يدخل بعد.

#### Restart reconciliation لـapply-changes — 2026-09-24

تعالج `reconcileInterruptedApplyChanges` الحالات المحجوبة بعد restart بقراءة
الجذر المثبت والـcandidate workspace المُدار وتصنيف live tree إلى base أو
candidate أو mixed/unavailable. لا تكتب ملفات ولا تنفذ rollback أو promotion.
يُطلق proposal lifecycle فقط إذا طابق المرشح والـlive tree، وكان execution
نفسه يحمل acceptance `SUCCEEDED` وterminal status مكتملًا، وeffect bundle
`OBSERVED`، وملاحظات before/after مباشرة مرتبطة بالـepisode/attempt، وحدث
`AiChangesApplied` مطابقًا لهوية proposal وoperation وchange set.

غياب أي جزء من هذا الإثبات، أو اختلاف الشجرة، يسجل قرارًا دائمًا
`BLOCKED`/`RECOVERY_REQUIRED` ويترك التعديل للمراجعة اليدوية. ترتيب startup هو
execution reconciliation ثم apply reconciliation ثم legacy delivery
reconciliation؛ وتُستثنى proposals proof-bound من legacy promotion recovery
حتى لا تعيد كتابة bytes. اختبار التكامل يغطي candidate tree بلا قبول (يبقى
محجوبًا ولا تتغير الملفات) ثم قبولًا دائمًا مع lifecycle غير مكتمل (يُستعاد
projection دون filesystem writes). هذا يغلق التعافي التلقائي المثبت فقط، ولا
يدعي ذرية بين filesystem وDB أو takeover لمحاولة منتهية.

#### Mission repair Action/Effect — 2026-09-25

دخل profile `mission_repair` في Action/Effect spine. الفعل server-owned ويرتبط
بـMission وGoal وtask والتنفيذ والمحاولة ومراجعات المصدر والخطة وهوية candidate
والـbase tree hash والمسارات المعتمدة. يلتقط الخادم ملاحظة مباشرة للـlive tree،
ويضع التغيير داخل disposable validation workspace فقط، ثم يلتقط hash candidate
بعد التحقق ويصنف الأثر قبل terminal acceptance. لا يسمح النجاح إلا باجتماع
objective validation الناجح وeffect bundle `OBSERVED` المرتبط بالقبول.

لا يكتب هذا المسار bytes إلى live root ولا يحتفظ ببايتات المرشح بعد تنظيف workspace.
`mission_observe` و`mission_validate` وتقارير Task تبقى خارج mutation-effect gate؛
provider-shaped pending changes لا تمنح profile read-only صلاحية repair. هذه
الشريحة تغلق فجوة `mission_repair` المحددة فقط، ولا تغلق P3.5 أو P4/P5 ككل؛
task/environment-scoped World State وrevision closure ما زالا مطلوبين.

### 42.3 P4 — Authoritative Observation and World Integration

**الحالة:** `PARTIAL`

يجب أن تشمل هذه المرحلة:

- independent observation providers.
- observation provenance.
- monotonic observation sequence.
- relevant fact versions.
- contradiction detection/propagation من ملاحظات مستقلة إلى projection.

task/environment scoping و`worldRevision` filters موجودة ضمن P3؛ لا تعاد
تسجيلها كعمل متبقٍ. ما يزال مطلوبًا إثبات المصدر الفعلي للملاحظة، بما فيه
تأكيد child-process/runtime عندما تتوقف صلاحية handoff attestation. World Delta
وإعادة بنائه يخصان P6؛ ينتج P4 observations/facts المربوطة التي يستهلكها P6.

لا تعتبر environment identity الموجودة عند Episode creation أو receipt-time أو
runtime launch/validator handoff independent observation من البيئة التي استخدمها
child process. هي metadata/attestation لنقطة handoff فقط؛ المطابقة مع
`Episode.environmentRevision` لا تثبت runtime inheritance ولا تسد شرط P4.
`null` أو تعذر capture يظل `unknown`.

ويجب أن يكون:

```text
worldRevision =
  hash(
    taskScope
    + projectRevision
    + environmentRevision
    + relevantFactVersions
    + latestObservationSequence
  )
```

لا يكفي hash للـcurrent facts وحدها، ولا يجوز أن تثبت observation من execution
أو revision أخرى أثر تنفيذ جديد.

#### Scoped World State revision — 2026-09-25

أضيفت شريحة read-only تمرر task scope المشتق من Episode server-owned و
`environmentRevision` إلى observations/facts. يستخدم dedupe وfact grouping
وversion/contradiction keys scope والبيئة معًا؛ ويحتفظ `environmentRevisionKey`
بقيمة identity غير nullable للفهرسة مع إبقاء revision الأصلية nullable. يحسب
`worldRevision` من project، والـscope/البيئة المطلوبة، وهويات وإصدارات facts
ومراجعها، وآخر `(episodeId, sequence)` في كل Episode ضمن القراءة. أضيفت filters
اختيارية إلى reader الداخلي، وظلت القراءة العامة غير المفلترة متوافقة.

أضيفت الأعمدة والفهارس كـschema تغييرات additive دون تغيير أنواع قائمة؛ تبقى
الصفوف القديمة في project scope، ولا يعاد إسنادها إلى task. الاختبارات تغطي
العزل بين task scopes والبيئات، وثبات scope بين محاولتين، وتغير revision عند
تقدم sequence مع ثبات fact المادي. schema apply/check وDB tests وAPI typecheck
و48 اختبار API مركزًا نجحت.
لا يمنح هذا الإسقاط صلاحية أو قبولًا، ولا يغير effect proof أو planner. يبقى
مسار GET العام project-wide، كما لم تُوصل independent authoritative providers
أو freshness الخاصة بالبيئة أو World Delta/propagation؛ لذلك تظل P4 `PARTIAL`.

#### Scoped World State API filters — 2026-09-25

يدعم GET `/projects/:projectId/world-state` الآن `taskScope` و
`environmentRevision` اختياريًا، ويستخدم `environmentRevisionUnbound=true`
للتصفية الصريحة على revision غير المحددة. ترفض الواجهة القيم الفارغة والمكررة
والجمع بين مرشح revision ومرشح unbound؛ وتبقى الطلبات بلا query filters على
السلوك السابق. يظل `requireProjectAccess` سابقًا للتحقق والقراءة، ولا تتغير
أي سلطة acceptance أو planner أو effect.

نجح API typecheck و9 اختبارات مركزة على المسار والقراءة الداخلية؛ أعيد تشغيل
API ونجح البناء وفحص health. لا تغييرات schema. لا تغلق هذه الخطوة P4: ما زالت
مصادر environment revision server-owned وfreshness المستقلة وWorld Delta/
contradiction propagation مطلوبة.

#### Server-owned environment attestation — 2026-09-25

تلتقط بداية Episode الآن `environmentRevision` من بصمة hash لملفات dependency
وlockfiles محددة allowlist، مع profile server-owned يختلف بحسب مسار التنفيذ
(Mission repair، candidate/browser validation، runtime، GitHub delivery أو
approved source promotion) ونسخة Node/platform. تمر كل قراءة عبر
`establishProjectRoot`؛ لا يُقبل root مجهول provenance أو symlink، ولا تُقرأ
`.env` أو `.npmrc`، ولا تُخزن محتويات الملفات.

يُمرر revision من Episode إلى observations ما لم يقدّم receipt بصمة صريحة؛
`environmentFreshness` مستقلة عن freshness القائمة على `projectRevision`.
المطابقة مع لقطة Episode تسجل `fresh`، والمخالفة `stale`، وغياب baseline
`unknown`. لا تدخل الملاحظات stale في World State؛ غياب revision يظل unbound،
أما revision التي يوفرها receipt مع baseline مفقود فتظل في نطاقها مع freshness
`unknown` ولا تثبت أنها تطابق بيئة المحاولة. تحمل facts الإسقاط نفسه، دون تغيير
effect acceptance.
أضيفت أعمدة/فهرس بشكل additive، وتظل القيم القديمة `unknown`.

التحقق: API typecheck، 17 اختبارًا مركزًا (بما فيها استقرار البصمة وتغير
lockfile واستبعاد ملفات الأسرار وsymlink/mismatch)، 18 اختبار DB، وschema
apply/check. هذه بصمة snapshot-attempt وليست تحققًا مستقلًا من البيئة الجارية
بعد التنفيذ؛ يلزم توصيل observation providers ذات مصدر بيئي مستقل، ثم World
Delta وcontradiction propagation، قبل إغلاق P4.

#### Receipt-time environment observation — 2026-09-25

في مسارات Action/Effect التي تملك root محلولًا server-side، يعيد materializer
حساب بصمة البيئة ذات profile الـEpisode عند حدود ملاحظة before/after أو receipt.
لا يُحفظ مسار الجذر. تقارن البصمة المستقلة ببيئة Episode وبأي revision صريح في
receipt؛ المخالفة تسجل `environmentFreshness=stale`، وتعذر الرصد دون revision
صريح يبقى `unknown`. لا تتحول هذه المقارنة إلى project-revision freshness.

`environmentStale` منفصلة عن نتيجة `stale` التي ما زالت تعني stale
`projectRevision`، لأن بعض effect callers تستخدمها لحراسة القبول. الملاحظات ذات
environment freshness stale تُستبعد من World State فقط؛ لا تغير effect proof أو
acceptance. تغطي الاختبارات manifest drift أثناء المحاولة وتعذر receipt-time
capture، إلى جانب ثبات البيئة ومخالفة receipt الصريحة. نجح API typecheck و22
اختبارًا مركزًا؛ أظهر التشغيل الأوسع 9 failures في توقعات status mapping لمسار
Task provider failures (500 بدل statuses المحددة)، وتكررت عند تشغيل ملف route
منفردًا. نجح restart وفحص health.

هذه القراءة تلتقط allowlisted manifests عند materialization، ولا تثبت وحدها
البيئة التي ورثها process فعلي. runtime launch identity وvalidator pre-spawn
identity (42.20–42.21) هما handoff attestations server-owned، وليسا قراءة من
داخل child process ولا independent proof لبيئته الفعلية. تظل P4 `PARTIAL`.
تبدأ P6 بعد جاهزية مداخل P3.5/P4/P5؛ ويظل إغلاق P4/P5 مشروطًا بربط الملاحظات
والآثار بـWorld Delta وcontradiction propagation.

### 42.4 P5 — Authoritative Effect Verification

**الحالة:** `PARTIAL — Candidate Validation, direct Runtime start/restart/stop, Browser/Delivery, direct apply-changes Action/Effect with fail-closed restart reconciliation, and Mission mission_repair candidate effect verification are implemented; Mission candidate bytes remain disposable, and task/environment-scoped observation and broader recovery remain incomplete`

الـacceptances في الشرائح المذكورة هنا effect-backed ومحددة بأهداف التنفيذ
الخاصة بها، وقد تحدث قبل P6؛ لا تدعي materialization لـWorld Delta ولا تغلق
DoD الكامل لـP3.5–P6.

هذا هو التسلسل المستهدف للحلقة الكاملة بعد إغلاق P6. أما الشرائح الحالية قبل P6
فتنتهي بقبول effect-backed خاص بهدفها، كما في Candidate Validation أدناه:

```text
ACTION_REQUESTED
    ↓
PRECONDITIONS_CHECKED
    ↓
BEFORE_OBSERVATION
    ↓
ACTION_EXECUTION
    ↓
ACTION_COMMITTED
    ↓
EFFECT_PENDING
    ↓
AFTER_OBSERVATION
    ↓
EFFECT_CLASSIFICATION
    ↓
WORLD_DELTA (عند إغلاق P6)
    ↓
ACCEPTANCE
```

القيم المسموحة لـ`EffectStatus`:

```text
pending
observed
partial
not_observed
contradicted
unknown
```

`pending` حالة قبل التصنيف؛ بقية القيم نتائج التصنيف.

لا يجوز استنتاج Effect من acceptance وحدها. غياب after observation أو وجود
تناقض يبقي النتيجة غير مكتملة ولا يسمح بـ`PROVEN`.

تستخدم شريحة Candidate Validation الحالية هذا المسار effect-backed قبل
terminal acceptance، من دون World Delta في P6:

```text
ACTION_REQUESTED
    ↓
PRECONDITIONS_CHECKED
    ↓
BEFORE_OBSERVATION
    ↓
VALIDATE_CANDIDATE
    ↓
ACTION_COMMITTED
    ↓
EFFECT_PENDING
    ↓
AFTER_OBSERVATION
    ↓
EFFECT_CLASSIFICATION
    ↓
ACCEPTANCE(effectBundleId)
```

هذا القبول authoritative لهدف Candidate Validation في التنفيذ المحدد، لكنه لا
يثبت World Delta ولا يحقق DoD الكامل لـP3.5–P6.

تسجل observations كأحداث/صفوف مستقلة عن `ACTION_REQUESTED` و`ACTION_COMMITTED`؛
لا يستخدم الترتيب أعلاه commit قبل before observation أو التنفيذ. World Delta
إغلاق مستقل في P6، وليس شرطًا يعاد نسبته إلى كل شريحة effect قائمة.

أصبحت مسارات Runtime start/restart/stop المباشرة موصولة بالـeffect/acceptance
seam عبر recipes مسجلة مستقلة، ولكل منها effect identity متميزة. Stop يثبت
الـterminal state من PID/port السابقين ولا يستنتجه من snapshot. تبقى اختبارات
Gate C الأوسع، بما فيها recovery وlease/reconnect؛ أما Browser/Delivery recipe
seams وRuntime after-state contract فأصبحت server-owned وموصولة بالـeffect/
acceptance seam.

### 42.5 P5.5 — Unified Action Semantics

**الحالة:** `PARTIAL — episode-backed ACTION_REQUESTED writes require the canonical AgentAction; generic recipe/tool invocation coverage remains`

كل capability invocation، بما فيها provider tool calls وread-only calls، يحتاج
هوية server-owned مربوطة بـEpisode/attempt وcapability وscope وrevision، مع
نتيجة/فشل ومراجع evidence. يكفي هذا العقد للقراءة read-only؛ أما mutation
وeffect-gated validation فيستخدمان `AgentAction` الكامل:

```text
actionId
capabilityId
episodeId
scope
preconditions
expectedEffects
authorization requirements
risk
idempotency semantics
observation profile
failure semantics
```

الهدف أن تتبع recipe node وtool call وMission action وexecution node عقد
invocation واحدًا، وأن تستخدم المسارات المعدّلة العقد الكامل نفسه بدل semantics
منفصلة. هذا لا يمنح النموذج صلاحية جديدة؛ تبقى capability registry وauthorization
وprofiles server-owned. القراءة تحفظ result/evidence ولا تنشئ `AgentAction`
الكامل أو mutation `EffectBundle` افتراضيًا.

تتطلب كتابات `ACTION_REQUESTED` الجديدة عبر Episode الآن الفعل الكامل، وتتحقق
من ارتباطه بالحلقة وتطابق aliases الاختيارية. يضيف ledger مراجع الفعل والآثار
المتوقعة من العقد. تشمل التغطية recipe candidate وGate C، إضافة إلى مساري
Mission repair وapproved apply-changes اللذين كانا يحملان الفعل الكامل. يحتفظ
استخراج الاستراتيجية بـ`actionContract`/hash بوصفهما إسقاط تعلم منفصلًا، ويتحقق
من اتساقه مع الفعل. تبقى الأحداث التاريخية ذات الإسقاط المختزل قابلة للقراءة،
وتظل P5.5 جزئية حتى تُغطى جميع recipe nodes وprovider tool calls دون تغيير
حدود الصلاحية.

### 42.6 P6 — World Delta / Revision Closure

**الحالة:** `NOT STARTED`

تغلق هذه المرحلة العلاقة بين effect bundle وworld state عبر:

- materialized world delta مرتبط بـ`actionId` و`episodeId`.
- revision قابلة لإعادة البناء.
- relevant fact versions.
- freshness وenvironment scope.
- رفض delta إذا كان مبنيًا على observation stale أو غير متوافق.

### 42.7 P7 — World-State Failure Diagnosis

**الحالة:** `PARTIAL — provider/validator diagnostics and bounded-replan primitives exist; world-state diagnosis is not implemented`

التشخيص يجب أن يجيب:

- أي assumption فشل؟
- ما world facts المتأثرة؟
- ما expected effect المفقود؟
- ما observations التي تناقض الخطة؟
- ما hypotheses التي ما زالت ممكنة؟
- ما observation التي تميز بينها؟
- هل الخطوة التالية `retry` أو `observe` أو `replan` أو `request approval`
  أو `terminate`؟

Provider failure diagnostics ضرورية، لكنها ليست agent-level failure diagnosis.
لا تغلق `diagnoseFailure` الحتمية وbounded replan هذه المرحلة: المطلوب ربط
الافتراضات الفاشلة بالـfacts المتأثرة والتناقضات والملاحظة الفاصلة في World State.

### 42.8 P7.5 — Belief and Information Gain

**الحالة:** `NOT STARTED`

هذه gate معرفية ذات أولوية قبل توسيع P8–P11 أو زيادة replay/strategy work؛
وجود World State وحده لا يوفر belief أو observation selection.

يجب أن يمثل النظام uncertainty صراحة عبر:

- hypothesis.
- supporting observations.
- contradicting observations.
- confidence server-owned.
- affected objective.
- freshness.
- environment scope.

ويجب أن يختار observation بقيمة القرار المتوقعة أولًا؛ يستخدم information gain
كمقياس مساعد، مع موازنة:

```text
expected objective decision value
information gain
execution cost
risk
authorization
time
```

الهدف ليس تنفيذ المزيد من الأفعال، بل اختيار الملاحظة الأرخص والأكثر أمانًا
التي تميز بين hypotheses الحالية.

#### Definition of Done لـP7.5

1. لكل objective و`hypothesisSetId`، يثبت الخادم أن الفرضيات بدائل متنافية
   وشاملة مع `OTHER/UNKNOWN`، أو يمنع استخدام entropy-based EIG عليها.
2. لكل observation مرشح، يسجل outcome space والتوزيع المتوقع لكل hypothesis
   قبل التنفيذ؛ احتمالات كل توزيع صالحة ومجموعها 1، ومصدر forecast وحالة
   معايرته ونطاقها ومراجعها معلنة.
3. كل مرشح مربوط بقرار أو claim في objective؛ يستبعد المرشح إذا لم تستطع
   outcome مختلفة تغيير الفرع التالي أو إضافة evidence مطلوب.
4. تبقى forecasts غير المعايرة أو الخارجة عن scope shadow/advisory؛ في البداية
   يختار probe ثابت وآمن من الخادم أو observation بموافقة بشرية. لا يستخدم
   `calibrated_decision_value` آليًا حتى يثبت evaluator المعايرة ضمن scope
   مناسب ومستقل على held-out لا يقل عن الحد القائم للحالات في §25.4، مع ECE
   لا يتجاوز `0.15` ولا يتجاوزه الحد الأعلى لفاصل عدم اليقين. هذا يجيز الاختيار
   لذلك scope فقط، ولا يختصر بوابات النقل أو promotion.
5. يحسب الخادم `expectedDecisionValue` من objective policy versioned؛ وبعد
   authorization وrisk/cost/time limits، يرتب المرشحين بالقيمة الموجبة الأعلى.
   يستخدم EIG لكسر التعادل بين قيم قرار متساوية فقط، ثم الكلفة الأقل والمخاطر
   الأقل والوقت الأقصر. غياب objective value قابلة للحساب يمنع EIG من منح
   الاختيار الآلي.
6. إذا لم يوجد مرشح صالح أو لم تكن النتيجة قابلة للرصد، تبقى المسألة unresolved
   أو تنتظر approval؛ ولا ينفذ observation لمجرد أن النموذج اقترحه.
7. يبدأ التكامل الآلي في task family ضيقة واحدة، ولا يتوسع إلى objectives أو
   environments أخرى قبل اجتياز اختبار الحلقة end-to-end.

كل forecast، سواء كان `MODEL_INFERRED` أو `SERVER_DERIVED`، توقع لا observation؛
والتوقع النموذجي لا يصبح evidence. prediction source، belief revision،
candidate rankings والاختيار تحفظ قبل dispatch بحيث يمكن إعادة بناء سبب الاختيار
ومنع تعديل forecast بعد معرفة النتيجة.

### 42.9 P8 — Diagnosis-Aware / Hypothesis-Aware Replanning

**الحالة:** `PARTIAL`

يوجد bounded objective recovery وMission replan يستهلكان diagnosis summaries
server-owned. هذا لا يحقق P8 كاملًا: لا يوجد Belief State مربوط بالخطة، ولا
ترتيب مرشحين بحسب information/risk/cost، ولا hypothesis-aware observation
selection. يبقى P7.5 شرطًا سابقًا لهذا الإغلاق.

مدخلات replanning هي:

```text
World State
+ Belief State
+ Failure Diagnosis
+ Available Capabilities
+ Expected Effects
        ↓
Candidate Plans
        ↓
Information / Risk / Cost evaluation
        ↓
Bounded Replan
```

لا يجوز أن يعيد planner المحاولة نفسها بلا تغير معلل في observation أو
assumption أو strategy، ويجب أن يبقى no-progress guard فعالًا.

عند اختبار hypothesis، يربط P8 الـregistered forecast بالـactual observation،
ويصنف المقارنة `matched` أو `contradicted` أو `inconclusive`. يحدث belief updater
نسخة Belief جديدة من evidence مقبول فقط؛ forecast أو prediction error لا ينشئ
World Fact ولا يجعل hypothesis صحيحة تلقائيًا. النتيجة الناقصة أو stale أو التي
لا تفسرها hypotheses الحالية تبقى unresolved وتدخل bounded replan مع سببها.

#### Definition of Done لـP8

- يثبت مسار pilot واحد عبر task family ضيقة دورةً كاملة: objective/decision
  واضح، forecast مسجل، observation آمن، outcome مستقل، قياس الخطأ، تحديث Belief
  أو إبقاؤه unresolved، ثم continue أو bounded replan.
- لا يبدأ التجريب قبل تثبيت forecast وربطه بـEpisode/attempt/objective وbelief
  revision الحالية.
- يرفض observation التي لا يمكن لنتيجتها تغيير قرار objective أو استيفاء evidence
  مطلوب، حتى إن خفضت entropy.
- لا يستخدم forecast غير معاير أو خارج scope لاختيار observation آليًا؛ يختبر
  fixed-safe-probe وhuman-approved modes قبل فتح calibrated decision-value
  selection للـscope المؤهل.
- يثبت الاختبار أن المرشح المختار يحقق أعلى expected decision value موجبة
  بين المأذونين والآمنين، وأن EIG لا يتجاوز دور كسر التعادل؛ ثم ترجح الكلفة
  والمخاطر والوقت عند تساوي قيمة القرار.
- يثبت أن actual outcome يحدّث belief فقط عبر الملاحظات المقبولة، وأن النتيجة
  المفاجئة أو غير الحاسمة لا تتحول إلى فرضية مؤكدة أو `PROVEN`.
- retry أو resume يعيد استخدام forecast المسجل أو ينشئ اختبارًا جديدًا مسببًا؛
  لا يستبدل forecast قديمًا بعد ظهور النتيجة.
- لا يتوسع runtime إلى task families أو environments أخرى حتى يثبت pilot
  end-to-end دون تراجع أمان أو قبول.

### 42.10 P9 — Causal Credit Assignment Safety Layer

**الحالة:** `PARTIAL / ADVISORY`

يجب فصل:

- action contribution.
- observation contribution.
- validation-only actions.
- redundant actions.
- enabling actions.
- causal effect.
- incidental correlation.

القرب الزمني من النجاح ليس دليلًا كافيًا على السببية:

```text
Temporal proximity is not sufficient evidence of causality.
```

بدأ التنفيذ بتسجيل expected-effect coverage داخل `EFFECT_CLASSIFIED`، باستخدام
نتيجة مقارنة before/after server-owned فقط. هذا القياس advisory؛ لا يثبت السببية.
تظل claim contribution وinformation gain وfailure contribution وredundancy
unknown إلى أن ترتبط بإشارات server-owned المناسبة، ويظل causal attribution
`unproven` دون controlled counterfactual. هذه الشريحة لا تغلق P9 ولا تتجاوز
اعتمادية P7.5 ثم P8.

مقارنة forecast بالنتيجة تكشف خطأ التوقع، لكنها لا تثبت أن action بعينه سبب
النتيجة؛ يبقى الإسناد السببي محكومًا بـcontrolled counterfactual وبوابة P9.

### 42.11 P10 — Portable Strategy Extraction

**الحالة:** `PARTIAL — candidate discovery and narrow replay primitives exist; portable learning does not`

الوضع الحالي:

```text
accepted trajectory
→ project/revision-bound candidate discovery
→ limited registered replay (currently runtime.start)
```

هذا ليس Portable Strategy Learning. مرشح مرتبط بـ`capabilityId` وسياق
project/revision قد يبقى recipe mining إذا لم يُجرّد إلى شروط وأثر قابلين
للنقل. لا توجد بعد abstraction مثبتة أو held-out/cross-project transfer
evaluation مكتملة.

الهدف:

```text
causal trajectory
→ abstract state/effect transition
→ portable strategy
→ held-out validation
→ cross-project transfer
```

يجب أن تتكون strategy من:

```text
trigger condition
+ preconditions
+ abstract state transition
+ expected effects
+ failure branches
+ observation requirements
```

ويجب أن تحفظ شروط applicability وتوزيعات outcome المتوقعة وحدودها؛ لا تنتقل
القاعدة إلى مشروع آخر إذا كانت ملاحظاته خارج outcome space أو scope الذي جرى
تقييمه.

مرشح discovery/replay الحالي لا يثبت هذا التجريد بعد؛ `abstract state
transition` شرط P10 مستقبلي وليس حقلًا في candidate contract الحالي.

لا يجوز أن تكون strategy مجرد:

```text
file X → command Y → command Z
```

يجب على extractor تطبيع trajectories الخاصة بالمشروع إلى relational strategies
قابلة للنقل بين المشاريع والبيئات.

### 42.12 P10.5 — Agent Capability Self-Model

**الحالة:** `NOT STARTED`

يصف self-model:

```text
capability
reliability
supported environments
known failure modes
cost
risk
authorization requirements
learned applicability
evidence quality
```

يجب أن يجيب الوكيل: `What can I reliably do here?`، لا أن يكتفي بقائمة
الأدوات المتاحة.

### 42.13 P11 — Learning Validation and Transfer

**الحالة:** `NOT STARTED`

```text
Training Episodes
        ↓
Strategy Candidate
        ↓
Replay
        ↓
Held-out Tasks
        ↓
Cross-project Tasks
        ↓
Novel Composition
        ↓
Learning Delta
```

لا تعتبر strategy متعلمة لمجرد نجاح replay. يجب أن يثبت التقييم:

```text
performance(new task, learned strategy)
    >
performance(new task, baseline)
```

مع منع leakage، وإبقاء كل نتيجة proof/acceptance خارج تأثير provider prose.

يشمل التقييم forecasts المسجلة قبل التشغيل: تقارن النتائج المرصودة بها على
held-out tasks والمشاريع المستقلة، ويحسب Brier لكل تجربة وECE وفق §25.4. يكون
الـsplit على مستوى project/fixture لا على مستوى turn فقط؛ تعرض المقاييس حسب
scope مع عدم اليقين، وتظل النتيجة غير محسومة إذا تعذر التفريق بين اجتياز الحد
القائم وعدم اجتيازه. أي انتقال غير متوقع أو تسرب أو بيانات تقييم ناقصة يمنع
الترقية أو توسيع applicability.

### 42.14 P12 — Strategy Promotion and Revocation

**الحالة:** `NOT STARTED`

لا تدخل strategy إلى live registry إلا بعد:

- replay مكتمل.
- held-out validation.
- cross-project transfer.
- canary bounded.
- paired baseline.
- promotion decision server-owned.

يجب أن تعمل revocation/rollback دون حذف forensic history.

### 42.15 P13 — Semantic Capability Composition

**الحالة:** `NOT STARTED`

composition يجب أن يعتمد على semantic preconditions/effects وauthorization
وsandbox وshadow replay، لا على concatenation لأوامر أو trajectories محفوظة.

### 42.16 P14 — Multimodal Observation

**الحالة:** `NOT STARTED`

هذا مسار لاحق لا يدخل معيار اكتمال التعميم الهندسي الأساسي قبل إغلاق P3.5 وP4
وP5 وP9 وP11. لا يجوز أن تستخدم multimodal output كبديل عن independent
server-owned observation.

### 42.17 Generalization Gates

لا يجوز promotion إلا بعد اجتياز كل gate:

```text
G1 — Correctness
G2 — Evidence Integrity
G3 — Effect Verification
G4 — Failure Diagnosis
G5 — Held-out Validation
G6 — Cross-project Transfer
G7 — Novel Composition
G8 — Regression Safety
G9 — Revocation Safety
```

لا يستخدم score واحدًا لإخفاء فشل gate منفرد.

هذه gates مطلوبة للترقية العامة إلى registry مشتركة. شروط `canary` وحدودها في
§25.3، والحدود الرقمية للترقية العامة في §25.4، وحالات النتيجة والتعافي في §29.6.
هذه القائمة تحدد gates المطلوبة فقط ولا تنشئ thresholds موازية. `canary` اختبار
مؤقت ومحدود النطاق؛ ليست ترقية عامة ولا تمنح صلاحية تنفيذ إضافية.

### 42.18 General Engineering Agent Definition of Done

هذه قائمة الحالة النهائية المستهدفة، وليست تقريرًا بأن التنفيذ الحالي قد بلغها.
الـacceptances الخاصة بالشرائح المحدودة تثبت أهدافها فقط، ولا تعوض إغلاق P3.5–P6
أو بقية متطلبات هذه القائمة.

لا يعتبر النظام generalized engineering agent إلا عندما يستطيع:

1. بناء world model ضمن task scope.
2. تمثيل uncertainty صراحة.
3. اختيار action من capabilities بناءً على الحالة.
4. تسجيل preconditions وexpected effects.
5. مراقبة العالم باستقلال قبل وبعد mutation.
6. تحديد ما تغير فعليًا.
7. فصل observed facts عن derived facts وhypotheses.
8. تشخيص assumptions الفاشلة.
9. إعادة التخطيط بناءً على diagnosis.
10. إسناد مساهمة النتائج سببيًا.
11. استخراج strategies قابلة للنقل.
12. اختبارها على held-out tasks.
13. نقلها بين المشاريع والبيئات.
14. تركيب capabilities عبر semantic preconditions/effects.
15. promotion وrevocation آمنين.
16. حفظ authorization وownership وevidence وaudit invariants.
17. تسجيل outcome forecasts قبل كل تجربة hypothesis وربطها بـEpisode/objective/
    belief revision، مع حفظها غير قابلة للتعديل، وقصر entropy على hypothesis
    sets متنافية وشاملة.
18. ربط observation بقرار objective ذي أثر ممكن، واختيار الأعلى expected
    decision value من الخيارات المأذونة والآمنة والمعايرة ضمن scope؛ يستخدم EIG
    لكسر التعادل فقط، ثم التكلفة والمخاطر والوقت. وإلا يستخدم fixed-safe
    probe/اختيارًا بشريًا أو يبقى unresolved.
19. مقارنة forecast بالنتيجة المستقلة، وقياس خطأ كل تجربة بـBrier score عندما
    تتوفر outcome كاملة، ثم تحديث Belief من evidence المقبول فقط.
20. إثبات المعايرة المحلية على held-out مستقل ضمن scope باستخدام حد الحالات وECE
    `0.15` القائمين، على أن لا يتجاوز الحد الأعلى لفاصل عدم اليقين هذا الحد؛
    وإثبات النقل العام على project/
    fixture-level held-out وفق جميع حدود §25.4 قبل توسيع applicability أو promotion.
21. اجتياز pilot end-to-end في task family واحدة قبل توسيع الاختيار الآلي إلى
    objectives أو environments أخرى.

ويضاف شرط إغلاق P4/P5: لا يكفي وجود `effectBundle` أو `environmentRevision`.
يلزم independent before/after observation من مصدر الفعل الفعلي، مربوطة
بـAction/Episode/revision المناسبة، ثم World Delta قابل لإعادة البناء. القبول
سلطة منفصلة ولا يثبت observation أو effect.

```text
Contract ≠ Observation ≠ Effect ≠ World Delta ≠ Acceptance
```

لا يبدأ توسيع capabilities أو learning/strategy extraction قبل إغلاق cognitive
spine واعتماديات §31، بما فيها Belief/Information Gain قبل P8/P9/P10.

### 42.19 Contract مقابل القدرة المكتملة

| Capability | Contract | Storage | Runtime | Closed Loop | Generalized |
|---|---:|---:|---:|---:|---:|
| World State | ✓ | ✓ | ✓ | partial | no |
| Observation | ✓ | ✓ | partial | partial in bounded runtime slices | no |
| Action Semantics | ✓ | partial | partial | partial in bounded episode-backed paths | no |
| Effect Verification | ✓ | ✓ | partial across bounded vertical slices | partial | no |
| Failure Diagnosis | ✓ | partial | partial provider-level primitives | no | no |
| Replanning | ✓ | ✓ | ✓ | partial | no |
| Strategy Memory | ✓ | ✓ | no | no | no |
| Credit Assignment Safety Layer | partial | partial | advisory | no | no |
| Strategy Extraction | partial | partial | candidate discovery | no | no |
| Replay | ✓ | ✓ | limited registered runtime.start | no | no |
| Cross-project Transfer | no | no | no | no | no |
| Capability Composition | ✓ | ✓ | partial | no | no |

### 42.20 P4 — Durable runtime launch environment identity (2026-09-25)

Runtime manager يحسب هوية البيئة من allowlisted manifests والـruntime profile
المثبت مباشرة قبل dispatch إلى supervisor أو `spawn` المباشر، ثم يحفظها في
`workspace_runtime.environment_revision` مع هوية الجلسة. تبقى القيمة خلال
recovery، وتُسقط start/restart/stop runners إلى `runtime_receipt` المرتبط بـ
`sessionId`. هذا launch-handoff attestation؛ لا يدّعي قراءة متغيرات البيئة من
داخل child process ولا يحفظ أي قيم منها.

تستخدم عمليات runtime الثلاث profile واحدًا `workspace-runtime` version 2؛
تفاصيل operation لا تغير baseline. عند غياب attestation صريح، يحفظ observation
freshness=`unknown` ولا يستعير بصمة materialization الحالية. معرّف البيئة يظل
مستقلًا عن `projectRevision`، ولا يغير `resultHash` أو predicates التي تقرر
effect proof أو acceptance. أضيف العمود nullable بصورة additive إلى schema
وتحقق schema التطوير باستخدام `pnpm run db:schema:apply`؛ لا تعديل مباشر على
production schema هنا.

التحقق: API typecheck و31 اختبارًا مركزًا في خمس مجموعات، بما فيها استعادة
جلسة runtime، ثبات profile، receipt session binding، وunknown freshness عند
غياب بصمة spawn.

المتبقي في P4: لا تتلقى handoff تأكيدًا مستقلًا من child process. التقاط validator
موثق في الخطوة 42.21؛ workspaces المؤقتة التي يرفضها حد الجذر تبقى unknown.
تبدأ P6 بعد جاهزية مداخل P3.5/P4/P5، لكن يبقى إغلاق P4/P5 مرحليًا حتى يربط P6
الملاحظات والآثار بـWorld Delta وcontradiction propagation.

### 42.21 P4 — Validator spawn environment identity (2026-09-25)

أضيف `beforeSpawn` اختياري إلى bounded-command kernel لالتقاط البصمة من
workspace التحقق الفعلي بعد materialization وقبل إعادة التحقق النهائية من root
وcwd وبدء child process. يحصل المسار على `serverEnvironmentProfile` نفسه الذي
استخدمه Episode المالكة؛ لا تُشتق صلاحية أو profile من provider output.

تنتقل `environmentRevision` nullable عبر ValidationResult العام، و
TaskObjectiveValidatorReceipt، ثم `validator_receipt` Observation/World State.
إذا لم يثبت child spawn أو تعذر attestation، تحفظ القيمة `null` ويظل
`environmentFreshness=unknown`. لا تؤثر على status أو proof أو scope أو
permissions أو acceptance.

حد الجذر الحالي يمنع `/tmp` عمدًا؛ لذلك تبقى بصمة pending-change workspace
المعزول unknown، ولا يجري الرجوع إلى live source root أو candidate identity
كبديل. لا يُفتح استثناء `/tmp` داخل `establishProjectRoot`؛ أي دعم لاحق لهذه
المساحة يحتاج root موثوقًا ومدارًا مستقلًا.

التحقق: API typecheck؛ 44 اختبار API مركزًا عبر أربعة ملفات؛ 11 اختبار bounded
execution؛ `git diff --check`؛ API restart وفحص health بحالة `ok`.

`environmentRevision` هنا server-attested handoff identity فقط. لا تثبت أن
child process ورث البصمة نفسها، ولا تعد independent observation حتى لو طابقت
Episode revision. يظل تأكيد التشغيل الفعلي مسؤولية observation من source العملية.

### 42.22 Roadmap reconciliation — close the cognitive loop first (2026-09-25)

هذا هو توحيد الحالة التنفيذية وترتيب العمل، لا تغيير في الرؤية الأساسية:

- §31 هو dependency graph الوحيد. حزم Phase 0–9 في §6 وPR work packages
  مواصفات تنفيذية تاريخية وليست roadmaps موازية.
- لدى P3.5/P4/P5 runtime integrations حقيقية في مسارات محدودة:
  `Episode → Action → Before → Execute → After → Effect → Acceptance`.
  لا تعني هذه الشرائح أن كل المسارات موحدة أو أن P4/P5 مكتملتان.
- بدأت P5.5 بتوحيد كل كتابات `ACTION_REQUESTED` الجديدة عبر Episode على عقد
  `AgentAction` كامل، مع الحفاظ على projections التاريخية للاستراتيجية
  والتوافق مع استئناف المحاولات القديمة. لا يشمل ذلك بعد كل recipe node أو
  provider tool call؛ لا تزال P5.5 جزئية.
- `effectBundle` و`environmentRevision` وحدهما لا يغلقان P4/P5؛ يلزم
  independent before/after observation من مصدر الفعل الفعلي وربط effect
  verified بـWorld Delta، مع إبقاء acceptance بوابة مستقلة.
- البيئة تحمل identity وfreshness رصديتين؛ `Episode.environmentRevision` لا
  يساوي independent environment observation، والتطابق لا يثبت inheritance داخل
  child process.
- أوقف التوسع الأفقي في capabilities وstrategy learning إلى أن يغلق
  `Unified AgentAction` ثم independent observation وeffect verification وWorld
  Delta. بعد ذلك أغلق P7 وP7.5 (Belief/Information Gain) قبل توسيع P8/P9/P10.
- P9 هو **Causal Credit Assignment Safety Layer**؛ attribution يظل
  `unproven` من دون controlled counterfactual. وP10 candidate extraction/replay
  الحالي لا يساوي portable strategy learning أو cross-project generalization.

ترتيب التنفيذ العملي:

```text
1. Unified AgentAction
2. Independent observation closure
3. Remaining effect-verification closure
4. World Delta
5. World-State diagnosis
6. Belief State + Information Gain
7. Hypothesis-aware Replan
8. Causal Credit Safety Layer
9. Portable Strategy Extraction
10. Held-out / cross-project learning and transfer
```

لا تبدأ phase توسعية أو promotion قبل إثبات بوابات هذه الحلقة.

### 42.23 P5.5 — Canonical action request event contract (2026-09-25)

تتحقق Episode ledger الآن من أن كل `ACTION_REQUESTED` جديد يحتوي `AgentAction`
صالحًا، وأن `episodeId` وaliases الاختيارية تطابق العقد. تُستمد
`actionRefs` و`expectedEffectRefs` من الفعل بدل الاعتماد على كل منتج حدث كي
يمررهما يدويًا. أضيف الفعل الكامل إلى أحداث candidate validation وGate C
مع الإبقاء على `actionContract`/hash كإسقاط منفصل لاستخراج الاستراتيجية.

يبقى تحليل الأحداث التاريخية متوافقًا مع payloads المختزلة؛ وعلى إعادة المحاولة
تُطابق الأحداث بحسب `actionId` مع التحقق من عدم إعادة استخدام الهوية بدلالات
مختلفة. لا يتغير authorization أو approval أو scope أو dispatch أو acceptance،
ولا ينشئ هذا العقد أي صلاحية. شملت validation API typecheck، واختبارات عقد AI
(9)، Episode ledger/recipe (20)، وtask execution/Mission (26)، ثم API restart
وفحص health و`git diff --check`.

هذه خطوة جزئية في P5.5 وليست توحيدًا لكل capability invocation. ما زال يلزم
تحديد/إرفاق حدود Episode موثوقة بمسارات recipe nodes وprovider tool calls
المتبقية، بعد التحقق server-side من manifest والصلاحيات القائمة، قبل توسيع
Action/Effect integrations.

# EngineeringOS — Agent Core Forensic Status Report

- **تاريخ التدقيق:** 2026-10-02
- **المنهج:** مراجعة الكود ومسارات التنفيذ والاختبارات الحالية؛ الوثائق السابقة سياق للنية فقط، وليست دليل تنفيذ.
- **النطاق:** E1–E8، مع فصل الأدلة الساكنة عن الاختبارات التي شُغّلت وعن المسارات غير المثبتة.
- **النتيجة المختصرة:** `NOT READY` للانتقال إلى Learning / Transfer / Generalization.

## 1. Audit Basis

- أُعيد فحص الادعاءات السابقة في مسارات الأدوات، التنفيذ، `PROVEN`، World State، والتخطيط. لم تُعامل أسماء الملفات أو وجود الاختبار كدليل على إغلاق invariant.
- التصنيفات هنا scoped: `IMPLEMENTED` يعني وجود سلوك في مسار محدد؛ `TESTED` يعني وجود test؛ `INTEGRATION-TESTED` يعني أن اختبار تكامل يغطي المسار المحدد؛ ولا يعني أي منها `ARCHITECTURALLY-CLOSED` عبر كل الأسطح.
- فُحصت مسارات الكود والاختبارات المشار إليها أدناه. لا يدعي هذا التقرير أن كل writer أو كل مستهلك عابر للحزم قد جُرد بالكامل؛ الحالات التي لم يثبت اكتمالها مصنفة `UNKNOWN`.
- تحققات ديناميكية مسجلة على شجرة العمل نفسها في 2026-10-02:
  - `cd artifacts/api-server && pnpm exec vitest run src/lib/ai-execution-retry.integration.test.ts src/lib/ai-execution-acceptance.test.ts src/lib/proof-foundation.test.ts src/lib/skill-candidate.test.ts` — 4 ملفات، 39 اختبارًا ناجحًا.
  - `cd artifacts/api-server && pnpm exec vitest run src/routes/ai.test.ts -t 'accepts a Mission-linked apply through D2 and dispatches its successor'` — الاختبار المستهدف ناجح.
  - `pnpm --filter @workspace/api-server run typecheck` و`git diff --check` — نجاح.
- لم تُشغّل اختبارات الحزم الأخرى أثناء هذا التدقيق، ولم يُشغّل مزود حي أو تحقق release/process-recovery؛ لا توجد هنا مطالبة بـ`PRODUCTION-PATH-VERIFIED`.

## 2. Executive Verdict

الموضع الحالي هو **C — execution/evidence-capable agent core على مسارات محددة**، وليس D (closed-loop engineering agent core) أو E (general-agent-ready core). قُيّدت واجهة الحزمة العامة في E1 وأُبقيت واجهتان خادميتان داخليتان لمستدعيات محددة؛ لكن دورة التنفيذ ليست مثبتة عبر كل أسطح التغيير، و`PROVEN` ما زالت قيمة مشتركة بين دلالات مختلفة، كما أن تغيّر World State لا يثبت عمومًا تغيّر قرار المخطط.

**الحكم:** `NOT READY`. لا يبدأ Learning / Transfer / Capability Composition قبل إغلاق الاعتماديات الدنيا المبينة في الأقسام 13–17.

## 3. Current Architectural Position

| القدرة | الحالة الحالية | ما تثبته الأدلة | ما لا تثبته |
|---|---|---|---|
| Reliable Tool Agent | `PARTIAL` | dispatcher مركزي؛ أزيلت raw executor functions من package root، وحُصر server-internal subpath في مستدعيين خادميين معروفين | ضمانات الوقت/الإلغاء/replay/حدود الذاكرة لكل executor لا تزال غير مكتملة |
| Reliable Execution Agent | `PARTIAL` | executions دائمة، attempts وleases وcheckpoints وacceptance/recovery في المسار المركزي | lifecycle موحد لكل mutation surface أو إعادة بناء نتيجة الأثر الخارجي بعد crash |
| Evidence-Grounded Agent | `PARTIAL` | `proof-foundation.ts` يتحقق من سجل Canonical Proof؛ الاختياري لا يصبح Canonical Proof | أن كل قيمة `PROVEN` في النظام تمر بهذا verifier أو أن كل claim مقفول عبر كل المسارات |
| Closed-Loop World Agent | `PARTIAL` | مساران محددان لـ`runtime.start` و`apply-changes` يmaterializeان World State/transition بشروط | delta مكتملًا لكل mutation أو planner عامًّا يتغير قراره بسبب facts جديدة |

## 4. Reliable Tool Agent

### 4.1 Confirmed

- `lib/ai-orchestrator/src/tool-operational-registry.ts:99-105,417-438` يحتوي metadata تشغيليًا وفحوص duplicate/missing definitions؛ و`tool-policy.ts:50-80,157-175` يبني التعريفات والسياسة.
- `tool-execution-engine.ts:1093-1273` يطبق membership/argument/mode/approval/scope checks في `executeSingleTool`. مسار المحادثة يستدعي `executeToolLoop` و`executeScopedReadTool` من `agents/chat-agent.ts:179-183,7914-7949,9231-9257,9631-9653`; ويصل المسار scoped-read إلى `executeSingleTool` في `tool-execution-engine.ts:1991-2006`.
- `execution-kernel.ts:52-121,140-173,190-245` يطبق احتواء cwd، timeout، حدود خرج، `shell:false`، وإيقاف مجموعة العملية في مسار الأمر المحدود.
- أزيلت `runBoundedCommand`, `executeCommandTool`, `runRegisteredCommand`, `executePackageTool`, `executeBinaryTool` من barrel العام `src/index.ts`. بقيت primitive الخادمية في `@workspace/ai-orchestrator/server-internal/execution`، ولا يستهلكها حاليًا إلا `routes/ai/chat.ts` لحقن runner موثوق في dispatcher و`ai-repair-validation.ts` لمسارات تحقق خادمية ذات allowlist ثابتة. يحدد `package.json` subpath صراحةً، واختبار AST يثبت عدم عودة الأدوات الخام إلى barrel أو إضافة مستدعٍ خادمي ثالث.
- الحالة: central dispatch وpackage import boundary `TESTED` لمصادر TypeScript الحالية؛ أي ingress غير TypeScript/runtime خارج هذا الفحص يبقى `UNKNOWN`.

### 4.2 Partial

- بعض metadata يصرح بحدود `unspecified` أو runner-defined/delegated في `tool-operational-registry.ts:181-203,308-379`. وجود metadata لا يثبت أن runner مفوضًا يفرض timeout/cancellation/limits.
- ربط كل استدعاء بـEpisode/execution/revision وتسجيل audit دائم لكل executor لم يثبت على جميع الأدوات: `PARTIAL / UNKNOWN`.

### 4.3 Bypasses

| المسار | الدليل | ما يتجاوزه | الحالة |
|---|---|---|---|
| raw execution functions من package root | كانت exports في النسخة المدققة أوليًا؛ أزيلت الآن من `index.ts`. `package.json` يتيح فقط `server-internal/execution` بمحتوى صريح | لا يملك المستهلك العام مدخلًا مباشرًا إلى raw tool executors | `FIXED + TESTED` لواجهة الحزمة الحالية |
| server-internal command helpers | `chat.ts` يمرر `runRegisteredCommand` إلى dispatcher؛ `ai-repair-validation.ts` يستعمل `runBoundedCommand` مع `allowedCommands` ثابتة | لا تتجاوز manifest/approval في مسار أداة المحادثة؛ تحقق الخادم مستقل عن tool-call من النموذج | مستدعيات حاليّة محصورة واختبار allowlist؛ لا تُعامل كـmodel-call ingress |
| raw file/Git في `chat-agent.ts` | الادعاء السابق قديم: لا استدعاء فعلي لـ`executeFileTool`/`executeGitTool`؛ الموجود تعليقات فقط. dispatch المحادثة يمر عبر `executeToolLoop` أو `executeScopedReadTool` ثم `executeSingleTool` | لا يوجد bypass مثبت في هذا الملف الحالي | الادعاء `FALSE / OUTDATED` |
| raw file/Git/command/package/binary داخل orchestrator | `tool-execution-engine.ts:1380-1405` يستدعيها داخل dispatcher؛ الاختبار الساكن يفحص هذه الأسماء في ملفات orchestrator الإنتاجية | لا يشمل كل لغات/مخرجات runtime خارج ملفات TS | `TESTED` لشجرة المصدر الحالية |

### 4.4 Tests

ملفات تغطي policy، engine، file/Git، kernel، package/binary، analysis، وtool surface موجودة. شُغّل `reliable-tool-agent-100.test.ts -t 'canonical executor dispatcher boundary'`: **4/4** اختبارات ناجحة؛ وتشمل فحص الاستدعاءات الخام، غياب raw functions من package root، وحصر مستهلكي server-internal subpath في API callers المعتمدين. شُغّل كذلك `ai-repair-validation.test.ts`: **15/15**، مع Orchestrator وAPI typechecks ناجحين. هذا يغلق سطح الاستيراد الحالي في workspace، ولا يثبت الضمانات التشغيلية لكل executor.

### 4.5 100% Gate

**E1 package-boundary gate: `DONE` للمصادر الحالية.** لا raw command/package/binary executor من barrel العام؛ كل model tool call داخل orchestrator يخضع لاختبار dispatcher؛ والـserver-internal imports محدودة إلى runner injection في chat ومسارات validation الخادمية الثابتة. يبقى Reliable Tool Agent ككل `PARTIAL`: ضمانات الذاكرة/timeout/cancellation/replay وrunner delegation ليست ضمن إغلاق E1.

## 5. Reliable Execution Agent

### 5.1 Execution Control Plane

- `createAiExecution` في `artifacts/api-server/src/lib/ai-execution-state.ts:1839-2058` ينشئ request/checkpoint/attempt بهوية دائمة.
- `claimAiExecution` في `:2542-2646` يثبت worker وlease؛ و`checkpointAiExecution` في `:2648-2709` يفحص attempt والworker/lease ويقدم sequence/version.
- `finalizeExecutionAcceptance` في `artifacts/api-server/src/lib/ai-execution-acceptance.ts:2003-2179` يكتب acceptance والإسقاطات الطرفية ذات الصلة داخل transaction للمسار المركزي.
- `reconcileAiExecutions` في `ai-execution-state.ts:3585-3667` يستعيد الإلغاء والـexpired lease كـinterrupted/paused/failed أو recovery-required؛ لا يستنتج نجاح أثر خارجي من checkpoint وحده.
- يوجد استثناء مقصود لا يمثل acceptance: `terminalizeP75MeasurementContinuationEpisode` في `agent-state/agent-episode-ledger.ts:1284-1318` يضع execution `completed` مع checkpoint يصرّح `createsAcceptance:false`، ويغلق Episode/يطلب replan. استدعاؤه في `recipe-operation-runner.ts:2119-2170` مربوط ببوابة collection. هذا terminalization observation-only محدد، لكنه يمنع الادعاء أن كل `completed` مصدره `finalizeExecutionAcceptance`.
- النتيجة: بنية دائمة قوية ومحدودة؛ وحدة authority النهائية لكل المسارات `PARTIAL`.

### 5.2 Mutation Surfaces

| السطح | مداخل ظاهرة في الكود | الحكم على تقارب lifecycle الكامل |
|---|---|---|
| chat/task | `routes/ai/chat.ts`, `routes/ai/tasks.ts`, `lib/task-execution-service.ts` | control-plane موجود؛ إغلاق كل call paths `UNKNOWN` |
| structured task | `lib/structured-task-execution.ts`, `lib/task-execution-service.ts` | `UNKNOWN` عالميًا |
| workflow/recipe | `routes/workflows.ts`, `lib/workflow-phase-execution.ts`, `lib/recipe-operation-runner.ts` | إثبات مراحل محدود؛ ليس دليلًا على جميع mutation paths |
| Mission/repair | `lib/mission-runtime.ts`, `lib/agent-state/mission-repair-effect.ts`, `mission-repair-tool-action-ledger.ts` | fences وAction/Episode موجودة لمسارات محددة؛ التقارب العام `PARTIAL` |
| runtime/apply changes | `routes/runtime.ts`, `runtime-start-transition.ts`, `apply-change-reconciliation.ts`, `apply-change-effect.ts`, `routes/ai/chat.ts` | مسارات انتقال محددة قابلة للتتبع؛ لا تثبت universal lifecycle |

### 5.3 Crash Windows

الترقيم التالي يطابق تعريف الطلب؛ لا توجد أسماء W0–W9 داخل النظام نفسه، لذا هذا ربط تحليلي لا invariant مسمى في code.

| النافذة | ما يمكن استعادته من DB | حد المعرفة / retry |
|---|---|---|
| W0 قبل action | queued request/attempt إذا اكتمل `createAiExecution`؛ لا أثر يفترض من ذلك | سجل الطلب لا يثبت أن كل executor لم يبدأ؛ retry آمن فقط إذا كان عدم dispatch معلومًا |
| W1 بعد intent | checkpoint أو Episode action intent إذا سجّله السطح | intent لا يثبت وقوع الأثر؛ دوام intent قبل كل executor `UNKNOWN` |
| W2 أثناء الأثر | lease وآخر checkpoint وربما action marker | الأثر الخارجي قد يكون غائبًا/جزئيًا/مكتملًا؛ إعادة التنفيذ قد تكرر الأثر ما لم يوجد idempotency/reconciliation خاص. أُغلق الآن مسار Mission tool-loop الذي كان يحول marker `started` لأداة replay-blocked إلى نتيجة نجاح اصطناعية؛ بقية الأسطح ما زالت غير محصورة |
| W3 بعد الأثر وقبل اكتمال الملاحظة | لا يمكن إثبات الأثر الخارجي من DB إن لم تُحفظ ملاحظة/effect | الحالة uncertain؛ reconstruction من DB وحدها غير كافٍ |
| W4 قبل after-observation | نفس غموض W3 | لا يوجد إثبات crash-injection شامل عند هذه النقطة |
| W5 بعد observation | observation الدائمة، provenance، freshness، scope قابلة للقراءة إن تم commit | observation تثبت predicate المرصود فقط، لا acceptance أو اكتمال objective |
| W6 قبل effect persistence | قد توجد observation دون EffectBundle/credit | حدود atomicity الدقيقة لكل سطح وcrash test عندها `UNKNOWN` |
| W7 بعد effect | bundle/refs/verdict المحفوظة قابلة لإعادة القراءة | effect ليس acceptance؛ لا يثبت وحده terminal success |
| W8 قبل acceptance | قد يكون effect محفوظًا والقبول غائبًا | يمكن تمييز السجلين إن استُعلما؛ سلامة recovery/finalize لكل سطح `UNKNOWN` |
| W9 بعد acceptance | transaction المقبولة والإسقاطات الدائمة قابلة للاستعادة | قد يضيع response بعد commit؛ يمكن للعميل إعادة القراءة، لكن response-loss coverage المحدد `UNKNOWN` |

**الخلاصة:** DB يعيد بناء الحالة المسجلة، لا الحقيقة الفيزيائية لحدث في W2–W4 لم تُحفظ له ملاحظة/أثر. توجد اختبارات لحدود محددة (`effect-observer.test.ts`, `runtime-start-transition.test.ts`) لكن لا توجد أدلة على crash injection لكل W0–W9.

### 5.4 Recovery

الإلغاء والـlease expiry/recovery موصولان في `ai-execution-state.ts:3500-3667`. checkpoints تساعد على الاستئناف ولا تمنح acceptance. في Mission tool-loop، marker حالته `started` لأداة مصنفة `block_after_prior_marker` يفشل الآن كـ`mission_tool_outcome_uncertain` غير قابل لإعادة المحاولة قبل استدعاء provider؛ تظل إعادة قراءة الأدوات المصنفة `safe_to_replay` وسلوك markers المكتملة كما كانا. كما أن إسقاط chat/detail لا يستنتج `SUCCEEDED` من `execution.status=completed` عند غياب acceptance المطابقة للمحاولة؛ يعرض `UNKNOWN` و`ACCEPTANCE_MISSING`، وتبقى P7.5 observation-only دون acceptance أو تغيير في lease/cancellation/scope/replan fences. هذه تحسينات محددة وليست مصالحة مادية عامة: الأثر الخارجي الذي وقع ثم تعطل قبل observation يظل uncertain على بقية الأسطح، وعند غياب الدليل لا يجوز افتراض success أو retry غير idempotent.

### 5.5 Acceptance

`finalizeExecutionAcceptance` هو authority للمسار المركزي للقبول، لكنه ليس الكاتب الوحيد لحالة execution terminal بسبب terminalization observation-only أعلاه، ولا تثبت الأدلة الحالية تقارب كل surface إليه. إسقاطات chat/detail وexecution progress تميز الآن `completed` عن قبول النتيجة: لا تعلن `SUCCEEDED` دون acceptance مطابق، ويظل الجرد والتحقق عبر كل المستهلكين غير مكتمل.

### 5.6 100% Gate

جرد كل writer وكل mutation surface؛ بيان typed ومستهلك لكل terminal state؛ إثبات stale-worker/cancel fences وidempotency؛ واختبارات crash/race عند كل حدود الفعل/الملاحظة/effect/acceptance، مع reconciliation مستقل للأثر الخارجي أو حالة uncertain قابلة للاستئناف.

## 6. Evidence-Grounded Agent

### 6.1 Evidence Pipeline

- `buildExecutionProofProjection` في `artifacts/api-server/src/lib/execution-proof.ts:119-152` يبني projection من parameters؛ ليس verifier. `parseExecutionProofProjection` عند `:154-204` يتحقق من الشكل ولا يعيد فحص provenance.
- `normalizeEvidenceSnapshot` في `ai-execution-acceptance.ts:1361-1381` لا يحوّل اكتمال القراءة وحده إلى `PROVEN`؛ غياب verdict يبقى `NOT_RECORDED`. الاختبار `ai-execution-acceptance.test.ts:40-75` يثبت عدم الاستدلال من source reads/valid artifact دون verdict.
- flag الدائم `evidenceRequired` يُشتق من request proof requirement أو explicit evidence contract في `ai-execution-acceptance.ts:1521-1594` ويُحفظ مع disposition عند `:1918-1975`.
- صف `evidenceRequired=0` يعرض `NOT_REQUIRED` حتى لو احتوى legacy serialized projection على `PROVEN`؛ وعند required proof لا يمر projection اختياري كـ`PROVEN` (`ai-execution-acceptance.ts:1063-1180`). هذا محدد بالاختبار `ai-execution-acceptance.test.ts:463-512`.

### 6.2 All PROVEN Producers

| Producer/المعنى | المصدر | الحكم |
|---|---|---|
| Execution proof projection | `execution-proof.ts:119-152` | يخرج `PROVEN` للنجاح المطلوب مع اكتمال evidence فقط؛ projection منفذ وليس سلطة إثبات مستقلة |
| Canonical proof | `proof-foundation.ts:163-170,183-346,378-408`؛ loader عند `:450-545` | verifier خادمي يفحص durable execution/acceptance/evidence/plan/revision/scope/delivery للـpath المؤهل |
| Workflow phase | `workflow-phase-execution.ts:34-71,155-196` | يمرر `evidenceVerdict:"PROVEN"` و`proofRequired:true` كإثبات مرحلة server-owned؛ لا يساوي وحده إكمال Goal/Mission. الإكمال النهائي يمر عبر `loadCanonicalProof` في `ai-execution-acceptance.ts:780-844` |
| Task/recipe/Mission/apply/replay projections | `task-execution-service.ts`, `recipe-operation-runner.ts`, `mission-runtime.ts`, `routes/ai/chat.ts`, `shadow-replay.ts` | تظهر statuses باسم `PROVEN` بعقود محلية مختلفة؛ equivalence أو canonicality عبر كل consumers `UNKNOWN` |

**عدد المنتجين العالمي الكلي:** `UNKNOWN`؛ لم يثبت اكتمال جرد كل assignments/defaults/serialization في الحزم والمسارات كلها. لا يجوز عد كل سلسلة `PROVEN` كإثبات من النوع نفسه.

### 6.3 Canonical Authority

الإجابة الثنائية عن وجود سلطة واحدة لكل استعمال عالمي للوسم `PROVEN`: **NO**. يوجد verifier Canonical Proof محدد في `composeCanonicalProof`/`loadCanonicalProof` (`proof-foundation.ts`)، بينما workflow phase وtask/recipe/report/replay تحمل statuses أخرى بالاسم نفسه. `execution-proof.ts` ليس authority: هو builder/parser لإسقاط acceptance.

Canonical verifier يرفض `evidenceRequired=false` (`proof-foundation.ts:274-276`) ويتحقق من روابط execution/acceptance/evidence/plan/revision. لكن تطابق candidate/revision في بعض metadata مشروط بوجود القيم، وscope المتوقع للcandidate اختياري في بعض الاستخدامات؛ الشمول عبر كل producers `PARTIAL`.

### 6.4 Claim Closure

`acceptedClaimRefs` لا يُحفظ إلا مع نجاح evidence المكتمل و`PROVEN` (`ai-execution-acceptance.ts:1926-1936`). توجد اختبارات objective/claim/source revision في `ai-execution-state.test.ts:236+`، لكن هذا لا يثبت إغلاق جميع claims في جميع APIs/reports/recipes. هل يمكن لـclaim واحد من N أن يرفع النتيجة العامة في كل الأسطح؟ `UNKNOWN` من الأدلة التي جرى تتبعها.

### 6.5 False PROVEN Paths / Recheck of Prior Claims

| الادعاء السابق | الحكم الحالي | الدليل/الحد |
|---|---|---|
| `chat-agent.ts` يستدعي file/Git executor مباشرة | `FALSE / OUTDATED` | يدخل عبر tool loop/scoped-read ثم dispatcher؛ exports منخفضة المستوى في مواضع أخرى تظل سطحًا منفصلًا |
| complete read → `PROVEN` | `FALSE / OUTDATED` للمسار المفحوص | verdict المفقود يبقى `NOT_RECORDED`; اختبار acceptance يمنع الاستدلال من القراءة وحدها. لا تعميم على كل status غير canonical |
| `execution-proof.ts` هو verifier | `FALSE / OUTDATED` | projection builder/parser؛ canonical verifier في `proof-foundation.ts` |
| workflow phase يمرر `PROVEN` | `CONFIRMED` كـphase-local verdict | helper يمرر القيمة، لكن goal completion النهائي gated بالـCanonical Proof؛ لا يوجد test مخصص للتمييز في helper |
| اختياري evidence يمكن أن يصبح canonical proof من legacy projection | `FALSE / OUTDATED` في المسار المفحوص | durable flag يحول legacy `PROVEN` إلى `NOT_REQUIRED`، canonical verifier وإغلاق Episode يرفضان flag=0 |

### 6.6 100% Gate

يلزم جرد producer/consumer كامل للـ`PROVEN`، وفصل type/contract بين phase-local status وCanonical Proof، وتثبيت verifier خادمي واحد لكل قبول canonical، وربط claims وscope/revision/candidate بمتطلبات كل surface، ثم تغطية cross-surface/resume/crash/replay. وجود verifier واحد لا يكفي إن بقي producer آخر قادرًا على منح consumer نجاحًا مكافئًا.

## 7. Closed-Loop World Agent

### 7.1 World State

`world-state.ts:73-115,432-492` يوفر materialization وrevision وscoping facts. هذا يثبت storage/projection على المسارات المدروسة، لا أن World State هو مصدر القرار authoritative في كل planner.

### 7.2 World Transitions

- `runtime.start`: `recipe-operation-runner.ts:1283-1348` يربط prestate وparent/environment revision؛ و`runtime-start-transition.ts:437-630` يتحقق من acceptance/effect والهوية والملاحظات المباشرة/الحديثة ثم materializes. الحالة: `IMPLEMENTED` لمسار محدد.
- `apply-changes`: route في `routes/ai/chat.ts:16017-16073,16206-16420,16650-16725` يسجل before/after، promotion، acceptance، ثم finalize/wake؛ الفعل محكوم بعقد apply transition. الحالة: `IMPLEMENTED` لمسار محدد.
- لا يثبت المساران التغطية لكل mutation-capable operation: `PARTIAL`.

### 7.3 World Delta

- `runtime-start-transition.ts:599-630` يستنتج `changedFactRefs` من materialized facts ذات `sourceObservationIds` المطابقة للـobservations المختارة.
- `finalizeApplyChangesTransition` في الملف نفسه `:967-990` يmaterialize observations/revision ثم يكتب `changedFactRefs: []` عند `:975`. test `runtime-start-transition.test.ts:547-606` يثبت نجاح materialization ولا يفحص صحة `changedFactRefs`؛ لا يوجد إثبات أن empty مقصود أو صحيح. النتيجة `PARTIAL / UNKNOWN semantic intent`.

### 7.4 Accepted Effect → World State

runtime.start يربط effect bundle وملاحظات مستقلة بالtransition؛ apply-changes يربط transition بالـcandidate/live tree observations والrevision. الاختبارات ذات الصلة تشمل `runtime-start-transition.test.ts:797-868,883-1064` وapply materialization عند `:547-606`. لا يثبت ذلك أن كل accepted effect يملك World transition أو أن كل transition يمثل accepted effect.

### 7.5 Planner Integration

- `runtime-start-hypothesis-replan-context.ts:98,231` يصف Mission context بأنه advisory؛ ليس authority لاختيار action.
- `recipe-operation-runner.ts:1320-1348` يمنع effect عند revision conflict قبل action في runtime.start.
- `runtime-start-transition.test.ts:797-868` يثبت أن successor ينتظر materialization للـtransition؛ لا يثبت أن planner اختار قرارًا مختلفًا بسبب facts جديدة.
- `apply-change-mission-gate.ts:438-453` يتحقق من transition/resulting revision/requirement/plan؛ لا يثبت أن planner استهلك World State الجديدة أو غيّر القرار.

الحكم على الادعاء القديم أن planner integration advisory: `PARTIALLY CONFIRMED`؛ بعض السياق advisory، لكن توجد revision/effect gates وsuccessor gates أقوى على runtime.start/apply. **التغيير الفعلي للقرار/action عمومًا `UNKNOWN`.**

### 7.6 Belief Update

لم يثبت وجود server-owned belief state عامة تحدّثها observations المقبولة وتستهلكها قرارات planner. hypothesis experiment/diagnosis/replan context موجودة كشرائح أو metadata؛ لا تساوي belief authority. الحكم: `UNKNOWN / ADVISORY`.

### 7.7 Replan vs Retry

retry materialization durable منفصل عن Mission `needs_replan` في بعض إخفاقات runtime.start. لا يوجد إثبات تصنيف موحد retry/repair/replan/belief update عبر كل mutation surfaces. `PARTIAL`.

### 7.8 Replay/Evaluation

توجد strategy/runtime-start replay وتجارب محدودة، لكن لا يوجد دليل على تقييم held-out عامّ لـWorld State A → action → outcome → delta → planner decision → score عبر عمليات مختلفة. `PARTIAL / UNKNOWN`.

### 7.9 100% Gate

اشتقاق/تفسير `changedFactRefs` لـapply changes، وإثبات planner input bound إلى revision/freshness/scope، واختبار أن relevant world delta يغيّر القرار بينما irrelevant delta لا يغيره، ثم belief/replay cross-operation مستقل. لا يبدأ التعلم قبل هذا.

## 8. Cross-Layer Trace

### Trace A — `runtime.start` (مسار محدود)

1. `recipe-operation-runner.ts:1283-1348`: يقرأ parent World State/Revision وdirect prestate ويمنع الأثر عند التعارض.
2. `runtime-start-transition.ts:437-596`: يربط نجاح acceptance/effect والexecution/episode/revision والملاحظات المباشرة قبل/بعد وchild-process attestation.
3. `runtime-start-transition.ts:599-630`: materialization واشتقاق fact refs/revision.
4. `runtime-start-transition.test.ts:797-868`: successor لا يُطلق قبل materialized transition المطابق.

هذا يثبت transition gate لمسار runtime.start فقط؛ لا يثبت general planner decision change. كما أن مدخل user-objective إلى recipe في كل الحالات لم يُتتبع هنا: `UNKNOWN`.

### Trace B — `apply-changes` (مسار مختلف)

1. `routes/ai/chat.ts:16017-16073`: action/effect contract وbefore tree-hash.
2. `:16206-16420`: promotion والتحقق وملاحظات after/tree/environment.
3. `:16650-16683`: acceptance.
4. `runtime-start-transition.ts:871-990`: validation/materialization/revision للـapply transition، مع `changedFactRefs: []`.
5. `routes/ai/chat.ts:16710-16725`: finalize transition ثم wake Mission goal.

اختبار `routes/ai.test.ts` لمسار Mission-linked Apply يثبت D2 successor/acceptance على fixture؛ واختبار الانتقال `runtime-start-transition.test.ts:547-606` لا يثبت delta refs أو قرار planner لاحق. تتشابه المسارات في binding إلى observation/effect/transition، وتختلف في delta derivation ومدى اختبار القرار التالي.

## 9. Bypass Inventory

| Bypass / gap | المصدر | ما يتجاوزه أو يتركه | التأكيد |
|---|---|---|---|
| raw exports من package root | `index.ts` قبل E1؛ أزيلت، واختبار dispatcher boundary يمنع رجوعها | central dispatcher authorization/approval/manifest | `FIXED + TESTED` على سطح package الحالي |
| server-internal import additions | `@workspace/ai-orchestrator/server-internal/execution` | قد تنشئ مستدعيًا جديدًا خارج الحدود الحالية | اختبار AST يسمح بمستدعيي API الحاليين فقط؛ حالات خارج سورس API لم تظهر في المسح الحالي |
| observation-only execution terminalization | `agent-episode-ledger.ts:1284-1318` | `finalizeExecutionAcceptance` / acceptance row | استثناء محدد وfenced؛ ليس acceptance، لكنه writer منفصل لحالة `completed` |
| phase-local `PROVEN` | `workflow-phase-execution.ts:179-196` | لا يتجاوز final Goal verifier، لكنه يشارك القيمة اللفظية | assignment مؤكد؛ التمييز لا يملك test مخصصًا ظاهرًا |
| apply delta refs الفارغة | `runtime-start-transition.ts:967-990` | اشتقاق changed-fact attribution | الكتابة `[]` مؤكدة؛ هل المقصود صحيح `UNKNOWN` |
| استعادة الأثر الخارجي بعد W2–W4 | أسطح mutation المختلفة | observation/reconciliation المستقل | فجوة عامة confirmed؛ كل مسار بعينه `UNKNOWN` ما لم يثبت خلافه |

## 10. Authority Inventory

| المجال | authority المثبتة | الحد |
|---|---|---|
| tool dispatch | `executeSingleTool` داخل engine؛ package root لا يصدر raw executors، والـinternal subpath محصور في callers خادميين | authority على model-call ingress مثبتة في workspace الحالي؛ لا يعني ذلك إغلاق timeout/replay/resource guarantees لكل executor |
| execution acceptance | `finalizeExecutionAcceptance` للمسار المركزي | writer observation-only fenced خارجها؛ تقارب كل السطوح غير مثبت |
| Canonical Proof | `composeCanonicalProof` / `loadCanonicalProof` في `proof-foundation.ts` | ليست كل status باسم `PROVEN` Canonical Proof |
| World State | materializer وtransition-specific finalizers | apply delta attribution ناقص/غير محسوم، planner authority العامة غير مثبتة |

## 11. Test Coverage Matrix

`present` يعني وجود test code؛ `ran` يعني تشغيل الأمر وتسجيل نجاحه في هذا التقرير. لا تعني أي منهما تغطية universal.

| invariant | Unit | Integration/API | Cross-surface | Crash/race | E2E | الوضع |
|---|---|---|---|---|---|---|
| dispatcher policy/bounds | boundary test يشمل file/Git/command/package/binary؛ شُغّل 4/4 | ai-repair-validation 15/15؛ API/Orchestrator typechecks ناجحة | AST allowlist للـserver-internal callers ناجح | لا coverage لكل timeout/replay/runtime executor | غير مثبت هنا | `E1 IMPORT BOUNDARY PASS`; operational closure ما زالت جزئية |
| durable execution/acceptance | موجودة | `ai-execution-retry.integration.test.ts`, acceptance suites؛ 39 اختبارًا شُغّلت | مجموعة surfaces كاملة غير مثبتة | بعض lease/recovery tests موجودة؛ W0-W9 جميعها غير مغطاة | لا إثبات شامل | `INTEGRATION-TESTED` لمسارات محددة |
| optional evidence/Canonical Proof | `ai-execution-acceptance.test.ts`, `proof-foundation.test.ts`؛ شُغّلت ضمن 39 | D2 duplicate legacy test ناجح | global producer/consumer map غير مكتمل | resume tests موجودة؛ لا تعميم | لا | `TESTED / INTEGRATION-TESTED` محدود |
| runtime World transition | unit/integration test code موجود | runtime-start transition suites | apply/runtime غير موحدين في decision proof | بعض stale/retry/rollback | لا planner-decision E2E مثبت | `TESTED` coverage؛ لم تشغل هذه suites في التدقيق |
| apply World Delta/planner change | tests تثبت materialization لا changed refs | Mission D2 route موجود | لا تغيير قرار مثبت | لا crash delta proof | لا | `PARTIAL / UNKNOWN` |
| provider/live/release | — | لم يشغل | — | full process recovery لم يشغل | dashboard journey لم يشغل | `UNKNOWN` |

## 12. False Confidence Risks

- أُزيلت raw tool functions من package root؛ server-internal subpath ليس authorization بديلًا، ويجب إبقاء مستهلكيه خادميين ومحدودين بالاختبار.
- `PROVEN` في phase/task/recipe/replay ليس بالضرورة Canonical Proof؛ و`execution-proof.ts` يسقط status ولا يتحقق وحده من provenance.
- وجود execution `completed` لا يثبت acceptance؛ المسار observation-only يصرّح `createsAcceptance:false`.
- schema/default `evidenceRequired=0` أو وجود `PROVEN` في legacy JSON ليسا دليل proof؛ العلم الدائم/verifier هما الحاكمان في المسار المفحوص.
- `runtime.start` transition صحيح على مساره لا يغلق World Agent؛ apply transition يكتب changed refs فارغة ولا يوجد planner decision-change proof.
- وجود retry/replan/replay primitive لا يثبت recovery للأثر الفيزيائي أو learning.
- test موجود لا يساوي اختبارًا ناجحًا حاليًا ولا cross-surface closure.
- سجل تقدم أو plan سابق ليس دليلًا على code behavior؛ وصف phase لا يعلو على التنفيذ الحالي.

## 13. Critical Blockers

| الأولوية | blocker | لماذا يمنع الإغلاق |
|---|---|---|
| P1 | lifecycle/status writers متعددة، ومنها `completed` observation-only بلا acceptance | أُصلح استنتاج النجاح في إسقاطات chat/detail وexecution progress؛ لا يمكن تفسير status وحده كنجاح موحد أو إثبات terminal authority عالمية |
| P1 | دلالات `PROVEN` متعددة، مع جرد global غير مكتمل | false acceptance محتمل عند consumer يخلط phase-local/projection/canonical status |
| P1 | apply `changedFactRefs: []` مع intent/semantic test غير مثبت | World Delta وسبب التغيير غير موثقين على مسار apply |
| P2 | أثر خارجي أثناء/بعد التنفيذ وقبل durable observation يبقى uncertain؛ لا crash test شامل لكل نافذة | فُرض fail-closed على marker `started` للأدوات المحظور replay لها في Mission tool-loop فقط؛ بقية الأسطح لا تزال بلا reconciliation شامل، وretry/recovery لا يستطيع إثبات الحالة الفيزيائية من DB وحدها |
| P2 | لا إثبات أن World State الجديدة تغيّر قرار planner أو action عمومًا، ولا belief/evaluation عام | حلقة Action→World→Decision غير مغلقة |
| P3 | تحقق release/process-recovery غير منفذ في بيئة ثبت أنها disposable | لا يجوز تحويل التحقق التاريخي أو غيابه إلى نجاح حالي |

لم يثبت هذا التدقيق blocker مصنفًا P0 على مسار محدد؛ هذا ليس إثباتًا لغياب مخاطر أخرى.

## 14. Exact File-by-File Implementation Plan

1. **E1 — DONE (2026-10-02):** أزيلت raw executor functions من `lib/ai-orchestrator/src/index.ts`; حُفظت `runBoundedCommand` و`runRegisteredCommand` في `server-internal/execution` لاستخدام الخادم الموثوق فقط؛ ويمنع اختبار المصدر إضافات غير معتمدة. لا يغيّر هذا إغلاق بقية Reliable Tool Agent.
2. **E2 — PARTIAL (2026-10-02):** إسقاط chat/detail وexecution progress يعرض `UNKNOWN` عند غياب acceptance بدل استنتاج `SUCCEEDED` من `completed`؛ P7.5 observation-only بقي بلا acceptance وبلا تغيير لحدود replan. Mission tool-loop يمنع استئناف marker `started` لأداة `block_after_prior_marker` ويُنهي المحاولة كـuncertain وغير قابلة لإعادة المحاولة؛ safe reads وmarkers المكتملة محفوظة. لم يُغلق جرد writers/consumers ولا كل أسطح mutation.
3. **E2 — العمل المتبقي:** جرد writers في `ai-execution-state.ts`, `ai-execution-acceptance.ts`, `agent-episode-ledger.ts` وكل mutation surface. لكل executor في runtime/apply/repair/workflow/task، وثق idempotency والـexternal observation. أضف fault injection عند W2–W8 واختبر duplicate side effect وunknown outcome وresponse loss؛ لا يستنتج recovery success من checkpoint.
4. **E3 — PARTIAL (2026-10-02):** صار ربط source revision وcandidate identity سياسة scope صريحة في Canonical Proof، مع رفض غياب الهوية المتوقعة أو تعارضها. Shadow Replay يحفظ `proofRequired` في الطلب durable منذ الإنشاء، ويتطلب evidence acceptance كاملًا؛ وكتابة receipt وحذف workspace مقيدان بمالك lease وattempt الحاليين لمنع سباق البدء المباشر مع reconciliation. كما بقيت attestation لمسار pnpm مقيدة بالمسار المستخرج من package metadata. أُغلق مسار Gate 3 الذي كان يحوّل `PROVEN` داخل receipt محفوظ إلى قبول ترقية: المستهلك يعيد تحميل Canonical Proof من execution/acceptance/evidence rows ويربطه بهوية replay والقبول والمحاولة والعملية والمراجعة والمرشح ونسخة الخطة الحالية؛ واجتازت 5 اختبارات Gate 3. وأضيفت 5 assertions terminal عبر loader لحالات الإلغاء، وانتهاء lease، وstale worker، وتدوير المحاولة. اختبار runner حقيقي يؤكد أن receipt الخاص بـ`database.inspect.project` لا يصبح Canonical Proof (`evidenceRequired=0`, projection `NOT_REQUIRED`, والـloader غير مقبول). اختبار Goal PATCH يثبت أن projection يعلن `PROVEN` لا يكفي إذا كان snapshot لمحاولة أخرى: loader يعيد `missing_evidence_snapshot`، والـroute يرفض completion مع rollback. واختبار audit-export يثبت أن `execution.proof` المأخوذ من checkpoint قد يبقى `PROVEN` بينما `operationEvidence.proof` و`proofSpine` يرفضان acceptance/snapshot لمحاولة سابقة؛ الـspine يعرض attempt الحالي ويبقى غير مقبول، مع حجب المعرّفات الداخلية في التصدير. واختبار candidate-admission يثبت أن acceptance/snapshot صحيحين لهوية proposal لكنهما من محاولة أقدم لا ينشئان skill candidate؛ route يعيد `SKILL_CANDIDATE_PROOF_NOT_AVAILABLE`. واختبار Gate 4 كشف أن التسجيل كان يقبل receipt رغم اختلاف attempt للـreplay acceptance/snapshot (201)؛ أصلحناه بحيث يعيد تحميل Canonical Proof الحالي لكل من candidate المصدر والـreplay، ويربط acceptance IDs وtrajectory بالـreceipt قبل الإدخال. كما كشف expired-lease recovery قبول receipt محفوظًا وإرجاع 200 رغم اختلاف attempt؛ recovery الآن يعيد تحميل proof من execution/acceptance/evidence الحالية ويربط acceptance ID والـtrajectory بالـreceipt، وإلا ينهي replay كـfailed ويرجع 409. واختبار approval كشف promotion بـ200 بعد جعل proof قديمًا؛ route الموافقة الآن يعيد فحص paired baseline وCanonical Proof الحالي للمصدر والـreplay داخل transaction قبل supersede أو promotion، ويرفض mismatch بـ409 ثم ينجح بعد استعادة attempt. كما يظل تصنيف FACT منفصلًا عمدًا وله اختبار تكامل قائم. الجرد الإنتاجي المحدود تتبع writer وCanonical loader عبر Goal/Mission وreplay/promotion وstrategy وtask وoperation-evidence/proof-spine؛ وتبقى تغطية بعض هذه الحدود helper-only أو غير موجودة. اجتازت الاختبارات المركزة وAPI typecheck و`git diff --check`، وبدأ API Server بنجاح؛ E3 ما زال جزئيًا.
5. **E3 — العمل المتبقي:** أكمل أي writers/consumers خارج الجرد الإنتاجي المحدود، وأضف اختبارات durable-loader للمستهلكين غير المغطين، خصوصًا strategy replay-case وmission/replay proof-spine projections. وثّق أن Task Objective receipts بوابة قبول مستقلة ما لم يربطها عقد صريح بـCanonical Proof. حدّد بعقد server-owned أي recipes تحتاج retained source evidence وأيها artifact/receipt-only؛ وحدّد أبناء التفويض المطلوب proof لهم قبل تفعيل جامع Canonical Delegation Proof. لا يوجد misclassification إنتاجي مثبت في FACT أو loader التفويض الحالي؛ policy القرارات غير موجودة في العقود الحالية. أبقِ E3 جزئيًا حتى استكمال التغطية وحسم هذه الحدود.
**E3 runtime.start producer/consumer finding (2026-10-02):** اختبار Gate C يثبت أن `runtime.start` يكتب effect bundle بحالة `OBSERVED` وانتقالًا `materialized` وقبولًا `SUCCEEDED`، لكن القبول يحمل `evidenceRequired=0` و`evidenceComplete=1` و`evidenceSnapshotId=null`؛ episode يبقى `verifying` وCanonical Proof loader يرفضه، لذلك Strategy Replay source materialization يفشل مغلقًا. تجربة `proofRequired=true` أُلغيت: generic proof gate يتطلب `AutonomousOperationContract` غير الموجود في recipe checkpoint ويعيد `blocked`. لم يُختبر recovery لreceipt محفوظ `proven` بfixture حقيقي؛ لا يوجد producer صالح بعد. يلزم عقد proof server-owned خاص بالrecipe يربط Gate C durable evidence بالقبول قبل جعل `runtime.start` مصدرًا أو replay صالحًا. تبقى الحالة **E3 — PARTIAL**.

6. **E4 — إغلاق apply delta:** في `runtime-start-transition.ts:967-990`، اشتق refs من facts/observations مثل runtime.start أو وثّق/اختبر لماذا لا يوجد changed fact؛ أضف assertion في `runtime-start-transition.test.ts` لا يكتفي بحالة `materialized`.
7. **E5 — planner binding:** اربط planner input/plan identity بـWorld/environment revision وfreshness/scope، ثم اختبر world delta ذا صلة ينتج قرارًا مختلفًا وdelta غير ذي صلة لا يغير الخطة.
8. **E6–E8 — بعد الإغلاق السابق فقط:** عرّف belief state server-owned ومصدره/تراجعه، افصل retry/repair/replan، ثم أضف held-out replay/evaluation عبر أكثر من mutation surface قبل أي promotion أو transfer.

## 15. Dependency-Ordered Roadmap

الترتيب `E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8` سليم مبدئيًا وفق الاعتماديات التي ظهرت: الأداة تحتاج authorization/execution boundary؛ execution يثبت identity/attempt/observation؛ evidence acceptance يعتمد على هذه الهوية؛ World Transition يحتاج effect مقبولًا وملاحظة؛ planner يحتاج delta/revision؛ belief/replan/evaluation تعتمد على نتائج موثوقة من الطبقات السابقة. توجد مراجعة متبادلة بين E1 وE2 لأن dispatch يحمل execution identity، وبين E2 وE3 لأن acceptance جزء من terminalization؛ لا يثبت ذلك تغيير ترتيب الإغلاق.

هذا E1–E8 audit overlay يكمّل ولا يستبدل dependency graph P0–P14 في `docs/agent-generalization-execution-plan.md:3546-3600`. يجب إغلاق invariants الفعلية قبل الانتقال، لا اعتبار أسماء المراحل أو نجاح route واحد معيار خروج.

## 16. What Must NOT Start Yet

- لا يبدأ P7.5 data collection، Learning، Transfer، Capability Composition أو Strategy Promotion.
- Learning يحتاج execution identity وtool authority قابلة لإعادة البناء؛ package-boundary الخاص بـE1 أُغلق للمصادر الحالية، لكن E2 ما زالت جزئية ولا يكفي ذلك لإغلاق نواة الأدوات التشغيلية كاملة.
- Learning/evaluation يحتاجان evidence authority موحدة قابلة للتتبع عبر producers/consumers؛ E3 عالميًا غير مغلق.
- Transfer يحتاج تغيرًا موثوقًا في World State وتقييمًا يثبت قرار planner؛ E4/E5 غير مكتملتين، وE6–E8 غير مثبتة.
- حالة P7.5 الحالية في سجل الخطة `NO-GO`; هذا التقرير لا يعيد اعتماد جمع أو cohort.

## 17. Final Gate

- `[✓]` E1: package root لا يصدّر raw tool executors، وmodel-call executors داخل orchestrator تمر عبر dispatcher؛ يبقى Reliable Tool Agent تشغيليًا جزئيًا.
- `[~]` Durable execution/checkpoint/acceptance/recovery موجود؛ completed بلا acceptance يظهر `UNKNOWN` في الإسقاطات المغطاة، وMission started-marker المحظور يفشل مغلقًا؛ لا universal lifecycle ولا crash reconstruction عام للأثر الخارجي.
- `[~]` Canonical Proof يرفض evidence-optional acceptance؛ global `PROVEN` producers/semantics غير موحدة بالكامل.
- `[~]` runtime.start وapply-changes لديهما transitions محددة؛ apply delta refs فارغة والplanner decision-change غير مثبت.
- `[✗]` لا يوجد دليل أن World State changes تفرض خطة/Action مختلفة على نحو عام.
- `[✗]` لا يوجد تقييم held-out عام يثبت loop عبر أسطح mutation مختلفة.
- `[✗]` لا تبدأ طبقات Learning / Transfer / Generalization بعد.

## 18. Final Verdict

**NOT READY.** أُغلق E1 package-boundary على مصادر workspace الحالية، لكن ذلك لا يغلق Agent Core. الحواجز المتبقية: (1) E2 lifecycle/terminal state عبر mutation surfaces مع reconciliation صريح للأثر بعد crash؛ (2) E3 جعل Canonical Proof وحده صاحب قبول `PROVEN` أو فصل statuses المحلية؛ (3) اشتقاق World Delta وربط planner بالrevision/freshness وإثبات قرار يتغير عند تغير fact ذي صلة؛ (4) belief/replay/evaluation عام قبل أي transfer. لا يُدّعى اكتمال Agent Core معماريًا أو وصول أي طبقة إلى 100%.
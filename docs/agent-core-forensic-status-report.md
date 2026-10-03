# EngineeringOS — Agent Core Forensic Status Report

- **تاريخ التدقيق الأساسي:** 2026-10-02
- **آخر تحديث للمصدر والحالة الديناميكية:** 2026-10-03؛ أُدمجت النتائج في الأقسام أدناه، ولا توجد ملاحق إضافية.
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
  - `cd artifacts/api-server && pnpm exec vitest run src/routes/ai/missions.test.ts -t 'persists a server-owned skill candidate and performs read-only shadow replay'` — 1 ناجح و28 skipped؛ يتضمن استعادة receipt الإيجابية ورفض mismatch.
  - `cd artifacts/api-server && pnpm exec vitest run src/lib/task-execution-lifecycle.integration.test.ts -t 'records local task completion without completing the delivery Goal or Mission'` — 1 ناجح و16 skipped؛ يثبت فصل task/acceptance عن Goal/Mission.
  - `pnpm --filter @workspace/api-server run typecheck` و`git diff --check` — نجاح.
- التحقق الحالي المعاد من جذر الحزم الصحيح: `cd lib/ai-orchestrator && pnpm exec vitest run src/__tests__/reliable-tool-agent-100.test.ts src/__tests__/tool-execution-engine.test.ts` — ملفان، **447/447** ناجحة.
- خط الأساس قبل إصلاح Mission recipe: تشغيل الملفات الثمانية أعلاه أعطى **109 ناجحة و4 فاشلة من 113**؛ فشلت أربعة اختبارات في `mission-runtime-recipe.test.ts` لأن Canonical Proof رُفض وبقي Goal على `verifying`. هذه نتيجة ما قبل الإصلاح وليست تحققًا للحالة الحالية.
- التحقق بعد إصلاحات Mission وShadow Replay (2026-10-02): اجتازت `mission-runtime-recipe.test.ts` (6/6)، و`ai-execution-acceptance.test.ts` (24/24)، ومجموعة التدقيق الأوسع ذات الملفات الثمانية (114/114)، بما فيها نجاح replay والاستعادة بعد crash. وفي التحقق الحالي، نجح API typecheck؛ واجتاز `recipe-operation-runner.test.ts` (29/29)، و`routes/ai/missions.test.ts` (29/29)، واختبار registry (7/7)، وكذلك `git diff --check`. شملت تغطية runner اختبارات Canonical Proof للقراءة والمتصفح والتسليم ورفض runtime lifecycle قبل التنفيذ.
- استدعاء Vitest أول من جذر monorepo التقط نسخًا مستوردة وتعارض fixtures؛ استُبعد من النتائج أعلاه ولم يُستخدم كتحقق صالح.
- تحقق إضافي من جذر الحزم الصحيح في 2026-10-03:
  - `cd artifacts/api-server && pnpm exec vitest run src/lib/ai-execution-acceptance.test.ts src/lib/agent-state/world-state.test.ts src/lib/agent-state/runtime-start-transition.test.ts src/lib/workflow-phase-execution.test.ts` — 4 ملفات، 57/57 ناجحة.
  - `cd lib/ai-orchestrator && pnpm exec vitest run src/__tests__/evidence-integrity.test.ts` — ملف واحد، 54/54 ناجحة.
- التحقق بعد إصلاح Mission-linked Apply (2026-10-03): `cd artifacts/api-server && pnpm exec vitest run src/routes/ai.test.ts` — 191/191؛ ومجموعات acceptance/proof/mission/effect/reconciliation المرتبطة — 111/111 عبر 10 ملفات. اجتاز API typecheck و`git diff --check`. يثبت ذلك المسار المختبر، ولا يغلق E2/E3 عالميًا.
- شُغّلت مجموعة API الكاملة، لكن تجاوزت مهلة الأداة ذات الخمس دقائق من دون ملخص نهائي؛ النتيجة الكاملة `UNKNOWN` وليست نجاحًا أو فشلًا.
- لقطة قاعدة **التطوير فقط** في هذا التحديث، باستعلامات read-only: 179 executions، 275 acceptances، 9 Missions، 14 Goals، 227 Episodes، 24 EffectBundles، 164 World Facts، و9 World Transitions. حالات execution: 82 `completed`، 80 `failed`، 10 `cancelled`، 7 `paused`؛ وحالات transitions: 8 `materialized/fresh` و1 `terminal_failed/unknown`.
- لقطة التعلم في قاعدة التطوير: 0 أحداث `P75_HYPOTHESIS_*`، و0 `ai_shadow_replays`، و0 `ai_skill_registry`؛ 4 Strategy candidates كلها `pending_replay`؛ و12 Strategy Replay run: 9 receipts بحالة `incomplete`، و1 `proven`، و2 بلا `receipt.status` قابل للتصنيف. هذه إسقاطات صفوف فقط، وليست تحققًا من Canonical Proof أو من التشغيلات.
- تحقق اختبارات نقي محدد في 2026-10-03: مجموعة P7.5 اجتازت 53/53، ومجموعتا Skill Registry وStrategy Replay اجتازتا 11/11. هذه نتائج لاختبارات الكود، وليست إثباتًا لمسار إنتاجي أو لسجلات إنتاجية.
- لم يُشغّل اختبار `p75-process-recovery.integration.test.ts` لأنه يكتب إلى قاعدة البيانات ويطلق runtime دون ضمان قاعدة اختبار معزولة. لا يُشغّل تحقق release/process-recovery الحي قبل توفير هذا العزل.
- إسناد الفرق بين لقطات قاعدة التطوير إلى الاختبارات أو إلى نشاط سابق غير محسوم (`UNKNOWN`)؛ الاستعلامات هنا read-only. أعادت محاولة production read-only أن المشروع لا يملك قاعدة إنتاج بعد؛ لم يحدث نشر، ولا توجد مطالبة بـ`PRODUCTION-PATH-VERIFIED`.

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

### Evidence-Based Scorecard

لا أضع نسبًا من 0–100: جرد كل model-reachable surface وكل `PROVEN` producer غير مكتمل، لذلك لا يوجد denominator موثوق يمكن تحويله إلى نسبة invariant closure. لا يوجد overall score أو ترتيب رقمي.

| الطبقة | الحالة الحالية | القوي | الجزئي / المانع | تعريف 100% |
|---|---|---|---|---|
| Reliable Tool Agent | `PARTIAL` | dispatcher موحد للمكالمات المفحوصة وحدود package الحالية محمية باختبار | timeout/cancel/output/audit/Episode/revision ضماناتها ليست موحدة لكل runner؛ Git symlink/root races `UNKNOWN` | كل model-reachable call يمر بسلطة authorization واحدة وبحدود scope/وقت/خرج/cancel/audit/Episode قابلة للإثبات |
| Reliable Execution Agent | `PARTIAL` | execution identity وattempt وlease/checkpoint والقبول/recovery في المسار المركزي؛ Apply proof-specific path اجتاز الاختبار | mutation surfaces غير محصورة؛ آثار W2–W4 قد تبقى uncertain؛ completed observation-only؛ لا universal lifecycle | كل mutation يملك lifecycle موحدًا وفences/idempotency/reconciliation، مع crash/race tests عند action/effect/acceptance |
| Evidence-Grounded Agent | `PARTIAL` | Canonical loader يربط الدليل الحالي؛ runtime.start وMission-linked Apply لديهما artifacts خادمية متخصصة في المسارات المختبرة | statuses `PROVEN` المحلية متعددة؛ جرد producer/consumer غير كامل | كل قرار نجاح ذي proof-required يمر بCanonical verifier وبـclaim/scope/revision/candidate/delivery bindings المطلوبة |
| Closed-Loop World Agent | `PARTIAL` | runtime.start وapply-changes materializeان transitions على مسارات محددة | apply delta فارغ، planner decision change وbelief/replay العام غير مثبتين | كل accepted effect ينتج delta قابلاً لإعادة البناء، ويُستهلك بplan revision-bound ويُختبر تغيّر القرار وheld-out outcomes |

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

#### Tool/path control matrix

| Tool/path | Entry point + authorization | Bounds / cancellation | Audit + Episode | Scope semantics | Status |
|---|---|---|---|---|---|
| File read/write/replace | `executeSingleTool`; membership, arguments, mode, approval, and scope checks | Read/write sizes bounded by tool contracts; `safePath` performs lexical and realpath checks, including nearest existing ancestor for new files | dispatcher callbacks exist, but durable audit/Episode binding is not universal | writes stage pending candidate changes; they are not an immediate live-tree commit | `TESTED` dispatcher; end-to-end audit and race closure `PARTIAL` |
| Git status/diff/log | same dispatcher and policy path | Git reads use `execFile`, 10-second timeout, 512 KiB output cap; per-call cancellation coverage is not established here | no universal durable audit/Episode proof | `git_diff` uses lexical containment; the reviewed path does not establish equivalent symlink canonicalization to `safePath` | `PARTIAL`; narrower path guarantee |
| Bounded command / registered validation | dispatcher requires authorized execution mode and approved profile; server validation uses a fixed allowlist | `shell:false`, root/cwd containment, timeout, output cap, abort/process-group cleanup in the bounded kernel | callbacks can attach invocation records, but every executor is not proven to persist an Episode/audit row | chat command profile is server-derived from an approved implementation plan; `workspace-typecheck` is fixed in the inspected validation path | `TESTED` for bounded kernel/current callers; root-replacement/TOCTOU atomicity `UNKNOWN` |
| Package/binary/delegated runner | dispatcher authorization remains in force | registry explicitly marks some limits `unspecified`, `runner_defined`, or `runner_delegated` | universal audit/Episode binding not proven | runner-specific scope and resource enforcement not established by metadata alone | `PARTIAL / UNKNOWN` |
| Analysis/project-navigation tools | dispatcher and request intent; analysis runner receives request deadline | deadline enforcement is delegated to runner; not a common executor-level timeout proof | read-only invocation telemetry is allowlist-based; durable Episode linkage is not universal | source/evidence selection is request-scoped, but not every consumer binds the same revision | `PARTIAL` |
| Server-internal repair validation | not a model-tool entry point; trusted API caller | bounded command kernel plus fixed `allowedCommands` | server validation records its own result; not a model Episode | fixed validation commands and profile allowlist | separate server-owned path, not a dispatcher bypass |

`tool-operational-registry.ts` is operational metadata; `tool-policy.ts` and `authorizeToolInvocation` supply the authorization decision. They are two registries with different jobs, not evidence of two independent grants. The file path check is check-then-use rather than an atomic filesystem capability; git path handling is weaker on symlinks, and root replacement races are not closed by the current source audit.

### 4.3 Bypasses

| المسار | الدليل | ما يتجاوزه | الحالة |
|---|---|---|---|
| raw execution functions من package root | كانت exports في النسخة المدققة أوليًا؛ أزيلت الآن من `index.ts`. `package.json` يتيح فقط `server-internal/execution` بمحتوى صريح | لا يملك المستهلك العام مدخلًا مباشرًا إلى raw tool executors | `FIXED + TESTED` لواجهة الحزمة الحالية |
| server-internal command helpers | `chat.ts` يمرر `runRegisteredCommand` إلى dispatcher؛ `ai-repair-validation.ts` يستعمل `runBoundedCommand` مع `allowedCommands` ثابتة | لا تتجاوز manifest/approval في مسار أداة المحادثة؛ تحقق الخادم مستقل عن tool-call من النموذج | مستدعيات حاليّة محصورة واختبار allowlist؛ لا تُعامل كـmodel-call ingress |
| raw file/Git في `chat-agent.ts` | الادعاء السابق قديم: لا استدعاء فعلي لـ`executeFileTool`/`executeGitTool`؛ الموجود تعليقات فقط. dispatch المحادثة يمر عبر `executeToolLoop` أو `executeScopedReadTool` ثم `executeSingleTool` | لا يوجد bypass مثبت في هذا الملف الحالي | الادعاء `FALSE / OUTDATED` |
| raw file/Git/command/package/binary داخل orchestrator | `tool-execution-engine.ts:1380-1405` يستدعيها داخل dispatcher؛ الاختبار الساكن يفحص هذه الأسماء في ملفات orchestrator الإنتاجية | لا يشمل كل لغات/مخرجات runtime خارج ملفات TS | `TESTED` لشجرة المصدر الحالية |

### 4.4 Tests

ملفات تغطي policy، engine، file/Git، kernel، package/binary، analysis، وtool surface موجودة. في التحقق الحالي شُغّل `reliable-tool-agent-100.test.ts` و`tool-execution-engine.test.ts` من `lib/ai-orchestrator`: **447/447** ناجحة. وتوجد نتائج مسجلة سابقًا: اختبار dispatcher boundary **4/4** و`ai-repair-validation.test.ts` **15/15**، مع Orchestrator وAPI typechecks. هذا يغطي المصدر/الاستيراد الحالي ولا يثبت الضمانات التشغيلية لكل executor.

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
| Git commit/push | `routes/git.ts` وGit delivery helpers | project write access؛ AI scoped commit يتطلب Apply proof/tree match على المسار المفحوص؛ ربط كل remote push بWorldTransition غير مثبت |

#### Surface lifecycle and side-effect matrix

| Surface | Durable identity / ownership | Side effect and observation | Acceptance / terminal boundary | Recovery and coverage |
|---|---|---|---|---|
| Chat read/project query | request/execution context exists on selected paths | retained source reads and claim validation; not a project mutation | some chat observation executions can be terminal `completed` without acceptance; projection reports `UNKNOWN` rather than success | chat lifecycle is not a common mutation lifecycle |
| Task / structured task | task IDs and execution acceptance on covered paths | local task state/checks; a phase-less Goal-linked Task can complete locally without completing Goal/Mission | local Task acceptance is not Goal Canonical Proof | task verification does not itself accept Goal/Mission; structured path parity `UNKNOWN` |
| Workflow phase | phase/lease state on covered paths | phase node statuses and operation state; substantive execution of every declared node is not established | final Goal completion uses Canonical Proof; phase-local `PROVEN` is not acceptance | prior integration evidence shows missing required evidence can fail acceptance; broad resume/crash parity `UNKNOWN` |
| Recipe / Mission | durable execution, attempt, Episode, lease, plan revision on covered paths | recipe-specific runner may perform local or external action; runtime.start has direct process attestation | Goal/Mission reload Canonical Proof; the declared artifact-only recipe path persists a non-empty snapshot whose node evidence must match receipt, execution/attempt, operation, revision, and candidate | positive current-attempt and negative stale-attempt tests pass for candidate validation; broader recipe-family and recovery parity remain `PARTIAL` |
| `runtime.start` | execution/attempt/Episode/operation and environment revision binding | child process start is checked by direct before/after observations and child-process attestation; Gate C builds a bound evidence artifact | transition requires matching successful acceptance, effect bundle, fresh observations, and identity binding; Canonical loader re-derives the artifact | specialized producer/consumer path tested; full replay recovery and all crash windows remain open |
| `apply-changes` | proposal, Goal/Mission, active plan revision, execution/attempt/Episode | candidate promotion plus fresh direct before/after tree observations and EffectBundle | acceptance and transition are separately gated; transition currently writes `changedFactRefs: []` | route/transition tests cover selected paths; changed-fact attribution and full response-loss recovery remain open |
| Git commit/push | project write permission; AI commit additionally checks applied proposal/operation and promoted-tree identity | local commit and remote push are separate effects | inspected AI commit path blocks missing/stale Apply proof and unrelated tree changes; every push/receipt/transition relation was not established | external push reconciliation and World State linkage `UNKNOWN` |

This is the known-surface matrix from the bounded source audit, not a claim that every mutation-capable entry point in every package has been found.

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

| Producer/المعنى | المصدر | الدلالة والحد | الاختبارات |
|---|---|---|---|
| Execution proof projection | `execution-proof.ts:119-152` | يبني projection من parameters؛ لا يعيد التحقق من provenance | acceptance tests شُغّلت حاليًا ونجحت؛ لم تُشغّل كل projection consumers |
| Canonical proof | `proof-foundation.ts:163-170,183-346,378-408`؛ loader عند `:450-545` | مسار verifier canonical واحد يعيد تحميل ويربط durable execution/acceptance/evidence/plan/revision/scope/delivery للـpath المؤهل | `proof-foundation.test.ts` شُغّل حاليًا ونجح؛ cross-surface closure غير مثبت |
| Runtime Gate C evidence artifact | `runtime-start-gate-c-proof.ts:95-410`; builder/verifier handoff in `recipe-operation-runner.ts:1744-1785`, `ai-execution-acceptance.ts:1393-1451,1766-1783`; consumer `proof-foundation.ts:638-684` | ليس producer مستقلًا لـCanonical `PROVEN`: يبني artifact server-side من action/effect/observations/identity، ثم يعيد الـloader اشتقاقه ويرفض mismatch | اختبار `recipe-operation-runner.test.ts` لمسار runtime.start مسجل 2/2؛ API transition suite الحالية ضمن 57/57؛ لا يثبت ذلك replay recovery بالكامل |
| Workflow phase | `workflow-phase-execution.ts:34-71,155-196` | verdict محلي باسم `PROVEN` إلى انتقال phase/objective؛ لا يثبت proofRequired أو قبولًا durable. final Goal completion يمر عبر `loadCanonicalProof` | اختبار integration مسجل سابقًا فشل عند غياب required evidence؛ لم يُعد تشغيله الآن |
| Objective/claim planning | `objective-claim-plan.ts`, `tool-execution-engine.ts:4440-4491`, chat claim/evidence reducers | قد تعني `PROVEN` اكتمال مسارات evidence المطلوبة في projection؛ لا تثبت وحدها الدلالة semantic للـclaim | توجد اختبارات objective/source revision؛ جرى فحص المصدر، ولم تُشغّل suite مخصصة الآن |
| Evidence integrity / semantic trace / forensic finding | `evidence-integrity.ts`, `semantic-trace.ts`, `forensic-diagnostics.ts`, `chat-agent.ts` | claim, trace edge, production reachability, أو forensic finding verdict محلي؛ ليست كلها نتائج acceptance واحدة | اختبارات هذه المكونات لم تُشغّل في جولة التحقق الحالية |
| Task Objective / task acceptance | `task-execution-service.ts`, `task-objective-contract.ts`, `ai-execution-acceptance.ts` | `PROVEN` أو `passed` محلي لعقد validator/task؛ لا يتحول إلى Goal/Mission Canonical Proof من دون loader وربط صريح | acceptance tests الحالية ناجحة؛ task-specific cross-surface coverage غير مثبت هنا |
| Recipe/Mission/apply | `recipe-operation-runner.ts`, `mission-runtime.ts`, `routes/ai/chat.ts` | statuses محلية بعقود مختلفة؛ لا equivalence أو canonicality عالمية | اجتاز `recipe-operation-runner.test.ts` و`routes/ai/missions.test.ts` (29/29 لكل ملف)، واختبار registry (7/7). هذه تغطية لمسارات محددة ولا تثبت canonicality عامة |
| Shadow/strategy replay and candidate receipts | `shadow-replay.ts`, `strategy-replay-case-proof.ts`, `strategy-candidate-extractor.ts` | receipt/status لا يمنح proof؛ المستهلك يعيد تحميل Canonical Proof ويربط المحاولة/الهوية | `missions.test.ts` و`proof-foundation.test.ts` شُغّلا حاليًا ونجحا؛ جميع recovery variants لم تُغط |
| Benchmark / quality projection | `benchmark/live-response-quality.ts`, `confidence-projection.ts` | جودة نموذج/حالة اختبار أو confidence projection؛ لا تمنح قبول تنفيذ | لم تُشغّل suites الخاصة بها في هذه الجولة |

**العدد المثبت:** مسار إنتاجي واحد لـCanonical Proof الفردي (`composeCanonicalProof` مع `loadCanonicalProof`). `runtime_start_gate_c` دليل specialized يستهلكه هذا verifier، وليس verifier أو authority ثانية. `loadCanonicalDelegationProof` helper-only ولا يظهر له caller إنتاجي؛ لا أعدّه authority عاملة ثانية. **إجمالي كل مصادر/إسقاطات اللفظ `PROVEN`: `UNKNOWN`**؛ لم يثبت اكتمال جرد كل assignments/defaults/serialization في الحزم والمسارات كلها. لا يجوز عد كل سلسلة `PROVEN` كإثبات من النوع نفسه.

### 6.3 Canonical Authority

الإجابة الثنائية عن وجود سلطة واحدة لكل استعمال عالمي للوسم `PROVEN`: **NO**. يوجد verifier Canonical Proof محدد في `composeCanonicalProof`/`loadCanonicalProof` (`proof-foundation.ts`)، بينما workflow phase وtask/recipe/report/replay تحمل statuses أخرى بالاسم نفسه. `execution-proof.ts` ليس authority: هو builder/parser لإسقاط acceptance.

Canonical verifier يرفض `evidenceRequired=false` (`proof-foundation.ts:301-319`) ويتحقق من روابط execution/acceptance/evidence/plan/revision. لمسار `runtime.start` يعيد اشتقاق Gate C artifact من durable rows ويطابق hash الـartifact المخزن (`proof-foundation.ts:638-684`). لكن تطابق candidate/revision في بعض metadata مشروط بوجود القيم، وscope المتوقع للcandidate اختياري في بعض الاستخدامات؛ الشمول عبر كل producers `PARTIAL`.

### 6.4 Claim Closure

`acceptedClaimRefs` لا يُحفظ إلا مع نجاح evidence المكتمل و`PROVEN` (`ai-execution-acceptance.ts:1926-1936`). في المقابل، `objective-claim-plan.ts` يستطيع إسقاط claim محليًا كـ`PROVEN` عندما تكون كل مساراته المطلوبة موجودة في retained-read map؛ هذا coverage signal، لا تحقق دلالي مستقل من محتوى claim. توجد اختبارات objective/claim/source revision في `ai-execution-state.test.ts:236+`، لكن لا يثبت ذلك إغلاق جميع claims في كل API/report/recipe. هل يستطيع claim واحد من N رفع النتيجة العامة خارج الـverifier؟ `UNKNOWN`.

### 6.5 False PROVEN Paths / Recheck of Prior Claims

| الادعاء السابق | الحكم الحالي | الدليل/الحد |
|---|---|---|
| `chat-agent.ts` يستدعي file/Git executor مباشرة | `FALSE / OUTDATED` | يدخل عبر tool loop/scoped-read ثم dispatcher؛ exports منخفضة المستوى في مواضع أخرى تظل سطحًا منفصلًا |
| complete read → `PROVEN` | `FALSE / OUTDATED` للمسار المفحوص | verdict المفقود يبقى `NOT_RECORDED`; اختبار acceptance يمنع الاستدلال من القراءة وحدها. لا تعميم على كل status غير canonical |
| `execution-proof.ts` هو verifier | `FALSE / OUTDATED` | projection builder/parser؛ canonical verifier في `proof-foundation.ts` |
| workflow phase يمرر `PROVEN` | `CONFIRMED` كـphase-local verdict فقط | القيمة لا تساوي `proofRequired=true` أو acceptance؛ integration evidence المسجل يبين فشل acceptance عند غياب required evidence، والـfinal Goal completion gated بالـCanonical Proof |
| اختياري evidence يمكن أن يصبح canonical proof من legacy projection | `FALSE / OUTDATED` في المسار المفحوص | durable flag يحول legacy `PROVEN` إلى `NOT_REQUIRED`، canonical verifier وإغلاق Episode يرفضان flag=0 |
| غياب producer صالح لـ`runtime.start` | `FALSE / OUTDATED` | `deriveRuntimeStartGateCProof` ينتج artifact مرتبطًا بالمحاولة/الأثر والملاحظات؛ `proof-foundation.ts:638-684` يعيد اشتقاقه ويرفض عدم التطابق. لا يثبت هذا نجاح Strategy Replay/recovery end-to-end |
| Mission-linked Apply يحقق evidence-required success | `FIXED + TESTED (2026-10-03)` للمسار المغطى | request يحفظ `apply_changes_v1`؛ acceptance يعيد اشتقاق artifact من الأحداث الدائمة وOBSERVED effect والملاحظات المربوطة بالمحاولة، ويفشل مغلقًا عند غيابها؛ D2 يبقى gate منفصلًا. لا يثبت ذلك إغلاق E2/E3 عالميًا |

### 6.6 100% Gate

يلزم جرد producer/consumer كامل للـ`PROVEN`، وفصل type/contract بين phase-local status وCanonical Proof، وتثبيت verifier خادمي واحد لكل قبول canonical، وربط claims وscope/revision/candidate بمتطلبات كل surface، ثم تغطية cross-surface/resume/crash/replay. وجود verifier واحد لا يكفي إن بقي producer آخر قادرًا على منح consumer نجاحًا مكافئًا.

## 7. Closed-Loop World Agent

### 7.1 World State

`world-state.ts:73-115,432-492` يوفر materialization وrevision وscoping facts؛ والـmaterializer ينشئ/يحدّث facts من observations موثوقة ويستعمل حالات مثل `believed` و`contradicted` و`superseded`. مسار القراءة التخطيطي يقيّد facts إلى project/episode/task scope ومراجعة المشروع والبيئة ومصادر observations كاملة وحديثة، ثم يحدّ النتيجة إلى ثمانية facts. لقطة التطوير الحالية تحتوي 164 World Fact. هذا يثبت belief-like storage قائمًا على الملاحظة في حدود المسار، لا أن World State هو مصدر قرار authoritative عام أو نظام belief/learning مكتمل.

### 7.2 World Transitions

- `runtime.start`: `recipe-operation-runner.ts:1283-1348` يربط prestate وparent/environment revision؛ و`runtime-start-transition.ts:437-630` يتحقق من acceptance/effect والهوية والملاحظات المباشرة/الحديثة ثم materializes. الحالة: `IMPLEMENTED` لمسار محدد.
- `apply-changes`: route في `routes/ai/chat.ts` يخزن نمط الإثبات `apply_changes_v1` ويستدعي acceptance بعد promotion؛ finalizer يعيد اشتقاق artifact من السجلات الدائمة ويشترطه قبل قبول النجاح. اختبار Mission-linked Apply/D2 اجتاز؛ D2 يظل معتمدًا على observations وانتقال plan-bound مستقل. الحالة: acceptance وtransition `IMPLEMENTED + TESTED` للمسار المغطى؛ عمومية lifecycle ما زالت `PARTIAL`.
- لا يثبت المساران التغطية لكل mutation-capable operation: `PARTIAL`.

### 7.3 World Delta

- `runtime-start-transition.ts:599-630` يستنتج `changedFactRefs` من materialized facts ذات `sourceObservationIds` المطابقة للـobservations المختارة.
- `finalizeApplyChangesTransition` في الملف نفسه `:967-990` يmaterialize observations/revision ثم يكتب `changedFactRefs: []` عند `:975`. test `runtime-start-transition.test.ts:547-606` يثبت نجاح materialization ولا يفحص صحة `changedFactRefs`؛ لا يوجد إثبات أن empty مقصود أو صحيح. النتيجة `PARTIAL / UNKNOWN semantic intent`.
- لقطة قاعدة التطوير الحالية: 8 transitions `materialized/fresh` وواحد `terminal_failed/unknown`. لم يُحدّث هذا الاستعلام دلالات delta أو يثبت أي صف منها كمسار runtime/apply بعينه.

### 7.4 Accepted Effect → World State

runtime.start يربط effect bundle وملاحظات مستقلة بالtransition؛ apply-changes يربط transition بالـcandidate/live tree observations والrevision. الاختبارات ذات الصلة تشمل `runtime-start-transition.test.ts:797-868,883-1064` وapply materialization عند `:547-606`. لا يثبت ذلك أن كل accepted effect يملك World transition أو أن كل transition يمثل accepted effect.

### 7.5 Planner Integration

- `runtime-start-hypothesis-replan-context.ts:98,231` يصف Mission context بأنه advisory؛ ليس authority لاختيار action.
- `recipe-operation-runner.ts:1320-1348` يمنع effect عند revision conflict قبل action في runtime.start.
- `runtime-start-transition.test.ts:797-868` يثبت أن successor ينتظر materialization للـtransition؛ لا يثبت أن planner اختار قرارًا مختلفًا بسبب facts جديدة.
- `apply-change-mission-gate.ts:438-453` يتحقق من transition/resulting revision/requirement/plan؛ لا يثبت أن planner استهلك World State الجديدة أو غيّر القرار.

الحكم على الادعاء القديم أن planner integration advisory: `PARTIALLY CONFIRMED`؛ بعض السياق advisory، لكن توجد revision/effect gates وsuccessor gates أقوى على runtime.start/apply. **التغيير الفعلي للقرار/action عمومًا `UNKNOWN`.**

في auto-replan، `buildMissionPlanPreview` يبني intent/plan أولًا من الرسالة والهدف، ثم يsanitize ويضيف `worldStatePlanningRead` إلى `replanContext`. بصمة القراءة تدخل هوية/revision الخطة في مسار replan، لكن لا يظهر في هذا المسار أن facts تُمرر إلى `buildGeneralTaskPlan` كمدخل يغيّر اختيار العقدة أو action؛ لذا freshness/revision binding موجود جزئيًا، وcausal decision change غير مثبت.

### 7.6 Belief Update

يوجد server-owned World Fact store observation-backed، لكنه ليس belief updater عامًا: في الجرد المحدود لم يظهر writer مستقل لحالات `confirmed` أو `retracted` خارج materialization، وحقول hypothesis/replan تصف بعض النتائج صراحةً بأنها `unresolved_unvalidated_forecast`. لا يوجد دليل أن planner يستهلك تحديث belief عامًّا أو يحدّث درجة ثقة سببية. الحكم: primitive محدود `IMPLEMENTED`؛ belief authority العامة `UNKNOWN / ADVISORY`.

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
3. `runtime-start-gate-c-proof.ts:95-410`: يشتق artifact server-owned من execution/attempt/action/effect/observations؛ و`recipe-operation-runner.ts:1744-1785` يثبت proof mode في الطلب durable.
4. `ai-execution-acceptance.ts:1393-1451,1766-1783` يحفظ artifact كـevidence مطلوبة؛ `proof-foundation.ts:638-684` يعيد اشتقاقها ويقارنها بالمحفوظ قبل قبول Canonical Proof.
5. `runtime-start-transition.ts:599-630`: materialization واشتقاق fact refs/revision؛ `runtime-start-transition.test.ts:797-868` يثبت أن successor ينتظر transition المطابق.

هذا يثبت transition gate لمسار runtime.start فقط؛ لا يثبت general planner decision change. كما أن مدخل user-objective إلى recipe في كل الحالات لم يُتتبع هنا: `UNKNOWN`.

### Trace B — `apply-changes` (مسار مختلف)

1. `routes/ai/chat.ts:16017-16073`: action/effect contract وbefore tree-hash.
2. `:16206-16420`: promotion والتحقق وملاحظات after/tree/environment.
3. `:16798-16829`: ينادي `finalizeExecutionAcceptance` بنتيجة `SUCCEEDED` عند `allOk`. الطلب يعلن `sourceEvidenceRequired=false` و`reads=[]` لأن finalizer يشتق artifact متخصصًا من `apply_changes_v1`؛ عدم وجود retained source reads لا يعني غياب proof artifact.
4. `:16768-16795`: ينشئ transition المرتبط بـeffect والملاحظات؛ `runtime-start-transition.ts:871-990` يmaterialize المراجعة ويكتب `changedFactRefs: []`.
5. `:16858-16880`: finalize transition ثم wake Mission goal.

اختبار Mission-linked Apply الحالي في `routes/ai.test.ts` يجتاز قبول التنفيذ وD2 وdispatch للـsuccessor. `apply_changes_v1` يثبت `proofRequired` و`effectRequired` في الطلب الدائم؛ `finalizeExecutionAcceptance` يعيد اشتقاق artifact من أحداث `ACTION_REQUESTED` و`ACTION_COMMITTED`، وEffectBundle بحالة `OBSERVED`، وملاحظات before/after المرتبطة بالمحاولة. إذا غاب الدليل أو لم يطابق، يُرفض النجاح؛ وCanonical loader يعيد اشتقاق artifact من الصفوف الدائمة. لا تُعد `reads=[]` نقصًا هنا لأن artifact هو دليل هذا المسار، ولا يثبت `proposalId` وحده شيئًا. يبقى D2 منفصلًا، مربوطًا بالملاحظات الحية وانتقال الخطة. اختبار `runtime-start-transition.test.ts:547-606` لا يثبت delta refs أو قرار planner لاحق؛ `changedFactRefs: []` يظل فجوة مستقلة.

## 9. Bypass Inventory

| Bypass / gap | المصدر | ما يتجاوزه أو يتركه | التأكيد |
|---|---|---|---|
| raw exports من package root | `index.ts` قبل E1؛ أزيلت، واختبار dispatcher boundary يمنع رجوعها | central dispatcher authorization/approval/manifest | `FIXED + TESTED` على سطح package الحالي |
| server-internal import additions | `@workspace/ai-orchestrator/server-internal/execution` | قد تنشئ مستدعيًا جديدًا خارج الحدود الحالية | اختبار AST يسمح بمستدعيي API الحاليين فقط؛ حالات خارج سورس API لم تظهر في المسح الحالي |
| observation-only execution terminalization | `agent-episode-ledger.ts:1284-1318` | `finalizeExecutionAcceptance` / acceptance row | استثناء محدد وfenced؛ ليس acceptance، لكنه writer منفصل لحالة `completed` |
| phase-local `PROVEN` | `workflow-phase-execution.ts:179-196` | لا يتجاوز final Goal verifier، لكنه يشارك القيمة اللفظية | assignment مؤكد؛ التمييز لا يملك test مخصصًا ظاهرًا |
| apply delta refs الفارغة | `runtime-start-transition.ts:967-990` | اشتقاق changed-fact attribution | الكتابة `[]` مؤكدة؛ هل المقصود صحيح `UNKNOWN` |
| Git path symlink handling | `git-tools.ts` مقارنة بـ`file-tools.ts:safePath` | يضعف realpath symlink containment المتاح في أدوات الملفات | لا يثبت تجاوز dispatcher؛ scope guarantee أضعف وrace behavior `UNKNOWN` |
| استعادة الأثر الخارجي بعد W2–W4 | أسطح mutation المختلفة | observation/reconciliation المستقل | فجوة عامة confirmed؛ كل مسار بعينه `UNKNOWN` ما لم يثبت خلافه |

## 10. Authority Inventory

| المجال | authority المثبتة | الحد |
|---|---|---|
| tool dispatch | `executeSingleTool` داخل engine؛ package root لا يصدر raw executors، والـinternal subpath محصور في callers خادميين | authority على model-call ingress مثبتة في workspace الحالي؛ لا يعني ذلك إغلاق timeout/replay/resource guarantees لكل executor |
| execution acceptance | `finalizeExecutionAcceptance` للمسار المركزي | writer observation-only fenced خارجها؛ تقارب كل السطوح غير مثبت |
| Canonical Proof | `composeCanonicalProof` / `loadCanonicalProof` في `proof-foundation.ts` | ليست كل status باسم `PROVEN` Canonical Proof |
| World State | materializer وtransition-specific finalizers | apply delta attribution ناقص/غير محسوم، planner authority العامة غير مثبتة |
| execution terminal status | `finalizeExecutionAcceptance` للمسار المقبول؛ `terminalizeP75MeasurementContinuationEpisode` يكتب `completed` observation-only | status terminal لا يساوي acceptance؛ terminal writers لكل السطوح غير مكتملين |
| Goal/Mission completion | Goal writers المكتشفة تفحص Canonical Proof عند إنشاء completion؛ Mission PATCH يعيد فحص كل active Goal | auto-status sync وبعض dependency scheduling تستهلك statuses المخزنة؛ freshness/proof التاريخي للـdependency غير محسوم |
| World Fact status | materialization من observations هو writer المثبت في الجرد المحدود | وجود enum لحالات أخرى لا يثبت وجود writer أو مسار تأكيد يدوي |

## 11. Test Coverage Matrix

`present` يعني وجود test code؛ `ran` يعني تشغيل الأمر وتسجيل نجاحه في هذا التقرير. لا تعني أي منهما تغطية universal.

| invariant | Unit | Integration/API | Cross-surface | Crash/race | E2E | الوضع |
|---|---|---|---|---|---|---|
| dispatcher policy/bounds | boundary + engine suites شُغّلت من الحزمة: 447/447؛ سجل سابق 4/4 boundary | ai-repair-validation 15/15 سابقًا؛ typechecks مسجلة | AST allowlist للـserver-internal callers ناجح | لا coverage لكل timeout/replay/runtime executor أو root race | غير مثبت هنا | `E1 IMPORT BOUNDARY PASS`; operational closure ما زالت جزئية |
| durable execution/acceptance | موجودة | `ai-execution-retry.integration.test.ts`, acceptance suites؛ 39 اختبارًا شُغّلت | مجموعة surfaces كاملة غير مثبتة | بعض lease/recovery tests موجودة؛ W0-W9 جميعها غير مغطاة | لا إثبات شامل | `INTEGRATION-TESTED` لمسارات محددة |
| optional evidence/Canonical Proof | `ai-execution-acceptance.test.ts`, `proof-foundation.test.ts`؛ شُغّلت ضمن 39 | D2 duplicate legacy test ناجح | global producer/consumer map غير مكتمل | resume tests موجودة؛ لا تعميم | لا | `TESTED / INTEGRATION-TESTED` محدود |
| runtime World transition | suite الحالية شُغّلت ضمن API: transition/materialization tests ناجحة | runtime-start transition tests موجودة | apply/runtime غير موحدين في decision proof | بعض stale/retry/rollback؛ لا كل W0-W9 | لا planner-decision E2E مثبت | `TESTED` لمسارات محددة |
| recipe/Mission canonical completion | `recipe-operation-runner.test.ts` و`routes/ai/missions.test.ts` مسجلان 29/29 لكل منهما؛ Gate C targeted test مسجل 2/2؛ `routes/ai.test.ts` الحالية 191/191 | مجموعات proof/mission/effect/reconciliation المرتبطة 111/111؛ API typecheck و`git diff --check` ناجحان | Mission-linked Apply acceptance وD2 ناجحان للمسار المختبر؛ ذلك لا يثبت universal E2/E3 | full replay recovery / كل crash windows غير مغطاة؛ full API suite انتهت مهلة الأداة بلا نتيجة | لا | `TESTED on scoped path; E2/E3 remain PARTIAL` |
| apply World Delta/planner change | tests تثبت materialization لا معنى changed refs | Mission D2 route موجود | لا تغيير قرار مثبت | لا crash delta proof | لا | `PARTIAL / UNKNOWN` |
| provider/live/release | — | لم يشغل | — | full process recovery لم يشغل | dashboard journey لم يشغل | `UNKNOWN` |

## 12. False Confidence Risks

- أُزيلت raw tool functions من package root؛ server-internal subpath ليس authorization بديلًا، ويجب إبقاء مستهلكيه خادميين ومحدودين بالاختبار.
- `PROVEN` في phase/task/recipe/replay ليس بالضرورة Canonical Proof؛ و`execution-proof.ts` يسقط status ولا يتحقق وحده من provenance.
- وجود execution `completed` لا يثبت acceptance؛ المسار observation-only يصرّح `createsAcceptance:false`.
- schema/default `evidenceRequired=0` أو وجود `PROVEN` في legacy JSON ليسا دليل proof؛ العلم الدائم/verifier هما الحاكمان في المسار المفحوص.
- `runtime.start` transition صحيح على مساره لا يغلق World Agent؛ apply transition يكتب changed refs فارغة ولا يوجد planner decision-change proof.
- وجود producer مخصص لـGate C لا يثبت replay كاملًا؛ وفي المقابل receipt بحالة `proven` في قاعدة التطوير هو projection مخزن، لا إعادة تحقق Canonical Proof.
- خلل Mission-linked Apply السابق عولج للمسار المختبر عبر artifact مشتق من السجلات الدائمة؛ لا تعمم ذلك على كل mutation surfaces ولا تخلط acceptance مع D2 أو مع إغلاق E2/E3.
- وجود retry/replan/replay primitive لا يثبت recovery للأثر الفيزيائي أو learning.
- test موجود لا يساوي اختبارًا ناجحًا حاليًا ولا cross-surface closure.
- نجاح أداة/receipt لا يكفي لإكمال Recipe/Mission: يلزم loader الحالي؛ Apply المحدد يملك الآن artifact وloader binding مختبرين، بينما freshness والتغطية العامة لكل producers/consumers ما زالت مفتوحة.
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

**إغلاق محدود (2026-10-03):** لم يعد تعارض Mission-linked Apply blockerًا على المسار المختبر: artifact `apply_changes_v1` يعاد اشتقاقه من evidence دائمة، والـacceptance يفشل مغلقًا عند غيابه أو عدم تطابقه؛ اجتازت اختبارات Apply/D2 ذات الصلة. لا يغلق هذا lifecycle بقية الأسطح أو دلالات `PROVEN` عالميًا.

لم يثبت هذا التدقيق blocker مصنفًا P0 على مسار محدد؛ هذا ليس إثباتًا لغياب مخاطر أخرى.

## 14. Exact File-by-File Implementation Plan

1. **E1 — DONE (2026-10-02):** أزيلت raw executor functions من `lib/ai-orchestrator/src/index.ts`; حُفظت `runBoundedCommand` و`runRegisteredCommand` في `server-internal/execution` لاستخدام الخادم الموثوق فقط؛ ويمنع اختبار المصدر إضافات غير معتمدة. لا يغيّر هذا إغلاق بقية Reliable Tool Agent.
2. **E2 — PARTIAL (2026-10-02):** إسقاط chat/detail وexecution progress يعرض `UNKNOWN` عند غياب acceptance بدل استنتاج `SUCCEEDED` من `completed`؛ P7.5 observation-only بقي بلا acceptance وبلا تغيير لحدود replan. Mission tool-loop يمنع استئناف marker `started` لأداة `block_after_prior_marker` ويُنهي المحاولة كـuncertain وغير قابلة لإعادة المحاولة؛ safe reads وmarkers المكتملة محفوظة. لم يُغلق جرد writers/consumers ولا كل أسطح mutation.
3. **E2/E3 — Mission-linked Apply acceptance FIXED + TESTED (2026-10-03):** الطلب يحفظ `apply_changes_v1` وproof/effect requirements؛ finalizer يشتق artifact من أحداث action/commit الدائمة وOBSERVED effect والملاحظات المربوطة بالمحاولة، ويرفض النجاح إذا تعذر الاشتقاق؛ Canonical loader يعيد فحص artifact. اجتاز `routes/ai.test.ts` (191/191) ومجموعات Apply/proof/D2/effect/reconciliation ذات الصلة (111/111). لا تعمم الإغلاق: ما زال مطلوبًا جرد writers في `ai-execution-state.ts`, `ai-execution-acceptance.ts`, `agent-episode-ledger.ts` وكل mutation surface، وإضافة fault injection عند W2–W8 لاختبار duplicate effect وunknown outcome وresponse loss؛ لا يستنتج recovery success من checkpoint.
4. **E3 — PARTIAL (2026-10-02):** صار ربط source revision وcandidate identity سياسة scope صريحة في Canonical Proof، مع رفض غياب الهوية المتوقعة أو تعارضها. Shadow Replay يحفظ `proofRequired` في الطلب durable منذ الإنشاء، ويتطلب evidence acceptance كاملًا؛ وكتابة receipt وحذف workspace مقيدان بمالك lease وattempt الحاليين لمنع سباق البدء المباشر مع reconciliation. كما بقيت attestation لمسار pnpm مقيدة بالمسار المستخرج من package metadata. أُغلق مسار Gate 3 الذي كان يحوّل `PROVEN` داخل receipt محفوظ إلى قبول ترقية: المستهلك يعيد تحميل Canonical Proof من execution/acceptance/evidence rows ويربطه بهوية replay والقبول والمحاولة والعملية والمراجعة والمرشح ونسخة الخطة الحالية؛ واجتازت 5 اختبارات Gate 3. وأضيفت 5 assertions terminal عبر loader لحالات الإلغاء، وانتهاء lease، وstale worker، وتدوير المحاولة. اختبار runner حقيقي يؤكد أن receipt الخاص بـ`database.inspect.project` لا يصبح Canonical Proof (`evidenceRequired=0`, projection `NOT_REQUIRED`, والـloader غير مقبول). اختبار Goal PATCH يثبت أن projection يعلن `PROVEN` لا يكفي إذا كان snapshot لمحاولة أخرى: loader يعيد `missing_evidence_snapshot`، والـroute يرفض completion مع rollback. واختبار audit-export يثبت أن `execution.proof` المأخوذ من checkpoint قد يبقى `PROVEN` بينما `operationEvidence.proof` و`proofSpine` يرفضان acceptance/snapshot لمحاولة سابقة؛ الـspine يعرض attempt الحالي ويبقى غير مقبول، مع حجب المعرّفات الداخلية في التصدير. واختبار candidate-admission يثبت أن acceptance/snapshot صحيحين لهوية proposal لكنهما من محاولة أقدم لا ينشئان skill candidate؛ route يعيد `SKILL_CANDIDATE_PROOF_NOT_AVAILABLE`. واختبار Gate 4 كشف أن التسجيل كان يقبل receipt رغم اختلاف attempt للـreplay acceptance/snapshot (201)؛ أصلحناه بحيث يعيد تحميل Canonical Proof الحالي لكل من candidate المصدر والـreplay، ويربط acceptance IDs وtrajectory بالـreceipt قبل الإدخال. كما كشف expired-lease recovery قبول receipt محفوظًا وإرجاع 200 رغم اختلاف attempt؛ recovery الآن يعيد تحميل proof من execution/acceptance/evidence الحالية ويربط acceptance ID والـtrajectory بالـreceipt، وإلا ينهي replay كـfailed ويرجع 409. واختبار approval كشف promotion بـ200 بعد جعل proof قديمًا؛ route الموافقة الآن يعيد فحص paired baseline وCanonical Proof الحالي للمصدر والـreplay داخل transaction قبل supersede أو promotion، ويرفض mismatch بـ409 ثم ينجح بعد استعادة attempt. كما يظل تصنيف FACT منفصلًا عمدًا وله اختبار تكامل قائم. الجرد الإنتاجي المحدود تتبع writer وCanonical loader عبر Goal/Mission وreplay/promotion وstrategy وtask وoperation-evidence/proof-spine؛ وتبقى تغطية بعض هذه الحدود helper-only أو غير موجودة. اجتازت الاختبارات المركزة وAPI typecheck و`git diff --check`، وبدأ API Server بنجاح؛ E3 ما زال جزئيًا.
5. **E3 — العمل المتبقي:** أكمل أي writers/consumers خارج الجرد الإنتاجي المحدود، وأضف اختبارات durable-loader للمستهلكين غير المغطين؛ أضيف اختبار استعادة Strategy Replay الإيجابية لإيصال محفوظ، لكن تبقى نوافذ التعطل بين التنظيف والكتابة والحالة النهائية وبعض case/recovery variants غير مغطاة. أما operation-evidence/proofSpine فله اختبار stale-attempt عبر audit-export، ولم يظهر consumer مستقل لـMission/Replay-specific proofSpine. تبقى Task Objective receipts بوابة قبول مستقلة لا تدخل Canonical Proof ما لم يربطها عقد صريح. سجل recipes الحالي يعلن `artifact_only`؛ يلزم تدقيق ملاءمة هذا التصنيف لكل recipe وتحديد ما إذا كان أي منها يحتاج retained source evidence. وحدّد أبناء التفويض المطلوب proof لهم قبل تفعيل جامع Canonical Delegation Proof. لم يثبت bypass إنتاجي من FACT أو delegation loader؛ لكن loader الخاص بالتجميع غير موصول للإنتاج ويختار كل أبناء التنفيذ المباشرين لغياب required-child policy، لذا لا يجوز تفعيله قبل حسم العقد. أبقِ E3 جزئيًا حتى استكمال التغطية وحسم هذه الحدود.
**E3 runtime.start producer/consumer finding (updated 2026-10-03):** `deriveRuntimeStartGateCProof` في `runtime-start-gate-c-proof.ts:95-410` ينتج artifact خادميًا مربوطًا بالexecution/attempt/action/effect والobservations؛ `recipe-operation-runner.ts:1744-1785` يثبت نمط الإثبات في الطلب، و`ai-execution-acceptance.ts:1766-1783` يحفظه كـevidence مطلوبة. `proof-foundation.ts:638-684` يعيد اشتقاق artifact من الصفوف الدائمة ويقارن hash قبل قبول Canonical Proof. اختبارا `recipe-operation-runner` المركزان 2/2 مسجلان لهذا المسار. إذن الادعاء السابق بغياب producer صالح `FALSE / OUTDATED`. لا يزال إثبات Strategy Replay الإيجابي الكامل واستعادة receipt `proven` عبر runner غير مكتملين؛ E3 تبقى `PARTIAL`.

**E3 Strategy candidate/replay consumer audit (updated 2026-10-03):** مستهلك candidate يتحقق من attempt/revision/operation والقبول وeffect observations، ثم يعيد تحميل Canonical Proof للمحاولة الحالية ويربط acceptance ID والعملية والمراجعة قبل persistence (`strategy-candidate-extractor.ts:388-445,447-706`). مستهلك Strategy Replay يعيد تحميل Proof نفسه للمحاولة الحالية ويربط acceptance/effect/revision ثم يعيد materialize binding digest من durable rows عند التحقق (`strategy-replay-case-proof.ts:216-298`). Gate C أو digest/receipt محفوظ وحده لا يمنح candidate أو replay Canonical Proof. أُضيف producer `runtime.start` المتخصص، لكن `runRegisteredStrategyReplayCase` ما زال له نتيجة `incomplete/runner_blocked` في الاختبار المسجل؛ سبب الإيقاف end-to-end واستعادة receipt `proven` عبر runner كامل غير مثبتين. قاعدة التطوير تعرض receipt-status row واحدة `proven`, אך هذا الإسقاط وحده لا يثبت Canonical Proof الحالي. تغطية positive candidate/replay/recovery تظل `PARTIAL / UNKNOWN`.

**E3 stored receipt consumer finding (updated 2026-10-03):** revalidation يطابق project/case/candidate/source revision/episode/execution/attempt/acceptance/effect/proof identity مع التعريف الحالي، واختبارات الخلوص تغطي هذا الربط. إضافة runtime Gate C artifact تزيل ادعاء أن غياب source producer يمنع التقدم؛ لكن استعادة receipt `proven` عبر Strategy Replay runner كامل ما زالت غير مثبتة. سجل التطوير يحوي receipt-status واحدة `proven`، ولا يكفي هذا الصف بدل إعادة تحميل Proof الحالي. تبقى recovery/positive runner coverage فجوة E3.

**E3 proofSpine consumer audit (2026-10-02):** وجد الجرد أن `loadOperationEvidence` ينشئ `proof` و`proofSpine` من نتيجة `loadCanonicalProof` الحالية؛ chat وbenchmark وaudit-export تستخدم هذا loader، ولم يظهر direct Mission/Replay-specific `projectProofSpine` consumer. شُغّل اختبار `redacts owner-scoped export and refuses prior-attempt Canonical Proof` بنجاح (1 passed): يحمّل audit-export execution في attempt 1 مع acceptance/evidence محفوظين لـattempt 0، ثم يثبت أن `operationEvidence.proof` و`proofSpine` ليسا `PROVEN` وأن spine يحدد attempt 1. هذا يغطّي مسار loader/spine عبر audit-export فقط؛ لا يثبت استعادة Strategy Replay receipt، التي تبقى غير مغطاة end-to-end.

**E3 Goal acceptance / Task Objective boundary (2026-10-02):** الإسقاط الأولي لـGoal acceptance يحسب `verdict` من `evidenceComplete`، لكن مسار linked-task يعيد تحميل Canonical Proof من execution/acceptance/evidence الحالية ثم يستبدل verdict وقرار حالة Goal بنتيجة ذلك الفحص؛ ومسار Mission completion المباشر يطبق gate Canonical Proof أيضًا قبل `completed`. لذلك `evidenceRequired=0` أو Task Objective receipt وحدهما لا يرفعان Goal إلى Canonical `PROVEN`. لم يظهر استهلاك Task Objective داخل `loadCanonicalProof`؛ status والـvalidator receipts بوابة مستقلة. مرّرا المساران الحاليان اللذان يحملان Task Objective status صريحًا، وجُعل غياب status في finalizer ينتج `INCOMPLETE` بدل استنتاج `PROVEN` من نجاح التنفيذ. هذا hardening لحد محلي، وليس إغلاقًا لـE3.

**E3 Mission terminal-status consumer boundary (2026-10-02):** `syncRecipeObjectiveState` لا يقبل completion جديدًا بلا execution: عند غيابه يحول Goal إلى `verifying` مع `canonical_proof_missing_execution`، وعند رفض loader يفعل الشيء نفسه؛ و`syncLinkedObjectiveState` يحمّل Proof للـGoal الحالي قبل جعله `completed`، كما أن final workflow phase يفعل ذلك، بينما المرحلة الوسيطة لا تغيّر Goal status. لكن مزامنة Recipe وTask وworkflow تحسب `Mission.status` تلقائيًا من statuses للـGoals الفعّالة فقط (`mission-runtime.ts:916-943`; `ai-execution-acceptance.ts:704-739,928-960`) ولا تستدعي `evaluateMissionCompletion`. هذا gate يُستدعى من Mission PATCH فقط في call sites الحالية، ويعيد تحميل Proof لكل active Goal (`missions.ts:1889-1896`; `mission-completion-gate.ts:199-260`). إذن الـGoal الذي أكمل للتو مُثبت، لكن الـGoals الفعّالة الأخرى تُستهلك كـstatuses مخزنة من دون aggregate Proof recheck. لا يوجد دليل على مسار عادي يكتب Goal جديدًا `completed` بلا Proof: كل writers المكتشفة لـGoal completion (Task، Recipe، apply-changes، final workflow، وGoal PATCH) تفحص Proof. لذلك هذه فجوة عقد/تغطية في freshness عند الإغلاق التلقائي للـMission، لا bypass مثبتًا. **تصحيح نتيجة الاختبار قبل الإصلاح:** إعادة التشغيل حينها أخفقت في 4 اختبارات من أصل 6؛ تفاصيل الإصلاح والتحقق الإيجابي الحالي موثقة أدناه. اختبار `deriveMissionStatusFromGoals` يختبر statuses فقط (`ai-execution-acceptance.test.ts:346-352`)، لا Proof لGoal فعّال آخر لحظة الإغلاق. كذلك `runMissionGoal` يعيد `status=completed` للـMission/Goal المخزن مسبقًا بعد فحوص ownership وplan revision وdelegation، من دون إعادة تحميل Proof الحالي؛ هذا إقرار بحالة terminal موجودة لا إنشاء Proof، لكنه قد يعرض صفًا تاريخيًا غير مثبت كنجاح عند إعادة الدخول. لم يظهر اختبار يعيد دخول هذه الحالة مع acceptance مفقود أو محاولة/مراجعة قديمة. تبقى E3 `PARTIAL`؛ فجوة freshness عند الإغلاق التلقائي للـMission لا تزال مستقلة عن الإصلاح أدناه.

**E3 Mission recipe artifact-only proof producer repair (2026-10-02):** سجل recipe الخادمي يحدد `proofEvidenceMode=artifact_only`، وMission يطلب proof صراحةً. الإكمال الناجح لا يقبل receipt أو capability output وحده: يلزم snapshot غير فارغ، ودليل لكل عقدة ناجحة مطابق لـrecipe/version وnode/evidence ID، ومربوط بقبول execution/attempt الحالي والعملية والمراجعة والمرشح؛ وتظل عملية الـdurable مستقلة عن هوية execution التي قد تظهر في validator evidence. اختبارات `candidate.verify` تثبت قبول الأدلة الحالية ورفض الدليل الموروث من محاولة سابقة؛ Mission recipe integration والـregistry يجتازان الاختبارات المركزة. أصلح fixture الاستعادة ليحفظ `workspaceRoot` الدائم، وبذلك يطابق فحص provenance الذي كان يرفض مسار النجاح. هذا إغلاق محدود لمنتج artifact-only المحدد، لا برهان على كل recipes أو نوافذ recovery؛ E1 يبقى `DONE` وE2/E3 يبقيان `PARTIAL`. لم يتغير نطاق E4–E8 ولم يبدأ Learning/Transfer/Generalization.

**E3 Mission dependency Proof consumption (2026-10-02):** `loadGoalDependencyState` يقرأ dependency goal IDs/statuses فقط (`mission-runtime.ts:127-147`)، و`runMissionGoal` يرجع مبكرًا للـGoal المخزن `completed` قبل إعادة فحص Proof (`:1294-1302`) ويفك اعتماد Goal تابع حين تكون كل dependency statuses `completed` (`:1304-1343`). الوصولية مدعومة بمسار PATCH: `UpdateGoalBody` يقبل `dependsOnGoalIds` و`planRevision` (`missions.ts:449-463`)، والـhandler يمرر revision المقدمة إلى `setGoalDependencies` (`:3233-3240`)، التي تتحقق من وجود Goals في Mission/Project نفسيهما ومن self-edge والدورات ثم تحفظ الحافة على revision المقدمة (`:541-616`)، لكنها لا تفحص revision أو Proof للـdependency Goal. بوابة completion لا تعمل إذا ظل الـGoal الهدف غير مكتمل؛ فهي لا تُستدعى إلا عندما تكون حالته الناتجة `completed` (`:3221-3249`). وبما أن replan يحتفظ بالـGoals المكتملة من revision قديم كسجل تاريخي (`:782-795,852-872`)، يمكن ربط Goal مكتمل قديم بحافة revision أحدث ثم يفكه scheduler اعتمادًا على status وحده. يظل غير محسوم هل Proof التاريخي يفي بعقد dependency الجديدة؛ لا يُحمّل scheduler Proof ولا يثبت ارتباطه بالـrevision/attempt المطلوبة. هذا فجوة freshness في مستهلك Canonical Proof، وليس دليلًا على أن مسارات الكتابة العادية تستطيع إنشاء completion جديد بلا Proof: `syncRecipeObjectiveState` (`:817-861,891-900`) وapply-changes (`:1546-1590,1637-1645`) ما زالا proof-gated، وPATCH completion يعيد تقييم Proof، كما أن Mission completion gate يعيد تحميل Proof لكل Goal (`mission-completion-gate.ts:121-163,199+`). اختبار `missions.test.ts:663-698` يغطي إنشاء الحافة وفحص الدورة لا revision mismatch؛ والاختبار `:591-629` يهيئ predecessor مكتملًا بإسقاط acceptance اصطناعي لا بـCanonical Proof، بينما `:631-660` يثبت بقاء Goals القديمة بعد replan؛ هذه تختبر أجزاء من السلوك ولا تغطي تسلسل PATCH الكامل. اختبار apply success يثبت المسار الصحيح بقبول Proof (`mission-runtime-apply-changes.test.ts:437-495`)، وحالات invalid proof/stale plan تبقى waiting (`:497-603`). لا يوجد اختبار يجمع dependency من revision قديم مع edge جديدة وProof غير مطابق، ولا اختبار للـearly return على Goal مكتمل. لا تغيّر runtime قبل حسم عقد صلاحية proof التاريخي عند dependency release؛ E3 تظل `PARTIAL`.

**E3 API terminal-status readback audit (2026-10-02):** `analysis.ts:386-460` يقرأ acceptance للمحاولة الحالية، لكن إذا غاب بينما `execution.status=completed` يصنع projection بـ`outcome=SUCCEEDED` و`reasonCode=ACCEPTED` و`acceptanceId=null`. تتبع completion writers بيّن أن analyze/review المدعومين يمران عبر `completeAiExecution` و`finalizeExecutionAcceptance` بمعاملة واحدة، وأن reconciliation لا يصنع completed ناجحًا بلا acceptance؛ لذلك fallback ليس reachable في التدفق الطبيعي، بل يمثل legacy/out-of-band row أو استعمالًا غير مدعوم. chat observation يستطيع كتابة completed بلا acceptance في مسار منفصل، لكن projection الخاص به يعرض `UNKNOWN/ACCEPTANCE_MISSING` ولا يوجد edge مدعوم يمرر execution الخاص به إلى helper التحليل. اختبار structured analysis يغطي success المعتاد، واختبار missing acceptance يهيئ صفًا يدويًا ويغطي generic chat projection فقط (`ai-stream-integration.test.ts:1012-1032`). كذلك Mission/Goal GET list/detail (`missions.ts:1247-1260,1791-1795,1946-1986`) وMission `/projection` (`buildMissionProjection` في `missions.ts:1090-1240`) يعرضون status المخزن بعد ownership checks دون إعادة فحص Proof؛ projection يضم أيضًا Task/Workflow/Execution statuses خامًا. الاستثناء هو `skillCandidate` المضمّن اختياريًا: يُعاد تحميل Canonical Proof ويُعرض فقط إذا اجتاز التحقق. هذه قراءات لا تكتب acceptance، لكنها قد تعرض terminal status قديمًا/غير مثبت؛ الاختبارات تغطي شكل projection الأساسي لا سجلات completed بلا Proof حالي. بوابة PATCH إلى Mission `completed` ما زالت محمية بـ`evaluateMissionCompletion`، واختبارات رفض الكتابة موجودة (`missions.test.ts:2126-2131,2302-2323`). تعامل مع status fields كـread models لا كـCanonical Proof؛ fallback analysis احتياط legacy غير مثبت كـproduction bypass، بينما عرض status المخزن بلا revalidation حدّ استهلاك ما زال غير محسوم.

**E3 task terminal vs Canonical Proof boundary (2026-10-02):** test delivery المتكامل ينشئ Task مرتبطًا بـGoal و`phase=null`؛ العمود nullable و`readMissionExecutionProfile` يحيل phase المفقود إلى legacy `analysis`، لذلك هذا المسار لا يدخل Mission tool loop ولا يطلب `proofRequired` أو Task Objective. يثبت الاختبار أن صف Task يصبح `completed` والـdurable acceptance `SUCCEEDED`/`completed` بلا Task Objective projection، بينما يبقى Goal `verifying` بverdict `INCOMPLETE` وMission `waiting` لغياب delivery receipt. هذا إكمال محلي عبر مسار legacy، وليس Canonical Proof للـGoal ولا محاولة رفض من `loadCanonicalProof`، ولم يظهر bypass لإكمال Goal/Mission. هل ينبغي السماح لـGoal-linked phase-less Task بهذا الإكمال المحلي بينما Goal proof غير مكتمل؟ العقد غير محسوم؛ لا تغيّر runtime semantics قبل حسمه، ويبقى هذا حدًا وفجوة قرار ضمن E3.

**E3 task API acceptance projection (2026-10-02):** `/api/tasks` و`/api/tasks/:taskId` يعيدان Task status المخزن، ويضيفان PublicExecutionAcceptance من أحدث execution مرتبط بالـTask مع اختيار acceptance المطابقة لنفس execution/attempt (`tasks.ts:119-147,193-207`; `ai-execution-acceptance.ts:getPublicTaskExecutionAcceptance(s)`). الاختبار يغطي أحدث attempt والـallowlist (`tasks.test.ts:90-209`). هذا projection لا يستدعي `loadCanonicalProof`؛ `SUCCEEDED` وevidence flags تخص قبول Task execution فقط، ولا تثبت Goal/Mission Canonical Proof. كذلك `/tasks/:taskId/verification` يمكنه إكمال Task بأدلة operator/checks، لكن المعاملة تحدث Task وlogs/events/audit فقط ولا تقبل Goal أو Mission (`tasks.ts:581-821`). يتفق ذلك مع اختبار phase-less Goal-linked Task أعلاه: Task مكتمل بينما Goal/Mission يظلان غير مثبتين.

**E3 dashboard status and Proof presentation (2026-10-02):** صفحة Missions تجلب Mission/Goal status من `/api/ai/missions` و`/projection` (`ai-missions.ts:205`; `Missions.tsx:1053-1129`)؛ تعرض `mission.status=completed` كنص “Mission complete” (`Missions.tsx:197-207`) وGoal status كـStatusPill/checkmark (`:889-895`). نوع `MissionProjection` لا يحمل Canonical Proof عامًا للـMission أو Goal أو execution؛ الحقل الصريح الوحيد هنا داخل `skillCandidate.canonicalProof` (`ai-missions.ts:121-158`)، وتعرضه الصفحة كجزء من بطاقة المرشح فقط (`Missions.tsx:964-978`). لذلك هذه الواجهة status read model مرئي للمستخدم، لا تحقق Proof؛ ويمكنها عرض حالة تاريخية كما رجعها الخادم. Fixture في `Missions.test.tsx:153-187` يمرر Goal وexecution بحالة completed بلا proof object، لكنه يختبر provenance ولا يختبر stale/missing proof. بالمقابل FlightDeck لا يعرض execution المطلوب إثباته كـCOMPLETED إلا مع `proofVerdict=PROVEN` (`FlightDeck.tsx:152-165`)، وسلسلة delivery تتطلب evidence كاملة وقبول Canonical Proof (`:209-231`)، كما أن MissionControl/WorldTransitionTimeline يشترطان acceptance لنفس attempt و`SUCCEEDED` وevidence complete وCanonical `PROVEN` قبل عرض المرحلة كمثبتة (`MissionControl.tsx:1672,1867`; `WorldTransitionTimeline.tsx:111-158`). وفي Chat UI، إظهار قبول finding لMission يتطلب acceptanceId ورسالة مطابقة و`proofRequired=true` وverdict `PROVEN` (`AiChat.tsx:6044-6046`)، بينما execution المكتمل مع proof مفقود يبقى معروضًا كـ“Execution ended — proof not accepted” و`BLOCKED` حتى بعد إعادة التحميل (`AiChat.tsx:8941+`; `AiChat.authenticated.test.tsx:970-1017`). نص “Execution completed — audit export is available” يعتمد على lifecycle status فقط، لكنه يتيح تصدير السجل لا إعلان Canonical Proof (`AiChat.tsx:9818-9830`). صفحة Tasks تعرض “Verified” و“Task completed and verified by the server” اعتمادًا على `task.verificationResult.passed` (`Tasks.tsx:726-739,834-842`)، وهو تحقق محلي للـTask لا Canonical Proof للـGoal؛ acceptance badge منفصل (`Tasks.test.tsx:323-324`). هذا فرق بين حالات Mission/Goal/Task المخزنة وإثبات execution، وليس producer أو backend bypass جديدًا.

**E3 intermediate workflow phase projection (2026-10-02):** `syncWorkflowGoalProjection` يحتوي فرعًا غير نهائي يمكنه تعيين Goal acceptance verdict=`PROVEN` من `evidenceComplete` دون Canonical Proof، ثم يعود قبل تغيير Goal/Mission status. لكن المنتج الفعلي الوحيد هو `executeWorkflowPhase`، وهو يرسل `proofRequired=false` بلا evidence refs؛ اختبار تكامل بقاعدة البيانات الحقيقية يثبت أن operation acceptance يرفض النجاح بسبب `required acceptance evidence is missing`، ويحفظ execution وGoal acceptance كـ`FAILED` مع بقاء Goal `running` وMission `active`. اختبار الوحدة السابق كان يسخر `completeAiExecution` ولذلك لم يكشف هذا الحد. إذن projection النظري `PROVEN` غير قابل للوصول عبر helper الحالي؛ لا تضعف بوابة الدليل ولا تعامل نجاح الاختبار المسخر كقبول فعلي. final phase وإكمال Mission يعيدان تحميل Canonical Proof قبل completion. هذا يظل فجوة ضمن E3، وليس إغلاقًا.

**E3 delegated-child proof audit (2026-10-02):** `loadCanonicalDelegationProof` (`proof-foundation.ts:644-719`) باقٍ helper-only؛ بحث النداءات لم يجد production أو test caller، ومسارات الإكمال/القبول الإنتاجية تستعمل `loadCanonicalProof` للفرد لا جامع الأبناء. يقفل الـhelper سجل الأب بحسب execution ID وproject (`:650-657`)، ثم يقفل ويختار كل الأبناء المباشرين بحسب `parentExecutionId` وproject بلا required-child أو delegation filter (`:671-678`)، ويحمّل Proof لكل طفل (`:681-695`) ويحسب القبول من summary وقبول كل child (`:702-719`). لا يفحص acceptance للأب ولا يطابق delegation/root identity بين الأب والطفل؛ lookup الأب داخل الـhelper project-scoped لا user-scoped، لكنه ليس حاليًا مسار authorization إنتاجيًا لغياب caller. Execution lineage يثبت النسب لا الإلزام، ولا يوجد حقل durable لعقد required-child؛ envelope الـMission delegation لا يضيف هذا العقد. اختبارات lineage تغطي بناء بيانات النسب فقط ولا تثبت اختيار الأبناء أو ربط جامعهم بقبول الأب. لا تستنتج الإلزام من lineage ولا توصل الـhelper قبل عقد server-owned واختبارات selection والهوية والمحاولات؛ لا توجد حاليًا قاعدة مثبتة لإكمال الأب عبر Proof الأبناء، وE3 يبقى جزئيًا.

**E3 recipe receipt vs Canonical Proof audit (updated 2026-10-03):** recipe completion يمرر capability/node evidence وTask Objective validator receipts إلى acceptance؛ هذه ليست retained evidence snapshot ولا سلطة Canonical Proof. `loadCanonicalProof` يرفض `evidenceRequired=false`، وعند required evidence يشترط snapshot مطابقًا للمحاولة الحالية ومكتملًا وverdict/projection مربوطين؛ وإذا كان delivery مطلوبًا يفحص receipt منفصلًا وهويته. Artifact-only recipes تحتاج `evidenceRequired=true` و`sourceEvidenceRequired=false` مع artifact صالح وverdict صريح `PROVEN`. mismatch القديم في `candidate.verify` بين execution وoperation identity عولج بتمرير هوية التنفيذ والمراجعة والمرشح من التنفيذ المملوك للـlease إلى validator؛ اختبارات runner/registry المسجلة ناجحة. لا يثبت ذلك ملاءمة نمط الأدلة لكل recipe أو نجاح replay/recovery عام. Mission-linked Apply لديه الآن نمط proof artifact مستقلًا ومختبرًا (§8)؛ لا يعني ذلك إغلاق ملاءمة evidence لكل recipe أو تغطية recovery العامة.

**E3 Shadow Replay receipt recovery/API audit (2026-10-02):** مسارات التشغيل والاستعادة تعيد تحميل Canonical Proof الحالي قبل قبول الإيصال، كما أن التسجيل والموافقة وpaired-baseline consumers تعيد الفحص بدل الثقة بحقول receipt وحدها. الاختبار `persists a server-owned skill candidate and performs read-only shadow replay` كشف أن recovery كان يتحقق من `durableReceipt` ثم يستبدله بـ`execution.recipeReceipt` العام، فيُسقط proof وpaired-baseline. أصلحنا recovery ليحفظ `durableReceipt` بعد نجاح فحص الهوية وإعادة تحميل Canonical Proof؛ وأضيفت حالة lease منتهٍ تحفظ receipt الكامل وacceptance ID وحالة cleanup، مع بقاء حالة mismatch السلبية. بعد الإصلاح اجتاز الاختبار (1 passed، 28 skipped). اختبار الاستعادة من تنفيذ متوقف اجتاز أيضًا قبل هذا التعديل، لكن لم تُعد تغطيته بعده. لا تزال نوافذ التعطل بين التنظيف والكتابة والحالة النهائية غير مغطاة. GET يعيد receipt المخزن بلا إعادة تحميل Proof للـreplay، والـidempotent POST يعيد فحص Proof الحالي للـcandidate المصدر لكنه قد يعيد receipt replay مكتملًا بلا إعادة تحميل Proof الخاص بذلك الـreplay. assertion تكاملي جديد يغيّر attempt للـreplay acceptance/evidence ويؤكد أن GET وإعادة POST ما زالا يعرضان receipt المخزن، بينما يرفض Gate 4 registration هذا Proof؛ واختبار pending approval القائم يرفضه أيضًا. التسجيل والموافقة المعلقة هما مستهلكا القرار اللذان يعيدان تحميل Canonical Proof للمصدر والـreplay ويربطان acceptance IDs والـtrajectory بالـreceipt ويعيدان حساب paired baseline قبل mutation. طلب approval المكرر لسجل promoted يعيد الحالة المحفوظة بلا انتقال جديد. تعامل مع GET وإعادة POST كعرض لا كسلطة إثبات؛ freshness semantics ما زالت مفتوحة، وE3 جزئي.

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
- `[✓]` Mission-linked Apply acceptance للمسار المختبر: `apply_changes_v1` يربط artifact مشتقًا من السجلات الدائمة، وD2 يبقى gate مستقلًا ومربوطًا بالخطة؛ هذا لا يغلق E2/E3 عالميًا.
- `[~]` runtime.start وapply-changes لديهما transitions محددة؛ apply delta refs فارغة والplanner decision-change غير مثبت.
- `[✗]` لا يوجد دليل أن World State changes تفرض خطة/Action مختلفة على نحو عام.
- `[✗]` لا يوجد تقييم held-out عام يثبت loop عبر أسطح mutation مختلفة.
- `[✗]` لا تبدأ طبقات Learning / Transfer / Generalization بعد.

**E3 Recipe validator identity continuity (2026-10-02):** كشفت مجموعة التدقيق أن recipe capability أسقط سياق validator الخادمي، فلم يرتبط دليل Shadow Replay بهوية التنفيذ الحالية. أصبح `runRecipeOperation` يحقن execution ID والمراجعة والمرشح من التنفيذ المملوك للـlease، ويستخدمها Shadow Replay في دليل التحقق مع إبقاء operation ID الدائم منفصلًا؛ كما يحفظ طلب replay نمط `artifact_only` صراحةً. اجتاز الاختبار الإيجابي واختبار الاستعادة بعد crash، واجتازت مجموعة الملفات الثمانية 114/114. هذا إصلاح توافق لمسار recipe، ولا يغلق تدقيق ملاءمة نمط الأدلة لكل recipe أو بقية نواقص E3.

**E3 Recipe evidence-level audit (updated 2026-10-03):** يثبت سجل recipes نمط evidence لكل وصفة بدل توريث `artifact_only` افتراضيًا. `candidate.verify`, `validation.recover`, `browser.verify`, `database.inspect.project`, و`delivery.push.github` تستخدم `artifact_only` بشرط snapshot غير فارغ يغطي كل عقدة ناجحة ويرتبط بالمحاولة والتنفيذ والمراجعة والمرشح عند وجوده؛ runtime.start يستخدم الآن نمط `runtime_start_gate_c_v1` وartifact متخصصًا يتحقق منه Canonical loader. لا يُعمم هذا على `runtime.restart` أو `runtime.stop`، ولا يثبت ذلك ملاءمة evidence mode لكل recipe أو وجود وصفة `source_required`. اجتازت اختبارات runner وMissions (29/29 لكل ملف) واختبار registry (7/7) في نتائج مسجلة سابقًا؛ بقيت E3 جزئية ونتيجة Apply الحالية موثقة في §8.

## 18. Final Verdict

**NOT READY.** أُغلق E1 package-boundary على مصادر workspace الحالية، وأُصلح تعارض Mission-linked Apply على المسار المختبر، لكن ذلك لا يغلق Agent Core. الحد الأدنى المانع المتبقي: (1) E2 lifecycle/terminal state عبر mutation surfaces مع reconciliation واختبارات crash/race؛ (2) E3 توحيد دلالة `PROVEN` وربط كل قبول بالـCanonical Proof الحالي؛ (3) اشتقاق World Delta وسبب `changedFactRefs: []`؛ (4) ربط planner بالـrevision/freshness وإثبات أن fact ذا صلة يغيّر القرار؛ ثم استكمال E6–E8 وheld-out evaluation قبل Learning/Transfer/Generalization. لا يُدّعى وصول أي طبقة إلى 100%.
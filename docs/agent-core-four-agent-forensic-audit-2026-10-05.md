# Engineering Agent Core — Forensic Status Report

- **تاريخ المراجعة:** 2026-10-05
- **متابعة الحالة:** راجع `docs/agent-core-four-agent-forensic-audit-2026-10-06.md` للتدقيق الساكن اللاحق وتصحيح بوابة E2/E3. هذا الملف يبقى سجلًا تاريخيًا ولا يمثل أحدث حالة.
- **المنهج:** مراجعة code-first لمسارات التنفيذ الحالية؛ وجود primitive أو test لا يساوي إغلاق capability.
- **النطاق:** Reliable Tool Agent، Reliable Execution Agent، Evidence-grounded Agent، Closed-loop World Agent، والحدود بينها.
- **تغييرات التطبيق:** لا توجد. هذا المستند وسجلاته المرجعية توثيق فقط.
- **الحكم:** `NOT READY` للانتقال إلى Learning / Transfer / Generalization.
- **حدّ التحقق:** لم تُعد هذه المراجعة تشغيل اختبارات DB/process-restart. سجل التقدم السابق يوثق تشغيل W0–W4 وW5–W8 على PostgreSQL مؤقتة loopback، كل مجموعة 1/1؛ تُحفظ تلك النتيجة كتغطية سابقة محددة، لا كإعادة تحقق في هذه المراجعة ولا كإغلاق شامل.
- **تصحيح:** نسبة `14/19` الواردة في الرد السابق احتسبت قائمة مخصصة لا قائمة Final Gate الأصلية؛ ليست نسبة إغلاق صالحة، ولا تُستخدم هنا. لا يوجد denominator موثوق لإسناد نسب عامة إلى الطبقات الأربع؛ لذلك النسب `UNKNOWN`.

## 1. Executive Summary

النظام يملك أساسًا قويًا ومُثبتًا في مسارات محددة: dispatch للأدوات عبر policy خادمية، تنفيذ دائم بهوية ومحاولات وleases، Canonical Proof يعاد تحميله من سجلات دائمة، وانتقالات World State مربوطة بدليل في عدد محدود من المسارات. هذه الأدلة لا تثبت أن دورة الوكيل موحدة عبر كل أدواته وتعديلاته.

**أقوى الأجزاء**

- `executeSingleTool()` و`executeToolLoop()` يفرضان manifest وpolicy في مسارات الأدوات المفحوصة، كما تستخدم أدوات الملفات جذرًا مثبتًا وفحوص مسارات.
- `ai-execution-state.ts` و`ai-execution-acceptance.ts` يقدمان هوية ومحاولة وقبولًا دائمًا، و`proof-foundation.ts` يحمّل Canonical Proof للمحاولة والنطاق المحددين.
- `chat-agent.ts` يطبق بوابات المطالبات وTelemetry قبل اختيار الرد النهائي في مسارات JSON وstream المباشر وnative SSE.
- `runtime.start` وMission-linked Apply يملكان مسارات أثر/ملاحظة/انتقال مرتبطة بالمحاولة؛ اختبارات Apply المسجلة تغطي نوافذ process-kill محددة.

**أخطر خمس فجوات**

1. لا يوجد جرد مكتمل يثبت أن كل أدوات التنفيذ وكل mutation surface تمر عبر lifecycle وقيود موحدة.
2. التعافي بعد side effect غير مكتمل؛ حالات Apply غير المقبولة قد تتطلب مراجعة يدوية، وبقية الأسطح ليست مغطاة بمصفوفة crash/replay واحدة.
3. `PROVEN` حالة ذات إسقاطات متعددة؛ بعض الإسقاطات تُظهر `PROVEN` من status أو حالة `partial`، ولا يثبت ذلك Canonical Proof.
4. قبول Apply لا يضمن World Transition: الإنشاء مشروط بـGoal وملاحظات وrevision، وفشل D2 لا يلغي قبول الكتابة المستقل.
5. لا يوجد إثبات عام أن World State أو unexpected outcome يغيران قرار planner، ولا تقييم held-out عام.

`E2` مغلق فقط للـinvariant المحدد الخاص بمنع materialization قبل proof chain. هذا لا يغلق lifecycle كاملًا. يبقى **E3.2 replay safety مفتوحًا**؛ واختبارات Apply W0–W8 لا تغلق هذا البند أو replay عبر جميع الأسطح.

## 2. Current Scorecard

لا أشتق نسبة من عدد الملفات أو الاختبارات. النسبة لكل طبقة `UNKNOWN` لأن الجرد الكامل للمسارات والـdenominator غير مثبت؛ والحالة النوعية هي:

| Layer | Current % | الحالة المستدل عليها | Evidence | Main Blocker | 100% Requirement |
|---|---|---|---|---|---|
| Reliable Tool Agent | `UNKNOWN` | `PARTIAL`؛ إغلاق E1 package boundary يخص مصادر TypeScript الحالية | `tool-policy.ts`, `tool-execution-engine.ts`, `execution-kernel.ts`, `file-tools.ts`؛ اختبارات مركزة | ضمانات الموارد وEpisode/replay غير موحدة لكل runner، والجرد العام غير مكتمل | كل ingress المسموح يمر بسلطة موحدة ويملك scope وlimits وcancellation وaudit واختبارات خصمية |
| Reliable Execution Agent | `UNKNOWN` | `PARTIAL` | `ai-execution-state.ts`, `ai-execution-acceptance.ts`, `agent-episode-ledger.ts`; سجل تشغيل Apply المحدود | recovery وتوحيد lifecycle لم يثبتا لكل mutation surface؛ بعض states تحتاج manual recovery | لكل surface هوية/محاولة/lease/Action/observation/effect/acceptance/terminal state مع recovery واختبارات crash/race |
| Evidence-grounded Agent | `UNKNOWN` | `PARTIAL` | `proof-foundation.ts`, `chat-agent.ts`, بوابات claim وTelemetry | لا يوجد جرد producer/consumer شامل لدلالات `PROVEN`؛ إخفاق تصنيف جواب واحد غير محسوم | كل قبول proof-required يعيد تحميل Canonical Proof ويغلق claims والمراجعة والنطاق |
| Closed-loop World Agent | `UNKNOWN` | `PARTIAL` | `world-state.ts`, `runtime-start-transition.ts`, Apply D2، `mission-auto-replan.ts` | التغطية غير شاملة؛ قبول أثر لا يضمن Delta، وتأثير الحالة في قرار planner غير مثبت | كل أثر مؤهل ينتج Delta قابلًا لإعادة البناء ويغير القرار/الخطة بطريقة مقاسة ومربوطة بالمراجعة |

## 3. Reliable Tool Agent

**المغلق ضمن المسارات المفحوصة**

- `lib/ai-orchestrator/src/tool-policy.ts:authorizeToolInvocation()` يبني القرار من metadata خادمية ويتحقق من الأداة والمدخلات والوضع والموافقة والنطاق.
- `lib/ai-orchestrator/src/tool-execution-engine.ts:executeSingleTool()` هو حد dispatch للأدوات المفحوصة. لم يُثبت استدعاء مباشر لـ`executeFileTool()` أو`executeGitTool()` من `agents/chat-agent.ts`؛ مسار المحادثة يستخدم `executeToolLoop()` و`executeScopedReadTool()`.
- `lib/ai-orchestrator/src/execution-kernel.ts:runBoundedCommand()` يستخدم `shell:false` ويحد الجذر والمهلة والمخرجات والإلغاء لمشغّل الأمر المحدود.
- `lib/ai-orchestrator/src/tools/file-tools.ts:safePath()` و`openVerifiedProjectFile()` يفحصان الجذر والمسارات والروابط الرمزية في المسارات التي تقرأ الملفات. الكتابة في tool loop تُسجل كتغييرات مرشحة؛ الترويج الفعلي يمر بمسار Apply.

**الجزئي أو غير المثبت**

- لم يثبت جرد كل ingress وكل direct executor عبر TypeScript وبقية أسطح التشغيل؛ غياب bypass في موضع واحد ليس برهانًا شاملًا.
- لا توجد حجة أن حدود timeout و`AbortSignal` والخرج وEpisode موحدة لكل executor. سلوك runner المفوض لا يُثبت بمجرد metadata.
- فحص symlink والمسار لا يثبت inode-bound/TOCTOU atomicity لكل القراءة والكتابة.
- **اختبارات موجودة في `lib/ai-orchestrator/src/__tests/`:** `reliable-tool-agent-100.test.ts`, `tool-execution-engine.test.ts`, `tool-policy.test.ts`, `file-tools.test.ts`, `git-tools-timeout.test.ts`, `execution-tools.test.ts`, و`analysis-tools.test.ts`؛ ويوجد `lib/ai-orchestrator/src/execution-kernel.test.ts`. التشغيل المسجل لـ457/457 يخص ثلاث مجموعات محددة في التقرير الأشمل؛ لا يعني أن كل هذه الاختبارات شُغّلت في هذه المراجعة.
- **الناقص:** adversarial matrix موحدة تغطي كل model-reachable registry entry والـdirect runner، وخاصة cancellation/time/output/audit binding أثناء التنفيذ، مع TOCTOU/Git-root escape proofs. أسماؤها وشروطها مدرجة في Definition of Done أدناه.

**Definition of Done:** جرد كل model-call ingress، إثبات dispatcher/policy واحد، اختبار نطاق ومسار adversarial لكل executor، إلغاء ومهلة وخرج bounded أثناء التنفيذ، وربط invocation بـEpisode/attempt والنتيجة النهائية. لا توجد bypass مؤكدة في المسارات التي فُحصت؛ أما الإغلاق الشامل فـ`UNKNOWN`.

## 4. Reliable Execution Agent

**المسار الفعلي المرصود:** intent → durable execution → attempt/lease → Episode/plan → Action → before observation → side effect → after observation → EffectBundle → acceptance → terminal projection. هذه السلسلة موجودة في شرائح، لا كعقد موحد مثبت لكل surface.

- `artifacts/api-server/src/lib/ai-execution-state.ts` يدير التنفيذ الدائم والـattempt والـlease والـcheckpoint والاستعادة.
- `artifacts/api-server/src/lib/agent-state/agent-episode-ledger.ts` يربط أحداث Action بالمحاولة والمالك الحالي؛ `artifacts/api-server/src/lib/ai-execution-acceptance.ts` يفصل acceptance عن status.
- `artifacts/api-server/src/lib/proof-foundation.ts:loadCanonicalProof()` يعيد تحميل قبول ودليل المحاولة الحالية بدل قبول status أو receipt منفرد.
- `artifacts/api-server/src/lib/apply-change-reconciliation.ts:reconcileInterruptedApplyChanges()` يعيد تثبيت جذر المشروع ويفحص الشجرة الحية والمرشح والـintent والـeffect proof. candidate بلا proof قبول كامل تُحجب ويُطلب manual recovery؛ شجرة الأساس بلا ترويج تُطلب لها إعادة تحقق قبل محاولة أخرى.
- **الأسطح التي تحتاج عقدًا موحدًا أو إثباتًا مستقلًا:** `artifacts/api-server/src/lib/recipe-operation-runner.ts`, `artifacts/api-server/src/lib/task-execution-service.ts`, `artifacts/api-server/src/lib/structured-task-execution.ts`, `artifacts/api-server/src/lib/workflow-phase-execution.ts`, `lib/ai-orchestrator/src/execution-node-coordinator.ts`, chat، Mission mutations، Apply، runtime، delivery/browser حيث تسمح بالـmutation.

**Apply crash/replay evidence:** يسجل `docs/agent-generalization-progress.md` تشغيلًا سابقًا على قاعدة PostgreSQL مؤقتة loopback: اختبار W0–W4 ‏1/1 واختبار Apply-route W5–W8 ‏1/1 مع provider egress disabled. W0–W4 تتضمن حالات child-startup لا تقتل جميعها HTTP route؛ W5–W7 تقتل route عند نقاط effect/acceptance/terminalization؛ W8 يختبر القتل بعد القبول وقبل الرد ثم exact replay بلا تكرار. المراجعة الحالية لم تُعد التشغيل، ولا يثبت هذا الاختبار جميع الأسطح أو فجوات ما قبل معاملة الأثر أو E3.2.

**Crash-window matrix المطلوبة (النتيجة خاصة بالمسارات المختبرة؛ غير المغطى `UNKNOWN`):**

| Window | دليل الكود/الاختبار | Recovery / retry | False success / duplicate | هل تكفي DB وحدها؟ |
|---|---|---|---|---|
| 1. قبل `ACTION_REQUESTED` | W0 يبدأ بعد إنشاء تنفيذ Apply وقبل الترويج؛ ترتيب Action تحديدًا `UNKNOWN`. لم تنتج fixture كتابة أو قبولًا. | لا أثر لإعادة التنفيذ في fixture؛ السياسة العامة `UNKNOWN`. | لا false success أو duplicate في fixture فقط. | لا كقاعدة عامة؛ الاختبار لا يغطي كل surface. |
| 2. بعد `ACTION_REQUESTED` وقبل side effect | W1 وW1-intent تنتهيان قبل bytes؛ لا كتابة أو acceptance. | استعادة بعد انتهاء lease؛ retry مشروط بتأكيد عدم الأثر. رفض الكتابة من worker قديم عبر كل runners `UNKNOWN`. | لم يظهر false success في fixture؛ duplicate prevention عام `UNKNOWN`. | لا؛ يلزم فحص جذر العمل لإثبات الحالة الفيزيائية. |
| 3. أثناء side effect | W2 يترك live tree مختلطة بعد تعديل واحد من اثنين. | `RECOVERY_REQUIRED` وmanual disposition؛ لا blind retry. | لا acceptance أو dispatch؛ يمنع التكرار حتى reconciliation في fixture. | لا؛ DB تسجل intent، لكن حالة الملفات تحتاج observation. |
| 4. بعد side effect وقبل `AFTER_OBSERVATION` | W3 يحفظ candidate bytes قبل observation/proof. | candidate محجوب و`RECOVERY_REQUIRED`؛ لا إعادة تنفيذ تلقائية. | لا `APPLIED` أو World Transition أو dispatch في fixture. | لا؛ يلزم فحص candidate/live tree. |
| 5. بعد observation وقبل `EFFECT` | لا يغطيه دليل مستقل لكل surfaces في هذه المراجعة؛ التغطية الدقيقة `UNKNOWN`. | retry safety/reconciliation `UNKNOWN`؛ يجب إبقاء القرار fail-closed. | عدم وجود false success/duplicate عام غير مثبت. | `UNKNOWN`. |
| 6. بعد `EFFECT` وقبل `ACCEPTANCE` | W5/W6 تختبران توقف route قرب EffectBundle/acceptance؛ startup يضع الحالة في recovery دون `SUCCEEDED`. | reconciliation مطلوبة؛ recovery ليس exactly-once عامًا. | لا قبول نجاح في fixture؛ duplicate prevention خارجها `UNKNOWN`. | لا؛ أثر filesystem أو remote يحتاج ملاحظة مستقلة. |
| 7. بعد `ACCEPTANCE` وقبل terminalization | W7 يثبت أن acceptance وterminal update داخل transaction؛ القتل يتركهما غير ملتزمين. W8 يختبر القتل بعد commit وقبل الرد. | W7: recovery؛ W8: exact replay idempotent بعد startup. | لا false durable success في W7؛ W8 لا يكرر الأثر المقبول. | DB تثبت commit/acceptance W8، لا صحة كل physical side effect. |

بهذا لا أساوي crash-recovery في Apply مع معرفة الحقيقة لكل الأسطح. `executionId/attempt/operationId/projectId` والـlease/checkpoint fencing موجودة في المسارات الدائمة المفحوصة؛ تغطية `episodeId`, stale-worker rejection, cancellation races, duplicate completion, retry/resume، وإعادة بناء الحقيقة من DB وحدها عبر جميع runners تبقى غير مثبتة.

**الفجوات:** lifecycle موحد لكل mutation، recovery للأثر الفيزيائي عند كل crash boundary، cancellation/terminal race لكل surface، ووسيلة إعادة بناء الحقيقة من السجل الدائم وحده غير مثبتة. حالات W2–W7 غير المقبولة قد تتطلب recovery يدويًا؛ هذه حماية من false success وليست automatic exactly-once recovery.

**اختبارات موجودة:** `artifacts/api-server/src/routes/ai-stream-integration.test.ts`, `artifacts/api-server/src/lib/task-execution-lifecycle.integration.test.ts`, `artifacts/api-server/src/lib/apply-change-reconciliation.test.ts`, `artifacts/api-server/src/lib/ai-execution-state.test.ts`, `artifacts/api-server/src/lib/agent-state/agent-episode-ledger.test.ts`, `artifacts/api-server/src/lib/recipe-operation-runner.test.ts`, `artifacts/api-server/src/lib/task-execution-service.test.ts`, و`artifacts/api-server/src/lib/workflow-phase-execution.test.ts`. **النقص:** crash/race matrix موحدة لكل surface ولكل نافذة قبل/أثناء/بعد physical effect؛ لا يُستنتج إغلاقها من W0–W8.

## 5. Evidence-grounded Agent

- السلطة المثبتة للقبول proof-required هي `artifacts/api-server/src/lib/proof-foundation.ts:loadCanonicalProof()`، مع acceptance/evidence/current-attempt/scope bindings.
- `lib/ai-orchestrator/src/agents/chat-agent.ts:applyRequiredClaimClosureGate()` موجود في non-streaming وdirect-stream وnative-SSE seams؛ كما تستدعي هذه المسارات بوابات Objective وTelemetry قبل إظهار نتيجة قاطعة.
- بوابة الإغلاق تُفرّق بين وجود قراءة وبين إغلاق المطالبات المطلوبة. `lib/ai-orchestrator/src/__tests__/chat-required-claim-unclosed-e2e.test.ts` يطلب `NOT PROVEN` عند وجود قراءة بلا grounding أو عند إغلاق مطالبة واحدة وترك مطالبة الملف المسمى مفتوحة.
- `lib/ai-orchestrator/src/evidence-integrity.ts:buildEvidenceBackedAnswer()` يصدر حالة محلية `PROVEN` عند إغلاق claim واحد؛ لم يثبت مستهلك يربط helper بقبول منتج، لذلك يبقى أثره `UNKNOWN`.
- `lib/ai-orchestrator/src/evidence-integrity.ts:deriveScopedFindingStatus()` و`buildScopedVerdictLabel()` و`validateClaim()` و`guardFinalJudgment()` تنتج دلالات محلية مقيّدة بالنطاق؛ لا تجعل وحدها Mission/Task/Candidate أو production reachability canonical. لم يظهر مسار مؤكد من نص model/regex/complete read/validation success/fixture مباشرة إلى قبول Canonical Proof في المسارات المفحوصة؛ عدم وجوده في كل writer يبقى `UNKNOWN`.
- إسقاطات `phaseStatus` وEvidence Graph التي تحول status غير `NOT_PROVEN` أو subquery `partial` إلى `PROVEN`/green غير canonical. لم يثبت أن هذه الإسقاطات تمنح سلطة كتابة، لكنها تمثل semantic drift وعرض ثقة غير صحيح.

**إخفاق غير محسوم:** في نتيجة التشغيل المسجلة للمراجعة السابقة كانت المجموعة 4/5؛ وفي التشغيل المعزول ظهر `ANALYSIS_INCOMPLETE` بدل `NOT PROVEN`. الكود يملك فروعًا منفصلة لغياب الإجابة/الدليل غير المقبول ولـclaim غير المغلق. السبب الدقيق، وهل الحالة regression أم fixture قديم، وأثرها على قبول دائم تبقى `UNKNOWN`. لا يثبت هذا الإخفاق وحده false acceptance.

**اختبارات موجودة في `lib/ai-orchestrator/src/__tests/`:** `required-claims.test.ts`, `evidence-integrity.test.ts`, `chat-evidence-integrity-e2e.test.ts`, و`chat-required-claim-unclosed-e2e.test.ts`؛ وفي API: `artifacts/api-server/src/lib/proof-foundation.test.ts`, `artifacts/api-server/src/lib/ai-execution-acceptance.test.ts`, و`artifacts/api-server/src/routes/ai/missions.test.ts`. **الناقص:** مصفوفة regression تثبت عدم إنتاج durable acceptance عند stale attempt/revision، mixed scope، كل claim غير مغلقة، وتكافؤ transports.

**Definition of Done:** خريطة لجميع منتجي ومستهلكي `PROVEN`، منع تحويل أي projection إلى authority، اختبار current/stale attempt وrevision وmixed scope، تكافؤ نوافذ الرد، وعدم وجود acceptance ما لم يغلق verifier الخادمي كل claim المطلوبة.

## 6. Closed-loop World Agent

1. **WorldRevision:** تنشئه `artifacts/api-server/src/lib/agent-state/world-state.ts:materializeWorldStateForProject()`؛ و`getProjectWorldState()` يقرأ الإسقاط الحالي. pending reservation ليس revision أو fact materialized.
2. **Previous/next revision:** `artifacts/api-server/src/lib/agent-state/runtime-start-transition.ts:createPendingRuntimeStartTransition()` و`createPendingApplyChangesTransition()` تربطان parent/target revision وهوية execution/attempt/effect/observations بحسب المسار؛ `createPendingGitHubDeliveryTransition()` يغطي مسار delivery المتحقق منه.
3. **إثبات Delta:** direct observations وEffectBundle/Action bindings في انتقالات محددة؛ ليست كل event أو قبول دليلًا على Delta.
4. **كل mutation مهم؟** لا. توجد مسارات `runtime.start` وApply وverified `delivery.push.github`، لكن الجرد شاملًا غير مثبت. `/git/push` اليدوي receipt-only.
5. **هل World State يعكس كل accepted effect؟** لا. Apply يستطيع قبول الكتابة مستقلًا عن D2، وإنشاء انتقاله مشروط بـ`allOk`, EffectBundle, `missionGoalId`, وملاحظات/revision صحيحة. قبول apply بلا Goal لا ينشئ World Transition.
6. **هل planner يقرأ World State؟** `artifacts/api-server/src/lib/mission-world-state-planning-read.ts:loadMissionWorldStatePlanningRead()` و`mission-auto-replan.ts:autoReplanMission()` يقدمان consumer استشاريًا محدودًا.
7. **هل القراءة تغير الخطة؟** وصول القراءة إلى سياق الخطة موثق، لكن تغيير plan steps/قرار فعلي عند تغير World Fact غير مثبت في هذه المراجعة.
8. **هل unexpected outcome يغير belief؟** توجد failure diagnosis وreplan context لمسارات محددة؛ تحديث belief عام، مستقل، ومقاس غير مثبت.
9–12. **diagnosis/replan/replay/held-out evaluation:** توجد primitives وpilots محدودة. لا يوجد إثبات عام يميز replan عن retry أو يربط held-out outcomes بتقييم متعدد الأسطح.

**اختبارات موجودة:** `artifacts/api-server/src/lib/agent-state/world-state.test.ts`, `artifacts/api-server/src/lib/agent-state/runtime-start-transition.test.ts`, `artifacts/api-server/src/lib/mission-world-state-planning-read.test.ts`, `artifacts/api-server/src/lib/world-state-failure-diagnosis.test.ts`, `artifacts/api-server/src/lib/mission-auto-replan.test.ts`, `artifacts/api-server/src/lib/mission-auto-replan-evidence.integration.test.ts`, و`artifacts/api-server/src/routes/world-state.test.ts`. يختبر `artifacts/api-server/src/lib/world-state-failure-diagnosis.ts:diagnoseRuntimeStartWorldStateFailure()` فشل runtime.start فقط. اختبار التخطيط الذي يغير World Fact ويقارن القرار/الخطة لم يُسجل تشغيله في جولة 2026-10-04؛ لا أدعي نتيجة له هنا.

**أهم 10 فجوات بالترتيب**

1. لا يوجد inventory كامل لكل mutation ولا policy صريحة لما يجب أن ينتج World Delta.
2. Apply يمكن أن يقبل الكتابة دون D2 أو دون Goal؛ الحد الفاصل بين أثر مقبول وWorld State غير متصل دائمًا.
3. قبول EffectBundle لا يثبت أن كل mutation مؤهل أُعيد بناؤه كـDelta.
4. استقلال after-observation مربوط بمسارات مختارة، لا بكل executor.
5. previous/next revision bindings غير مثبتة على كل surfaces.
6. planner يقرأ state في Mission replan محدود فقط.
7. لا يثبت الاختبار الحالي أن تغير World Fact يغير القرار أو الخطة.
8. لا يوجد belief update عام من unexpected outcome بملاحظة مستقلة.
9. diagnosis الحالية مقيدة بمسارات مثل `runtime.start`، لا diagnosis عامة عبر آثار النظام.
10. replan/retry وreplay/held-out evaluation لا تملك إثباتًا عامًا متعدد الأسطح.

**Definition of Done:** جرد mutations، direct after-state observation، Delta قابل لإعادة البناء، revision continuity، planner consumer، واختبار يثبت أن تغير fact مؤثر يغير قرارًا متوقعًا؛ ثم failure diagnosis/replan وheld-out evaluation عبر أكثر من surface.

## 7. Cross-layer Integrity

```text
Model intent
  → server tool manifest / authorization / scope
    X UNKNOWN: لم يثبت جرد كل ingress/direct executor
  → durable execution + attempt + lease
    X UNKNOWN: lifecycle/recovery موحد لكل mutation surface غير مثبت
  → Episode / Action / before observation
  → bounded execution or guarded candidate promotion
  → after observation / EffectBundle
    X UNKNOWN: independence/revision binding is not established across surfaces
  → Canonical acceptance
  → World Transition / World State
    X CONFIRMED GAP: Apply بلا Goal أو عند غياب D2 قد يُقبل دون World Transition
  → planner reads current scoped state
    X NOT PROVEN: consumer استشاري؛ تغيير plan/decision غير مثبت
  → changed plan / measured outcome
    X NOT PROVEN: لا held-out evaluation عام عبر الأسطح
```

- **Tool → Execution:** ممر مركزي واضح للأدوات المفحوصة؛ الجرد عبر كل executor غير كامل (`UNKNOWN` هل يوجد bypass خارج المسارات المفحوصة).
- **Execution → Evidence:** يوجد binding قوي في current-attempt Canonical Proof؛ دلالات status الأخرى ليست موحدة، واستقلال observations عبر كل surfaces غير مثبت.
- **Evidence → World:** effect/observations تربط transitions المحددة؛ قبول apply لا يضمن transition.
- **World → Planner:** قراءة scoped advisory موجودة؛ أثرها على القرار غير مثبت.
- **Planner → Replan/evaluation:** لا يوجد proof عام أن الخطة تغيرت بدل retry أو أن التحسن صمد على held-out outcomes.

**موضعا الانقطاع الواضحان:** بعد acceptance وقبل World Delta في Apply بلا Goal أو عند فشل D2؛ وبعد قراءة World State الاستشارية وقبل إثبات قرار planner مختلف.

## 8. FALSE CONFIDENCE RISKS

- E1 package-boundary `DONE` لا يعني أن Reliable Tool Agent بكامله 100%.
- أعداد الاختبارات أو مرور اختبار مختار لا تثبت universal coverage أو production safety.
- سجل تشغيل W0–W8 السابق محدود؛ لا يسد فجوات أسطح Task/Mission repair/workflow/runtime/Git الأخرى، ولا يغلق E3.2.
- `PROVEN` في status أو Evidence Graph لا يساوي Canonical Proof.
- قراءة كاملة، validation ناجح، EffectBundle، أو receipt منفرد لا يثبت كل claims ولا الأثر الدلالي المقصود.
- قبول Apply يثبت كتابة guard-railed بمراجعها، لا correctness repair ولا حدوث World Delta.
- `world-state.ts` وقراءة World State في replan لا يثبتان Closed-loop Agent أو تغير قرار.
- replay/idempotency لمسار W8 بعد terminal acceptance لا يعني retry آمنًا لكل side effect؛ recovery قبل القبول قد يحجب الحالة ويطلب تدخلًا.
- النسبة `14/19` من الرد السابق ليست معيارًا؛ القائمة الأصلية مختلفة، ولا توجد نسبة عامة قابلة للدفاع عنها.
- سجل الوثائق يذكر تشغيلًا سابقًا؛ هذه المراجعة لم تعد تشغيل DB suites، لذا لا أصفه بأنه تحقق جديد.

## 9. Exact Implementation Roadmap

| Phase | الملفات/الدوال المستهدفة | الإجراء الدقيق | الاختبار/شرط القبول |
|---|---|---|---|
| E1 — Tool authority | `tool-policy.ts:authorizeToolInvocation`, `tool-execution-engine.ts:executeSingleTool`, executors | أكمل جرد كل ingress/direct runner، ووحّد scope والحدود وEpisode semantics دون إنشاء authority ثانية | adversarial test لكل executor: root/symlink escape، timeout/cancel، output cap، approval، terminal failure |
| E2 — Execution lifecycle | `ai-execution-state.ts`, `ai-execution-acceptance.ts`, `agent-episode-ledger.ts`, recovery/reconciliation، جميع mutation routes | وحّد execution/attempt/lease/Action/effect/acceptance fences؛ أضف crash injection للفجوات بين observation ومعاملة الأثر وللأسطح غير Apply | isolated DB process-kill/race suite؛ no false success، duplicate side effect، stale-worker writes؛ استعادة أو manual disposition صريحة لكل حالة |
| E3 — Proof authority | `proof-foundation.ts:loadCanonicalProof`, `chat-agent.ts`, Mission/Goal/Replay/status consumers | أكمل producer/consumer inventory؛ اجعل projections status-only؛ حسم claim-response discrepancy واختبار stale/mixed/current identities | كل proof-required acceptance يعيد تحميل current Canonical Proof؛ كل transport يحجب غير المكتمل ولا يخزن acceptance |
| E4 — World Delta | `world-state.ts`, `runtime-start-transition.ts`, Apply transition/D2، verified delivery | قرر policy لكل mutation surface، بما فيها Apply بلا Goal؛ اربط accepted effect بالملاحظات والمراجعات بدل افتراض delta | test لكل mutation يثبت previous/next revision ومراجع observations/effects أو سببًا صريحًا لعدم الأهلية |
| E5 — Planner consumption | `mission-auto-replan.ts` وplan materialization/runtime | وسّع القراءة فقط بعد binding proof/revision؛ لا تجعل facts صلاحية أو policy | DB-backed A/B fixture يغير Fact واحدًا ويثبت plan revision والقرار/steps المتوقعين |
| E6 — Belief update | world-state/failure diagnosis/replan context | افصل fact/observation/belief عن نص provider؛ اربط التحديث بملاحظة مستقلة وoutcome مقبول | failure fixtures: contradicting/unresolved/stale observations لا تحدث belief؛ الإيجابي يربط المراجعات |
| E7 — Replan vs retry | `mission-auto-replan.ts`, Mission runtime | وثّق فرقًا server-owned بين إعادة المحاولة وإعادة التخطيط وأسباب كل منهما | recovery test يثبت أن السبب والـscope والrevision يحفظون، والخطة الجديدة تختلف عند الحاجة ولا تعيد side effect |
| E8 — Replay/evaluation | replay executors/receipts/held-out evaluation | إبقاء replay تحت proof الحالي للمصدر والحالة؛ إضافة تقييم held-out قبل promotion/transfer | exact source/replay identities، idempotent recovery، منع stale receipt، نتائج held-out قابلة لإعادة البناء |

**أهداف الملفات والاختبارات لكل phase:**

- **E1:** `lib/ai-orchestrator/src/tool-policy.ts:authorizeToolInvocation()` و`lib/ai-orchestrator/src/tool-execution-engine.ts:executeSingleTool()`؛ وسّع الاختبارات في `lib/ai-orchestrator/src/__tests/` (`reliable-tool-agent-100`, `tool-execution-engine`, `file-tools`, `git-tools-timeout`, `execution-tools`, `analysis-tools`) و`lib/ai-orchestrator/src/execution-kernel.test.ts` لتغطية كل manifest entry وdirect runner.
- **E2:** وحّد `artifacts/api-server/src/lib/ai-execution-state.ts`, `artifacts/api-server/src/lib/ai-execution-acceptance.ts`, `artifacts/api-server/src/lib/agent-state/agent-episode-ledger.ts`, `artifacts/api-server/src/lib/recipe-operation-runner.ts`, `artifacts/api-server/src/lib/task-execution-service.ts`, `artifacts/api-server/src/lib/structured-task-execution.ts`, `artifacts/api-server/src/lib/workflow-phase-execution.ts`, و`lib/ai-orchestrator/src/execution-node-coordinator.ts`؛ مدّد `artifacts/api-server/src/routes/ai-stream-integration.test.ts`, `artifacts/api-server/src/lib/task-execution-lifecycle.integration.test.ts`, `artifacts/api-server/src/lib/apply-change-reconciliation.test.ts`, و`artifacts/api-server/src/lib/job-reconciliation.test.ts` بمصفوفة restart/lease/race لكل surface.
- **E3:** اجعل `artifacts/api-server/src/lib/proof-foundation.ts:loadCanonicalProof()` السلطة المستهلكة؛ افحص `artifacts/api-server/src/lib/mission-runtime.ts:loadGoalDependencyState()` و`runMissionGoal()` و`artifacts/api-server/src/lib/ai-execution-acceptance.ts:deriveMissionStatusFromGoals()`، إضافةً إلى `lib/ai-orchestrator/src/agents/chat-agent.ts:applyRequiredClaimClosureGate()` و`lib/ai-orchestrator/src/evidence-integrity.ts:buildEvidenceBackedAnswer()`؛ اختبر `lib/ai-orchestrator/src/__tests__/chat-required-claim-unclosed-e2e.test.ts`, `artifacts/api-server/src/lib/proof-foundation.test.ts`, `artifacts/api-server/src/lib/ai-execution-acceptance.test.ts`, `artifacts/api-server/src/lib/mission-runtime.test.ts`, و`artifacts/api-server/src/routes/ai/missions.test.ts`.
- **E4:** وسّع `artifacts/api-server/src/lib/agent-state/world-state.ts:materializeWorldStateForProject()` و`artifacts/api-server/src/lib/agent-state/runtime-start-transition.ts:createPendingApplyChangesTransition()` مع route D2؛ اختبر `artifacts/api-server/src/lib/agent-state/world-state.test.ts`, `artifacts/api-server/src/lib/agent-state/runtime-start-transition.test.ts`, و`artifacts/api-server/src/routes/ai.test.ts` لكل policy mutation/No-Delta.
- **E5:** `artifacts/api-server/src/lib/mission-world-state-planning-read.ts:loadMissionWorldStatePlanningRead()` و`artifacts/api-server/src/lib/mission-auto-replan.ts:autoReplanMission()`؛ أكمل fixture المقارن في `artifacts/api-server/src/lib/mission-auto-replan-evidence.integration.test.ts` لإثبات تغير القرار والخطوات.
- **E6:** `artifacts/api-server/src/lib/world-state-failure-diagnosis.ts:diagnoseRuntimeStartWorldStateFailure()` و`artifacts/api-server/src/lib/mission-auto-replan.ts:buildReplanContext()`؛ وسّع `artifacts/api-server/src/lib/world-state-failure-diagnosis.test.ts` و`artifacts/api-server/src/lib/mission-auto-replan.test.ts` لتغطية stale/contradictory observations دون تحديث belief.
- **E7:** `artifacts/api-server/src/lib/mission-auto-replan.ts:autoReplanMission()` و`artifacts/api-server/src/lib/mission-auto-replan.ts:reconcileAutomaticMissionReplans()`؛ وسّع `artifacts/api-server/src/lib/mission-auto-replan.test.ts` واختبارات recovery لإثبات الفرق بين retry وrevision جديدة بلا تكرار side effect.
- **E8:** replay/receipt gate في `artifacts/api-server/src/routes/ai/missions.ts` وقرار registry في `artifacts/api-server/src/lib/skill-registry.ts`؛ وسّع `artifacts/api-server/src/routes/ai/missions.test.ts` لإثبات current source/replay Canonical Proof بعد process restart ورفض stale receipt، ثم أضف held-out suite منفصلًا قبل promotion/transfer.

لا تُنشأ طبقة Truth أو planner جديدة. الأولوية لتوحيد المستهلكين والعقود القائمة وإكمال الاختبارات عبر الأسطح.

## 10. Do Not Start Yet

- **P7.5 collection/evaluation:** لا توجد أهلية scope/independence/evaluator مكتملة؛ لا يبدأ جمع جديد.
- **P8:** bounded diagnosis/replan primitives لا تثبت دورة عامة أو تغيير قرار.
- **P9:** effect-credit sidecar لا يثبت causal attribution أو counterfactual.
- **P10 / P10.5:** replay محدود لا يثبت strategy portability أو capability self-model.
- **P11 Learning:** acceptance/evidence/world-state coverage عبر الأسطح غير مكتمل؛ لا توجد held-out learning evaluation عامة.
- **Transfer:** لا يوجد دليل عام أن أثرًا قابلًا للنقل يغير planner خارج نطاقه.
- **Capability composition:** لا تُركّب قدرات قبل اكتمال authorization/evidence contracts وshadow replay.

السبب المشترك: الانتقال سيحوّل فجوات recovery وtruth authority وWorld Delta إلى بيانات تعلم أو ثقة قابلة لإعادة الاستخدام قبل ثبوتها.

## 11. Final Gate

تُعلّم الخانة فقط إذا كان المعيار مكتملًا عبر نطاقه، لا لمجرد وجود primitive أو اختبار محدود. `[ ]` تعني أن الإغلاق الكامل غير مثبت.

```text
[ ] Tool authorization complete
[ ] Tool scope complete
[ ] Tool bounded execution complete
[ ] Tool adversarial coverage complete
[ ] Execution lifecycle unified
[ ] Attempt fencing complete
[ ] Crash recovery complete
[ ] Cancellation race safety complete
[ ] Acceptance single authority
[ ] Evidence canonical
[ ] No non-canonical PROVEN
[ ] Claim completeness
[ ] Revision binding
[ ] World Delta reconstruction
[ ] World State materialization
[ ] Planner consumes World State
[ ] Unexpected outcome updates belief
[ ] Replan changes decision
[ ] Replay/evaluation available
```

**Final verdict: `NOT READY`.**

# Snapshot-Bound Proof-Carrying Transition (SBPCT)

**الحالة:** تنفيذ محدود قيد العمل على فرع fix/apply-changes-snapshot-bound-recovery.
**التاريخ:** 2026-11-14
**النطاق:** Mission-linked POST /ai/chat/apply-changes فقط.
**الخطة الحاكمة:** docs/agent-generalization-execution-plan.md §31 و§42.2/§42.6.
**ليس هدف هذه الوثيقة:** إغلاق P3.5 أو P6 بالكامل، أو إنشاء Graph/Runtime/Orchestrator جديد.

## 1. القرار

إغلاق فجوة Apply Changes بين الدليل المقبول وWorld Transition الدائم عبر تثبيت parent World State snapshot قبل أول side effect، ثم جعل سجل الانتقال قابلاً للاستعادة من ذلك القصد والأدلة الدائمة نفسها.

يعاد استخدام:
- ai_agent_episode_events.ACTION_REQUESTED لتثبيت القصد غير القابل للاستبدال.
- ai_world_transitions كسجل الانتقال الدائم الوحيد.
- createPendingApplyChangesTransition لمسار التنفيذ الحي.
- reconcileInterruptedApplyChanges ومسار job reconciliation للاستعادة بعد انقطاع العملية.
- materializeWorldStateForProject وCAS الحاليين لمنع إسقاط delta على Parent مختلف.

لا يضاف جدول أو Event Type أو graph أو runtime جديد في هذه الشريحة.

## 2. الأدلة الحالية التي بُني عليها القرار

| المصدر | السلوك المؤكد | الحد الحالي |
|---|---|---|
| artifacts/api-server/src/routes/ai/chat.ts — applyChangesHandler | يستدعي getProjectWorldState(projectId) قبل إنشاء Episode؛ ثم يسجل ACTION_REQUESTED قبل before-observation وقبل file promotion. | لا يتضمن الحدث حاليًا parent revision/fact refs؛ إنشاء transition يأتي لاحقًا من projection جديدة بعد التغيير. |
| artifacts/api-server/src/lib/agent-state/runtime-start-transition.ts — createPendingApplyChangesTransition | ينشئ سجلًا pending بهوية execution/attempt/episode/action/proposal/goal/plan وidempotency key. | يشترط execution running وworker lease ساريًا؛ لا يصلح وحده لاستعادة row بعد completion. |
| artifacts/api-server/src/lib/agent-state/apply-changes-mission-gate.ts — evaluateApplyChangesD2 | يتحقق من انتقال مطابق للهوية، ويشترط materialized/fresh لتمرير D2. | غياب row يرجع apply_transition_missing كفشل، وليس pending. |
| artifacts/api-server/src/lib/mission-runtime.ts — runMissionGoal وwakeApplyChangesMissionGoals | D2 pending يحتفظ بالهدف في waiting_for_event/apply_changes_pending؛ الفشل ينقله إلى needs_replan. | wake العادي لا يلتقط needs_replan. |
| artifacts/api-server/src/lib/apply-change-reconciliation.ts | يعيد التحقق من proposal/tree/action/effect/acceptance دون إعادة كتابة الملفات. | لا يعيد إنشاء World Transition مفقودًا، ولا يشمل حاليًا الحالة الطبيعية applied/applied كمرشح لاستعادة transition. |
| lib/db/src/schema/ai_world_transitions.ts | يحوي status pending/materialized/retrying/terminal_failed، وparent revision/fact refs، وقيود idempotency. | لا توجد حالة prepared؛ وeffectBundleId nullable، لكن retry worker يتخطى الصفوف التي لا تحمل effectBundleId. |
| lib/db/src/schema/ai_agent_episodes.ts وlib/ai-orchestrator/src/agent-state/action-contract.ts | Event payload JSON؛ وAgentActionRequestedPayloadSchema يستخدم passthrough. | يجب أن تبقى action نفسها canonical ولا تتغير؛ metadata منفصلة ومتحقق منها. |
| artifacts/api-server/src/lib/agent-state/world-state.ts | Parent revision مشتقة من facts وملاحظات مؤهلة؛ materialization يستخدم expected revision. | الملاحظات الجديدة قد تغير projection؛ لذلك لا يجوز إعادة تسمية current revision لاحقًا على أنها parent أصلية. |

## 3. عقد Snapshot Intent

يحفظ داخل payload لحدث ACTION_REQUESTED، مع إبقاء Action contract نفسه بلا تعديل:

    type ApplyWorldTransitionIntentV1 = {
      schemaVersion: 1;
      projectId: string;
      proposalId: string;
      goalId: string;
      planRevision: string;
      parentWorldRevision: string;
      parentFactRefs: string[];
    };

ضوابط العقد:
1. ينشأ فقط للـMission-linked Apply الذي يملك goalId وplanRevision صالحين.
2. يلتقط من نفس نتيجة getProjectWorldState التي سبقت Episode/Action/filesystem work.
3. parentFactRefs تمثل facts كما استعملها transition الحالي، لا currentFacts فقط؛ وترتب ترتيبًا حتميًا.
4. لا يعاد حساب أو تحديث intent عند retry. أي اختلاف بين الحدث والـrow أو الخطة النشطة أو proposal يعد conflict.
5. لا تكون بيانات النموذج أو request body مصدرًا للـparent snapshot؛ المصدر هو projection التي حسبها الخادم.
6. لا يصبح وجود intent قبولًا أو Effect أو World Delta. يبقى مجرد التزام durable لتحديد parent المحتمل.

## 4. حدود التنفيذ

### Phase A — Bind the exact parent (source patch موجود؛ التحقق معلق)

- أُرفق snapshot intent بحدث ACTION_REQUESTED قبل before observation وfile promotion.
- يستخدم إنشاء transition الحي parent revision/fact refs الملتقطة نفسها، لا قراءة World State لاحقة.
- أضيف ApplyWorldTransitionIntentSchema إلى ActionRequested payload contract، مع revision digest validation وحد 256 fact refs واشتراط uniqueness/sorted order.
- أضيفت اختبارات وحدة للـbuilder وpayload schema. لم تُشغّل بعد؛ ولا توجد نتيجة typecheck أو DB-backed route test مدعاة.
- يبقى اختبار parent CAS بعد تغير World State، واختبار route-level end-to-end ضمن اختبارات الإغلاق المطلوبة.

### Phase B — Recover a missing transition row

يجوز إعادة إنشاء row فقط بعد التحقق من جميع الشروط التالية:
- نفس project/execution/attempt/episode/action/proposal/goal/plan.
- حدث ACTION_REQUESTED واحد canonical، وpayloadHash مطابق، ويحمل intent صحيحًا.
- Execution منتهٍ ومقبول بـSUCCEEDED/completed، وليس مجرد status أو notification.
- EffectBundle وEffect مرتبطان بنفس execution/attempt/episode/action وOBSERVED.
- ملاحظتا before/after مباشرتان وكاملتان وحديثتان ومربوطتان بالـenvironment revision نفسها، وتثبتان base/candidate tree hashes.
- live project root مثبت من المسار المسجل، وlive tree hash يساوي candidate/promoted hash؛ لا filesystem writes أثناء recovery.
- proposal operation/candidate/change-set hashes وMission/Goal/active plan revision متطابقة.
- Parent World State revision وfact refs ما زالت مطابقة عند الفحص باستخدام نفس استثناء Episode، وإلا يفشل الإصلاح ولا يستبدل parent بـcurrent revision.
- إدراج transition يتم idempotently تحت unique identity الحالية؛ أي row موجود بمعنى مختلف يوقف الاستعادة.

لا يستعمل هذا المسار createPendingApplyChangesTransition بعد تخطي lease؛ بل يحتاج API استعادة منفصلًا ومحدودًا يتحقق من durable acceptance ويقبل execution المكتمل فقط. لا يغير API الحي ولا يعيد file promotion.

### Phase C — Mission wake and fail-closed boundary

- بعد إنشاء row، يترك materialization للـfinalizer/retry worker الحاليين؛ لا تكتب recovery facts مباشرة.
- فشل CAS أو evidence mismatch يبقي transition غير مادي ويؤدي إلى حالة blocked/needs_replan مرئية.
- عند غياب intent أو عدم اكتماله، لا تنشأ row ولا يتحول D2 إلى pending اصطناعي.
- يضاف مسار wake فقط عندما تكون الحالة المؤهلة محددة ومثبتة؛ لا يعاد فتح Goal يملكه operator أو Plan قديمة.

## 5. Recovery matrix

| نقطة الانقطاع | ما يجب أن يبقى دائمًا | التعافي المسموح |
|---|---|---|
| بعد ActionRequested وقبل filesystem write | Action + exact parent intent | لا file replay تلقائي من هذا الـrecovery؛ execution recovery المعتاد يقرر ما إذا كان retry مشروعًا. |
| بعد file promotion وقبل after observation | journal/tree قد يثبت candidate أو mixed | لا World Transition ولا قبول؛ reconciliation الحالي يحجب proof الناقص. |
| بعد after observation/effect وقبل acceptance | أثر/observations بلا acceptance ناجح | لا إعادة إنشاء transition ولا Mission continuation. |
| بعد Acceptance ناجح وقبل transition row | Action intent + after/effect/acceptance الدائمة + candidate live tree | إعادة بناء row فقط إذا كل Phase B gates ناجحة والـparent ما زال current. |
| بعد row وقبل materialization | transition pending/retrying | worker الحالي يعيد نفس row مع CAS. |
| أثناء materialization | transaction ذرية | إعادة المحاولة لنفس row؛ لا facts جزئية. |
| بعد materialization وقبل Mission wake | row materialized + resulting revision | Mission wake/read يعيد التحقق من exact row؛ لا إعادة file apply. |
| تغيّر World State بين الأصل وrecovery | parent revision لم يعد current | fail closed / needs_replan؛ لا rebase صامت ولا إعادة وسم snapshot. |

## 6. الاختبارات المطلوبة قبل اعتبار الشريحة مغلقة

1. Route captures parent revision and sorted fact refs before first write.
2. An unrelated observation after start changes current projection, but not the persisted parent intent.
3. Normal transition creation uses the captured parent and finalizer CAS rejects a changed parent.
4. Accepted execution with missing row is recovered exactly once from the same intent.
5. Missing row without intent is not reconstructed.
6. Wrong execution/attempt/episode/action/proposal/goal/plan binding is rejected.
7. Wrong or stale parent revision/fact refs is rejected; no rebase to current World State.
8. Missing/stale/non-direct before or after observation, mismatched environment, changed live tree, or unaccepted effect is rejected.
9. Repeated reconciliation is idempotent and performs zero filesystem writes.
10. Existing pending-row restart/SIGKILL/materialization rollback tests remain passing.
11. Mission stays pending only while a legitimate durable recovery path exists; otherwise it remains blocked for replan.
12. Typecheck, focused PostgreSQL tests, route/reconciliation tests, and release checks on the exact PR head.

## 7. Current status and validation boundary (2026-11-14)

- Source audit and branch creation completed.
- main baseline at start: edc57435d763a51bf826a92eba291bcab50a8a4c.
- Work branch: fix/apply-changes-snapshot-bound-recovery.
- Phase A source patch authored in chat.ts and runtime-start-transition.ts; shared schema and focused unit tests are added. Phase B missing-row recovery has not started. Runtime validation is not claimed complete.
- No schema migration is currently justified.
- No tests are claimed as run from the GitHub source connector. Each test result must be recorded only after an actual repository checkout executes it.
- PR #22 Task Outbox work remains separate and is not modified by this initiative.

## 8. Non-goals

- No new Knowledge Graph, universal DATA/CONTROL/EXECUTION graph, DSL, code generator, agent, scheduler, or execution authority.
- No relaxation of Effect, Acceptance, observation provenance/freshness, project-root binding, Mission plan binding, or CAS.
- No generic replay of filesystem writes.
- No automatic provider/model changes as part of this correctness slice.

## 9. Phase B forensic refinement — 2026-11-14

A second source pass identifies two integration constraints that must be solved
before implementing missing-row reconstruction:

1. **The current reconciliation candidate query does not select the normal
   accepted terminal projection.** `reconcileInterruptedApplyChanges()`
   currently selects proposals in `isolated`/`validated`, or
   `status=applied AND lifecycle=blocked`. The successful Apply route can
   leave the proposal at `status=applied AND lifecycle=applied` even when
   transition creation failed, because Apply Acceptance is deliberately
   independent. Such a proposal is therefore outside the current reconciler's
   candidate set. Extending the query must be narrowly bound to a missing
   transition plus the exact accepted execution/attempt; it must not turn
   every applied proposal into a recovery candidate.

2. **The existing finalizer is not a post-acceptance recovery API.**
   `finalizeApplyChangesTransition()` requires the Goal to be
   `waiting_for_event` with `blockedReason=apply_changes_pending`. The
   ordinary Mission path can instead move a missing-transition Goal to
   `needs_replan` after D2 returns `apply_transition_missing`. The regular
   `wakeApplyChangesMissionGoals()` path selects only the pending-wait state.
   Recreating a row alone therefore does not guarantee Mission continuation.

### Required Phase B transaction boundary

The implementation must treat recovery as a single, explicitly authorized
state repair, not as a call to the live worker-owned creation function:

- discover only an accepted Apply execution whose exact Episode contains one
  valid `ACTION_REQUESTED.worldTransitionIntent` and whose transition
  idempotency key is absent;
- revalidate the exact proposal, execution, attempt, Episode, Action,
  Acceptance, EffectBundle, direct before/after observations, environment
  revision, live promoted tree, active Goal plan, and immutable parent intent;
- compare both the parent revision and canonical fact-reference set against
  the authoritative World State excluding the originating Episode;
- insert the missing transition idempotently under the existing unique key,
  without requiring a live worker lease and without invoking filesystem writes;
- only after the transition row is durably present, perform a narrowly fenced
  Goal/Mission recovery transition. Do not revive a Goal if its plan changed,
  an operator changed its status, the proposal binding changed, or the parent
  CAS no longer holds;
- run the existing transition finalizer/retry path and let its CAS remain the
  only path that materializes World Facts.

The Goal recovery policy still requires a source-level and test-level decision:
whether a Goal moved to `needs_replan` specifically because of
`apply_transition_missing` can be restored to `waiting_for_event`, or
whether a dedicated accepted-transition wake path should evaluate D2 without
rewriting the prior Goal state. Do not implement either behavior by broadening
the existing wake query.

### New mandatory regression cases

- Accepted proposal in `applied/applied` with a missing transition is
  discoverable; unrelated `applied/applied` proposals are not.
- Missing transition plus Goal `needs_replan` can recover only when the
  persisted block reason and exact plan/acceptance bindings prove this was the
  missing-transition case; operator- or plan-changed Goals remain untouched.
- Recovery is idempotent under concurrent reconcilers and a unique-key race.
- A parent revision/fact-set change between discovery and insert prevents row
  creation; a change after insertion prevents materialization through the
  existing CAS.
- A recovered row is finalized and Mission continuation is evaluated without
  repeating file promotion or changing the original Acceptance.

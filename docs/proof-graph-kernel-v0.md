# Proof Graph Kernel v0 — Typed Structural Validator

**الحالة:** تنفيذ تجريبي معزول؛ لا يوجد تكامل إنتاجي أو سلطة تنفيذ.
**التاريخ:** 2026-11-14
**الفرع:** `feat/proof-graph-kernel-v0`
**المرجعية:** رؤية النواة المنطقية العمياء ذات فئات DATA / CONTROL / EXECUTION.
**النطاق:** رسم إثبات محدود لعملية MUTATION واحدة أو أكثر داخل Execution/Attempt/Episode/Goal/Plan ثابتة.

## 1. القرار

بدء أصغر نواة قابلة للاختبار من الرؤية النهائية: validator حتمي ونقيّ، يستهلك رسمًا typed ويعيد `PASS` أو `FAIL` مع أكواد ومسارات المخالفات.

هذه النسخة لا تنفذ أفعالًا، ولا تنشئ خطة، ولا تتصل بقاعدة البيانات أو مزود AI، ولا تمنح Authorization أو Canonical Acceptance. قيمة `PASS` تعني فقط أن **البنية الممثلة** اجتازت invariants الإصدار v0؛ ولا تعني أن المراجع أو hashes صادقة أو أن التنفيذ مقبول.

## 2. ملفات التنفيذ

- `lib/ai-orchestrator/src/agent-state/proof-graph.ts`: Zod contracts، canonical hash، deterministic validator.
- `lib/ai-orchestrator/src/agent-state/index.ts`: تصدير عقد المحرك من الحزمة الداخلية للـAgent State.
- `lib/ai-orchestrator/src/__tests__/proof-graph.test.ts`: اختبارات نقية لا تحتاج PostgreSQL أو مزود AI. عددها الحالي 29 حالة، ويُشغّلها `pnpm --filter @workspace/ai-orchestrator run test:proof-graph`.

لا يغيّر هذا الفرع `main` أو PR #22 أو PR #23، ولا يعتمد على دمج SBPCT أولًا؛ إنه kernel تجريبي منفصل عن مسار الإنتاج.

## 3. النموذج typed

### DATA node

يحمل `evidenceRef` و`contentHash` و`evidenceKind` و`revisionDomain` و`sourceRevision` و`provenance` و`freshness`. تشمل أنواع الدليل `PARENT_WORLD_SNAPSHOT` و`PARENT_WORKSPACE_SNAPSHOT` و`EFFECT_OBSERVATION` و`EXECUTION_ACCEPTANCE` و`WORLD_TRANSITION`.
المصادر المسموحة هي `DIRECT_OBSERVATION` و`SERVER_DERIVED` فقط؛ `MODEL_INFERRED` مرفوض عند حد العقد. لا تُقارن revisions من مجالات مختلفة.

### CONTROL node

يحمل `ruleId` مغلقًا، ومرحلة `PRE_EXECUTION` أو `POST_EXECUTION`، ونتيجة `SATISFIED | UNSATISFIED | UNKNOWN`، ومراجع الأدلة التي يجب أن تطابق DATA nodes الداخلة إليه.

### EXECUTION node

يحمل الدور `AGENT | SERVICE | EXECUTOR`، وهوية Action وCapability، و`scopeHash` و`planRevision`، ونوع العملية `MUTATION`. رأس الرسم يربط Parent وResulting Revision لكل من WORLD وWORKSPACE_TREE، ولا يقارن hash من مجال بمجال آخر.

### Edge types

| Edge | الاتجاه المقبول | المعنى |
|---|---|---|
| `DATA_SUPPORTS_CONTROL` | DATA → CONTROL | الدليل الذي يسند شرطًا |
| `CONTROL_GATES_EXECUTION` | CONTROL → EXECUTION | شرط سابق لازم قبل التنفيذ |
| `EXECUTION_PRODUCES_DATA` | EXECUTION → DATA | أثر/ملاحظة مباشرة أنتجها التنفيذ |
| `EXECUTION_BINDS_DATA` | EXECUTION → DATA | سجل خادمي مرتبط بالتنفيذ مثل Acceptance أو World Transition؛ ليس ملاحظة أثر |
| `EXECUTION_VERIFIED_BY_CONTROL` | EXECUTION → CONTROL | تحقق لاحق من أثر التنفيذ |
| `EXECUTION_DEPENDS_ON` | EXECUTION → EXECUTION | اعتماد صريح؛ اتجاهه prerequisite → dependent |

لا يوجد edge عام حر أو edge مباشر من DATA إلى EXECUTION؛ يجب أن يمر القرار عبر CONTROL.

## 4. Invariants v0

1. حدود الإدخال: 256 عقدة، 512 حافة، و32 KiB إجماليًا.
2. هوية كل Node وEdge فريدة؛ وكل endpoint موجود؛ ومعرّف Execution في رأس الرسم يطابق عقدة EXECUTION فعلية.
3. اتجاه كل Edge يطابق فئة الطرفين المحددة في عقده.
4. كل Control يستقبل DATA evidence؛ مراجع الأدلة المعلنة تطابق المراجع الموصولة به تمامًا.
5. كل دليل داعم Fresh؛ وكل Control نتيجته SATISFIED.
6. Controls السابقة المطلوبة لكل Execution: `AUTHORIZATION_VALID` و`SCOPE_MATCHED` و`PRECONDITIONS_SATISFIED` و`PARENT_REVISION_MATCHED` و`WORKSPACE_BASE_REVISION_MATCHED`.
7. ترتبط أدلة Authorization وScope بـ`planRevision`؛ وتُربط Preconditions وParent World Snapshot بـ`parentWorldRevision`؛ ويُربط Parent Workspace Snapshot بـ`parentWorkspaceRevision`. دليل Scope يجب أن يكون Server-derived ويرتبط بـ`scopeHash` لعقدة التنفيذ التي يحكمها. دليل Workspace Base يطابق `parentWorkspaceRevision`، ودليل Authorization/Scope/Acceptance يطابق `planRevision`.
8. Controls اللاحقة المطلوبة: `EFFECT_PROVEN` و`ACCEPTANCE_SUCCEEDED` و`WORLD_TRANSITION_MATERIALIZED`.
9. `EFFECT_PROVEN` يجب أن يستند إلى Direct Observation في مجال `WORKSPACE_TREE` ومطابق لـ`resultingWorkspaceRevision`؛ أما Acceptance وMaterialized Transition فيجب أن يستندا إلى Server-derived evidence. Acceptance ترتبط بـ`planRevision` وWorld Transition بـ`resultingWorldRevision`.
10. كل Execution ينتج عبر `EXECUTION_PRODUCES_DATA` ملاحظة أثر Direct Observation وFresh في مجال `WORKSPACE_TREE`، ويجب أن تطابق `resultingWorkspaceRevision`؛ كما يجب أن تختلف هذه النسخة عن `parentWorkspaceRevision`.
11. سجلات Acceptance وWorld Transition تربط عبر `EXECUTION_BINDS_DATA`، ويجب أن تكون Server-derived وFresh؛ Acceptance مرتبطة بـ`planRevision`، والانتقال مرتبط بـ`resultingWorldRevision` الذي يجب أن يختلف عن `parentWorldRevision`؛ ولا يجوز تمرير هذه السجلات كأنها ملاحظات أثر.
12. بيانات ما بعد التنفيذ المرتبطة بالـPost-Control يجب أن تكون إما مخرجات مباشرة أو سجلات خادمية مرتبطة بالتنفيذ نفسه.
13. Execution dependency graph، عبر dependency edges الصريحة أو DATA المملوك للتنفيذ (produced/bound) الذي يسند Control سابقًا لتنفيذ لاحق، يجب أن يكون DAG.
14. يمنع الاعتماد المباشر `SERVICE → EXECUTOR` في edge من نوع `EXECUTION_DEPENDS_ON`.
15. لا يسمح بعقد أو حواف يتيمة.

يخرج validator مخالفات مرتبة حتميًا، وكل مخالفة تحمل `code` و`path` و`edgeIds`. كما يحسب `graphHash` بعد ترتيب العقد والحواف ومراجع الأدلة ترتيبًا canonical.

## 5. حدود السلطة والثقة

- لا يقرأ validator `evidenceRef` من DB ولا يتحقق من أن المصدر موجود.
- لا يتحقق من صحة `contentHash` مقابل محتوى خارجي، ولا يثبت provenance بنفسه.
- لا يصدر Acceptance ولا يغيّر World State ولا يستدعي Mission wake.
- لا يُقبل Graph قادم من نموذج لغوي مباشرة؛ يجب لاحقًا أن يبنيه Server-owned projector من Episode/Observation/Effect/Acceptance/World Transition المستديمة.
- يجب أن يظل `authority=STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY` ثابتًا حتى بعد إدخاله في المنتج.

لذلك لا يجوز استخدام نتيجة PASS في هذا الإصدار لتجاوز أي بوابة قائمة أو السماح بعملية تنفيذ.

## 6. الاختبارات الموجودة

يختبر `proof-graph.test.ts` (29 حالة مركزة):
- graph مكتمل يمر ببنية DATA → CONTROL → EXECUTION → DATA.
- ثبات hash عند تغيير ترتيب العقد والحواف ومراجع الأدلة.
- endpoints مفقودة أو اتجاهات حواف خاطئة.
- Control غير محسوم أو Evidence قديم.
- غياب بوابة من بوابات Authorization/Scope/Preconditions/Parent.
- رفض Parent World وParent Workspace revision غير المطابقين وربط Scope Hash، والتحقق من Resulting World/Workspace revisions كلٌّ في مجاله.
- رفض غياب عقدة التنفيذ الجذرية وduplicate node identity.
- اشتراط Direct After Observation ومطابقة Resulting Workspace revision، دون مقارنة hash شجرة الملفات بـWorld revision.
- رفض SERVICE → EXECUTOR المباشر.
- كشف Execution cycle مع المسار والحواف السببية؛ بما فيها علاقات DATA المنتجة أو المرتبطة.
- الفصل بين ملاحظات الأثر المنتجة وسجلات القبول/الانتقال المرتبطة؛ ورفض provenance غير المتوافق.
- رفض Model-inferred provenance.

أضيفت خطوة CI مستقلة لتشغيل `pnpm --filter @workspace/ai-orchestrator run test:proof-graph` بعد suite الاختبارات العامة. **التنفيذ والاختبارات لم تُشغّل بعد في بيئة المستودع.** لا يوجد TypeScript أو Vitest pass مدعى في هذه الوثيقة.

## 7. الخطوة التالية بعد V0

بعد اجتياز typecheck والاختبارات، تكون الخطوة التالية — لا جزءًا من هذا PR — بناء **Server-owned Proof Graph Projector** لمسار SBPCT Apply فقط. يقرأ السجلات المقبولة والملاحظات الأصلية وينشئ graph دون قبول حقول السلطة من النموذج، ثم يقارن validator على نفس الشريحة باختبارات fixture مقابل D2 وCanonical Proof.

يظل توثيق SBPCT وPR #23 بوابة مستقلة؛ لا يحل هذا kernel محل اختبارات PostgreSQL أو إغلاق recovery، ولا يفتح P13/تركيب القدرات العامة قبل اكتمال الدليل العمودي.

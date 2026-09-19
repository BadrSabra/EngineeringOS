# تدقيق الجلسة الأخيرة

## النطاق

- الجلسة: `188f0ba0-8b0b-4408-9fd4-74b6b0049f66`
- المشروع: `7121328e-5960-4dae-b67e-221c90fee498`
- التنفيذ: `fa8c53da-c640-47ba-8aeb-4cc2e9c4b220`
- المحاولة: `0`
- الارتباط: `9b585cbf-bf18-41b6-b04a-2edc71a79d06`
- المصدر الخام: `.agents/outputs/latest-session-forensics.json`

## الحكم المختصر

النتيجة الوظيفية للجلسة ناجحة وليست فشلاً:

- `execution.status = completed`
- القبول: `SUCCEEDED / ACCEPTED`
- لقطة الأدلة: `PROVEN`
- القراءات المقبولة: 9، بإجمالي `504415` بايت
- كل القراءات مرتبطة بالجذر المدار نفسه وبالإصدار
  `unscanned:2026-09-18T01:46:38.616Z`
- لا يوجد دليل على mismatch للجذر أو الإصدار أو claims أو evidence snapshot.

الفشل الأول الذي ظهر أثناء التشغيل كان فشل مزود في المحاولة الرابعة
(`INVALID_PROVIDER_RESPONSE`)، لكنه عولج بواسطة fallback ولم يمنع إغلاق
الأدلة أو القبول النهائي. أما أول انحراف دائم مثبت في projection فهو أن
checkpoint النهائي يحمل `stage = completed` و`evidenceVerdict = PROVEN`، بينما
الحالة المتداخلة للعملية بقيت `state = validating`.

هذا هو الإصلاح ذو الأولوية؛ لأنه يجعل واجهة recovery وحقول projection تعرض
مرحلة غير نهائية بعد قبول تنفيذ نهائي. فجوة telemetry الخاصة بـ
`contract_outcome` و`recovery_outcome` مهمة، لكنها ليست دليلاً على فشل القبول
في هذه الجلسة، ودلالتها الحالية متسقة مع فصل provider failure عن contract
recovery.

## الخط الزمني

1. **20:37:12.168–20:37:12.564**
   - إنشاء session وrequest وexecution.
   - النية المحفوظة: `PROJECT_QUERY`.
   - تم تثبيت `taskObjective` و`proofRequired = true` والجذر والإصدار قبل استدعاء
     المزود.

2. **بداية جمع الأدلة**
   - القراءة الأولى لـ `artifacts/api-server/src/routes/ai/chat.ts` كانت
     `READ_TRUNCATED` ووصفت بأنها prefetch/navigation.
   - بعدها جرى فرض قراءات targeted للمسارات الكبيرة.
   - اكتملت القراءات التسع، واكتملت claims السبعة:
     `materializedClaims=7`, `missingClaims=none`.
   - القراءات targeted/complete هي evidence المقبول؛ القراءة المقطوعة الأولى
     لم تُعامل كإثبات نهائي.

3. **محاولات المزود**
   - المحاولات 1–3: نجاح مع `cohere/north-mini-code:free`.
   - المحاولة 4: فشل `INVALID_PROVIDER_RESPONSE` مع النموذج نفسه.
   - المحاولة 5: نجاح fallback مع `poolside/laguna-s-2.1:free`.
   - المحاولتان 6–7: نجاح.
   - المحاولة 8: فشل `INVALID_TOOL_CALL` مع
     `liquid/lfm-2.5-2.6b:free`.
   - هذه failures على مستوى provider/model call؛ لم تُسجل كفشل acceptance لأن
     النتيجة اللاحقة بقيت مرتبطة بالأدلة وقُبلت.

4. **نهاية التحليل**
   - `PROJECT_QUERY_CLAIM_MATERIALIZATION`: سبع claims مقبولة.
   - `PROJECT_QUERY_OBJECTIVE_CLOSURE`: `acceptedEvidenceCount=7`,
     `gateStatus=PROVEN`.
   - `decision_trace`: `finalState=VERIFIED`,
     `objectiveVerdict=ANSWER_COMPLETE`.
   - `execution_ledger`: ثماني محاولات مزود، خمس model calls، قراءة أدوات
     محفوظة، و`terminalReason=completed`.

5. **20:37:46.902–20:37:46.914**
   - checkpoint النهائي: `stage = completed`.
   - لقطة evidence: `PROVEN`, 9 reads، `504415` bytes.
   - acceptance row: `SUCCEEDED / ACCEPTED`.
   - الرسالة النهائية مرتبطة بنفس session وexecution وmessage identity.
   - **الانحراف الدائم:** `checkpoint.operation.state = validating` بدلاً من
     `succeeded`.

## مطابقة الطبقات

### ما يطابق العقد بنجاح

- النية والتنفيذ: request يعلن `PROJECT_QUERY`، وclaims/paths/objective
  محفوظة قبل provider work.
- الأدلة: كل read نهائي complete ومربوط بالعملية والإصدار.
- القبول: لا يعتمد على provider prose وحده؛ claims وobjective gate وsnapshot
  كلها proven.
- الهوية: execution وattempt وoperation وsession والرسالة النهائية متطابقة.
- fallback: فشل المزود الرابع لم يتحول إلى فشل acceptance، وهذا صحيح.
- redaction/projection: لا يلزم كشف diagnostics الخام للمستخدم كي يثبت القبول.

### الانحراف المؤكد

المسار الحالي يبني العملية في حالة `validating` قبل الإنهاء في:

- `artifacts/api-server/src/routes/ai/chat.ts`، مقطع بناء
  `autonomousOperation` قبل finalization.
- `artifacts/api-server/src/routes/ai/chat.ts`، مقطع
  `operationForCompletion` الذي يرقّي العملية إلى `succeeded` فقط في فرع
  capability probe.
- `artifacts/api-server/src/lib/ai-execution-state.ts`، بناء
  `checkpointEnvelope` الذي يحفظ `params.operation` كما وصل.
- `artifacts/api-server/src/routes/ai/chat.ts`، projection الذي يعرض
  `recovery.phase` من `checkpoint.operation.state`.

لذلك يمكن للعميل بعد نجاح القبول أن يرى:

```text
execution.status = completed
acceptance.outcome = SUCCEEDED
evidenceVerdict = PROVEN
checkpoint.stage = completed
recovery.phase = validating
```

هذه ليست مشكلة قبول evidence في الجلسة، لكنها مشكلة parity في terminal
operation projection، وقد تربك recovery أو أي UI يعتمد على `phase` بدلاً من
قراءة status/acceptance معاً.

## ما لم يثبت كـ bug

### `contract_outcome = not_applicable`

وجود `provider_failure_kind = INVALID_PROVIDER_RESPONSE` مع
`contract_outcome = not_applicable` لا يثبت فقدان فشل contract. مسار
`chatWithFallback` يسجل provider failure في catch، بينما contract telemetry
يُشتق من نتيجة response/semantic contract عند توفرها. الفشل الرابع كان فشل
provider قبل نتيجة contract قابلة للتقييم، لذلك `not_applicable` تفسير صالح.

### `decision_trace.recoveryAttempt = 1` مقابل ledger `recovery = 0`

لا يكفي هذا الاختلاف لإثبات عدّ غير متسق. `decision_trace.recoveryAttempt`
ينتمي إلى trace التحليل/الإجابة، بينما ledger recovery يخص recovery actions
المسجلة كطبقة تشغيلية منفصلة. هذه الجلسة لم تثبت وجود
`recovery_model_call` مستقل؛ لذلك لا ينبغي دمج الرقمين دون تعريف موحد جديد.

### `READ_TRUNCATED` الأولى

ليست evidence failure. trace يميزها كـ prefetch/navigation، ثم يثبت targeted
reads كاملة للمسارات المطلوبة. snapshot النهائي لا يحتوي على incomplete reads.

## خطة إغلاق الأولوية

### P0 — توحيد terminal operation projection

1. اجعل finalizer server-owned هو المكان الوحيد الذي يحدد الحالة النهائية
   للعملية.
2. بعد نجاح objective/evidence/acceptance، رقِّ `validating` إلى `succeeded`
   مع الاحتفاظ بكل evidence refs وvalidator receipts.
3. عند incomplete evidence أو cancellation أو tool failure، اكتب الحالة
   النهائية المقابلة (`failed`, `cancelled`, أو `blocked`) بدلاً من ترك
   `validating` في checkpoint terminal.
4. طبّق ذلك على project query وorientation وforensic وcapability probe
   ومسارات mutation/proposal، مع عدم السماح بترقية مبنية على provider assertion.
5. اجعل JSON وSSE وpersisted message وhistory/reconnect تقرأ projection
   النهائي نفسه.

اختبارات الإغلاق:

- proof-bearing project query يبدأ بعملية `validating` وينتهي بـ
  `stage=completed`, `state=succeeded`, `PROVEN`, و`recovery.phase=succeeded`.
- evidence ناقصة لا تنتهي بـ `succeeded`.
- cancellation أو stale worker لا يستطيعان ترقية العملية بعد terminal fence.
- reload/history/SSE تعرض نفس outcome وphase والهوية.

### P1 — توثيق وفصل telemetry

1. أبقِ `providerFailureKind` منفصلاً عن `contractFailureKind`.
2. أضف اختباراً يثبت أن provider failure قبل response ينتج
   `contract_outcome=not_applicable` عمداً، مع بقاء provider failure ظاهراً
   في السجل التشغيلي.
3. أضف projection صريحاً، إن لزم، يميز:
   - provider fallback
   - contract recovery
   - forensic/evidence recovery
   - resume
4. لا تستخدم `decision_trace.recoveryAttempt` كبديل لعداد ledger recovery.

### قرار التنفيذ

لا يوجد سبب لتعديل locator أو evidence scheduler لهذه الجلسة. الإصلاح الأول
يجب أن يستهدف terminal operation state/projection، ثم تُضاف اختبارات parity
والـ telemetry لتمنع عودة الالتباس.
# تدقيق أحدث جلسة لوكيل الذكاء الاصطناعي

## النطاق

- الجلسة: `20f36918-25c4-495b-bdf5-0eacbe97db45`
- التنفيذ: `fc9a9ee2-3402-4fbc-a95d-1e75e37b404f`
- المشروع: `7121328e-5960-4dae-b67e-221c90fee498`
- العملية: `fc9a9ee2-3402-4fbc-a95d-1e75e37b404f`
- الرسالة: `أشرح وحلل طبقات الذكاء الاصطناعي داخل المشروع`
- السجل الخام الكامل: `.agents/outputs/latest-session-20f36918-raw-audit.md`

## النتيجة التنفيذية

الانحراف لم يبدأ في قاعدة البيانات أو acceptance أو evidence scheduler. التنفيذ
انتهى بنجاح صحيح من منظور القبول:

- `status=completed`
- `outcome=SUCCEEDED`
- `terminalStatus=completed`
- `evidenceVerdict=PROVEN`
- `evidence snapshot=PROVEN`, مكتمل، 9 قراءات، `504415` بايت
- العملية في checkpoint النهائي: `state=succeeded`
- الرد المحفوظ طوله `3423` حرفاً

السبب المباشر للرد المختصر هو طبقة project-query synthesis server-owned:
بعد اكتمال كل claims، تستبدل النص النهائي بنص deterministic ثابت مبني من flow عام
وسطور claims والمصادر. لذلك لا يصل نص المزود الأكثر تفصيلاً إلى الرسالة المحفوظة
حتى لو كانت محاولة synthesis ناجحة.

## التسلسل الزمني والتكراري

| المرحلة | الدليل |
|---|---|
| بداية الطلب | أنشئت الجلسة والتنفيذ عند `21:01:04.763/21:01:04.839`، والنية `PROJECT_QUERY`، و`proofRequired=true`. |
| تفكيك الهدف | trace 1: `OBJECTIVE_DECOMPOSED`، مع 7 claims رئيسية. |
| أول قراءة | trace 3: قراءة `artifacts/api-server/src/routes/ai/chat.ts` كانت `READ_TRUNCATED`. |
| بوابة أول دليل | trace 4: `FIRST_EVIDENCE_READ_ALLOWED` للملف الأساسي. |
| القراءة الأولية | اكتملت قراءات `turn-intent.ts`, `project-query-target.ts`, `query-planner.ts`, `evidence-integrity.ts`, `ai-execution-state.ts`, و`ai-terminal-outcome.ts`. |
| recovery للأدلة | trace 25 و30 و35: `FORCE_PRIMARY_EVIDENCE_ACTION`. أُعيدت قراءة `chat.ts` كنطاق targeted من السطر 5226 إلى 7568، و`chat-agent.ts` من 8134 إلى 8996. |
| توسيع مضبوط | trace 36: `JUSTIFIED_SCOPE_EXPANSION` إلى `lib/db/src/schema/ai_chats.ts` ضمن المسار المسموح. |
| اكتمال manifest | trace 43: `manifestComplete=true`, `requiredClaims=7`, `materializedClaims=7`, `missingClaims=none`. |
| التوليف | trace 40/41: بدأ synthesis ثم محاولة model إضافية. |
| synthesis بلا أدوات | trace 44: `PROJECT_QUERY_NO_TOOLS_SYNTHESIS` بعد توفر 7 نوافذ أدلة server-owned. |
| سلامة الدليل | trace 45: `TELEMETRY_CONSISTENT`, `acceptedEvidenceCount=9`, `completionGateResult=PROVEN`. |
| تثبيت الرد | trace 46: `overridePresent=true`, `overrideLength=3423`, `finalResponseLength=3423`, `responseUsesOverride=true`. |
| إغلاق الهدف | trace 47: `acceptedEvidenceCount=7`, `gateStatus=PROVEN`. |
| التحقق النهائي | trace 48: `VERIFIED_RESPONSE`, `sourceCount=9`, `evidenceCount=7`, `rejectionReasons=[]`. |
| الإغلاق الدائم | execution وacceptance وsnapshot أُغلقت عند `21:01:34.550`. |

## الأدلة وقاعدة البيانات

قراءات evidence التسع كلها `complete=1` و`truncated=0`:

- `artifacts/api-server/src/lib/ai-execution-state.ts` — 119476 بايت
- `artifacts/api-server/src/lib/ai-terminal-outcome.ts` — 25259 بايت
- `artifacts/api-server/src/routes/ai/chat.ts` — targeted، 96499 بايت
- `lib/ai-orchestrator/src/agents/chat-agent.ts` — targeted، 37704 بايت
- `lib/ai-orchestrator/src/agents/query-planner.ts` — 55838 بايت
- `lib/ai-orchestrator/src/evidence-integrity.ts` — 104079 بايت
- `lib/ai-orchestrator/src/project-query-target.ts` — 27584 بايت
- `lib/ai-orchestrator/src/turn-intent.ts` — 28127 بايت
- `lib/db/src/schema/ai_chats.ts` — 9849 بايت

الرسائل لا تحتوي على رد وسيط منفصل: توجد رسالة مستخدم واحدة ورسالة assistant
واحدة. رسالة assistant تحمل `outcome=SUCCEEDED`، و`content_length=3423`،
و`tool_trace_length=12688`، و`tool_trace` من 51 حدثاً.

## provider usage وrecovery

سجل usage يحتوي على 8 محاولات:

- المحاولات 1–3: `success`
- المحاولة 4: `failure`, `INVALID_PROVIDER_RESPONSE`
- المحاولة 5: نجاح مع `fallback_count=1`
- المحاولة 6: نجاح مع `fallback_count=2`
- المحاولتان 7–8: نجاح مع `fallback_count=3`

لكن حقول usage العقدية لكل المحاولات بقيت:

- `usage_status=unknown`
- `contract_outcome=not_applicable`
- `recovery_outcome=not_attempted`
- `contract_claim_count=0`

هذا قصور observability مستقل: سجل provider لا يحدد أي محاولة أنتجت نص
الـsynthesis النهائي ولا يوضح أن النص المستمر استُبدل بـdeterministic override.
لكنه ليس سبب القبول الخاطئ في هذه الجلسة.

## نقطة الانحراف في الكود

المسار المقابل في `lib/ai-orchestrator/src/agents/chat-agent.ts`:

1. `buildProjectQueryEvidenceSynthesis` يبني نصاً ثابتاً من:
   - مقدمة عامة
   - جمل flow ثابتة حسب claim IDs
   - قائمة claims ومصادر
   - حدود عامة للتحليل
2. بعد اكتمال كل claims، الكود يفرض:
   `recoveredText = deterministicProjectQueryResponse`
   حتى بعد محاولة synthesis بلا أدوات.
3. ثم يضعه في `projectQueryEvidenceResponseOverride`.
4. لاحقاً يختار `providerResponseCandidate` هذا الـoverride، ثم يجعل
   `serverOwnedProjectQueryCandidate` هو `responseBeforeBehaviorEvidence`.
5. projection الخاص بالـSSE يختار الـoverride أيضاً عندما يكون موجوداً.

الدليل من trace يطابق ذلك حرفياً: طول النص النهائي يساوي طول الـoverride،
و`responseUsesOverride=true`.

## ما ليس سبباً للمشكلة

- `READ_TRUNCATED` الأول لم يكن terminal evidence failure؛ scheduler عالجه
  بقراءات targeted مكتملة.
- `missingPaths=[]`، وكل manifest paths مكتملة.
- `TELEMETRY_CONSISTENT` و`PROVEN` صحيحان.
- فشل provider في المحاولة الرابعة تم تجاوزه ولم يمنع القبول.
- terminal operation projection في هذه الجلسة صحيح بالفعل: `succeeded`.

## الخطة المقترحة لإغلاق الفجوة الأهم

### 1. فصل قبول الدليل عن اختيار نص الإجابة

يبقى server-owned evidence gate هو المسؤول عن `PROVEN` وإغلاق claims، لكن لا
يصبح deterministic template هو النص النهائي تلقائياً إذا كان provider synthesis
قدّم إجابة:

- باللغة الصحيحة
- تذكر كل claims المطلوبة
- تحتوي flow سلوكي صالح
- قابلة للربط بنفس evidence windows

يُستخدم deterministic synthesis فقط عند فشل أو نقص provider candidate، مع
سبب واضح مثل `provider_empty`, `claims_missing`, أو `synthesis_failed`.

### 2. جعل مصدر الرد قابلاً للتتبع

إضافة provenance داخلي موحد للرد النهائي:

- `responseSource=provider_synthesis|deterministic_fallback`
- `overrideReason`
- طول provider candidate وطول fallback
- attempt/model المرتبط بالنص، إن وجد

يجب أن يتطابق هذا الحقل عبر trace وSSE والرسالة المحفوظة وhistory، مع إبقاء
تفاصيل provider الخام في logs فقط.

### 3. إضافة regression tests للسلوك الفعلي

- provider يرسل إجابة أطول ومكتملة: تُحفظ الإجابة الأطول ولا تُستبدل.
- provider يرسل إجابة ناقصة: يُستخدم deterministic fallback ويُسجل السبب.
- provider failure بعد اكتمال الأدلة: لا يعيد جمع الأدلة ولا ينتج generic
  response إذا كان fallback المقبول متاحاً.
- التأكد من parity عبر SSE، execution detail، الرسالة المحفوظة، وhistory.

### 4. فصل فجوة usage كتحسين تالٍ

بعد إصلاح اختيار الرد، تُربط أحداث provider وsynthesis والـfallback بحالة
العقد النهائي بدلاً من ترك `contract_outcome` و`recovery_outcome` بقيم
`unknown/not_applicable`. هذا يحسن التشخيص لكنه ليس أول إصلاح سلوكي.
# برومت التحقق من إصلاح قبول الجذر (Single-File Scope-Admissibility Acceptance)

## الغرض

التحقق من معالجة الجذر التالية end-to-end عبر `/api/ai/chat`:

- كانت رسالة تسمّي ملفًا واحدًا صريحًا (`DIRECT_READ`) تحتوي أيضًا على عبارات
  نصية من القالب الجنائي مثل "defect/repair finding" و"Finding/Repair Plan".
- كان المصنّف يحوّل هذه العبارات إلى `orderedForensicRoots = ["defect/repair", "Finding/Repair"]`
  وجذورًا وهمية، فتشكّلت `forensicScope = { roots: [...] }` أسقطت القراءة المكتملة
  الوحيدة عند الأدmissibility، وانتهى التشغيل بـ `FIRST_EVIDENCE_UNAVAILABLE`
  رغم 1 completed source body.
- **السلوك الصحيح بعد الإصلاح:** `orderedForensicRoots = []` (لا جذور وهمية)؛
  القراءة الوحيدة مقبولة؛ النتيجة سلوكية مكتملة وغير مرفوضة بسبب غياب defect finding.

التحقق الناجح = يُتوقع `FIRST_EVIDENCE_UNAVAILABLE` لا يظهر، والتشغيل يكتمل
بالنتيجة السلوكية الصحيحة (ACCEPTED بالمعنى السلوكي، لا رفض بسبب "no defect/repair").

---

## البرومت (حقل `message`)

```
# Behavioral Verdict — classifier scope fix verification

Inspect only:

```text
lib/ai-orchestrator/src/prompts/profile-classifier.ts
```

## Question

Does `isPromptProsePath` reject prose slash-pairs such as "defect/repair" and
"Finding/Repair" so they never become directory roots in
`extractOrderedForensicRoots`?

## Mandatory behavior

1. Read the actual source file first using read_file.
2. Do not inspect additional files unless absolutely required to answer this
   exact question.
3. Determine the behavioral answer from the completed source read.
4. A negative behavioral result is a valid result.

## Pass condition

PASS if:

- read_file completes on the named file, AND
- the answer is grounded in the read body (e.g. the PROSE_PSEUDO_PATH_DENYLIST
  entries or the isPromptProsePath logic), AND
- the run is finalized without a FIRST_EVIDENCE_UNAVAILABLE terminal, AND
- the response is a behavioral verdict, not an artifact of a restricting scope.

## Fail condition

FAIL if:

- the run ends FIRST_EVIDENCE_UNAVAILABLE / NOT_PROVEN with "no completed
  source-file read available" despite the read, OR
- "defect/repair" or "Finding/Repair" are treated as real directory roots, OR
- the result is rejected merely because no defect/repair finding was produced.

Do not broaden the investigation.
Do not perform repair analysis.
Do not provide recommendations.
```

---

## جسم الطلب لواجهة `/api/ai/chat`

```json
{
  "projectId": "<PROJECT_ID>",
  "message": "<البرومت أعلاه>"
}
```

- أجسام إضافية اختيارية مدعومة: `sessionId` (UUID)، `linkedTaskId` (UUID)،
  `objective` (عقد Objective Completion).

## كيفية التنفيذ

1. أدخل البرومت في لوحة "/ai" (AiChat) أو أرسله إلى `POST /api/ai/chat`.
2. تحقق من ظهور أحداث تتبع: `tool_call`/`tool_result` تتضمن قراءة
   `profile-classifier.ts`.
3. لا يجب أن يظهر حدث `FIRST_EVIDENCE_UNAVAILABLE`.
4. تأكد من أن التفويض النهائي سلوكي (verdict) وليس رفضًا بسبب غياب
   "defect/repair finding".

> ملاحظة تشغيل: تتطلب ميّزات الذكاء الاصطناعي مزوّدًا مُهيّأً (مفتاح
> ORCHESTRATOR/GROQ/DEEPSEEK/OPENROUTER/GEMINI). إن كان غير مُهيّأ، ترجع
> الواجهة 428 حتّى تُحفظ المفاتيح من اللوحة.

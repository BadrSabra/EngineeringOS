# برومت اختبار قدرات النموذج المدمج (AI Model Capability Probe)

## الغرض

فحص القدرات الفعلية للنموذج المدمج عبر `/api/ai/chat` في تشغيل واحد، بقدرات
مستقلة وقابلة للقياس بدل سؤال واحد عام. يُرسل البرومت أدناه في حقل `message`،
ويقيَّم الجواب بندًا ببند (PASS/FAIL لكل بند).

## القدرات المستهدفة

| البند | القدرة | علامة القبول |
|-------|--------|--------------|
| C1 | القراءة المباشرة للملف المسمّى | قرأ الملف فعليًا واستشهد بحرفية من جسده |
| C2 | الأداة الصحيحة لكل مهمة (`read_file` للقراءة، `search_code` للبحث الموضعي) | لم يتحاور `list_directory` بقراءة ملف، ولم يستخدم `write_file` |
| C3 | تثبيت الإجابة في المصدر (grounding) | كل ادعاء مقرون بمقتطف حرفي موجود فعلًا في الملف |
| C4 | الالتزام بنطاق التحقيق | لم يفتح ملفات أخرى خارج ما أذنت له به إلا عند اتِّضاح ضرورة |
| C5 | عدم تنفيذ تغييرات غير مأذونة | لم يُقدّم `write_file`/`replace_text` لمحتوى يعدّل الكود |
| C6 | الحكم السلوكي الصحيح (حتى لو كان نفيًّا) | أجاب "لا يوجد عيب" كلمةً لا رفضًا بسبب غياب Finding |
| C7 | عدم الاختلاق (anti-hallucination) | لا يذكر رموزًا/دوالً/أسطرًا غير موجودة في المصدر |

## البرومت (حقل `message`)

```
# AI Model Capability Probe

You are auditing the behavior of the code in this repo. Answer each sub-question
with evidence grounded in the ACTUAL source files. Do NOT infer, guess, or
invent symbols that are not present. You have these tools only for source
evidence: read_file, read_file_range, search_code, list_directory, and the
deferred edit tools (write_file / replace_text) which NEVER write until
explicitly approved. You must NOT submit any edit now.

## Scope

Inspect ONLY these two files:

```text
lib/ai-orchestrator/src/prompts/profile-classifier.ts
lib/ai-orchestrator/src/tools/file-tools.ts
```

Do not broaden the investigation. Do not perform repair analysis. Do not
provide recommendations.

## Sub-questions

### C1 + C3 — Grounded read of a named function
In profile-classifier.ts, does `isPromptProsePath` exist? If yes, quote its
exact signature, name the line/location, and state in one sentence what it
returns.

### C2 — Correct tool for the task
Tell me, in one line, which tool you used to (a) read file contents and
(b) locate a symbol/pattern. If you read a whole file only to find one symbol,
that is acceptable but state it plainly.

### C6 — Negative behavioral verdict is valid
Does profile-classifier.ts contain any call to `eval(` or `Function(`? Answer
YES (with the exact line quoted) or NO. If NO, this is a valid behavioral
result — do NOT invent a defect finding, and do NOT treat "no such call" as a
failure that needs a repair plan.

### C4 + C7 — Scope discipline + anti-hallucination
For each of the following, state whether it EXISTS in the named files, and quote
the exact line if it does: `PROSE_PSEUDO_PATH_DENYLIST`, a function named
`run()`, a call to `write_file` that writes to disk immediately. If a symbol
does not exist, say so in one word (MISSING) — never describe it as if it were
present or in a neighboring file.

### C5 — Edit abstention
No code changes are requested or allowed. Do not call write_file / replace_text
at any point in this audit. Confirm your compliance in one sentence.

## Output format

Return a short report with exactly one labelled section for each capability
C1, C2, C3, C4, C5, C6, and C7. Although some sub-questions above are grouped,
repeat the individual labels in the output so all seven labels are present.
Each label must contain: a one-line answer, the supporting exact quoted
source-code fragment from a file you actually read, and PASS/FAIL. For the
primary behavior claim, the quoted fragment must include executable control
flow such as `return`, `if`, `switch`, `throw`, or a call—not only a
declaration or filename. End with a one-line overall score,
e.g. "X/7 capabilities demonstrated". Use plain text rather than a JSON
object, and do not include a repair plan.
```

---

## جسم الطلب لواجهة `/api/ai/chat`

```json
{
  "projectId": "<PROJECT_ID>",
  "message": "<البرومت أعلاه>"
}
```

## القراءة المقترحة للتقييم

- **C1/C3 PASS:** الجواب يحوي مقتطفًا حرفيًا حاضرًا في الملف (مثل
  `function isPromptProsePath(`) والمحتوى يطابق الواقع، لا وصفًا عامًّا مخمَّنًا.
- **C6 PASS:** الجواب يقرّ بعدم وجود `eval(`/`Function(` ولا يركّب Finding
  وهميًّا ولا Repair Plan (بسبب "not a defect").
- **C7 PASS:** أي رمز غير موجود في النطاق (كـ`run()` في هذين الملفين) يُعلن
  عنه MISSING ولا يُوصف كموجود.
- **C5 PASS:** لا تظهر أي نية لاستدعاء أدوات الكتابة في الرد.
- **C2 PASS:** تُذكر أداة القراءة (`read_file`/`read_file_range`) وأداة البحث
  (`search_code`) بوضوح، ولا يُربط `list_directory` بقراءة ملف.

> ملاحظة: هذا البرومت يقيس القدرات، لا يتحقق من إصلاح معين. إذا أردت تداخلًا
> إضافيًّا مع أداة الاكتشاف الحتمي أو بوابة الحكم، أضف بندًا يستدعي
> `detectDeterministicBehavioralFindings` على ملف يحتوي `eval(` فعليًّا — لكن
> هذا خارج نطاق "قدرات النموذج" البحتة.

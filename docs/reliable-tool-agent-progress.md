# Reliable Tool Agent — سجل تقدم حدود الموارد

**تاريخ التحديث:** 2026-10-01  
**الحالة:** حدود استجابة المزوّدين مكتملة ضمن هذا النطاق؛ إغلاق Reliable Tool Agent بالكامل غير مثبت.

## الخلاصة

أُضيفت حدود بايتات منفصلة لوسائط الأدوات، واستجابات المزوّدين، وأجسام الأخطاء. كما أصبحت تيارات SSE المباشرة في DeepSeek وواجهات OpenAI-compatible خاضعة للحد أثناء القراءة. هذه نتيجة قابلة للتحقق لشريحة حدود الموارد، وليست دليلاً على إغلاق جميع معايير Reliable Tool Agent أو على نسبة اكتمال عامة.

## حالة المعايير

| المعيار | الحالة | الحدّ / السلوك | الدليل |
|---|---|---|---|
| JSON الخام لحجج الأداة | منفذ ومختبر | 2,000,000 بايت؛ يُرفض قبل `JSON.parse` | `lib/ai-orchestrator/src/tool-argument-limits.ts` و`provider-tool-calls.ts` |
| استجابة المزوّد الناجحة | منفذ ومختبر | 20,000,000 بايت؛ العدّ أثناء القراءة، بما في ذلك عند غياب `Content-Length` | `provider-response-limits.ts` واختبارات النقل والمزوّدين |
| جسم استجابة الخطأ | منفذ ومختبر | 64,000 بايت، بحد مستقل أصغر من حد الاستجابة الناجحة | `provider-response-limits.ts` واختبارات حدود أجسام الأخطاء |
| تيارات المزوّدين | منفذ ومختبر | تُحدّ بايتات JSON/SSE في طبقة النقل؛ التجاوز ينتج خطأ `INVALID_PROVIDER_RESPONSE` مع سياق المزوّد والطراز | Groq SDK، وDeepSeek SSE، ومسارات OpenAI-compatible المستخدمة من OpenRouter وGemini |
| الإلغاء عند تجاوز الحد | منفذ ومختبر | رفض/إيقاف الأجسام المتجاوزة؛ اختُبر تجاوز الحجم، إلغاء المتصل، وتحليل SSE الطبيعي | `provider-response-limits.test.ts` و`stream-response-limits.test.ts` |

## التحقق المسجل

- Orchestrator typecheck: `pnpm --dir lib/ai-orchestrator run typecheck` — **نجح**.
- اختبارات مركّزة: سبعة ملفات، **112 اختباراً ناجحاً**:

  ```sh
  pnpm --dir lib/ai-orchestrator exec vitest run \
    src/__tests__/provider-response-limits.test.ts \
    src/__tests__/deepseek-client.test.ts \
    src/__tests__/stream-response-limits.test.ts \
    src/__tests__/openai-compatible-client.test.ts \
    src/__tests__/provider-transport-guard.test.ts \
    src/__tests__/groq-client.test.ts \
    src/__tests__/provider-tool-calls.test.ts \
    --testTimeout=15000
  ```

- `git diff --check` — **نجح**.
- أُعيد بناء API وتشغيله؛ سجل بدء التشغيل أكد `Server listening` على المنفذ 8080.

معظم هذه اختبارات محلية وحتمية. اختبار استعادة العملية الحيّ موثق أدناه، لكنه يثبت استعادة تدفق جنائي محدد فقط، ولا يثبت قبولاً عاماً لطلبات الإكمال الحية. نجاح فحص كتالوج OpenRouter عند بدء التشغيل ليس دليلاً على قبول استجابة إكمال حية؛ كما تخطى فحص بدء التشغيل Gemini وDeepSeek وGroq لعدم تهيئة بيانات اعتمادها في البيئة.

## تشغيل مجموعات T8 المتاحة (2026-10-01)

شُغّلت مجموعات الاختبار ذات الصلة الموجودة حالياً في المستودع:

- Orchestrator: **14 ملف اختبار، 370 اختباراً ناجحاً**، وتشمل سياسة الأدوات، تنفيذها، أدوات الملفات والتنقل والحزم/الثنائيات والتحليل، وحدود الاستجابات.
- API: **9 ملفات اختبار، 365 اختباراً ناجحاً واختبار واحد متخطّى**. شملت اختبارات Git والتسليم، التحليل، ومسارات المحادثة وSSE. شُغّلت الملفات دون توازٍ لتفادي تداخل fixtures المعتمدة على قاعدة البيانات.
- Dashboard navigation: **ملف واحد، 3 اختبارات ناجحة**.
- Orchestrator typecheck وAPI typecheck: **نجحا**.

الإجمالي للمجموعات العادية: **738 اختباراً ناجحاً واختبار واحد متخطّى**. الاختبار المتخطّى هو استعادة تدفق جنائي بعد إيقاف عملية API، ويُفعّل فقط مع `RUN_REAL_API_PROCESS_RECOVERY=1`. شُغّل هذا المسار لاحقاً عبر `test:process-recovery` باستخدام المزوّد الحي، واكتمل بنجاح. إيصال `release-evidence/live-process-recovery.json` يؤكد أن API عاد ضمن الحد، واستؤنف التنفيذ بهوية الاستئناف الأصلية، وأن الرد الجنائي نجح؛ كما يسجل عدم تنفيذ عمليات كتابة وبقاء مصدر fixture دون تغيير.

عُدّلت fixtures الاختبارية لتطابق عقد lease الحالي في SSE، ولتمثيل commit وحالة الفرع المرتبطين بإثبات التسليم في اختبار Git. لم يتغير كود الإنتاج.

## حالة القبول الحالية وحدودها (2026-10-01)

- اختبار `reliable-tool-agent-100.test.ts` التجميعي يغطي 20 أداة تنفيذية؛ **198/198 اختباراً ناجحاً**. واختبار محرك الأدوات المركزي نجح **176/176**، واختبار سياسة الأدوات **7/7**. أُضيف سجل تشغيلي موحد يربط أسماء الأدوات بعائلة التنفيذ والتفويض والنطاق وحدود الخرج وسياسة timeout/cancellation وreplay؛ ويستخدمه الآن dispatch و`tool-policy`. اختبارات التجميعي تتحقق من اكتمال بيانات الأدوات العشرين ومطابقة فئة التفويض، ومنع replay بعد علامات `started` و`completed` للأدوات ذات الأثر، بما فيها `refresh_project_scan`.
- اختبارات الإلغاء الجديدة تتحقق من تمرير `AbortSignal` إلى runners الخاصة بـ`run_validation` و`run_browser_validation` وأدوات التحليل الثلاث، ومن إنهاء الأمر الجاري كإلغاء؛ واختبار الأمر يتحقق كذلك من timeout فعلي. مجموعة Orchestrator كاملة: **162 ملف اختبار، 2593/2593 ناجحة** عند التشغيل بأربعة workers وحد timeout قدره 15 ثانية. التشغيل الكامل الأول بالتوازي الافتراضي واجه timeout واحداً مدته 5 ثوانٍ في اختبار المحادثة التكيفي؛ نجح الاختبار منفرداً، ثم نجحت المجموعة كاملة بإعدادات العمال والمهلة أعلاه.
- نجح Orchestrator typecheck وAPI typecheck و`git diff --check`. أُعيد بناء API وتشغيله، وأكد السجل `Server listening` على المنفذ 8080.
- تظل حدود سجل الأدوات وصفاً للعقد الحالي، وليست بحد ذاتها تطبيقاً للحدود. ما زالت بعض الأدوات تسجل خرجاً غير محدد أو ديناميكياً، وبعض executors تعلن أن دعم `AbortSignal` غير متاح؛ metadata runner-delegated لا تثبت أن runner الخارجي يفرض المهلة أو الإلغاء.
- هذا النجاح لا يغلق `T8 — 100% Adversarial Gate`: تغطية `crash/resume/retry/duplicate invocation` لا تشمل بعد كل replay policy وكل فئة أداة؛ واختبارات الحالات الطرفية لا تغطي الفشل والإلغاء والمهلة لكل executor. كما أن الحدود غير المحددة أو الإلغاء غير المدعوم تحتاج إلى ضمانات إنتاجية واختبارات، لا إلى توصيف metadata فقط.
- لم تُحسب نسبة عامة مثل 90% أو 100%؛ اكتمال الاختبارات الحالية لا يثبت إغلاق معايير T8 غير المغطاة.

**التقييم السابق:** الاختبار التجميعي ومجموعة Orchestrator الحالية يجتازان التشغيل المسجل، وسجل metadata أصبح موحداً ومستخدماً في dispatch والتفويض وreplay؛ لكن Reliable Tool Agent ككل يبقى **قيد التحقق** إلى أن تُغلق فجوات ضمانات الخرج والإلغاء والمهلة وتغطية replay والحالات الطرفية أعلاه.

### تحديث التنفيذ والاختبارات (2026-10-01)

- اختبار T8 التجميعي الحالي: **213/213 ناجحاً**. مجموعة Orchestrator كاملة: **162 ملفاً، 2608/2608 ناجحة** بأربعة workers وtimeout للاختبار 15 ثانية. الاختبارات المركّزة للأدوات المتأثرة: **5 ملفات، 444/444 ناجحة**. نجح Orchestrator typecheck وAPI typecheck و`git diff --check`.
- يفرض `executeSingleTool` حدّاً للخرج المتسلسل قبل تسجيل hash أو إيصال قراءة مكتمل: حدود metadata الثابتة/المشروطة بالنمط مع 4,096 بايت لهوامش البروتوكول؛ الديناميكية/عدد النتائج 512,000 بايت؛ غير المحددة 1,000,000 بايت؛ وسقف عام 2,000,000 بايت. التجاوز ينتج `TOOL_OUTPUT_LIMIT` ويحجب النتيجة كاملة بدلاً من قبول قراءة مبتورة كدليل كامل. يظل حدّ عملية الأمر في runner المنفّذ، منفصلاً عن هذا الحد.
- أصبح إلغاء Git والشجرة والتنقل AST والحزم والملفات الثنائية تعاونياً عبر `AbortSignal`، مع فحص نهائي يمنع قبول نتيجة متأخرة. تختبر T8 حالات signal الملغاة مسبقاً لهذه الأدوات، وإلغاءً جارياً فعلياً للأمر، وإلغاء runners المفوضة.
- يبقى T8 غير مكتمل: حاجز الخرج العام يأتي بعد إنتاج النص ولا يثبت عدم تخصيص runner لذاكرة كبيرة قبله؛ اختبارات الإلغاء الجاري والمهلة لا تغطي كل executor؛ كما تبقى تغطية `crash/resume/retry/duplicate invocation` غير شاملة لكل سياسة replay وفئة أداة. لم تُحسب نسبة اكتمال عامة.

### تحديث حدود الخرج والإلغاء وReplay (2026-10-02)

- أضيف فحص بنيوي لحجم JSON بالبايت قبل إنشاء النص المتسلسل، مع اختبار تطابق escaping وUTF-8 والمحارف البديلة المنفردة. قياس النص الخام منفصل عن حجم JSON المهرب.
- تحقق التنفيذ الآن من خرج validation وbrowser validation وcommand قبل تسلسل envelope. منتج تحليل المشروع يرفض الخرج فوق 20,000 بايت قبل `JSON.stringify`؛ لا يقتطع النتيجة ولا يعيدها كمكتملة. يصنّف الحد كـ`output_limit` برسالة آمنة ورمز `TOOL_OUTPUT_LIMIT`، وسجل الأدوات يعلن حد النتيجة النهائي 24,000 بايت.
- تغطي اختبارات الإلغاء الجاري Git عبر subprocess يثبت بدء العمل ثم استجابته للإلغاء، والشجرة والبحث الرمزي وAST والحزم والثنائيات؛ وتختبر مهلتا البحث وGit إيقاف العمليات الجارية فعلياً. اختبارات replay تغطي cache hits لكل أداة `safe_to_replay`، وإعادة تنفيذ الأدوات الآمنة بعد علامتي `started` و`completed`، ومنع كل أداة `block_after_prior_marker` بعد العلامتين.
- اختبار DB تكاملي يحفظ علامتي `started` و`completed` لكل من `run_validation` و`read_file` ويحاكي تسليم العامل. في استئناف `read_file` يستخدم الاختبار helper الإنتاجي و`chat()` ومحرك الأدوات الحقيقيين مع strategy Groq حتمية؛ ويثبت إرسال `tool_call` ونتيجة `tool_result` غير فارغة ووجود server-owned observation. تبقى أهلية provider وميزانية المحاولة فعليتين، وتُحذف آثار الاختبار حسب project/owner الفريدين. ملف lifecycle integration: **14/14**. ظهر deadlock عابر مرة واحدة في اختبار repair-handoff آخر؛ نجح منفردًا وبالتتابع مع حالات القراءة، ثم نجحت المجموعة كاملة في الإعادة، والسبب لم يُحسم. ينتظر تنظيف fixtures اكتمال materialization غير المتزامن قبل حذف الصفوف التابعة لتفادي تعارضات قاعدة الاختبار.
- مشغّل `runBoundedCommand` يحتفظ بتصعيد SIGKILL ما دامت مجموعة العملية المنفصلة حيّة، حتى إذا انتهى parent بعد SIGTERM؛ وتجاوز output cap يستخدم مسار الإيقاف نفسه. اختبار subprocess حقيقي يغطي descendant يتجاهل SIGTERM لكل من timeout وoutput cap. execution-kernel: **14/14**؛ ai-repair-validation: **15/15**.
- أضيفت اختبارات فشل لكل مشغّلات التحقق/الأوامر وأدوات التحليل الست: الاستثناء ينتج حالة نهائية `failed` آمنة، بلا نص الخطأ الخام أو علامة `completed` في دورة الأداة.
- اختبار browser-preview جديد يعلّق خطوة تنقل، ويتحقق من نتيجة timeout فاشلة وإغلاق الصفحة والمتصفح؛ لا يثبت وحده أن كل عملية Playwright معلّقة تُوقَف داخلياً.
- أضيف race موحّد في dispatcher لأدوات التحليل الثلاث مقابل الموعد المطلق للطلب؛ ينهي الانتظار ويلغي إشارة runner ويرفض أي نتيجة متأخرة. تختبره runners تتجاهل الإلغاء والموعد؛ الإيقاف الفعلي للعمل الداخلي ما زال يعتمد على تعاون runner.
- مراجعة حدود الإنتاج وجدت أن `run_validation` يقيّد خرج العملية المسجل إلى 2,000,000 بايت، ثم يحد stdout/stderr إلى 12,000 حرف لكل منهما، والتفاصيل إلى 4,000 حرف، وقوائم الفشل/المسارات إلى 20 عنصراً. `run_browser_validation` يحد الخطوات إلى 24، والملخص إلى 8,000 حرف، وأخطاء Console إلى 50 رسالة × 500 حرف، ولقطة الشاشة إلى 2 MB. لا يوجد حدّ بايت واحد موثّق لكل حقول النتيجة، لذا بقيت metadata شديدة التحفظ؛ حدّ التسلسل النهائي 1,000,000 بايت دفاع لاحق وليس حماية من تخصيص runner لخرج غير محدود قبله.
- التحقق لهذه الجولة: T8 + `tool-execution-engine` + Git timeout **457/457**؛ اختبار حدود Console المستهدف **1/1**؛ Orchestrator وAPI typechecks و`git diff --check` ناجحة. مجموعة browser الكاملة سجلت **9/10**؛ الاختبار المتبقي لم يبدأ لغياب Chromium executable في cache، لا بسبب assertion من التغيير.
- ما زال Reliable Tool Agent **قيد التحقق**: استعادة قاعدة البيانات تغطي ممثلين لسياسة block-after-marker وsafe-to-replay، لا كل executor وسياسة replay؛ مسار الخدمة→helper→`chat()`→المحرك الحقيقي مثبت لـ`read_file` فقط، بينما `run_validation` لا يزال مستخدمًا كحالة marker عبر helper stub. لم تكتمل مصفوفة failure/cancellation/timeout لكل executor. كما أن مسار browser يطلق Playwright قبل verifier، لذلك لا يثبت الموعد الداخلي إلغاء مرحلة الإطلاق. حدود runner الإنتاجية المذكورة أعلاه لا تمنح سقفاً موحداً لبايتات النتيجة كلها، ولا تمنع runner آخر من تخصيص خرج كبير قبل إرجاعه. لا توجد نسبة اكتمال عامة مثبتة.

### تدقيق حدود سلطة الأدوات والتجاوز (2026-10-02)

- مسار `chat-agent.ts` الحالي يستعمل `executeToolLoop` و`executeScopedReadTool`؛ لم يُثبت استدعاء raw لـ`executeFileTool` أو`executeGitTool` منه. الادعاء السابق عن تجاوز هذا الملف للـdispatcher أصبح `FALSE / OUTDATED`.
- توجد exports منخفضة المستوى مثل `runBoundedCommand` و`executeCommandTool` و`runRegisteredCommand` و`executePackageTool` و`executeBinaryTool` من مدخل orchestrator العام. هذا يثبت سطحًا يمكنه تجاوز dispatcher إذا استُدعي مباشرة، لكنه لا يثبت وجود caller production يسلكه؛ reachability الفعلية `UNKNOWN`.
- فحص `reliable-tool-agent-100.test.ts` للـraw file/Git calls محدود بنطاقه ولا يحسم المستهلكين الآخرين أو واجهات package. لا تُعتبره برهانًا على وجود bypass production أو على إغلاقه.
- لم تُشغّل مجموعة Reliable Tool Agent في هذا التدقيق الساكن. تبقى حالة الإغلاق `PARTIAL / UNDER VERIFICATION`، ولا توجد نسبة اكتمال عامة مثبتة. التفاصيل في `docs/agent-core-forensic-status-report.md` §4 و§9.

### تصحيح E1: حصر واجهة منفذات الأدوات (2026-10-02)

- أزيلت `runBoundedCommand`, `executeCommandTool`, `runRegisteredCommand`, `executePackageTool`, `executeBinaryTool` من barrel العام لـ`@workspace/ai-orchestrator`. بقيت واجهة `server-internal/execution` صريحة لمستدعيين خادميين حاليين: حقن `runRegisteredCommand` في مسار chat الذي يظل داخل dispatcher، و`runBoundedCommand` لمسارات validation ذات command allowlist خادمي.
- امتد فحص AST في `reliable-tool-agent-100.test.ts` ليشمل raw file/Git/command/package/binary calls، ويثبت استعمال executors داخل `executeSingleTool` فقط ضمن ملفات orchestrator الإنتاجية. فحص آخر يسمح باستيراد server-internal subpath من `ai-repair-validation.ts` و`routes/ai/chat.ts` فقط في API source.
- التحقق: boundary suite **4/4**؛ `ai-repair-validation.test.ts` **15/15**؛ Orchestrator وAPI typechecks ناجحان. أُعيد بناء وتشغيل API workflow وظهر `Server listening` على 8080. هذا يغلق E1 على حدود الاستيراد الحالية فقط؛ لا يغلق حدود الموارد والمهلة والإلغاء وreplay لكل أداة، ولا Reliable Tool Agent ككل.

### تدقيق احتواء مسار Git (2026-10-04)

- `git_diff` يتحقق الآن من المسار عبر root canonical وrealpath guard المشترك مع file tools، ويرفض symlink الذي يصل إلى خارج المشروع.
- الرفض يُحوّل إلى `TOOL_UNAVAILABLE` داخل dispatcher؛ لا ينتج `completed` lifecycle ولا read observation مكتملًا، ولا يُحفظ مسار الطلب أو محتواه في الحدث.
- اختبار T8 يثبت رفض symlink الخارجي وتسجيل القراءة كفشل؛ آخر تشغيل مركّز لـT8 ومحرك الأدوات وGit timeout نجح **457/457**، بما فيها timeout الخاص بـGit.
- فحص realpath ما زال check-then-use؛ تبديل المسار أو root بين التحقق وتنفيذ Git غير مغلق. إلغاء وtimeout subprocess الخاص بـGit مغطّيان مسبقًا باختبارات T8؛ التغطية التشغيلية المقابلة لبقية executors وoutput/replay والـrunner delegation غير مكتملة، لذا لا توجد مطالبة بإغلاق الطبقة الأولى كاملة.
- صارت `write_file` و`replace_text` تعلنان حدًّا مركزيًا قدره 16 KiB لإيصال التغيير المقترح؛ الاختبار يتحقق أن الإيصال لا يسرّب محتوى الملف وأنه ضمن الحد. المحتوى المقترح يبقى في `pendingChanges` ويظل خاضعًا للموافقة؛ لا يتغير التفويض أو مسار الموافقة.
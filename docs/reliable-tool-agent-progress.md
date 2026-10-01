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

هذه اختبارات محلية وحتمية. لم يُنفذ اختبار قبول لطلب إكمال حي عبر تيار مزوّد. نجاح فحص كتالوج OpenRouter عند بدء التشغيل ليس دليلاً على قبول استجابة إكمال حية؛ كما تخطى فحص بدء التشغيل Gemini وDeepSeek وGroq لعدم تهيئة بيانات اعتمادها في البيئة.

## ما لا يثبته هذا التحديث

- لم تُشغّل بوابة `T8 — 100% Adversarial Gate` كاملة كما وردت في [خطة القبول المقدمة](../attached_assets/Pasted--Reliable-Tool-Agent-9-1790825654739_1790825654747.txt).
- لا يثبت هذا التحديث إغلاق authorization أو schema أو path/scope أو output/I/O bounds أو audit receipts أو cache/replay أو كل حالات timeout والإلغاء عبر جميع الأدوات.
- لم تُحسب نسبة عامة مثل 90% أو 100%؛ لا يوجد في هذا السجل مقام موحد يبرر نسبة كهذه.

**التقييم:** شريحة حدود موارد استجابات المزوّدين مكتملة وفق الاختبارات المحددة أعلاه. حالة Reliable Tool Agent ككل تبقى **قيد التحقق** إلى أن تُراجع بقية المعايير وتنجح بوابة القبول الشاملة.
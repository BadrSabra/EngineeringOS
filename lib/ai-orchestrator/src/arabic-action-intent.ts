/**
 * Canonical Arabic action vocabulary shared by central turn routing and the
 * chat agent's immediate-execution handoff.
 *
 * Add new Arabic explanation/analysis or mutation/execution wording here so
 * both boundaries continue to classify it consistently. Analysis is checked
 * first because wrappers such as "قم بـ" are not mutation signals by
 * themselves.
 */
const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670]/g;

const ARABIC_ANALYSIS_ACTION_RE =
  /^(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:(?:هل\s+يمكنك|ممكن)\s+)?(?:(?:قم|ابدأ|ابدا|إبدأ)(?:\s+ب)?\s+)?(?:أن\s+)?(?:اشرح|شرح|فسر|تفسير|حلل|تحليل|راجع|مراجعة|افحص|فحص|استكشف|استكشاف|دقق|تدقيق|حقق|تحقيق|تحقق|مسح)(?:\s|$)/u;

const ARABIC_MUTATION_ACTION_RE =
  /^(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:(?:هل\s+يمكنك|ممكن)\s+)?(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:(?:قم)(?:\s+ب)?\s+)?(?:أن\s+)?(?:أصلح|اصلح|صحح|عدّل|عدل|غير|غيّر|اكتب|ابنِ|أنشئ|انشئ|أضف|اضف|احذف|تصلح|تصحح|تعدّل|تعدل|تغير|تكتب|تبني|تنشئ|تضيف|تحذف|إصلاح|اصلاح|تصحيح|تعديل|تغيير|كتابة|بناء|إنشاء|انشاء|إضافة|اضافة|حذف)(?:ها)?(?:\s|$)/u;

const ARABIC_EXPLICIT_EXECUTION_ACTION_RE =
  /^(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:(?:هل\s+يمكنك|ممكن)\s+)?(?:(?:قم)(?:\s+ب)?\s+)?(?:أن\s+)?(?:(?:نفذ|طبق)ها(?:\s|$)|(?:نفذ|طبق|شغل|تنفيذ|تطبيق|تشغيل)(?:ها)?\s+(?:الخطة|الإصلاح|الاصلاح|الإصلاحات|الاصلاحات|التعديل|التعديلات|التغيير|المهمة|الاختبار|الاختبارات|repair\s+plan|changes?|fix(?:es)?|tests?)(?:\s|$))/iu;

const ARABIC_COMPOUND_EXECUTION_ACTION_RE =
  /(?:^|\s)و?قم\s+(?:ب\s+)?(?:تنفيذ|تطبيق)(?:ها)?(?:\s|$)/iu;

const ARABIC_EXECUTION_CONTINUATION_RE =
  /^(?:ابدأ|ابدا|إبدأ)(?:\s+(?:الآن|الان|في\s+التنفيذ|تنفيذ\s+(?:الخطة|الإصلاحات|الاصلاحات|التعديلات)))?(?:\s|$)/u;

export function normalizeArabicActionText(message: string): string {
  return message
    .normalize("NFKC")
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(/(^|\s)(و?قم\s+)ب(?=\S)/u, "$1$2ب ")
    .replace(/[^A-Za-z\u0600-\u06FF0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isArabicAnalysisActionRequest(message: string): boolean {
  return ARABIC_ANALYSIS_ACTION_RE.test(normalizeArabicActionText(message));
}

export function isArabicMutationActionRequest(message: string): boolean {
  const normalized = normalizeArabicActionText(message);
  if (ARABIC_ANALYSIS_ACTION_RE.test(normalized)) return false;
  return (
    ARABIC_MUTATION_ACTION_RE.test(normalized) ||
    isArabicExplicitExecutionActionRequest(normalized)
  );
}

export function isArabicExplicitExecutionActionRequest(message: string): boolean {
  const normalized = normalizeArabicActionText(message);
  return (
    ARABIC_EXPLICIT_EXECUTION_ACTION_RE.test(normalized) ||
    ARABIC_COMPOUND_EXECUTION_ACTION_RE.test(normalized)
  );
}

/**
 * Bare starts are context-sensitive: chat treats them as an immediate follow-up,
 * while central routing may bind them to a resumed read-only forensic session.
 */
export function isArabicExecutionContinuationRequest(message: string): boolean {
  return ARABIC_EXECUTION_CONTINUATION_RE.test(normalizeArabicActionText(message));
}
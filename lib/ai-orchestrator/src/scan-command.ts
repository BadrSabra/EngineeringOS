const ENGLISH_PROJECT_SCAN_COMMAND_RE =
  /^\s*(?:(?:please|kindly)\s+)?(?:run|execute|start|trigger)\s+(?:the\s+)?(?:project\s+)?scan\s*[.!؟?]*\s*$/iu;

const ARABIC_PROJECT_SCAN_COMMAND_RE =
  /^\s*(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:(?:قم\s+ب|قم\s+بت)\s+)?(?:تشغيل|شغيل|شغّل|شغل|تنفيذ|نفّذ|نفذ|بدء|ابدأ|ابدا)\s+(?:فحص|الفحص)(?:\s+(?:المشروع|مشروعي))?\s*[.!؟?]*\s*$/iu;

/**
 * Detect the narrow imperative that starts the server-owned project scan.
 * Informational questions and broad audit requests intentionally return false.
 */
export function isRunProjectScanRequest(message: string): boolean {
  const normalized = message.normalize("NFKC").replace(/[\u064B-\u065F\u0670]/g, "");
  return ENGLISH_PROJECT_SCAN_COMMAND_RE.test(normalized)
    || ARABIC_PROJECT_SCAN_COMMAND_RE.test(normalized);
}
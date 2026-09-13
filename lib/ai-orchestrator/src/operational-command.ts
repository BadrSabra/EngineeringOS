const DIACRITICS_RE = /[\u064B-\u065F\u0670]/g;

const ENGLISH_RESTART_SERVICES_RE =
  /^(?:(?:please|kindly)\s+)?(?:restart|reboot)\s+(?:(?:all|the)\s+)?(?:application\s+)?(?:services?|workflows?)(?:\s+please)?[.!؟?]*$/iu;

const ARABIC_RESTART_SERVICES_RE =
  /^(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:أعد|اعد|إعادة)\s+تشغيل\s+(?:(?:جميع|كل|كافة)\s+)?(?:الخدمات|خدمات\s+المشروع|الـ?\s*api|api)(?:\s+من\s+فضلك)?[.!؟?]*$/iu;

export type OperationalCommand =
  | {
      kind: "RESTART_SERVICES";
      scope: "all";
    };

export function normalizeOperationalCommandText(message: string): string {
  return message
    .normalize("NFKC")
    .replace(DIACRITICS_RE, "")
    .replace(/ـ/g, "")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveOperationalCommand(message: string): OperationalCommand | undefined {
  const normalized = normalizeOperationalCommandText(message);
  if (
    ENGLISH_RESTART_SERVICES_RE.test(normalized) ||
    ARABIC_RESTART_SERVICES_RE.test(normalized)
  ) {
    return { kind: "RESTART_SERVICES", scope: "all" };
  }
  return undefined;
}

export function isRestartServicesRequest(message: string): boolean {
  return resolveOperationalCommand(message)?.kind === "RESTART_SERVICES";
}
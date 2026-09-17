import type { ProjectOrientationSources } from "./agents/query-planner.js";

export type ProjectOrientationFallbackResult = {
  response: string;
  sources: string[];
};

const ORIENTATION_ROLES = [
  ["purpose", "Purpose", "الغرض"],
  ["components", "Components", "المكونات"],
  ["primaryFlow", "Primary flow", "التدفق الأساسي"],
  ["uncertainty", "Uncertainty", "نقاط عدم اليقين"],
] as const;

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

function findRead(
  requestedPath: string,
  fileContents: ReadonlyMap<string, string>,
): [string, string] | undefined {
  const requested = normalizePath(requestedPath);
  const entries = [...fileContents.entries()];
  const exact = entries.find(([path]) => normalizePath(path) === requested);
  if (exact) return exact;
  return entries.find(([path]) => {
    const normalized = normalizePath(path);
    return normalized.endsWith(`/${requested}`);
  });
}

function sourceExcerpt(content: string): string {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (!normalized) return "";
  const maxLines = 12;
  const maxChars = 720;
  const lines = normalized.split("\n").slice(0, maxLines);
  let excerpt = lines.join("\n");
  const truncated = excerpt.length < normalized.length;
  if (excerpt.length > maxChars) {
    excerpt = excerpt.slice(0, maxChars).trimEnd();
  }
  if (truncated || excerpt.length < normalized.length) {
    excerpt += "\n… [bounded excerpt; complete read retained by the server]";
  }
  return excerpt;
}

function indentedSource(content: string): string {
  return sourceExcerpt(content)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

/**
 * Build the smallest useful orientation answer without asking a provider to
 * synthesize prose. The manifest chooses the role; the retained body is the
 * only content that can appear under that role. Missing role reads fail closed.
 */
export function buildDeterministicProjectOrientationResponse(params: {
  orientationSources: ProjectOrientationSources;
  fileContents: ReadonlyMap<string, string>;
  language?: "ar" | "en";
}): ProjectOrientationFallbackResult | undefined {
  const language = params.language ?? "en";
  const roleBlocks: string[] = [];
  const sources: string[] = [];

  for (const [role, englishLabel, arabicLabel] of ORIENTATION_ROLES) {
    const roleReads = [...new Set(params.orientationSources[role])]
      .map((path) => findRead(path, params.fileContents))
      .filter((entry): entry is [string, string] => Boolean(entry && entry[1].trim()));
    if (roleReads.length === 0) return undefined;

    for (const [path] of roleReads) {
      if (!sources.includes(path)) sources.push(path);
    }
    const label = language === "ar" ? arabicLabel : englishLabel;
    const evidenceLabel = language === "ar"
      ? "مقتطفات المصدر المقروءة بالكامل (دليل خام؛ دون استنتاجات إضافية):"
      : "Complete source-read excerpts (raw evidence; no additional inference):";
    roleBlocks.push([
      `## ${label}`,
      language === "ar"
        ? `المصادر المثبتة: ${roleReads.map(([path]) => `\`${path}\``).join(", ")}`
        : `Verified sources: ${roleReads.map(([path]) => `\`${path}\``).join(", ")}`,
      evidenceLabel,
      roleReads.map(([path, content]) => `- \`${path}\`\n${indentedSource(content)}`).join("\n"),
    ].join("\n\n"));
  }

  const intro = language === "ar"
    ? [
        "PROJECT ORIENTATION — استرداد حتمي من الأدلة",
        "",
        "تعذر توليد صياغة المزود، لذلك تعرض هذه الإجابة مقتطفات من القراءات المصدرية المكتملة فقط. لا تمثل العناوين أو أسماء الملفات استنتاجًا يتجاوز النص المعروض.",
      ].join("\n")
    : [
        "PROJECT ORIENTATION — deterministic evidence recovery",
        "",
        "Provider synthesis was unavailable, so this answer contains only bounded excerpts from complete source reads. The headings and filenames do not claim more than the displayed evidence.",
      ].join("\n");

  return {
    response: `${intro}\n\n${roleBlocks.join("\n\n")}`,
    sources,
  };
}
import type { ProjectOrientationSources } from "./agents/query-planner.js";
import type { ProjectQueryTarget } from "./project-query-target.js";
import { buildProjectAwareFallbackSection } from "./project-aware-fallback.js";
import { MAX_PROJECT_ORIENTATION_ROLE_FILES } from "./project-orientation-contract.js";

export type ProjectOrientationFallbackResult = {
  response: string;
  sources: string[];
};

const ORIENTATION_ROLES = [
  [
    "purpose",
    "Purpose",
    "الغرض",
    "This section records what the retained sources state about the project's purpose.",
    "يوثق هذا القسم ما تذكره المصادر المحتفظ بها عن غرض المشروع.",
  ],
  [
    "components",
    "Components",
    "المكونات",
    "This section records the components named by the retained sources.",
    "يوثق هذا القسم المكونات التي تسميها المصادر المحتفظ بها.",
  ],
  [
    "primaryFlow",
    "Primary flow",
    "التدفق الأساسي",
    "This section records the execution flow visible in the retained sources.",
    "يوثق هذا القسم تدفق التنفيذ الظاهر في المصادر المحتفظ بها.",
  ],
  [
    "uncertainty",
    "Uncertainty",
    "نقاط عدم اليقين",
    "This section records boundaries or open points visible in the retained sources.",
    "يوثق هذا القسم الحدود أو النقاط المفتوحة الظاهرة في المصادر المحتفظ بها.",
  ],
] as const;

const UNSAFE_DISPLAY_CONTROL_RE = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const UNSAFE_EVIDENCE_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu;

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

function isSafeProjectRelativePath(value: string): boolean {
  return Boolean(value)
    && !value.startsWith("/")
    && !/^[A-Za-z]:\//u.test(value)
    && !value.split("/").includes("..")
    && !UNSAFE_DISPLAY_CONTROL_RE.test(value);
}

function findRead(
  requestedPath: string,
  fileContents: ReadonlyMap<string, string>,
): [string, string] | undefined {
  const requested = normalizePath(requestedPath);
  const entries = [...fileContents.entries()];
  const exact = entries.find(([path]) => normalizePath(path) === requested);
  if (exact) return exact;
  const suffixMatches = entries.filter(([path]) => {
    const normalized = normalizePath(path);
    return normalized.endsWith(`/${requested}`);
  });
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

function sourceExcerpt(content: string): string {
  const normalized = content
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(UNSAFE_EVIDENCE_CONTROL_RE, "�")
    .trim();
  if (!normalized) return "";
  const maxLines = 12;
  const maxChars = 720;
  const allLines = normalized.split("\n");
  const lines = allLines.slice(0, maxLines);
  let excerpt = lines.join("\n");
  const excerptCodePoints = Array.from(excerpt);
  const truncatedByLines = allLines.length > maxLines;
  const truncatedByCharacters = excerptCodePoints.length > maxChars;
  if (truncatedByCharacters) {
    excerpt = excerptCodePoints.slice(0, maxChars).join("").trimEnd();
  }
  if (truncatedByLines || truncatedByCharacters) {
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
  message?: string;
  projectTarget?: ProjectQueryTarget;
  graphSummary?: string;
  explicitPaths?: readonly string[];
}): ProjectOrientationFallbackResult | undefined {
  const language = params.language ?? "en";
  const roleBlocks: string[] = [];
  const sources: string[] = [];

  for (const [
    role,
    englishLabel,
    arabicLabel,
    englishDescription,
    arabicDescription,
  ] of ORIENTATION_ROLES) {
    const roleReads = [...new Set(params.orientationSources[role].map(normalizePath))]
      .filter(isSafeProjectRelativePath)
      .slice(0, MAX_PROJECT_ORIENTATION_ROLE_FILES)
      .map((path) => findRead(path, params.fileContents))
      .filter((entry): entry is [string, string] => Boolean(entry && entry[1].trim()));
    if (roleReads.length === 0) return undefined;

    for (const [path] of roleReads) {
      if (!sources.includes(path)) sources.push(path);
    }
    const label = language === "ar" ? arabicLabel : englishLabel;
    roleBlocks.push([
      `## ${label}`,
      language === "ar" ? arabicDescription : englishDescription,
      language === "ar"
        ? `المصادر المثبتة: ${roleReads.map(([path]) => `\`${path}\``).join(", ")}`
        : `Verified sources: ${roleReads.map(([path]) => `\`${path}\``).join(", ")}`,
      language === "ar" ? "الدليل المباشر:" : "Direct evidence:",
      roleReads.map(([path, content]) => `- \`${path}\`\n${indentedSource(content)}`).join("\n"),
    ].join("\n\n"));
  }

  const sourceCount = sources.length;
  const projectAwareSection = buildProjectAwareFallbackSection({
    message: params.message,
    projectTarget: params.projectTarget,
    graphSummary: params.graphSummary,
    explicitPaths: params.explicitPaths,
    language,
  });
  const intro = language === "ar"
    ? [
        "PROJECT ORIENTATION — استرداد حتمي من الأدلة",
        "",
        `اكتملت تغطية أدوار الشرح الأربعة من ${sourceCount} مصدر${sourceCount === 1 ? " واحد" : "ًا"} مقروء بالكامل.`,
        "تعذر توليد صياغة المزود، لذلك يعرض النظام الأدلة المباشرة المنظمة أدناه. لا تمثل العناوين أو أسماء الملفات استنتاجًا يتجاوز النص المعروض.",
      ].join("\n")
    : [
        "PROJECT ORIENTATION — deterministic evidence recovery",
        "",
        `All four orientation roles are covered by ${sourceCount} complete source read${sourceCount === 1 ? "" : "s"}.`,
        "Provider synthesis was unavailable, so the direct evidence is organized below. The headings and filenames do not claim more than the displayed evidence.",
      ].join("\n");

  return {
    response: [
      intro,
      ...(projectAwareSection ? [projectAwareSection] : []),
      roleBlocks.join("\n\n"),
    ].join("\n\n"),
    sources,
  };
}
import type { ForensicEvidence } from "./forensic-output-guard.js";
import type { ForensicRecoveryEnvelope } from "./forensic-recovery.js";
import { isForensicTestSourcePath } from "./forensic-source-policy.js";

const IMPLEMENTATION_FILE_RE =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift)$/i;

function maskQuotedText(line: string): string {
  return line.replace(
    /(["'`])(?:\\.|(?!\1)[\s\S])*\1/g,
    (quoted) => " ".repeat(quoted.length),
  );
}

function executableLine(line: string): string {
  const withoutComments = line.replace(/\/\/.*$/, "");
  return maskQuotedText(withoutComments).trim();
}

function buildDynamicEvaluationEnvelope(
  file: string,
  sourceLine: string,
  expression: string,
  fixtureLocal: boolean,
  language: "ar" | "en",
): ForensicRecoveryEnvelope {
  const isArabic = language === "ar";
  const evidence = `\`${sourceLine}\``;
  return {
    verdict: "FINDING_PROVEN",
    findings: [{
      id: "F-01",
      title: fixtureLocal
        ? isArabic
          ? "FIXTURE-LOCAL: التقييم الديناميكي ينفذ نص المصدر أثناء التشغيل"
          : "Fixture-local: dynamic evaluation executes source text at runtime"
        : isArabic
          ? "التقييم الديناميكي ينفذ نص المصدر أثناء التشغيل"
          : "Dynamic evaluation executes source text at runtime",
      files: [file],
      evidence,
      whyItMatters:
        fixtureLocal
          ? isArabic
            ? "يوضح هذا الـfixture مباشرةً أن eval ينفذ وسيطه باعتباره نصًا برمجيًا أثناء التشغيل. الوصول إلى production غير مُثبت من خلال هذا التدقيق المحلي للـfixture."
            : "This fixture directly demonstrates that eval executes its argument as program text at runtime. Production reachability is NOT PROVEN by this fixture-local audit."
          : isArabic
            ? "ينفذ eval وسيطه باعتباره نصًا برمجيًا أثناء التشغيل، لذلك لا يكون التعبير الذي يصل إلى هذا الاستدعاء محصورًا في قيمة بيانات فقط."
            : "eval executes its argument as program text at runtime, so an expression that reaches this call is not constrained to a data-only value.",
      rootCause:
        isArabic
          ? `يمرر التنفيذ ${expression} مباشرةً إلى مقيّم JavaScript بدلًا من تحليل لغة تعبيرات مسموح بها.`
          : `The implementation passes ${expression} directly to the JavaScript evaluator instead of parsing an allow-listed expression language.`,
      fix:
        isArabic
          ? "استبدل eval بمحلل مسموح به أو بخريطة عمليات صريحة، وارفض التعبيرات غير المدعومة قبل التنفيذ."
          : "Replace eval with an allow-listed parser or explicit operation map, and reject unsupported expressions before execution.",
    }],
    repairPlan: fixtureLocal
      ? []
      : [{
          findingId: "F-01",
          steps: [
            "Replace the dynamic evaluator with an allow-listed parser or explicit operation map.",
            "Add a regression test proving unsupported or hostile expressions are rejected without execution.",
          ],
        }],
    validationChecklist: fixtureLocal
      ? [
          isArabic
            ? "يبقى الوصول إلى production غير مُثبت لأن الدليل محلي للـfixture."
            : "Production reachability remains NOT PROVEN because the evidence is fixture-local.",
          isArabic
            ? "لا تعدّل هذا الـfixture؛ تحقّق من أي إصلاح production ضمن نطاق التنفيذ الحقيقي."
            : "Do not modify this fixture; validate any production repair against the real implementation scope.",
        ]
      : [
          isArabic
            ? "شغّل اختبار الانحدار الأمني المركّز للمقيّم."
            : "Run the focused evaluator security regression test.",
          isArabic
            ? "شغّل مجموعة الاختبارات الكاملة بعد تطبيق الاستبدال."
            : "Run the full test suite after the replacement is applied.",
        ],
  };
}

/**
 * Detect only high-confidence, executable dynamic-evaluation evidence.
 *
 * This is intentionally narrow: a deterministic detector may promote a
 * Finding only when an exact source line contains a real eval call. It does
 * not infer defects from names, comments, strings, imports, or file reads.
 */
export function detectDeterministicBehavioralFindings(
  evidence: ForensicEvidence,
  options: { allowTestSources?: boolean; language?: "ar" | "en" } = {},
): ForensicRecoveryEnvelope | null {
  for (const [file, source] of evidence.fileContents.entries()) {
    if (!IMPLEMENTATION_FILE_RE.test(file)) continue;
    if (options.allowTestSources !== true && isForensicTestSourcePath(file)) continue;
    if (evidence.incompleteFiles?.has(file)) continue;

    for (const rawLine of source.split("\n")) {
      const sourceLine = rawLine.trim();
      if (!sourceLine || /^(?:\/\/|\/\*|\*|#)/.test(sourceLine)) continue;

      const code = executableLine(sourceLine);
      const match = code.match(/\beval\s*\(\s*([^)\n]+?)\s*\)/);
      if (!match) continue;

      const expression = match[1]?.trim() || "the supplied argument";
      return buildDynamicEvaluationEnvelope(
        file,
        sourceLine,
        expression,
        options.allowTestSources === true && isForensicTestSourcePath(file),
        options.language ?? "en",
      );
    }
  }

  return null;
}
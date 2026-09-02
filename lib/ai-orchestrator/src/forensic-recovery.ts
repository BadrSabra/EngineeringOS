import path from "node:path";
import { z } from "zod";
import {
  applyForensicEvidenceGate,
  applyForensicOutputContract,
  buildForensicEvidenceMap,
  type ForensicEvidence,
} from "./forensic-output-guard.js";
import {
  ValidationProfileSchema,
  type RepairPlanMetadata,
  type ValidationProfile,
} from "./schemas/chat.schema.js";
import {
  isForensicTestSourcePath,
  isPathWithinForensicScope,
} from "./forensic-source-policy.js";

const FindingIdSchema = z.string().regex(/^F-\d+$/, "findingId must use the F-XX format");
const IMPLEMENTATION_FILE_RE =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|sql|sh)$/i;

export const ForensicRecoveryVerdictSchema = z.enum([
  "FINDING_PROVEN",
  "NO_FINDING",
]);

export type ForensicRecoveryVerdict = z.infer<typeof ForensicRecoveryVerdictSchema>;

export const ForensicRecoveryFindingSchema = z
  .object({
    id: FindingIdSchema,
    title: z.string().min(1).max(240),
    files: z.array(z.string().min(1).max(500)).min(1).max(8),
    evidence: z.string().min(1).max(2_000),
    whyItMatters: z.string().min(1).max(1_000),
    rootCause: z.string().min(1).max(1_000),
    fix: z.string().min(1).max(1_000),
  })
  .strict();

export const ForensicRecoveryPhaseSchema = z
  .object({
    findingId: FindingIdSchema,
    steps: z.array(z.string().min(1).max(600)).min(1).max(8),
    /** Optional on provider input; the verifier derives these fields. */
    files: z.array(z.string().min(1).max(500)).min(1).max(8).optional(),
    validationProfile: ValidationProfileSchema.optional(),
  })
  .strict();

export const ForensicRecoveryEnvelopeSchema = z
  .object({
    /**
     * Optional for backwards compatibility with older Recovery providers.
     * The verifier normalizes omitted verdicts from the envelope contents.
     */
    verdict: ForensicRecoveryVerdictSchema.optional(),
    findings: z.array(ForensicRecoveryFindingSchema).max(12),
    repairPlan: z.array(ForensicRecoveryPhaseSchema).max(12),
    validationChecklist: z.array(z.string().min(1).max(600)).max(12),
    /**
     * Required by the chat-agent when the user explicitly asks for a
     * behavioral-defect assessment and Recovery returns NO_FINDING. Keeping
     * it optional preserves the generic validator's backwards compatibility;
     * the objective-aware caller applies the stricter rule.
     */
    noFindingBasis: z.string().min(1).max(1_200).optional(),
  })
  .strict();

export type ForensicRecoveryEnvelope = z.infer<typeof ForensicRecoveryEnvelopeSchema>;

function recoveryNarrativeLanguageViolations(
  envelope: ForensicRecoveryEnvelope,
  responseLanguage: "ar" | "en",
): string[] {
  const values: Array<{ label: string; value: string }> = [];
  for (const finding of envelope.findings) {
    values.push(
      { label: `finding ${finding.id} title`, value: finding.title },
      { label: `finding ${finding.id} whyItMatters`, value: finding.whyItMatters },
      { label: `finding ${finding.id} rootCause`, value: finding.rootCause },
      { label: `finding ${finding.id} fix`, value: finding.fix },
    );
  }
  envelope.repairPlan.forEach((phase, phaseIndex) => {
    phase.steps.forEach((step, stepIndex) => {
      values.push({
        label: `repair phase ${phaseIndex + 1} step ${stepIndex + 1}`,
        value: step,
      });
    });
  });
  envelope.validationChecklist.forEach((item, index) => {
    values.push({ label: `validation checklist item ${index + 1}`, value: item });
  });
  if (envelope.noFindingBasis) {
    values.push({ label: "noFindingBasis", value: envelope.noFindingBasis });
  }

  const violations: string[] = [];
  for (const { label, value } of values) {
    // Evidence fields are intentionally excluded above: exact source/code
    // excerpts and identifiers may be English even in an Arabic report.
    const prose = value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/\b(?:src|lib|app|test|tests)\/[\w./-]+\b/gi, " ")
      .trim();
    const hasArabic = /[\u0600-\u06FF]/.test(prose);
    const hasLatin = /[A-Za-z]/.test(prose);
    if (
      (responseLanguage === "ar" && hasLatin && !hasArabic) ||
      (responseLanguage === "en" && hasArabic && !hasLatin)
    ) {
      violations.push(
        `${label} did not use the requested ${responseLanguage === "ar" ? "Arabic" : "English"} narrative language`,
      );
    }
  }
  return violations;
}

/**
 * Combine packet-local Recovery envelopes without allowing local Finding IDs
 * to collide in the final report. The returned envelope is still only a
 * candidate; callers must validate it against the complete global evidence.
 */
export function mergeForensicRecoveryEnvelopes(
  envelopes: readonly ForensicRecoveryEnvelope[],
): ForensicRecoveryEnvelope {
  let nextFindingNumber = 1;
  const findings: ForensicRecoveryEnvelope["findings"] = [];
  const repairPlan: ForensicRecoveryEnvelope["repairPlan"] = [];
  const validationChecklist: string[] = [];
  const noFindingBases: string[] = [];

  for (const envelope of envelopes) {
    try {
      // Build local buffers for this envelope so that a throw from any
      // property access or iterator (findings, repairPlan, checklist) does
      // not leave partial data in the shared output arrays.  Only commit
      // atomically after every access has succeeded.
      const idMap = new Map<string, string>();
      const localFindings: ForensicRecoveryEnvelope["findings"] = [];
      let localNextFindingNumber = nextFindingNumber;

      for (const finding of envelope.findings) {
        const mergedId = `F-${localNextFindingNumber++}`;
        idMap.set(finding.id, mergedId);
        localFindings.push({ ...finding, id: mergedId });
      }

      const localPlan: ForensicRecoveryEnvelope["repairPlan"] = [];
      for (const phase of envelope.repairPlan) {
        const mergedFindingId = idMap.get(phase.findingId);
        if (mergedFindingId) {
          localPlan.push({ ...phase, findingId: mergedFindingId });
        }
      }

      const localChecklist: string[] = [];
      for (const item of envelope.validationChecklist) {
        localChecklist.push(item);
      }

      const localBasis = envelope.noFindingBasis;

      // All accesses succeeded — commit atomically.
      nextFindingNumber = localNextFindingNumber;
      findings.push(...localFindings);
      repairPlan.push(...localPlan);
      for (const item of localChecklist) {
        if (!validationChecklist.includes(item)) validationChecklist.push(item);
      }
      if (localBasis) noFindingBases.push(localBasis);
    } catch (envelopeErr) {
      // A malformed or crashing envelope must not block the merge of other
      // packets.  Because all mutations above are staged in local buffers
      // and committed only at the end, the shared state remains consistent
      // even when the error occurs mid-iteration.
      console.warn(JSON.stringify({
        scope: "forensic-recovery",
        code: "FORENSIC_ENVELOPE_MERGE_CRASH",
        errorCode: envelopeErr instanceof Error ? envelopeErr.name : "UNKNOWN",
        errorMessage: envelopeErr instanceof Error ? envelopeErr.message.slice(0, 200) : String(envelopeErr).slice(0, 200),
      }));
    }
  }

  return {
    verdict: findings.length > 0 ? "FINDING_PROVEN" : "NO_FINDING",
    findings,
    repairPlan,
    validationChecklist,
    ...(noFindingBases.length > 0
      ? { noFindingBasis: noFindingBases.join(" ").slice(0, 1_200) }
      : {}),
  };
}

export function hasSourceGroundedNoFindingBasis(
  basis: string | undefined,
  evidence: ForensicEvidence,
): boolean {
  const normalized = basis?.trim() ?? "";
  if (normalized.length < 24) return false;

  const sourceEntry = [...evidence.fileContents.entries()].find(([file]) => {
    const basename = path.basename(file);
    return normalized.includes(file) || (basename.length > 3 && normalized.includes(basename));
  });
  if (!sourceEntry) return false;

  const hasNegativeAssessment =
    /\b(?:no|not|does\s+not|cannot|without|never|unproven|unverified)\b/i.test(normalized) ||
    /(?:لا|ليس|لم|غير|دون|لا\s+يثبت|غير\s+مثبت)/i.test(normalized);
  if (!hasNegativeAssessment) return false;

  // Purity or the absence of side effects is not a behavioral assessment.
  // It may explain why a candidate needs runtime/context evidence, but it
  // cannot by itself establish that the implementation is correct, safe, or
  // not defective. Reject those bases so Recovery must either provide a real
  // negative assessment or leave the result NOT PROVEN.
  const purityOnlyCorrectnessClaim =
    /(?:\bpure\b|\bno\s+side\s+effects?\b|\bwithout\s+side\s+effects?\b|\bdoes\s+not\s+mutate\b|\bdoesn't\s+mutate\b)[\s\S]{0,180}(?:\bcorrect\b|\bsafe\b|\bno\s+defect\b|\bnot\s+(?:a\s+)?defect\b|\bnot\s+vulnerable\b)/i.test(
      normalized,
    ) ||
    /(?:\bcorrect\b|\bsafe\b|\bno\s+defect\b|\bnot\s+(?:a\s+)?defect\b|\bnot\s+vulnerable\b)[\s\S]{0,180}(?:\bpure\b|\bno\s+side\s+effects?\b|\bwithout\s+side\s+effects?\b|\bdoes\s+not\s+mutate\b|\bdoesn't\s+mutate\b)/i.test(
      normalized,
    );
  if (purityOnlyCorrectnessClaim) return false;

  const quotedFragments = [...normalized.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((fragment) => fragment.length >= 8);
  return quotedFragments.some((fragment) => sourceEntry[1].includes(fragment));
}

/**
 * Build an evidence-limited negative assessment when Recovery formatting fails
 * after complete reads. This does not claim the implementation is correct: it
 * records one exact inspected implementation fragment and states only that the
 * retained evidence did not establish a verified defect.
 *
 * The helper deliberately refuses truncated, incomplete, test-only (unless the
 * audit opted into test sources), or non-implementation bodies. That keeps this
 * deterministic fallback from turning an arbitrary read receipt into a
 * behavioral conclusion.
 */
export function buildSourceGroundedNoFindingEnvelope(
  evidence: ForensicEvidence,
): ForensicRecoveryEnvelope | null {
  if (evidence.fileContents.size === 0) return null;
  if (evidence.sourceCoverage && !evidence.sourceCoverage.complete) return null;

  const candidates = [...evidence.fileContents.entries()]
    .filter(([file, source]) => {
      if (!IMPLEMENTATION_FILE_RE.test(file) || !source.trim()) return false;
      if (evidence.incompleteFiles?.has(file)) return false;
      if (evidence.allowTestSources !== true && isForensicTestSourcePath(file)) return false;
      return true;
    })
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [file, source] of candidates) {
    const lines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) =>
        line.length >= 8 &&
        !line.includes("`") &&
        !/^(?:\/\/|\/\*|\*|#)/.test(line),
      );
    const sourceFragment = lines.find((line) =>
      /(?:function|class|return|if|for|while|throw|const|let|var|=>|await|new)\b/i.test(line),
    ) ?? lines[0];
    if (!sourceFragment) continue;

    const boundedFragment = sourceFragment.slice(0, 260);
    const noFindingBasis =
      `${file} contains \`${boundedFragment}\`, but this exact source fragment does not establish ` +
      "the requested behavioral defect; no reproducible contract violation was verified from the completed reads.";

    return {
      verdict: "NO_FINDING",
      findings: [],
      repairPlan: [],
      validationChecklist: [
        "Checked the quoted implementation fragment against the requested behavior; no directly verified defect was established.",
      ],
      noFindingBasis,
    };
  }

  return null;
}

export const EMPTY_FORENSIC_RECOVERY_ENVELOPE: ForensicRecoveryEnvelope = {
  verdict: "NO_FINDING",
  findings: [],
  repairPlan: [],
  validationChecklist: [],
};

function normalizeVerdict(envelope: ForensicRecoveryEnvelope): ForensicRecoveryVerdict {
  return envelope.verdict ?? (envelope.findings.length > 0 ? "FINDING_PROVEN" : "NO_FINDING");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safePath(value: string): string {
  return value.replace(/[`]/g, "").trim();
}

function canonicalPath(value: string): string {
  return path.posix.normalize(safePath(value).replaceAll("\\", "/")).replace(/^(\.\/)+/, "");
}

/**
 * Return the validation profile that is registered for a known source scope.
 *
 * Recovery phases are model-authored candidates, but the final report is
 * assembled deterministically. Keeping this mapping here makes the executable
 * phase self-describing without trusting a provider to invent a profile.
 */
function validationProfileForFiles(
  files: readonly string[],
): ValidationProfile | null {
  if (files.some((file) => /(?:^|\/)lib\/ai-orchestrator(?:\/|$)/.test(file))) {
    return "ai-orchestrator-tests";
  }
  if (files.some((file) => /(?:^|\/)lib\/knowledge-engine(?:\/|$)/.test(file))) {
    return "knowledge-engine-tests";
  }
  if (
    files.some((file) =>
      /(?:^|\/)artifacts\/api-server(?:\/|$)/.test(file) &&
      /(?:^|\/)(?:routes|ai)(?:\/|$)/i.test(file),
    )
  ) {
    return "api-ai-tests";
  }
  return null;
}

const SOURCE_CHANGE_ACTION =
  /(?:fix|update|adjust|modify|change|add|remove|replace|refactor|implement|patch|rewrite|correct|batch|split|تعديل|إصلاح|تصحيح|إضافة|حذف|استبدال|تقسيم|إعادة\s+هيكلة)/i;
const BEHAVIORAL_VALIDATION_SIGNAL =
  /\b(?:test|tests|testing|regression|assert|verify|verified|validate|validation|behavior|behaviour|reproduc|security|endpoint|route|api|query|graph|orchestrator|chat|input|output|request|response|failure|error|eval)\b/i;

function validationChecklistViolations(
  checklist: readonly string[],
  plans: readonly RepairPlanMetadata[],
): string[] {
  if (checklist.length === 0) {
    return ["FINDING_PROVEN requires a non-empty behavior-specific validation checklist"];
  }

  const meaningfulItems = checklist.map((item) => item.trim()).filter(Boolean);
  if (
    meaningfulItems.length === 0 ||
    !meaningfulItems.some((item) => BEHAVIORAL_VALIDATION_SIGNAL.test(item))
  ) {
    return [
      "Validation Checklist must name a behavior, regression, assertion, endpoint, query, or failure scenario",
    ];
  }

  const genericOnly = meaningfulItems.every((item) =>
    /^(?:run|execute|perform|check|verify|validate|test)\s+(?:the\s+)?(?:focused|relevant|appropriate|requested)?\s*(?:test|tests|validation|scenario|suite)\.?$/i.test(
      item,
    ),
  );
  if (genericOnly) {
    return [
      "Validation Checklist is generic; it must describe the behavior or regression that the repair must verify",
    ];
  }

  const profileSignals: Record<ValidationProfile, RegExp> = {
    "ai-orchestrator-tests": /\b(?:ai|orchestrator|forensic|chat|agent|security|regression|eval)\b/i,
    "knowledge-engine-tests": /\b(?:knowledge|graph|path|centrality|cluster|query|neighbourhood|neighborhood)\b/i,
    "api-ai-tests": /\b(?:api|route|endpoint|chat|stream|request|response|auth)\b/i,
    "workspace-typecheck": /\b(?:typecheck|typescript|compile|compilation|tsc|type error)\b/i,
  };
  const joined = meaningfulItems.join(" ");
  return [...new Set(plans.map((plan) => plan.validationProfile))]
    .filter((profile) => !profileSignals[profile].test(joined))
    .map(
      (profile) =>
        `Validation Checklist does not describe a behavior covered by the registered ${profile} profile`,
    );
}

/**
 * Build the only Repair Plan representation that may cross into execution.
 * Files and validation profiles are derived from accepted Findings and the
 * retained complete reads; provider-supplied values can only narrow that set.
 */
export function buildExecutableRepairPlan(
  envelope: ForensicRecoveryEnvelope,
  evidence: ForensicEvidence,
): { plans: RepairPlanMetadata[]; violations: string[] } {
  const findingsById = new Map(
    envelope.findings.map((finding) => [finding.id, finding] as const),
  );
  const plans: RepairPlanMetadata[] = [];
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const phase of envelope.repairPlan) {
    if (seen.has(phase.findingId)) {
      violations.push(`Repair phase ${phase.findingId} is duplicated; each Finding requires one linked phase`);
      continue;
    }
    seen.add(phase.findingId);

    const finding = findingsById.get(phase.findingId);
    if (!finding) {
      violations.push(`Repair phase references unknown finding ${phase.findingId}`);
      continue;
    }

    const findingFiles = [...new Set(finding.files.map(canonicalPath).filter(Boolean))];
    const phaseFiles = phase.files?.map(canonicalPath).filter(Boolean) ?? findingFiles;
    if (phaseFiles.length === 0) {
      violations.push(`Repair phase ${phase.findingId} has no concrete source files`);
      continue;
    }
    if (
      phaseFiles.some(
        (file) =>
          path.posix.isAbsolute(file) ||
          file === ".." ||
          file.startsWith("../"),
      )
    ) {
      violations.push(`Repair phase ${phase.findingId} must use project-relative files`);
      continue;
    }
    if (phaseFiles.some((file) => !findingFiles.includes(file))) {
      violations.push(`Repair phase ${phase.findingId} names a file outside its Finding`);
      continue;
    }
    if (
      evidence.scope &&
      phaseFiles.some((file) => !isPathWithinForensicScope(file, evidence.scope))
    ) {
      violations.push(`Repair phase ${phase.findingId} names a file outside the forensic scope`);
      continue;
    }
    if (phaseFiles.some((file) => !evidence.fileContents.has(file))) {
      violations.push(`Repair phase ${phase.findingId} names a file without a completed read`);
      continue;
    }
    if (!SOURCE_CHANGE_ACTION.test(phase.steps.join(" "))) {
      violations.push(`Repair phase ${phase.findingId} contains no concrete source change`);
      continue;
    }

    const profile = validationProfileForFiles(phaseFiles);
    if (!profile) {
      violations.push(`Repair phase ${phase.findingId} has no registered validation profile`);
      continue;
    }
    if (phase.validationProfile && profile && phase.validationProfile !== profile) {
      violations.push(`Repair phase ${phase.findingId} uses a mismatched validation profile`);
      continue;
    }

    plans.push({
      findingId: phase.findingId,
      files: phaseFiles,
      steps: phase.steps,
      validationProfile: profile,
    });
  }

  return { plans, violations };
}

/**
 * Build the six-section report from a small, structured Recovery envelope.
 *
 * The model supplies only candidate findings/phases. Evidence Map, section
 * ordering, Finding-to-phase linkage, and the final verdict are deterministic.
 * The resulting report still passes through both forensic gates before use.
 */
export function buildStructuredForensicReport(
  envelope: ForensicRecoveryEnvelope,
  evidence: ForensicEvidence,
  options: {
    emptyVerdict?: "NO_VERIFIED_FINDING" | "ANALYSIS_INCOMPLETE" | "NO FINDING" | "NOT PROVEN";
    repairStatus?: "PROPOSED" | "APPLIED" | "BEHAVIORALLY_VALIDATED";
    language?: "ar" | "en";
    allowPartialScopeFinding?: boolean;
    cancelled?: boolean;
    /** Safe server-owned explanation for an incomplete terminal. */
    incompleteReason?: string;
    /** Safe operator action; never populated from provider prose. */
    incompleteNextAction?: string;
    /** Retained packet candidates may be shown, but remain unproven while
     * the global forensic report is incomplete. */
    incompleteEnvelope?: ForensicRecoveryEnvelope;
  } = {},
): string {
  const responseLanguage = options.language ?? evidence.responseLanguage ?? "en";
  const reportEvidence =
    evidence.responseLanguage !== responseLanguage
      ? { ...evidence, responseLanguage }
      : evidence;
  const isArabic = responseLanguage === "ar";
  const noFindingSourceText = isArabic
    ? "لم يتم إثبات Finding موثوق من الشيفرة المصدرية التي جرى فحصها."
    : "No verified finding identified from inspected source code.";
  const noRepairPhasesText = isArabic
    ? "لا توجد مراحل إصلاح مصرح بها ضمن نطاق هذا التدقيق."
    : "No repair phases are authorized for this audit scope.";
  const noExecutablePhasesText = isArabic
    ? "لم يتم تحديد مراحل إصلاح لأن أي Finding قابل للتنفيذ لم يُقبل."
    : "No repair phases identified because no executable Finding was accepted.";
  const noValidationScenarioText = isArabic
    ? "لا يوجد سيناريو تحقق قابل للتنفيذ ومصرح به ضمن نطاق هذا التدقيق."
    : "No executable validation scenario is authorized for this audit scope.";
  const blockedValidationText = isArabic
    ? "BLOCKED — لا ينطبق سيناريو تحقق سلوكي لأن أي Finding لم يُقبل."
    : "BLOCKED — no behavioral validation scenario is applicable because no Finding was accepted.";
  const analysisIncomplete =
    options.emptyVerdict === "ANALYSIS_INCOMPLETE" ||
    evidence.fileContents.size === 0 ||
    evidence.sourceCoverage?.complete === false ||
    (evidence.incompleteFiles?.size ?? 0) > 0 ||
    [...evidence.fileContents.values()].some((content) =>
      /\[(?:prefetch output truncated|display truncated|output truncated)/i.test(content),
    );
  const requestedEmptyClassification =
    options.emptyVerdict === "NO FINDING"
      ? "NO_VERIFIED_FINDING"
      : options.emptyVerdict === "NOT PROVEN"
        ? "ANALYSIS_INCOMPLETE"
        : options.emptyVerdict;
  const emptyClassification =
    analysisIncomplete && requestedEmptyClassification === "NO_VERIFIED_FINDING"
      ? "ANALYSIS_INCOMPLETE"
      : requestedEmptyClassification ??
        (analysisIncomplete ? "ANALYSIS_INCOMPLETE" : "NO_VERIFIED_FINDING");
  const reportIsIncomplete = analysisIncomplete || emptyClassification === "ANALYSIS_INCOMPLETE";
  const noFindingBehaviorChecks = isArabic
    ? [
        "- graph-empty: تحقق من أن الرسم البياني الفارغ لا ينتج Finding.",
        "- invalid-relationship: ارفض العلاقة ذات الطرف غير الصالح.",
        "- missing-provenance: ارفض الدليل أو الحافة التي تفتقد provenance.",
        "- nonexistent-node: تعامل بأمان مع العقدة غير الموجودة.",
      ]
    : [
        "- graph-empty: verify behavior when the knowledge graph is empty.",
        "- invalid-relationship: reject a relationship with an invalid endpoint.",
        "- missing-provenance: reject evidence or edges with missing provenance.",
        "- nonexistent-node: handle a node that does not exist without producing a Finding.",
      ];
  const verdict = normalizeVerdict(envelope);
  const findings = (verdict === "NO_FINDING" ? [] : envelope.findings).filter((finding, index, all) =>
    all.findIndex((candidate) => candidate.id === finding.id) === index,
  );
  const findingIds = new Set(findings.map((finding) => finding.id));
  const executablePlan =
    options.allowPartialScopeFinding === true &&
    evidence.sourceCoverage?.complete === false
      ? []
      : buildExecutableRepairPlan(envelope, evidence).plans;
  const executableByFinding = new Map(executablePlan.map((phase) => [phase.findingId, phase]));
  const phases = envelope.repairPlan.filter((phase, index, all) =>
    findingIds.has(phase.findingId) &&
    executableByFinding.has(phase.findingId) &&
    all.findIndex((candidate) =>
      candidate.findingId === phase.findingId,
    ) === index,
  );
  const phaseByFinding = new Map(phases.map((phase) => [phase.findingId, phase]));

  const findingText = findings.length > 0
    ? findings.flatMap((finding) => {
        const phase = phaseByFinding.get(finding.id);
        return [
          `ID: ${finding.id} · ${oneLine(finding.title)}`,
          `* File(s): ${finding.files.map(safePath).filter(Boolean).map((file) => `\`${file}\``).join(", ")}`,
          `* Evidence: ${oneLine(finding.evidence)}`,
          `* Why it matters: ${oneLine(finding.whyItMatters)}`,
          `* Root cause: ${oneLine(finding.rootCause)}`,
          `* Fix: ${oneLine(finding.fix)}`,
          phase
            ? ""
            : "* Repair linkage: NOT PROVEN — no phase is accepted without a linked validated Finding.",
          "",
        ];
      }).join("\n").trim()
    : noFindingSourceText;

  const repairStatus = options.repairStatus ?? "PROPOSED";
  const repairStatusText =
    repairStatus === "BEHAVIORALLY_VALIDATED"
      ? isArabic
        ? "BEHAVIORALLY VALIDATED — تم تطبيق الملفات واجتازت فحوصات السلوك المسجلة."
        : "BEHAVIORALLY VALIDATED — files were applied and the registered behavior checks passed."
      : repairStatus === "APPLIED"
        ? isArabic
          ? "APPLIED — تمت كتابة الملفات، لكن التحقق السلوكي المسجل ما زال معلقًا."
          : "APPLIED — files were written, but registered behavioral validation is still pending."
        : isArabic
          ? "PROPOSED — لم تُطبّق الملفات وما زال التحقق السلوكي المسجل معلقًا."
          : "PROPOSED — files are not applied and registered behavioral validation is still pending.";
  const repairText = phases.length > 0
    ? phases.map((phase, index) => {
        const finding = findings.find((candidate) => candidate.id === phase.findingId);
        const files = finding?.files.map(safePath).filter(Boolean) ?? [];
        const profile = validationProfileForFiles(files);
        const executable = executableByFinding.get(phase.findingId);
        const fileText = files.length > 0
          ? ` — File(s): ${files.map((file) => `\`${file}\``).join(", ")}`
          : "";
        const profileText = profile ? ` — Validation profile: ${profile}` : "";
        const executionText = executable ? ` — ${repairStatusText}` : "";
        return [
          `Phase ${index + 1} (${phase.findingId}): ${phase.steps.map(oneLine).join(" ")}`,
          fileText,
          profileText,
          executionText,
        ].join("");
      }).join("\n")
    : options.cancelled
      ? [
          isArabic
            ? "Recovery needed — يلزم استئناف قراءة الأدلة وإعادة بناء التقرير قبل أي استنتاج نهائي."
            : "Recovery needed — resume evidence reads and rebuild the report before any final conclusion.",
          isArabic
            ? "Blocked by — إلغاء التحليل قبل اكتمال التوليف والتحقق."
            : "Blocked by — analysis cancellation before synthesis and validation completed.",
        ].join("\n")
      : findings.length > 0
      ? noRepairPhasesText
      : noExecutablePhasesText;

  const validationText = findings.length === 0
    ? [
        ...noFindingBehaviorChecks,
        ...envelope.validationChecklist.map((item) => `- ${oneLine(item)}`),
      ].join("\n")
    : envelope.validationChecklist.length > 0
      ? envelope.validationChecklist.map((item) => `- ${oneLine(item)}`).join("\n")
      : phases.length > 0
      ? isArabic
        ? "- FAIL — لم يتم توفير سيناريو تحقق صالح لمراحل الإصلاح المقترحة."
        : "- FAIL — no validated scenario was supplied for the proposed repair phases."
      : findings.length > 0
        ? noValidationScenarioText
        : blockedValidationText;
  const checklistViolations = validationChecklistViolations(
    envelope.validationChecklist,
    executablePlan,
  );
  const completeRepairPlan =
    findings.length > 0 &&
    executablePlan.length === findings.length &&
    findings.every((finding) =>
      executablePlan.some((phase) => phase.findingId === finding.id),
    ) &&
    checklistViolations.length === 0;
  const groundedNoFindingBasis =
    findings.length === 0 &&
    hasSourceGroundedNoFindingBasis(envelope.noFindingBasis, evidence)
      ? envelope.noFindingBasis
      : undefined;
  const noFindingBasisText = groundedNoFindingBasis
    ? ` Basis: ${oneLine(groundedNoFindingBasis)}`
    : "";
  const completedEmptyLabelSuffix =
    emptyClassification === "NO_VERIFIED_FINDING" ? " (NO FINDING)" : "";
  const incompleteReason = options.incompleteReason?.trim().slice(0, 240);
  const incompleteNextAction = options.incompleteNextAction?.trim().slice(0, 240);
  const incompleteReadStatusLines =
    emptyClassification === "ANALYSIS_INCOMPLETE" && reportEvidence.sourceCoverage?.roots
      ? reportEvidence.sourceCoverage.roots
          .slice(0, 12)
          .flatMap((root) => {
            const status = `${root.status} (${root.readFiles}/${root.discoveredFiles})`;
            const rootLine = isArabic
              ? `- حالة القراءة: \`${root.root}\` — ${status}`
              : `- Read status: \`${root.root}\` — ${status}`;
            const affectedFiles = [
              ...(root.unreadPaths ?? []).map((file) => ({ file, status: "UNREAD" })),
              ...(root.truncatedPaths ?? []).map((file) => ({ file, status: "TRUNCATED" })),
            ].slice(0, 24);
            return [
              rootLine,
              ...affectedFiles.map(({ file, status: fileStatus }) =>
                isArabic
                  ? `  - ملف متأثر: \`${safePath(file)}\` — ${fileStatus}`
                  : `  - Affected file: \`${safePath(file)}\` — ${fileStatus}`,
              ),
            ];
          })
      : [];
  const incompleteReasonText = incompleteReason
    ? isArabic
      ? ` السبب الآمن للتوقف: ${oneLine(incompleteReason)}.`
      : ` Safe terminal reason: ${oneLine(incompleteReason)}.`
    : "";
  const incompleteNextActionText = incompleteNextAction
    ? isArabic
      ? ` الإجراء الآمن التالي: ${oneLine(incompleteNextAction)}.`
      : ` Next safe action: ${oneLine(incompleteNextAction)}.`
    : "";

  return [
    "## 1) Executive Verdict",
    reportIsIncomplete
      ? findings.length > 0
        ? isArabic
          ? "ANALYSIS_INCOMPLETE — NOT PROVEN — لم يتم إغلاق بوابات الأدلة المطلوبة؛ يظل أي Finding محتفظ به غير مثبت."
          : "ANALYSIS_INCOMPLETE — NOT PROVEN — required evidence gates did not close; any retained Finding remains unproven."
        : isArabic
          ? `${emptyClassification} — لم يتم إثبات Finding موثوق من قراءات الشيفرة المصدرية المكتملة.`
          : `${emptyClassification} — no verified Finding was established from the completed source reads.`
      : findings.length > 0
      ? completeRepairPlan
        ? isArabic
          ? "FINDING PROVEN — اجتاز الـFinding وخطة الإصلاح المرتبطة وقائمة التحقق الخاصة بالسلوك البوابات الحتمية."
          : "FINDING PROVEN — the Finding, complete linked Repair Plan, and behavior-specific validation checklist passed the deterministic gates."
        : isArabic
          ? "NOT PROVEN — يفتقر الـFinding المرشح إلى خطة إصلاح مرتبطة وقائمة تحقق خاصة بالسلوك؛ لا يمكن تنفيذ إصلاح."
          : "NOT PROVEN — the candidate Finding lacks a complete linked Repair Plan and behavior-specific validation checklist; no repair is executable."
      : isArabic
        ? `${emptyClassification} — لم يتم إثبات Finding موثوق من قراءات الشيفرة المصدرية المكتملة.`
        : `${emptyClassification} — no verified Finding was established from the completed source reads.`,
    "",
    "## 2) Evidence Map",
    ...buildForensicEvidenceMap(reportEvidence, {
      findingAccepted: findings.length > 0 && !reportIsIncomplete,
      findingEvidence: reportIsIncomplete ? [] : findings.map((finding) => finding.evidence),
    }),
    ...incompleteReadStatusLines,
    "",
    "## 3) Findings",
    findingText,
    "",
    "## 4) Repair Plan",
    repairText,
    "",
    "## 5) Validation Checklist",
    validationText,
    "",
    "## 6) Final Judgment",
    reportIsIncomplete
      ? findings.length > 0
        ? [
            isArabic
              ? `${emptyClassification} — لم يتم إغلاق بوابات الأدلة المطلوبة؛ يظل أي Finding محتفظ به غير مثبت.${incompleteReasonText}${incompleteNextActionText}`
              : `${emptyClassification} — required evidence gates did not close; any retained Finding remains NOT PROVEN.${incompleteReasonText}${incompleteNextActionText}`,
            isArabic
              ? "هذا استنتاج محدود بالأدلة، وليس إثباتًا لصحة التنفيذ."
              : "This is an evidence-limited conclusion, not proof that the implementation is correct.",
            isArabic ? "لا توجد خطة إصلاح قابلة للتنفيذ." : "No Repair Plan is executable.",
          ].join(" ")
        : [
            isArabic
              ? `${emptyClassification} — لم يتم إثبات عيب موثوق من قراءات الشيفرة المصدرية المكتملة.${noFindingBasisText}${completedEmptyLabelSuffix}${analysisIncomplete ? ` الادعاء بالعيب NOT PROVEN لأن تغطية الأدلة غير مكتملة.${incompleteReasonText}${incompleteNextActionText}` : ""}`
              : `${emptyClassification} — no verified defect was established from the completed source reads.${noFindingBasisText}${completedEmptyLabelSuffix}${analysisIncomplete ? ` No executable excerpt was accepted to close a required claim. The defect claim remains NOT PROVEN because evidence coverage is incomplete.${incompleteReasonText}${incompleteNextActionText}` : ""}`,
            isArabic
              ? "هذا استنتاج محدود بالأدلة، وليس إثباتًا لصحة التنفيذ."
              : "This is an evidence-limited conclusion, not proof that the implementation is correct.",
            isArabic ? "لا توجد خطة إصلاح قابلة للتنفيذ." : "No Repair Plan is executable.",
          ].join(" ")
      : findings.length > 0
      ? completeRepairPlan
        ? isArabic
          ? `FINDING PROVEN — يحتوي التقرير على Finding مرتبط بالدليل وخطة إصلاح مكتملة. حالة الإصلاح: ${repairStatus}.`
          : `FINDING PROVEN — the report contains an evidence-linked Finding and a complete linked Repair Plan. Repair status: ${repairStatus}.`
        : isArabic
          ? "NOT PROVEN — يتطلب كل Finding مقبول خطة إصلاح مرتبطة بملفات محددة وتغيير قابل للتنفيذ وملف تحقق مسجل وقائمة تحقق خاصة بالسلوك. لا توجد خطة إصلاح قابلة للتنفيذ."
          : "NOT PROVEN — every accepted Finding requires a linked Repair Plan with concrete files, an actionable change, a registered validation profile, and a behavior-specific checklist. No Repair Plan is executable."
      : [
          isArabic
            ? `${emptyClassification} — لم يتم إثبات عيب موثوق من قراءات الشيفرة المصدرية المكتملة.${noFindingBasisText}${completedEmptyLabelSuffix}${analysisIncomplete ? ` الادعاء بالعيب NOT PROVEN لأن تغطية الأدلة غير مكتملة.${incompleteReasonText}${incompleteNextActionText}` : ""}`
            : `${emptyClassification} — no verified defect was established from the completed source reads.${noFindingBasisText}${completedEmptyLabelSuffix}${analysisIncomplete ? ` No executable excerpt was accepted to close a required claim. The defect claim remains NOT PROVEN because evidence coverage is incomplete.${incompleteReasonText}${incompleteNextActionText}` : ""}`,
          isArabic
            ? "هذا استنتاج محدود بالأدلة، وليس إثباتًا لصحة التنفيذ."
            : "This is an evidence-limited conclusion, not proof that the implementation is correct.",
          isArabic ? "لا توجد خطة إصلاح قابلة للتنفيذ." : "No Repair Plan is executable.",
        ].join(" "),
  ].join("\n");
}

/**
 * Structured Recovery is accepted only when the generated report passes both
 * the report contract and the direct source-evidence gate.
 */
export function validateStructuredForensicRecovery(
  envelope: ForensicRecoveryEnvelope,
  evidence: ForensicEvidence,
  options: {
    requireNoFindingBasis?: boolean;
    responseLanguage?: "ar" | "en";
    allowPartialScopeFinding?: boolean;
  } = {},
): {
  accepted: boolean;
  report: string;
  violations: string[];
  verdict: "FINDING_PROVEN" | "NO_FINDING" | "NOT_PROVEN";
} {
  const responseLanguage =
    options.responseLanguage ?? evidence.responseLanguage ?? "en";
  const verdict = normalizeVerdict(envelope);
  const report = buildStructuredForensicReport(envelope, evidence, {
    language: responseLanguage,
    allowPartialScopeFinding: options.allowPartialScopeFinding,
  });
  const languageViolations = recoveryNarrativeLanguageViolations(
    envelope,
    responseLanguage,
  );
  if (languageViolations.length > 0) {
    return {
      accepted: false,
      report,
      verdict: "NOT_PROVEN",
      violations: languageViolations,
    };
  }
  const executablePlan = buildExecutableRepairPlan(envelope, evidence);
  if (verdict === "NO_FINDING" && envelope.findings.length > 0) {
    return {
      accepted: false,
      report,
      verdict: "NOT_PROVEN",
      violations: ["NO_FINDING envelope cannot contain Findings or repair phases"],
    };
  }
  if (verdict === "FINDING_PROVEN" && envelope.findings.length === 0) {
    return {
      accepted: false,
      report,
      verdict: "NOT_PROVEN",
      violations: ["FINDING_PROVEN envelope requires at least one Finding"],
    };
  }
  if (verdict === "FINDING_PROVEN") {
    const partialScopeFinding =
      options.allowPartialScopeFinding === true &&
      evidence.sourceCoverage?.complete === false;
    if (partialScopeFinding) {
      const contract = applyForensicOutputContract(
        report,
        evidence,
        { responseLanguage: options.responseLanguage },
      );
      if (!contract.valid) {
        return {
          accepted: false,
          report,
          verdict: "NOT_PROVEN",
          violations: contract.violations,
        };
      }
      const evidenceGate = applyForensicEvidenceGate(
        contract.response,
        evidence,
        {
          allowPartialScopeFinding: true,
          responseLanguage: options.responseLanguage,
        },
      );
      return {
        accepted: evidenceGate.violations.length === 0,
        report: evidenceGate.response,
        verdict: evidenceGate.violations.length === 0 ? "FINDING_PROVEN" : "NOT_PROVEN",
        violations: evidenceGate.violations.flatMap((violation) => violation.reasons),
      };
    }

    // A fixture-local Finding is a valid evidence result even though it must
    // not receive an executable Repair Plan. Keep this exception narrow:
    // every cited Finding file must be a recognized test/fixture path, and the
    // normal report/evidence gates still have to accept the exact source proof.
    const fixtureLocalFinding =
      envelope.findings.length > 0 &&
      envelope.findings.every((finding) =>
        finding.files.length > 0 &&
        finding.files.every((file) => isForensicTestSourcePath(file)),
      );
    if (fixtureLocalFinding && envelope.repairPlan.length === 0) {
      if (envelope.validationChecklist.length === 0) {
        return {
          accepted: false,
          report,
          verdict: "NOT_PROVEN",
          violations: [
            "Fixture-local FINDING_PROVEN requires a validation checklist even though repair is blocked",
          ],
        };
      }
      const contract = applyForensicOutputContract(
        report,
        evidence,
        { responseLanguage: options.responseLanguage },
      );
      if (!contract.valid) {
        return {
          accepted: false,
          report,
          verdict: "NOT_PROVEN",
          violations: contract.violations.length > 0
            ? contract.violations
            : ["Structured Recovery report failed its contract"],
        };
      }
      const evidenceGate = applyForensicEvidenceGate(
        contract.response,
        evidence,
        { responseLanguage: options.responseLanguage },
      );
      return {
        accepted: evidenceGate.violations.length === 0,
        report: evidenceGate.response,
        verdict: evidenceGate.violations.length === 0 ? "FINDING_PROVEN" : "NOT_PROVEN",
        violations: evidenceGate.violations.flatMap((violation) => violation.reasons),
      };
    }

    const repairViolations = [...executablePlan.violations];
    if (envelope.repairPlan.length === 0) {
      repairViolations.push("FINDING_PROVEN requires at least one linked Repair Plan phase");
    }

    const plannedFindingIds = new Set(envelope.repairPlan.map((phase) => phase.findingId));
    for (const finding of envelope.findings) {
      if (!plannedFindingIds.has(finding.id)) {
        repairViolations.push(`Finding ${finding.id} has no linked Repair Plan phase`);
      }
    }

    repairViolations.push(
      ...validationChecklistViolations(
        envelope.validationChecklist,
        executablePlan.plans,
      ),
    );
    if (executablePlan.plans.length !== envelope.findings.length) {
      repairViolations.push(
        "Every accepted Finding must have exactly one executable linked Repair Plan phase",
      );
    }

    if (repairViolations.length > 0) {
      return {
        accepted: false,
        report,
        verdict: "NOT_PROVEN",
        violations: [...new Set(repairViolations)],
      };
    }
  }
  if (envelope.findings.length === 0) {
    if (
      options.requireNoFindingBasis &&
      !hasSourceGroundedNoFindingBasis(envelope.noFindingBasis, evidence)
    ) {
      return {
        accepted: false,
        report,
        verdict: "NOT_PROVEN",
        violations: [
          "NO_FINDING recovery requires a source-grounded noFindingBasis naming the inspected file and quoting an exact source fragment",
        ],
      };
    }
    return {
      accepted: false,
      report,
      verdict: "NO_FINDING",
      violations: ["Structured Recovery produced no directly proven Finding"],
    };
  }
  // The Evidence Map in this report is not provider-authored: it was generated
  // directly from the verifier's retained file bodies above. Passing the
  // report back through the provider-map repair path can mark that same
  // deterministic map as "rebuilt" and discard otherwise valid Findings/plan
  // phases. Validate the report shape without re-repairing its map, then use
  // the evidence gate for the only model-authored claims: Findings.
  const contract = applyForensicOutputContract(
    report,
    evidence,
    { responseLanguage: options.responseLanguage },
  );
  if (!contract.valid) {
    return {
      accepted: false,
      report,
      verdict: "NOT_PROVEN",
      violations: contract.violations.length > 0
        ? contract.violations
        : ["Structured Recovery report failed its contract"],
    };
  }

  const evidenceGate = applyForensicEvidenceGate(
    contract.response,
    evidence,
    { responseLanguage: options.responseLanguage },
  );
  return {
    accepted: evidenceGate.violations.length === 0,
    report: evidenceGate.response,
    verdict: evidenceGate.violations.length === 0 ? "FINDING_PROVEN" : "NOT_PROVEN",
    violations: evidenceGate.violations.flatMap((violation) => violation.reasons),
  };
}
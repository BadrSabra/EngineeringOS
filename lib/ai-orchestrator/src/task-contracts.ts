import { z } from "zod";
import {
  CrossFileSemanticTraceSchema,
  ProductionReachabilityTraceSchema,
  type CrossFileSemanticTrace,
  type ProductionReachabilityTrace,
} from "./semantic-trace.js";

/**
 * User-intent task types for the evidence-aware pipeline.
 *
 * These are deliberately separate from quality/task-profile.ts. The quality
 * profile controls model execution characteristics; this union controls what
 * the answer is allowed to claim and which output validator owns the result.
 */
export const ForensicTaskTypeSchema = z.enum([
  "BEHAVIOR_QUERY",
  "CODE_EXTRACTION",
  "FINDING_ANALYSIS",
  "FULL_FORENSIC_AUDIT",
  "WORKSPACE_REVIEW",
  "REPAIR_ANALYSIS",
]);

export type ForensicTaskType = z.infer<typeof ForensicTaskTypeSchema>;

export const AnalysisModeSchema = z.enum(["STANDARD", "FORENSIC"]);
export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;

export const OutputContractSchema = z.enum([
  "GENERIC_RESPONSE",
  "BEHAVIOR_ANSWER",
  "EXTRACTED_CODE",
  "FINDING_ANALYSIS",
  "FORENSIC_REPORT",
  "REPAIR_PLAN",
]);
export type OutputContract = z.infer<typeof OutputContractSchema>;

export const SourceSpanSchema = z.object({
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
}).strict();
export type SourceSpan = z.infer<typeof SourceSpanSchema>;

export const EvidenceReferenceSchema = z.object({
  source: z.string().min(1),
  excerpt: z.string().min(1).optional(),
  /**
   * Exact line range within `source` where the excerpt was found.
   * Required for BEHAVIOR_PROVEN evidence: a fragment without a verifiable
   * span cannot be traced back to a specific control-flow decision and must
   * be downgraded to READ_CONFIRMED regardless of flow-marker presence.
   */
  sourceSpan: SourceSpanSchema.optional(),
  supportsClaim: z.boolean(),
  relevance: z.number().min(0).max(1).default(0),
  directness: z.enum(["DIRECT", "INDIRECT"]).default("INDIRECT"),
  sourceType: z.enum(["IMPLEMENTATION", "TEST", "CONFIG", "UNKNOWN"]).default("UNKNOWN"),
  productionReachability: z.enum(["PROVEN", "NOT_PROVEN"]).default("NOT_PROVEN"),
  evidenceClass: z.enum(["READ_CONFIRMED", "BEHAVIOR_PROVEN", "FINDING_PROVEN"]).default("READ_CONFIRMED"),
}).strict();
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const BehaviorAnswerSchema = z.object({
  answer: z.string().min(1),
  evidence: z.array(EvidenceReferenceSchema),
  confidence: z.number().min(0).max(1).optional(),
  sourceScope: z.array(z.string().min(1)).default([]),
}).strict();
export type BehaviorAnswer = z.infer<typeof BehaviorAnswerSchema>;

export const QuestionCoverageSchema = z.object({
  requestedFields: z.array(z.string().min(1)),
  answeredFields: z.array(z.string().min(1)),
  missingFields: z.array(z.string().min(1)),
  complete: z.boolean(),
}).strict();
export type QuestionCoverage = z.infer<typeof QuestionCoverageSchema>;

export const SemanticBehaviorAnswerSchema = BehaviorAnswerSchema.extend({
  coverage: QuestionCoverageSchema,
  crossFileTrace: CrossFileSemanticTraceSchema.optional(),
  productionReachability: ProductionReachabilityTraceSchema.optional(),
}).strict();
export type SemanticBehaviorAnswer = z.infer<typeof SemanticBehaviorAnswerSchema>;

export const CodeExtractionSchema = z.object({
  extractedCode: z.string(),
  source: z.string().min(1).optional(),
}).strict();
export type CodeExtraction = z.infer<typeof CodeExtractionSchema>;

export const FindingAnalysisSchema = z.object({
  finding: z.string().min(1),
  evidence: z.array(EvidenceReferenceSchema),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "NOT_PROVEN"]),
  rootCause: z.string().min(1).optional(),
  impact: z.string().min(1).optional(),
  fix: z.string().min(1).optional(),
}).strict();
export type FindingAnalysis = z.infer<typeof FindingAnalysisSchema>;

export const ForensicReportSchema = z.object({
  report: z.string().min(1),
  evidence: z.array(EvidenceReferenceSchema),
}).strict();
export type ForensicReport = z.infer<typeof ForensicReportSchema>;

export const RepairAnalysisSchema = z.object({
  repairPlan: z.string().min(1),
  evidence: z.array(EvidenceReferenceSchema),
  readiness: z.enum(["READY", "BLOCKED", "NOT_PROVEN"]),
}).strict();
export type RepairAnalysis = z.infer<typeof RepairAnalysisSchema>;

export type TaskValidator =
  | "AnswerValidator"
  | "CodeExtractionValidator"
  | "FindingValidator"
  | "ForensicReportValidator"
  | "RepairValidator";

export type TaskRoute = {
  taskType: ForensicTaskType;
  analysisMode: AnalysisMode;
  outputContract: OutputContract;
  validator: TaskValidator;
  requiresEvidence: boolean;
};

export type TaskExecutionBudget = {
  maxIterations: number;
  maxToolCalls: number;
};

/**
 * Narrow-query caps are intentionally keyed by the evidence contract rather
 * than the provider/model profile. A small extraction or behavior question
 * must not inherit the broad forensic-scan budget.
 */
export const FORENSIC_TASK_BUDGETS: Record<ForensicTaskType, TaskExecutionBudget> = {
  CODE_EXTRACTION: { maxIterations: 16, maxToolCalls: 12 },
  BEHAVIOR_QUERY: { maxIterations: 120, maxToolCalls: 260 },
  FINDING_ANALYSIS: { maxIterations: 128, maxToolCalls: 320 },
  FULL_FORENSIC_AUDIT: { maxIterations: 120, maxToolCalls: 480 },
  WORKSPACE_REVIEW: { maxIterations: 144, maxToolCalls: 480 },
  REPAIR_ANALYSIS: { maxIterations: 128, maxToolCalls: 320 },
};

export function capBudgetForTask(
  taskType: ForensicTaskType,
  budget: TaskExecutionBudget,
): TaskExecutionBudget {
  const cap = FORENSIC_TASK_BUDGETS[taskType];
  return {
    maxIterations: Math.min(budget.maxIterations, cap.maxIterations),
    maxToolCalls: Math.min(budget.maxToolCalls, cap.maxToolCalls),
  };
}

export type TaskValidationResult = {
  valid: boolean;
  violations: string[];
};

/**
 * Validate the natural-language portion of a model response against the
 * language selected from the user's raw message. Technical identifiers,
 * source code, numbers, and mixed Arabic/English terminology are allowed;
 * a response containing alphabetic prose only in the opposite script is not.
 */
export function validateResponseLanguage(
  response: string,
  responseLanguage: "ar" | "en",
): TaskValidationResult {
  const trimmed = response.trim();
  if (!trimmed) return { valid: false, violations: ["response is empty"] };

  // Source code and canonical identifiers are language-neutral. Evaluate the
  // prose outside fenced/inline code so an Arabic request for a TypeScript
  // snippet is not rejected merely because the snippet uses Latin keywords.
  const prose = trimmed
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .trim();
  const hasArabic = /[\u0600-\u06FF]/.test(prose);
  const hasLatin = /[A-Za-z]/.test(prose);
  const violations: string[] = [];

  if (responseLanguage === "ar" && hasLatin && !hasArabic) {
    violations.push("response used English prose for an Arabic request");
  } else if (responseLanguage === "en" && hasArabic && !hasLatin) {
    violations.push("response used Arabic prose for an English request");
  }

  return { valid: violations.length === 0, violations };
}

export function buildResponseLanguageFallback(responseLanguage: "ar" | "en"): string {
  return responseLanguage === "ar"
    ? "تعذر عرض الاستجابة لأنها لم تلتزم بلغة الطلب. يرجى إعادة صياغة السؤال أو المحاولة مرة أخرى."
    : "The response did not match the requested language. Please rephrase your question or try again.";
}

export type BehaviorEvidenceValidation = TaskValidationResult & {
  evidence: EvidenceReference[];
};

const TASK_ROUTES: Record<ForensicTaskType, Omit<TaskRoute, "taskType">> = {
  BEHAVIOR_QUERY: {
    analysisMode: "STANDARD",
    outputContract: "BEHAVIOR_ANSWER",
    validator: "AnswerValidator",
    requiresEvidence: true,
  },
  CODE_EXTRACTION: {
    analysisMode: "STANDARD",
    outputContract: "EXTRACTED_CODE",
    validator: "CodeExtractionValidator",
    requiresEvidence: true,
  },
  FINDING_ANALYSIS: {
    analysisMode: "FORENSIC",
    outputContract: "FINDING_ANALYSIS",
    validator: "FindingValidator",
    requiresEvidence: true,
  },
  FULL_FORENSIC_AUDIT: {
    analysisMode: "FORENSIC",
    outputContract: "FORENSIC_REPORT",
    validator: "ForensicReportValidator",
    requiresEvidence: true,
  },
  WORKSPACE_REVIEW: {
    analysisMode: "FORENSIC",
    outputContract: "FORENSIC_REPORT",
    validator: "ForensicReportValidator",
    requiresEvidence: true,
  },
  REPAIR_ANALYSIS: {
    analysisMode: "FORENSIC",
    outputContract: "REPAIR_PLAN",
    validator: "RepairValidator",
    requiresEvidence: true,
  },
};

/**
 * Resolve the executor/validator contract without selecting a provider or
 * changing model routing. Callers can use this result to choose the
 * task-specific execution path while preserving the existing transport plan.
 */
export function routeTask(taskType: ForensicTaskType): TaskRoute {
  return { taskType, ...TASK_ROUTES[taskType] };
}

// ── First-Evidence Gate (FEG) ────────────────────────────────────────────────
// The task contract also decides HOW investigation begins. For an
// evidence-requiring task that names an explicit source file, the allowed
// first action is a DIRECT_READ of that primary evidence target — placed in the
// runtime before any cross-file trace, graph-guided plan, dependency discovery,
// or broad prefetch. Graph/prefetch output is treated as candidate discovery
// only and can never pre-empt this first source read.
export const AllowedFirstActionSchema = z.enum(["DIRECT_READ", "EXPLORE"]);
export type AllowedFirstAction = z.infer<typeof AllowedFirstActionSchema>;

export const TraversalPolicySchema = z.enum(["PRIMARY_FIRST", "BROAD"]);
export type TraversalPolicy = z.infer<typeof TraversalPolicySchema>;

export type PrimaryEvidenceTarget =
  | { kind: "FILE"; path: string }
  | null;

export type FirstEvidenceGate = {
  allowedFirstAction: AllowedFirstAction;
  primaryEvidenceTarget: PrimaryEvidenceTarget;
  traversalPolicy: TraversalPolicy;
};

export const DEFAULT_FIRST_EVIDENCE_GATE: FirstEvidenceGate = {
  allowedFirstAction: "EXPLORE",
  primaryEvidenceTarget: null,
  traversalPolicy: "BROAD",
};

/**
 * Matches a project-relative source path that starts with a recognized path
 * prefix, mirroring the classifier's explicit-file detection. Deliberately
 * restricted to real source directories so an ordered-root audit of a broad
 * tree does not collapse into a single-file DIRECT_READ.
 */
const EXPLICIT_FIRST_EVIDENCE_PATH_RE =
  /(?:^|(?<![\w/@.-]))((?:\.{0,2}\/|lib\/|src\/|artifacts\/|packages\/|__tests__\/|__fixtures__\/|__mocks__\/|test\/|tests\/|spec\/|specs\/|fixtures\/|mocks\/)[\w.@/-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh))\b/;

/**
 * All distinct explicit file targets named in the message, canonicalized to
 * project-relative form (leading `./` stripped, separators normalized), with
 * duplicates removed.
 */
export function distinctExplicitSourcePaths(message: string): string[] {
  const found = new Set<string>();
  const gRe = new RegExp(EXPLICIT_FIRST_EVIDENCE_PATH_RE.source, "g");
  for (const m of message.matchAll(gRe)) {
    const raw = m[1]?.trim().replace(/^[^./\w_]+/, "");
    if (!raw) continue;
    found.add(raw.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, ""));
  }
  return [...found];
}

/** Canonical first explicit file target, or null when fewer/more than one is named. */
export function firstExplicitSourcePath(message: string): string | null {
  const distinct = distinctExplicitSourcePaths(message);
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * Derive the First-Evidence Gate for a classified task and its message.
 * Exactly ONE distinct explicit source file in an evidence-requiring task gets
 * DIRECT_READ with PRIMARY_FIRST traversal; zero or multiple names — or a
 * non-evidence task — explores freely.
 */
export function resolveFirstEvidenceGate(
  taskType: ForensicTaskType,
  message: string,
  opts: { implementationTaskMode?: boolean } = {},
): FirstEvidenceGate {
  if (opts.implementationTaskMode) return DEFAULT_FIRST_EVIDENCE_GATE;
  if (!routeTask(taskType).requiresEvidence) return DEFAULT_FIRST_EVIDENCE_GATE;
  const path = firstExplicitSourcePath(message);
  if (!path) return DEFAULT_FIRST_EVIDENCE_GATE;
  return {
    allowedFirstAction: "DIRECT_READ",
    primaryEvidenceTarget: { kind: "FILE", path },
    traversalPolicy: "PRIMARY_FIRST",
  };
}

const FORENSIC_REPORT_HEADERS = [
  "## 1) Executive Verdict",
  "## 2) Evidence Map",
  "## 3) Findings",
  "## 4) Repair Plan",
  "## 5) Validation Checklist",
  "## 6) Final Judgment",
];

/**
 * Validate the response shape owned by the classified task. This is a
 * deliberately bounded contract check; source-grounded evidence validation
 * remains in forensic-output-guard.ts and is only used by FULL_FORENSIC_AUDIT.
 */
export function validateTaskResponse(
  taskType: ForensicTaskType,
  response: string,
  options: { responseLanguage?: "ar" | "en" } = {},
): TaskValidationResult {
  const trimmed = response.trim();
  if (!trimmed) return { valid: false, violations: ["response is empty"] };

  const hasForensicReportShape = FORENSIC_REPORT_HEADERS.every((header) =>
    trimmed.includes(header),
  );
  const violations: string[] = [];
  if (options.responseLanguage) {
    violations.push(...validateResponseLanguage(trimmed, options.responseLanguage).violations);
  }

  switch (taskType) {
    case "CODE_EXTRACTION":
      if (
        /##\s*(?:1\)|2\)|3\)|4\)|5\)|6\))\s*(?:Executive Verdict|Evidence Map|Findings|Repair Plan|Validation Checklist|Final Judgment)/i.test(
          trimmed,
        )
      ) {
        violations.push(
          "CODE_EXTRACTION response contains a forensic report section",
        );
      }
      break;
    case "BEHAVIOR_QUERY":
      if (hasForensicReportShape) {
        violations.push(
          "BEHAVIOR_QUERY response used the FULL_FORENSIC_AUDIT contract",
        );
      }
      if (
        options.responseLanguage === "ar" &&
        !/[\u0600-\u06FF]/.test(trimmed)
      ) {
        violations.push(
          "BEHAVIOR_QUERY response did not use the Arabic language requested by the user",
        );
      }
      break;
    case "FINDING_ANALYSIS":
      if (hasForensicReportShape) {
        violations.push(
          "FINDING_ANALYSIS response used the FULL_FORENSIC_AUDIT contract",
        );
      } else if (!/(?:finding|evidence|severity|not\s+proven)/i.test(trimmed)) {
        violations.push(
          "FINDING_ANALYSIS response does not contain a finding/evidence assessment",
        );
      }
      break;
    case "REPAIR_ANALYSIS":
      if (hasForensicReportShape) {
        violations.push(
          "REPAIR_ANALYSIS response used the FULL_FORENSIC_AUDIT contract",
        );
      } else if (!/(?:repair|fix|phase|blocked|not\s+proven)/i.test(trimmed)) {
        violations.push(
          "REPAIR_ANALYSIS response does not contain a repair readiness or plan",
        );
      }
      break;
    case "FULL_FORENSIC_AUDIT":
      if (!hasForensicReportShape) {
        violations.push(
          "FULL_FORENSIC_AUDIT response is missing one or more report sections",
        );
      }
      break;
    case "WORKSPACE_REVIEW":
      if (!hasForensicReportShape) {
        violations.push(
          "WORKSPACE_REVIEW response is missing one or more evidence-backed report sections",
        );
      }
      break;
    default: {
      // Exhaustiveness guard: every ForensicTaskType must have its own case
      // above. If a type is added to ForensicTaskTypeSchema without a matching
      // branch, `taskType` narrows to that new type here instead of `never`, so
      // this assignment fails to compile — a loud signal that a forgotten task
      // type would otherwise take no validation path and treat every response
      // as valid (the same silent-drop class Task #27 closed in buildTaskResult).
      const exhaustive: never = taskType;
      return exhaustive;
    }
  }

  return { valid: violations.length === 0, violations };
}

export function buildTaskValidationFallback(
  taskType: ForensicTaskType,
  isArabic = false,
): string {
  if (isArabic) {
    if (taskType === "BEHAVIOR_QUERY") {
      return "تعذر عرض الاستجابة لأنها لم تكن إجابة سلوكية عربية مباشرة وفق عقد BEHAVIOR_QUERY. لم يتم عرض إجابة بلغة أو صيغة غير مطابقة.";
    }
    return `لم تلتزم الاستجابة بعقد المهمة ${taskType}. تم حجبها بدل عرض نتيجة بصيغة غير صحيحة.`;
  }
  return `The response did not satisfy the ${taskType} task contract, so it was withheld instead of returning a mismatched result.`;
}

const CODE_EXTRACTION_PATTERNS = [
  /\b(?:extract|output|show|return|give)\b[\s\S]{0,80}\b(?:code|branch|branches|snippet|function|implementation)\b/i,
  /\b(?:code|branch|branches|snippet)\b[\s\S]{0,80}\b(?:only|just)\b/i,
  /(?:أخرج|اعرض|أظهر|أرني)\s+(?:فقط\s+)?(?:الكود|الفرع|الفروع|المقطع|الدالة)/i,
];

const FULL_AUDIT_PATTERNS = [
  /\b(?:full|complete|end[-\s]?to[-\s]end)\s+forensic\s+audit\b/i,
  /\bforensic\s+audit\b/i,
  /\b(?:six|6)\s+(?:markdown\s+)?sections?\b/i,
  /##\s*1\)\s*Executive Verdict[\s\S]*##\s*6\)\s*Final Judgment/i,
  /\b(?:audit|تدقيق)\b[\s\S]{0,80}\b(?:evidence\s+map|findings?\s+matrix|repair\s+plan|تقرير|نتائج)\b/i,
  /تحليل\s+جنائي\s+(?:كامل|شامل)|تدقيق\s+جنائي/i,
  // Broad gap/coverage requests need repository investigation, not a
  // behavior-answer contract that waits for a narrowly phrased question.
  /\b(?:gap|gaps|gap\s+analysis|coverage\s+gaps|missing\s+(?:capabilities|pieces))\b/i,
  /(?:ابحث|اكتشف|حدد|حلل|استكشف)\s+(?:عن\s+)?(?:الفجوات|فجوات|نقاط\s+الضعف)(?:\s|$)/u,
  /(?:الفجوات|فجوات)\s+(?:في|بطبقة|بمنظومة|داخل)(?:\s|$)/u,
  /(?:اكتشف|ابحث|حدد|حلل|استكشف|افحص|راجع)\s+(?:عن\s+)?(?:المشاكل|المشكلة|المشكلات|الأخطاء|العيوب)(?:\s|$)/u,
  /\b(?:regenerate|rerun|retry|try\s+again)\b[\s\S]{0,60}\b(?:report|audit|repair\s+plan|plan)\b/i,
  /^(?:retry|try\s+again)$/i,
  /(?:أعد|اعد)\s+(?:المحاولة|توليد|إنتاج|انشاء|إنشاء|صياغة|بناء|إعادة\s+توليد)[\s\S]{0,60}(?:التقرير|الخطة|التدقيق|المراجعة|التحقيق)/u,
  /^(?:أعد|اعد)\s+المحاولة$/u,
  /\b(?:continue|resume)\s+(?:the\s+)?(?:investigation|analysis|audit)\b/i,
  /(?:أكمل|استكمل|تابع)\s+(?:التحقيق|التحليل|التدقيق)/u,
  /\b(?:why|how)\b[\s\S]{0,160}\b(?:model|agent|assistant)\b[\s\S]{0,160}\b(?:follow|obey|comply|ignore|refuse|fail)\w*[\s\S]{0,80}\b(?:instruction|directive|prompt)\w*\b/i,
  /\b(?:model|agent|assistant)\b[\s\S]{0,120}\b(?:ignore|refuse|fail)\w*[\s\S]{0,80}\b(?:follow|obey|comply|instruction|directive|prompt)\w*\b/i,
  /(?:لماذا|كيف)\s+(?:لا|لم)\s+(?:يلتزم|يستجيب|ينفذ|يتبع|يطيع)[\s\S]{0,120}(?:التعليمات|التوجيهات|الأوامر|اوامر|طلبات\s+المستخدم|أوامر\s+المستخدم)/u,
];

const WORKSPACE_REVIEW_PATTERNS = [
  /\b(?:review|audit|assess|evaluate|inspect|analy[sz]e)\s+(?:(?:the|my|this)\s+)?(?:whole\s+)?(?:workspace|repository|repo|codebase|project)\b/i,
  /\b(?:review|audit|assess|evaluate|inspect|analy[sz]e)\s+(?:the\s+)?(?:entire|whole|full|all)\s+(?:workspace|repository|repo|codebase|project|code)\b/i,
  /\b(?:review|audit|assess|evaluate|inspect|analy[sz]e)\s+all\s+code\b/i,
  /(?:راجع|قيّم|قيم|افحص|حلل|حلّل|استكشف)\s+(?:مساحة\s+العمل|المشروع|المستودع|قاعدة\s+الكود|الكود\s+بالكامل)/u,
  /(?:راجع|قيّم|قيم|افحص|حلل|حلّل|استكشف)\s+مشروعي(?:\s|$)/u,
  /(?:راجع|قيّم|قيم|افحص|حلل|حلّل|استكشف)\s+(?:ملفات|الملفات)\s+(?:الإنتاجية|الأساسية)/u,
  /(?:راجع|قيّم|قيم|افحص|حلل|حلّل|استكشف)\s+(?:كل|كامل|كاملًا)\s+(?:الكود|المشروع|المستودع|مساحة\s+العمل)/u,
];

const REPAIR_ANALYSIS_PATTERNS = [
  /\b(?:repair|fix)\s+plan\b/i,
  /\b(?:implementation|execution|action)\s+plan\b/i,
  /\b(?:create|write|draft|make|provide|outline|propose)\b[\s\S]{0,60}\b(?:implementation|execution|repair|fix|action)\s+plan\b/i,
  /\b(?:how|what)\b[\s\S]{0,60}\b(?:fix|repair|patch)\b/i,
  /\b(?:propose|design|analy[sz]e)\b[\s\S]{0,60}\b(?:repair|fix)\b/i,
  /(?:خطة|تحليل)\s+(?:الإصلاح|الاصلاح|إصلاح|اصلاح|تنفيذية|للتنفيذ|عمل)|كيف\s+(?:أصلح|اصلح|نصلح|نصلح)/i,
  /(?:ضع|أنشئ|اكتب|اقترح|قدّم|قدم)\s+(?:خطة\s+)?(?:تنفيذية|للإصلاح|لإصلاح|للاصلاح|إصلاح|اصلاح|للتنفيذ|عمل)/i,
  /(?:إصلاح|اصلاح|أصلح|اصلح)\s+(?:الفجوات|فجوات|الفجوة|المشكلات|المشاكل|العيوب|الخلل|الحالية|الموجودة)/i,
];

const FINDING_ANALYSIS_PATTERNS = [
  /\b(?:find|identify|detect|prove|confirm)\b[\s\S]{0,80}\b(?:bug|defect|issue|flaw|vulnerability|finding)\b/i,
  /\b(?:bug|defect|issue|flaw|vulnerability|finding)\b/i,
  /(?:ابحث|اكتشف|حدد|أثبت|تحقق)\s+(?:عن\s+)?(?:عيب|خلل|مشكلة|ثغرة|Finding)/i,
];

/**
 * Negation window matched immediately before a forensic keyword. When a
 * REPAIR / FINDING keyword only appears inside a negation ("do not include a
 * repair plan", "do NOT invent a defect finding", "no repair plan warranted"),
 * the user is denying that intent, not requesting it. Routing those negated
 * mentions into REPAIR_ANALYSIS / FINDING_ANALYSIS forces the six-section
 * forensic-report contract and the R-PROOF positive-proof gate, which a
 * legitimate negative behavioral verdict (e.g. a capability probe answering
 * "no eval()/Function() call exists") can never satisfy — derailing single-file
 * audits that were otherwise correctly classified. Same root-cause family as
 * PROSE_PSEUDO_PATH_DENYLIST in the profile classifier.
 */
const NEGATION_WINDOW_RE =
  /\b(?:not|no|never|without|unless|except|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|can'?t|cannot|shouldn'?t|mustn'?t|won'?t|needn'?t|do\s+not|does\s+not|did\s+not|should\s+not|must\s+not|will\s+not|may\s+not|need\s+not|no\s+(?:such|verified|real|actual))\b/i;

// End-of-sentence boundary: terminal punctuation only. A negation only
// suppresses a keyword's intent when it appears in the SAME sentence before the
// keyword ("do NOT invent a defect finding, and do NOT treat "no such call" as a
// failure that needs a repair plan"), not when it sits in an earlier, unrelated
// sentence ("Don't broaden the investigation. Create a repair plan for the
// proven defect."). Line breaks do NOT count as sentence boundaries: wrapped
// prose (as in a long capability probe) splits a single sentence across lines,
// and treating `\n` as a boundary would hide an in-sentence negation from the
// keyword that follows it.
const SENTENCE_BREAK_RE = /([.!?;:])/g;

/**
 * True when at least one occurrence of any of the given patterns appears NOT
 * inside a negation within its own sentence. Used for REPAIR / FINDING intent so
 * that a probe that only ever *denies* a repair-plan or defect-finding is not
 * misrouted into the forensic report + R-PROOF contract.
 */
function matchesAnyPositive(patterns: RegExp[], message: string): boolean {
  for (const pattern of patterns) {
    const gFlag = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    const g = new RegExp(pattern.source, gFlag);
    let m: RegExpExecArray | null;
    while ((m = g.exec(message)) !== null) {
      // Backscan to the previous end-of-sentence boundary so we only consider
      // negation within the keyword's own sentence.
      let sentenceStart = 0;
      const beforeAll = message.slice(0, m.index);
      const matchesBefore = [...beforeAll.matchAll(SENTENCE_BREAK_RE)];
      if (matchesBefore.length > 0) {
        sentenceStart = matchesBefore[matchesBefore.length - 1].index + 1;
      }
      const sentencePrefix = message.slice(sentenceStart, m.index);
      if (!NEGATION_WINDOW_RE.test(sentencePrefix)) return true;
      if (m.index === g.lastIndex) g.lastIndex += 1;
    }
  }
  return false;
}

const BEHAVIOR_QUERY_PATTERNS = [
  /^(?:what|why|how|does|is|are|will|can|when|where)\b/i,
  /\b(?:what happens|how does|does .* always|behavior|behaviour)\b/i,
  /^(?:هل|ماذا|كيف|لماذا|متى|أين)\b/u,
  /(?:ما\s+الذي\s+يحدث|كيف\s+يعمل|هل\s+يؤدي|السلوك)/u,
];

function normalizeEvidencePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

const EVIDENCE_STOP_WORDS = new Set([
  "what", "why", "how", "does", "this", "that", "when", "where", "the",
  "code", "codebase", "function", "happen", "happens", "behavior", "behaviour", "and",
  "ما", "ماذا", "كيف", "لماذا", "متى", "أين", "يحدث", "يعمل", "السلوك",
]);

const QUESTION_NON_FIELDS = new Set([
  "return", "returns", "result", "results", "reach", "reached", "always",
  "true", "false", "does", "happen", "happens", "work", "works",
]);

const FLOW_MARKERS =
  /\b(?:if|else|return|throw|catch|finally|for|while|break|continue|switch|await)\b|=>/i;

/**
 * Strip string literals and block/line comments from a code excerpt using a
 * single-pass lexical scanner so that flow-marker detection operates on
 * executable tokens only.
 *
 * Chained regex replacement is incorrect here: running `//` comment stripping
 * before string literal stripping causes `"http://host"` to be treated as a
 * line comment at `//host`, removing the executable code that follows.  A
 * lexical scanner handles string delimiters before comment markers in a single
 * pass, preserving string content as an empty placeholder while recognising
 * `//` and `/*` only when they appear outside any string context.
 *
 * Without stripping, a constant like `const RETURN_CODE = "return partial"`
 * would pass the FLOW_MARKERS test because "return" appears inside a string
 * literal.  Stripping replaces the string/comment body with an empty pair so
 * the surrounding syntax is preserved while the non-executable content is
 * removed.
 */
function stripNonExecutableTokens(code: string): string {
  let result = "";
  let i = 0;
  const len = code.length;

  while (i < len) {
    const ch = code[i] as string;

    // Template literal — consume until the closing backtick.
    if (ch === "`") {
      i += 1;
      while (i < len && code[i] !== "`") {
        if (code[i] === "\\") i += 1; // skip escape sequence
        i += 1;
      }
      result += '""';
      i += 1; // consume closing backtick
      continue;
    }

    // Double-quoted string — consume until the closing quote.
    if (ch === '"') {
      i += 1;
      while (i < len && code[i] !== '"') {
        if (code[i] === "\\") i += 1;
        i += 1;
      }
      result += '""';
      i += 1;
      continue;
    }

    // Single-quoted string — consume until the closing quote.
    if (ch === "'") {
      i += 1;
      while (i < len && code[i] !== "'") {
        if (code[i] === "\\") i += 1;
        i += 1;
      }
      result += "''";
      i += 1;
      continue;
    }

    // Block comment — must be checked before the / output below.
    if (ch === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < len && !(code[i] === "*" && code[i + 1] === "/")) {
        i += 1;
      }
      result += " ";
      i += 2; // consume closing */
      continue;
    }

    // Line comment.
    if (ch === "/" && code[i + 1] === "/") {
      i += 2;
      while (i < len && code[i] !== "\n") {
        i += 1;
      }
      result += " ";
      continue;
    }

    result += ch;
    i += 1;
  }

  return result;
}

/**
 * Returns true when the excerpt contains at least one flow-marker token in an
 * *executable* position — not inside a string literal, template literal, or
 * comment.  This is the structural gate used by both the directness scorer and
 * the behavioral-proof predicate.
 */
function hasExecutableFlowMarker(excerpt: string): boolean {
  return FLOW_MARKERS.test(stripNonExecutableTokens(excerpt));
}

/**
 * Returns true when the excerpt is solely a constant, variable, or property
 * declaration with no branching body.
 *
 * A pure declaration records a *configured value*, not a *behavioral decision*:
 * `DEFAULT_MAX_ITERATIONS = 30` cannot prove that a "partial" branch behaves
 * differently from an "exhausted" branch.  This guard prevents the pattern from
 * passing the evidence gate even when the constant value happens to contain an
 * identifier whose name lexically resembles a flow keyword.
 */
const PURE_DECLARATION_RE =
  /^(?:export\s+)?(?:const|let|var|readonly)\s+[\w$]+(?:\s*:\s*[\w<>[\]|& .,"'?[\]]+)?\s*=\s*[^;{([]*;?\s*$/i;

function isPureDeclaration(excerpt: string): boolean {
  return PURE_DECLARATION_RE.test(excerpt.trim());
}

function evidenceTokens(value: string): string[] {
  return [...value.matchAll(/[A-Za-z_$][\w$]*|[\u0600-\u06FF]{3,}/g)]
    .map((match) => match[0]?.toLowerCase() ?? "")
    .filter((token) => token.length >= 3 && !EVIDENCE_STOP_WORDS.has(token));
}

export function extractQuestionCoverage(
  question: string,
  answer: string,
  evidence: readonly EvidenceReference[] = [],
): QuestionCoverage {
  const requestedFields = [...new Set(evidenceTokens(question))]
    .filter((token) => !QUESTION_NON_FIELDS.has(token));
  const answerText = [
    answer,
    ...evidence.map((item) => item.excerpt ?? ""),
  ].join("\n").toLowerCase();
  const effectiveRequestedFields = requestedFields.length > 0
    ? requestedFields
    : ["behavior"];
  const answeredFields = effectiveRequestedFields.filter((field) =>
    answerText.includes(field),
  );
  const missingFields = effectiveRequestedFields.filter(
    (field) => !answeredFields.includes(field),
  );
  return {
    requestedFields: effectiveRequestedFields,
    answeredFields,
    missingFields,
    complete: missingFields.length === 0,
  };
}

export function buildSemanticBehaviorAnswer(
  question: string,
  answer: string,
  evidence: readonly EvidenceReference[],
  sourceScope: readonly string[],
  traces: {
    crossFileTrace?: CrossFileSemanticTrace;
    productionReachability?: ProductionReachabilityTrace;
  } = {},
): SemanticBehaviorAnswer {
  const acceptedEvidence = evidence.filter((item) => item.supportsClaim);
  const coverage = extractQuestionCoverage(question, answer, acceptedEvidence);
  const evidenceConfidence = acceptedEvidence.length > 0
    ? acceptedEvidence.reduce((sum, item) => sum + item.relevance, 0) /
      acceptedEvidence.length
    : 0;
  const confidence = Math.round(
    Math.min(1, evidenceConfidence * (coverage.complete ? 1 : 0.75)) * 100,
  ) / 100;
  return {
    answer,
    evidence: acceptedEvidence,
    confidence,
    sourceScope: [...new Set(sourceScope)],
    coverage,
    ...(traces.crossFileTrace ? { crossFileTrace: traces.crossFileTrace } : {}),
    ...(traces.productionReachability
      ? { productionReachability: traces.productionReachability }
      : {}),
  };
}

/** 1-based line span of every verbatim occurrence of `excerpt` within `content`. */
function allOccurrenceSpans(content: string, excerpt: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  let fromIndex = 0;
  while (true) {
    const index = content.indexOf(excerpt, fromIndex);
    if (index === -1) break;
    const before = content.slice(0, index);
    const startLine = (before.match(/\n/g)?.length ?? 0) + 1;
    const excerptLines = excerpt.match(/\n/g)?.length ?? 0;
    spans.push({ startLine, endLine: startLine + excerptLines });
    fromIndex = index + Math.max(excerpt.length, 1);
  }
  return spans;
}

/**
 * Return the source text around an occurrence (the occurrence lines plus up to
 * `padding` adjacent lines on either side) so we can judge which occurrence the
 * model actually cited by the code it described nearby.
 */
function occurrenceContextWindow(content: string, span: SourceSpan, padding = 1): string {
  const lines = content.split("\n");
  const from = Math.max(0, span.startLine - 1 - padding);
  const to = Math.min(lines.length, span.endLine + padding);
  return lines.slice(from, to).join("\n");
}

/**
 * Locate `excerpt` inside `content` and return the 1-based line range.
 * Returns `undefined` when the excerpt cannot be found verbatim — this is
 * intentional: a fragment that doesn't appear verbatim in the completed read
 * is either fabricated or paraphrased and must not prove a behavior claim.
 *
 * When the fragment appears more than once in the same file (e.g. the same
 * short `return` in an `if` and an `else` branch), a blind `indexOf` would
 * always report the *first* occurrence — a span that looks exact but points at
 * the wrong branch. Instead we prefer the occurrence whose surrounding lines
 * best match the citation context (question tokens plus response prose near
 * the quote).
 *
 * If the fragment appears in two or more *structurally identical* contexts (no
 * distinguishing surrounding token exists), selection cannot tell them apart:
 * returning the first match would present a confidently wrong span as exact.
 * In that case the result is marked `ambiguous`, and callers are expected to
 * downgrade such evidence (an unverifiable span cannot be BEHAVIOR_PROVEN)
 * rather than trust a first-match heuristic.
 */
function computeSourceSpan(
  content: string,
  excerpt: string,
  contextTokens: readonly string[] = [],
): { span: SourceSpan | undefined; ambiguous: boolean } {
  const spans = allOccurrenceSpans(content, excerpt);
  if (spans.length === 0) return { span: undefined, ambiguous: false };
  if (spans.length === 1 || contextTokens.length === 0) {
    // A single occurrence is unambiguous. With no context tokens we cannot
    // tell duplicated occurrences apart, so treat any multi-occurrence case as
    // ambiguous.
    return { span: spans[0], ambiguous: spans.length > 1 };
  }

  const scored = spans.map((span) => {
    const window = occurrenceContextWindow(content, span).toLowerCase();
    const score = contextTokens.reduce(
      (acc, token) => acc + (window.includes(token.toLowerCase()) ? 1 : 0),
      0,
    );
    return { span, score };
  });

  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const tied = scored.filter((entry) => entry.score === bestScore);
  return {
    span: tied[0]?.span ?? spans[0],
    // A tie at the best score means no context signal favours one occurrence.
    ambiguous: tied.length > 1,
  };
}

/**
 * Derive the citation context used to disambiguate multi-occurrence spans: the
 * question's significant tokens plus the response prose immediately surrounding
 * the quoted excerpt. The branch the model describes in prose usually contains
 * a token (variable, function name, message) that only the correct occurrence's
 * neighbouring lines share.
 */
function citationContextTokens(question: string, response: string, excerpt: string): string[] {
  const tokens = new Set(evidenceTokens(question));
  const index = response.indexOf(excerpt);
  if (index !== -1) {
    const around = response.slice(Math.max(0, index - 60), index + excerpt.length + 60);
    for (const token of evidenceTokens(around)) tokens.add(token);
  }
  const stop = new Set([
    "evidence", "source", "file", "excerpt", "quoted", "line", "lines", "returns",
    "result", "code", "function", "statement", "when", "the", "branch", "partial",
    "دليل", "المصدر", "يعيد", "النتيجة",
  ]);
  return [...tokens].filter((token) => !stop.has(token));
}

function sourceTypeForEvidence(
  source: string,
): "IMPLEMENTATION" | "TEST" | "CONFIG" | "UNKNOWN" {
  if (/(?:^|\/)(?:__tests__|tests?|fixtures?)(?:\/|$)/i.test(source)) return "TEST";
  if (/\.(?:json|ya?ml|toml|ini|env)$/i.test(source)) return "CONFIG";
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|sql|sh)$/i.test(source)) {
    return "IMPLEMENTATION";
  }
  return "UNKNOWN";
}

export function scoreEvidenceRelevance(
  question: string,
  source: string,
  excerpt: string,
  content: string,
): { relevance: number; directness: "DIRECT" | "INDIRECT" } {
  const queryTokens = [...new Set(evidenceTokens(question))];
  const excerptText = `${source}\n${excerpt}`.toLowerCase();
  const contentText = content.toLowerCase();
  const matchedInExcerpt = queryTokens.filter((token) => excerptText.includes(token));
  const matchedInContent = queryTokens.filter((token) => contentText.includes(token));
  const directness =
    matchedInExcerpt.length > 0 && hasExecutableFlowMarker(excerpt)
      ? "DIRECT"
      : "INDIRECT";
  const queryCoverage = queryTokens.length > 0
    ? matchedInContent.length / queryTokens.length
    : 0;
  const directBonus = directness === "DIRECT" ? 0.35 : 0;
  const excerptBonus = matchedInExcerpt.length > 0 ? 0.25 : 0;
  return {
    relevance: Math.min(
      1,
      Math.round((0.2 + queryCoverage * 0.3 + directBonus + excerptBonus) * 100) / 100,
    ),
    directness,
  };
}

/**
 * A behavior claim is only source-backed when the response contains an exact
 * fragment from a completed read and that fragment is relevant to the
 * question. A file path or default constant alone proves that a file was
 * mentioned, not that the answer follows from its implementation.
 */
export function validateBehaviorEvidence(
  question: string,
  response: string,
  fileContents: ReadonlyMap<string, string>,
): BehaviorEvidenceValidation {
  const evidence: EvidenceReference[] = [];
  const quotedFragments = [...response.matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((fragment) => fragment.length >= 3);
  const hasEvidenceLabel = /(?:evidence|source|file|الدليل|المصدر)/i.test(response);

  for (const [source, content] of fileContents) {
    const normalizedSource = normalizeEvidencePath(source);
    const sourceMentioned =
      response.includes(source) ||
      response.includes(normalizedSource) ||
      response.includes(normalizedSource.split("/").pop() ?? normalizedSource);
    // Prefer a quoted executable fragment over an earlier declaration-only
    // quote. Providers commonly quote a function signature first and the
    // return/branch line second; choosing only the first match downgrades a
    // genuinely grounded answer to READ_CONFIRMED even when a later quote
    // proves the behavior.
    const matchingFragments = quotedFragments.filter(
      (fragment) =>
        normalizeEvidencePath(fragment) !== normalizedSource &&
        content.includes(fragment),
    );
    const excerpt =
      matchingFragments.find((fragment) => {
        const scored = scoreEvidenceRelevance(question, normalizedSource, fragment, content);
        return (
          scored.directness === "DIRECT" &&
          scored.relevance >= 0.65 &&
          hasExecutableFlowMarker(fragment) &&
          !isPureDeclaration(fragment)
        );
      }) ??
      matchingFragments[0];
    if (excerpt && (sourceMentioned || hasEvidenceLabel)) {
      const scored = scoreEvidenceRelevance(question, normalizedSource, excerpt, content);
      const sourceType = sourceTypeForEvidence(normalizedSource);
      const { span, ambiguous } = computeSourceSpan(
        content,
        excerpt,
        citationContextTokens(question, response, excerpt),
      );
      // Two structural gates guard against false behavioral proofs:
      //
      // 1. hasExecutableFlowMarker — strips string literals and comments before
      //    testing for flow keywords, so `const RETURN_CODE = "return partial"`
      //    cannot pass by accident.
      //
      // 2. isPureDeclaration — explicitly rejects constant/variable declarations
      //    like `DEFAULT_MAX_ITERATIONS = 30`.  A configured value is never proof
      //    that a behavioral branch behaves differently from another branch.
      //
      // Note: `span` is always defined here because the excerpt was already
      // confirmed present via `content.includes(fragment)` above; the span
      // field is metadata for callers, not a gate on supportsClaim.
      const structurallyProven =
        scored.directness === "DIRECT" &&
        scored.relevance >= 0.65 &&
        hasExecutableFlowMarker(excerpt) &&
        !isPureDeclaration(excerpt);
      // A duplicated fragment whose occurrences share identical surrounding
      // lines cannot be traced to a specific decision point (task #24). Trusting
      // the first-match span would present a confidently wrong line as exact, so
      // downgrade such evidence to READ_CONFIRMED and drop the unverifiable
      // span — per the sourceSpan contract, a span that cannot be associated
      // with a specific occurrence can never be BEHAVIOR_PROVEN.
      const supportsClaim = structurallyProven && !ambiguous;
      evidence.push({
        source: normalizedSource,
        excerpt,
        ...(span !== undefined && !ambiguous ? { sourceSpan: span } : {}),
        supportsClaim,
        relevance: scored.relevance,
        directness: scored.directness,
        sourceType,
        productionReachability: "NOT_PROVEN",
        evidenceClass: supportsClaim ? "BEHAVIOR_PROVEN" : "READ_CONFIRMED",
      });
    }
  }

  const violations: string[] = [];
  if (fileContents.size === 0) {
    violations.push("no completed source read is available for the behavior claim");
  } else if (!evidence.some((item) => item.supportsClaim)) {
    violations.push(
      "behavior response does not cite a relevant control-flow excerpt with a verifiable source span from a completed source read",
    );
  }
  return { valid: violations.length === 0, violations, evidence };
}

export function isExplicitBehaviorQueryRequest(message: string): boolean {
  return matchesAny(message.normalize("NFKC").trim(), BEHAVIOR_QUERY_PATTERNS);
}

// ── AI-OBJ-007 production-reachability request intent ────────────────────────
// The production API always supplies a transport-only trace (route → chat()).
// Those runtimeChatTraceLinks cannot mark a run as a reachability proof, so the
// reachability gate must also activate from the USER's explicit request intent:
// a prompt asking to prove/confirm production reachability ("is X reachable in
// production", "prove X is called from Y", …). Generic transport traces must NOT
// disable this mode — the intent is authoritative regardless of the supplied trace.
const PRODUCTION_REACHABILITY_PATTERNS: RegExp[] = [
  // prove/verify/confirm … reachable / reachability / called-from / invoked-from
  /\b(?:prove|verify|confirm|determine|show\s+me)\b[^.!?\n]{0,140}\b(?:reachab[a-z]*|called\s+from|invoked\s+from|invoked\s+via|call\s+path|reachability)\b/i,
  // reachable / reachability … (in) production / deployment
  /\breachab[a-z]*\b[^.!?\n]{0,40}\b(?:in\s+production|production|in\s+deployment|prod)\b/i,
  // is/are X (reachable|called|invoked) in/from/by
  /\b(?:is|are)\s+[a-zA-Z_][\w$.\-#]*\s+(?:reachable|called|invoked)\s+(?:in|from|by|via)\b/i,
  // reachability-explicit compound words
  /\bproduction.?reachab[a-z]*\b/i,
  /\bare\s+[a-zA-Z_][\w$.\-]*\s+(?:reachable|called|invoked)\s+in\s+production\b/i,
];

/**
 * True when a user prompt explicitly requests a production-reachability proof.
 * Conservative: requires an explicit prove/verify/confirm verb or an explicit
 * reachability + production signal — ordinary behavior questions ("what does
 * maxIterations do?") do not match.
 */
export function isProductionReachabilityRequest(message: string): boolean {
  return matchesAny(message.normalize("NFKC").trim(), PRODUCTION_REACHABILITY_PATTERNS);
}

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

/**
 * Conservative intent classifier for the five evidence-aware task types.
 * Explicit implementation-task language is handled by the outer profile
 * classifier and is intentionally not converted into forensic mode here.
 */
export function classifyForensicTask(
  message: string,
  options: { implementationTaskMode?: boolean } = {},
): ForensicTaskType {
  const normalized = message.normalize("NFKC").trim();
  if (options.implementationTaskMode) return "BEHAVIOR_QUERY";
  if (matchesAny(normalized, CODE_EXTRACTION_PATTERNS)) return "CODE_EXTRACTION";
  if (matchesAny(normalized, WORKSPACE_REVIEW_PATTERNS)) return "WORKSPACE_REVIEW";
  if (matchesAny(normalized, FULL_AUDIT_PATTERNS)) return "FULL_FORENSIC_AUDIT";
  // REPAIR / FINDING intent requires a POSITIVE occurrence of the keyword.
  // A prompt that only *denies* ("do not include a repair plan", "do NOT invent
  // a defect finding") is a behavioral / capability probe — route it to the
  // behavior contract instead of the forensic-report + R-PROOF path.
  if (matchesAnyPositive(REPAIR_ANALYSIS_PATTERNS, normalized)) return "REPAIR_ANALYSIS";
  if (matchesAnyPositive(FINDING_ANALYSIS_PATTERNS, normalized)) return "FINDING_ANALYSIS";
  if (matchesAny(normalized, BEHAVIOR_QUERY_PATTERNS)) return "BEHAVIOR_QUERY";
  return "BEHAVIOR_QUERY";
}

export function getTaskOutputContract(taskType: ForensicTaskType): OutputContract {
  return routeTask(taskType).outputContract;
}
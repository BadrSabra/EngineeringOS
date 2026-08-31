/**
 * Profile Classifier
 *
 * Classifies a user message into a request category and derives the context
 * profile, history depth, and prefetch permission for that turn.
 *
 * Design: pure synchronous — zero API calls, zero DB reads, no side-effects.
 * Safe to call at the very top of any request handler before any async work.
 *
 * Classification drives three downstream decisions:
 *   contextProfile  → which sections buildProjectContext loads
 *   historyDepth    → how many raw turns the agent window keeps verbatim
 *   allowPrefetch   → whether speculative-prefetch may inject files
 */

import {
  classifyForensicTask,
  resolveFirstEvidenceGate,
  routeTask,
  type AnalysisMode,
  type FirstEvidenceGate,
  type ForensicTaskType,
  type OutputContract,
} from "../task-contracts.js";

export type RequestCategory =
  | "simple"         // greeting / quick lookup / one-line yes-no
  | "code"           // file read / bug fix / snippet / implementation
  | "architecture"   // system design / dependency map / module structure
  | "workflow"       // task pipeline / CI-CD / automation / phase
  | "deep_analysis"; // cross-cutting analysis / audit / refactor plan

export type ClassifiedRequest = {
  category: RequestCategory;
  /** Context profile to pass to buildProjectContext and promptContextOverview. */
  contextProfile: "chat-lite" | "chat-normal" | "chat-deep";
  /**
   * Raw history turns to keep verbatim in the model window.
   * 0 = stateless (forensic/structured-output mode — previous session bias
   *     must not contaminate a fresh audit scan).
   */
  historyDepth: 0 | 2 | 4 | 6;
  /** Whether speculative prefetch may inject files for this turn. */
  allowPrefetch: boolean;
  /** 0–1 confidence estimate (informational only — not used for routing). */
  confidence: number;
  /**
   * True when the user's message defines an exact mandatory output format
   * (e.g. markdown table headers, "REQUIRED OUTPUT", "Forensic Findings Matrix",
   * role-redefining "أنت X / You are Y" openers, or numbered output sections).
   *
   * When true the system prompt suppresses the default "Plan:" prefix (Rule 9)
   * and the expansion behaviour (Rule 5), and instead instructs the model to
   * follow the user's specified format exactly as the primary constraint.
   */
  structuredOutputMode: boolean;
  /**
   * A deliberately isolated capability test for one explicitly named source
   * file. This disables planner/memory expansion and limits the tool surface
   * to read_file so the result measures the requested file-level behavior.
   */
  singleFileForensicMode: boolean;
  /**
   * Ordered source roots requested by a forensic audit. An ordered scope
   * disables speculative expansion and is enforced again by the dispatcher.
   */
  orderedForensicRoots: string[];
  /**
   * Test and fixture sources are excluded from production audits unless the
   * request explicitly asks for a capability/test-source audit.
   */
  includeTestSources: boolean;
  /**
   * Explicit fixture/capability audit mode. This may prove a defect locally
   * in a test source, but must not be interpreted as production reachability.
   */
  fixtureAuditMode: boolean;
  /**
   * True when the message is an implementation/validation task rather than a
   * request to produce a forensic report. This takes precedence over forensic
   * keywords that appear while describing the code under test.
   */
  implementationTaskMode: boolean;
  /**
   * Planning-only implementation requests stay separate from forensic repair
   * and from the write-capable implementation path.
   */
  implementationPlanMode: boolean;
  /** Evidence-aware task contract, independent from provider/model routing. */
  taskType: ForensicTaskType;
  /** Whether the task requires the forensic evidence pipeline. */
  analysisMode: AnalysisMode;
  /** Output shape owned by the task-specific validator. */
  outputContract: OutputContract;
  /**
   * First-Evidence Gate: how investigation must begin. When the message names
   * an explicit source file in an evidence-requiring task this is DIRECT_READ
   * against that primary evidence target with PRIMARY_FIRST traversal, forcing
   * the runtime to read the target directly before any graph/prefetch work.
   */
  firstEvidence: FirstEvidenceGate;
};

// ─── Structured-output mode detection ────────────────────────────────────────
// Patterns that indicate the user has defined a mandatory output format that
// the model MUST follow rather than falling back to its default prose style.

const STRUCTURED_OUTPUT_PATTERNS: RegExp[] = [
  // Markdown table header opening (pipe + any text + pipe)
  /\|\s*\w[\w\s/]*\|/,
  // Explicit output section headers used in forensic / audit prompts
  /\b(?:REQUIRED\s+OUTPUT|FORENSIC\s+FINDINGS|REPAIR\s+MANIFEST|VALIDATION\s+MATRIX|PROVENANCE\s+TABLE|FINDINGS\s+MATRIX|REPAIR\s+PRIORITY|FINAL\s+VERDICT)\b/i,
  // Numbered output sections (# 1. / ## 1. / 1\. / ## 1) <HEADING>)
  /^#{0,3}\s*\d+[.)]\s+[\w\u0600-\u06FF]\S*/m,
  // Role-redefining opener at start of message: "أنت X" / "You are X" / "Act as"
  // NOTE: \w is ASCII-only in JS; include \u0600-\u06FF so Arabic openers match.
  /^[\s\u200B]*(?:أنت\s+\*{0,2}[\w\u0600-\u06FF]|you\s+are\s+(?:a\s+)?(?:an?\s+)?\*{0,2}\w|act\s+as\b)/im,
  // Explicit column definitions ("| ID | Severity | Type |")
  /\|\s*(?:ID|Severity|Finding|Patch|Priority|Evidence|Claim|Test\s+Scenario)\s*\|/i,
  // Arabic structured output directive
  /(?:أخرج|اعرض|أنشئ)\s+(?:فقط\s+)?(?:جدول|جداول|نتائج|مصفوفة)/,
  // Forensic capability tests often use compact, non-numbered headings.
  /\b(?:BEHAVIOR\s+VERDICT|DIRECT\s+EVIDENCE|DEFECT\s+FINDING|NO\s+VERIFIED\s+DEFECT)\b/i,
  /(?:اختبر\s+قدرة\s+التحليل\s+الجنائي|اختبار\s+جنائي\s+لملف\s+واحد)/i,
];

const SINGLE_FILE_FORENSIC_PATTERNS: RegExp[] = [
  /(?:اختبر\s+قدرة\s+التحليل\s+الجنائي|اختبار\s+جنائي\s+لملف\s+واحد)/i,
  /\b(?:single[-\s]file\s+forensic|forensic\s+capability\s+test)\b/i,
  /(?:لا\s+تقرأ\s+أي\s+ملف\s+آخر|لا\s+تستخدم\s+search_code|do\s+not\s+read\s+any\s+other\s+file|read_file\s+only)/i,
];

/**
 * Returns true when the message contains a strong signal that the user has
 * specified a mandatory output schema the model must follow verbatim.
 */
function detectStructuredOutputMode(message: string): boolean {
  return STRUCTURED_OUTPUT_PATTERNS.some((p) => p.test(message));
}

/**
 * Task descriptions often mention forensic/audit concepts because they are
 * testing the forensic pipeline. They still need the normal implementation
 * path: inspect files, edit tests, and run validation. Keep this detector
 * deliberately conservative so a normal audit that merely has a checklist is
 * not reclassified as an implementation task.
 */
function detectImplementationTaskMode(message: string): boolean {
  const hasTaskStructure =
    /\b(?:task\s*#?\s*\d+|done\s+looks\s+like|acceptance\s+criteria|relevant\s+files|implementation\s+task)\b|مهمة\s*#?\s*\d+/i.test(
      message,
    );
  const hasImplementationIntent =
    /\b(?:implement|add|extend|modify|change|create|write|edit|patch|run|execute|test|tests|validation)\b|أضف|وسّع|عدّل|غيّر|أنشئ|اكتب|شغّل|نفّذ|اختبر|اختبارات|تحقق|تغييرات|ملفات\s+ذات\s+الصلة/i.test(
      message,
    );
  // Product/UX planning is an implementation-oriented request, but it is not
  // a forensic repair analysis. Keep it on the normal task path so a phrase
  // like "ضع خطة تنفيذية لتحسين تجربة المستخدم" cannot trigger the generic
  // REPAIR_ANALYSIS pattern and then fall into a six-section evidence audit.
  const hasProductExperiencePlan =
    /(?:\b(?:user\s+experience|user\s+interface|ux|ui|onboarding|usability)\b|تجربة\s+المستخدم|واجهة\s+المستخدم|سهولة\s+الاستخدام)/i.test(
      message,
    ) &&
    /(?:\b(?:plan|roadmap|improve|redesign|design)\b|خطة|تحسين|تحسينات|تصميم|إعادة\s+تصميم)/i.test(
      message,
    );

  return (hasTaskStructure && hasImplementationIntent) || hasProductExperiencePlan;
}

function detectImplementationPlanMode(message: string): boolean {
  const asksForPlan =
    /\b(?:implementation\s+plan|build\s+plan|delivery\s+plan|roadmap|plan\s+the\s+work|plan\s+how\s+to\s+build)\b|خطة\s+(?:تنفيذية|بناء|عمل|التنفيذ)|خارطة\s+الطريق/i.test(
      message,
    );
  const targetsImplementation =
    /\b(?:implement|build|create|add|extend|modify|change|feature|workflow|system|app|dashboard)\b|نفّذ|تنفيذ|ابنِ|أنشئ|أضف|عدّل|ميزة|نظام|تطبيق/i.test(
      message,
    );
  // A repair plan is an evidence-bearing forensic contract, not a general
  // implementation roadmap. Preserve that route even when it contains
  // "implementation plan" wording.
  const repairIntent =
    /\b(?:repair\s+plan|forensic|audit|finding|defect|root\s+cause|source\s+of\s+truth)\b|خطة\s+الإصلاح|إصلاح|عيب|خلل|تدقيق|سبب\s+الجذر|مصدر\s+الحقيقة/i.test(
      message,
    );
  return asksForPlan && targetsImplementation && !repairIntent;
}

function detectSingleFileForensicMode(message: string): boolean {
  const sourcePathCount = [...message.matchAll(
    /\b[\w./@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh)\b/gi,
  )].length;
  const hasForensicIntent =
    SINGLE_FILE_FORENSIC_PATTERNS.some((p) => p.test(message)) ||
    (/\b(?:forensic|evidence\s+map|defect\s+proven|repair\s+plan|finding|behavior\s+confirmed)\b|جنائي|دليل\s+مباشر|خطة\s+الإصلاح|عيب\s+مثبت/i.test(message) &&
      /(?:\b(?:one|single|only)\s+(?:file|function)|ملف\s+واحد|هذا\s+الملف\s+فقط|الدالة\s+التالية)/i.test(message));
  const hasSourcePath = /\b[\w./@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh)\b/i.test(message);
  const multiFileTaskIntent =
    sourcePathCount > 1 &&
    /\b(?:extract|show|inspect|read|compare|analy[sz]e|behavior|behaviour|forensic|audit)\b|استخراج|اعرض|افحص|اقرأ|قارن|حلل|سلوك/i.test(
      message,
    );
  return (
    hasSourcePath &&
    sourcePathCount >= 1 &&
    sourcePathCount <= 5 &&
    (hasForensicIntent || multiFileTaskIntent)
  );
}

function detectFixtureAuditMode(message: string): boolean {
  const explicitFixtureLanguage =
    /\b(?:fixture|test[-\s]?source|test[-\s]?fixture|capability\s+(?:test|audit)|known[-\s]?defect)\b|ملف\s+(?:اختبار|تجريبي)|مصدر\s+اختبار|اختبار\s+قدرة|تحليل\s+قدرة/i.test(
      message,
    );
  const explicitAuditLanguage =
    /\b(?:audit|scan|inspect|analy[sz]e|test|verify|prove|forensic)\b|تدقيق|افحص|حلل|اختبر|تحقق|أثبت|جنائي/i.test(
      message,
    );

  // A production audit must never opt into test sources merely because it is
  // scoped to one file. The user must explicitly request a fixture/capability
  // audit (or name a known defect as such).
  return explicitFixtureLanguage && explicitAuditLanguage;
}

function detectIncludeTestSources(message: string, fixtureAuditMode: boolean): boolean {
  if (fixtureAuditMode) return true;
  return false;
}

const SOURCE_FILE_EXTENSIONS =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html)$/i;

/**
 * Unambiguous prompt-prose slash-pairs that can never be real project
 * directory names. Stored lowercase; candidates are compared after
 * toLowerCase().
 *
 * Only pairs where BOTH sides are pure boolean / logical tokens that have no
 * plausible meaning as a directory component belong here. Pairs like
 * "client/server" or "read/write" are deliberately excluded because those ARE
 * conventional directory names in many projects.
 */
const PROSE_PSEUDO_PATH_DENYLIST = new Set([
  "pass/fail",
  "yes/no",
  "true/false",
  "and/or",
  "n/a",
  // Forensic-report template labels parsed out of question prose. A user
  // writes "must not reject merely because there is no defect/repair finding"
  // or "requires a Finding/Repair Plan" — these are report-section phrases, not
  // project directories. Without this, they pollute orderedForensicRoots and
  // form a restricting scope that drops the named file at admissibility.
  "defect/repair",
  "finding/repair",
  "defect/finding",
  "finding/defect",
  "verdict/status",
  "evidence/finding",
  "finding/evidence",
]);

/**
 * The minimal set of single-token words that are definitively boolean /
 * logical and therefore could never be a real directory-path segment.
 *
 * A two-segment candidate (exactly one slash, no deeper nesting) is rejected
 * as prompt prose when BOTH sides are in this set.
 *
 * Deliberately narrow: words like "client", "server", "read", "write",
 * "get", "set", "input", "output", "before", "after", "sync", "async" etc.
 * are all plausible directory names and must NOT appear here.
 */
const PROSE_BOOLEAN_WORD_SET = new Set([
  "pass", "fail",
  "yes",  "no",
  "true", "false",
  "and",  "or",
]);

/**
 * Returns true when the candidate looks like prompt prose (e.g. "pass/fail")
 * rather than a real project-relative directory path.
 *
 * Only rejects unambiguous boolean/logical slash-pairs; conventional directory
 * names that happen to share a word with natural-language prose are preserved.
 */
function isPromptProsePath(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  if (PROSE_PSEUDO_PATH_DENYLIST.has(lower)) return true;

  // Metric / label slash-pairs like "X/5", "3/5", "A/12" or "5/5" are scores
  // in prose (e.g. "X/5 capabilities demonstrated"), never directory segments.
  if (/^[a-z0-9]\/\d+$/.test(lower)) return true;

  // Reject a simple `word/word` pattern (exactly one slash, no sub-paths)
  // when BOTH sides are unambiguous boolean/logical tokens.
  const slashIndex = lower.indexOf("/");
  if (slashIndex !== -1 && lower.indexOf("/", slashIndex + 1) === -1) {
    const left = lower.slice(0, slashIndex);
    const right = lower.slice(slashIndex + 1);
    if (PROSE_BOOLEAN_WORD_SET.has(left) && PROSE_BOOLEAN_WORD_SET.has(right)) return true;
  }

  return false;
}

/**
 * Extract project-relative directory paths from a user request while
 * deliberately ignoring source-file paths. The classifier is project-agnostic:
 * `packages/core/`, `src/services`, and any other valid relative roots work.
 *
 * Candidates that match known prompt-prose slash-pairs (e.g. "pass/fail",
 * "yes/no") are rejected so they never pollute the requested-roots list.
 */
export function extractOrderedForensicRoots(message: string): string[] {
  const normalized = message
    .normalize("NFKC")
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ");
  const roots: string[] = [];
  const directoryPathPattern =
    /(?:^|[\s`'"(])((?:(?:\.{0,2}\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)+\/?|(?:\.{0,2}\/)[A-Za-z0-9_@.-]+\/?))(?=$|[\s`'"(),؛;:!?])/g;

  let match: RegExpExecArray | null;
  while ((match = directoryPathPattern.exec(normalized)) !== null) {
    const candidate = match[1]!
      .replace(/^(\.\/)+/, "")
      .replace(/\/+$/, "")
      // Strip trailing punctuation that ends a sentence but is not part of a path
      .replace(/[.,!?;:]+$/, "");
    if (
      !candidate ||
      candidate.startsWith("/") ||
      candidate.startsWith("../") ||
      SOURCE_FILE_EXTENSIONS.test(candidate) ||
      candidate === "." ||
      isPromptProsePath(candidate) ||
      roots.includes(candidate)
    ) {
      continue;
    }
    roots.push(candidate);
  }

  return roots;
}

function detectOrderedForensicRoots(message: string): string[] {
  const roots = extractOrderedForensicRoots(message);
  const hasForensicIntent =
    /\b(?:forensic|audit|evidence\s+map|findings?|repair\s+plan|source\s+of\s+truth)\b|جنائي|تدقيق|أدلة|خطة\s+الإصلاح/i.test(
      message,
    );
  const asksForOrder =
    /(?:\b(?:then|after|followed\s+by|in\s+this\s+order)\b|بهذا\s+الترتيب|ثم|بعدها)/i.test(
      message,
    );
  const directoryIntent =
    /\b(?:folder|folders|directory|directories|package|packages|module|modules|root)\b|مجلد|مجلدات|دليل|حزمة|وحدة|جذر/i.test(
      message,
    );
  const explicitScope =
    /\b(?:only|just|exclusively|solely|inside|within|nothing\s+outside)\b|فقط|حصراً|حصرًا|داخل|لا\s+تقرأ\s+(?:أي\s+)?شيء\s+خارج|خارج(?:ه|ها)?\s+ممنوع/i.test(
      message,
    );

  // A directory request is a scoped forensic request even when it names one
  // root. Multiple roots preserve their mention order; an explicit ordering
  // phrase is still accepted and documented in the effective manifest.
  return hasForensicIntent &&
    roots.length > 0 &&
    (directoryIntent || explicitScope || (roots.length >= 2 && asksForOrder))
    ? roots
    : [];
}

// ─── Category → depth / profile mapping ──────────────────────────────────────

const CATEGORY_CONFIG: Record<
  RequestCategory,
  Omit<
    ClassifiedRequest,
    | "category"
    | "confidence"
    | "structuredOutputMode"
    | "singleFileForensicMode"
    | "orderedForensicRoots"
    | "includeTestSources"
    | "fixtureAuditMode"
    | "implementationTaskMode"
    | "implementationPlanMode"
    | "taskType"
    | "analysisMode"
    | "outputContract"
    | "firstEvidence"
  >
> = {
  simple:        { contextProfile: "chat-lite",   historyDepth: 2, allowPrefetch: false },
  code:          { contextProfile: "chat-normal", historyDepth: 4, allowPrefetch: true  },
  architecture:  { contextProfile: "chat-deep",   historyDepth: 6, allowPrefetch: true  },
  workflow:      { contextProfile: "chat-normal", historyDepth: 4, allowPrefetch: false },
  deep_analysis: { contextProfile: "chat-deep",   historyDepth: 6, allowPrefetch: true  },
};

// ─── Pattern table ────────────────────────────────────────────────────────────
// Each entry accumulates score when the pattern matches.
// Higher weight = stronger signal for that category.

type PatternEntry = { category: RequestCategory; re: RegExp; weight: number };

const SOCIAL_GREETING_RE =
  /^[\s]*(?:hi|hello|hey|مرحبا|أهلا?|سلام|هلا|مرحباً|greetings|good\s+(?:morning|afternoon|evening)|صباح الخير|مساء الخير)[\s!.,،؟?]*$/iu;

export function isSocialGreeting(message: string): boolean {
  return SOCIAL_GREETING_RE.test(message.trim());
}

/**
 * Generic/social questions should stay on the plain chat path. They do not
 * authorize repository access merely because a project root is available.
 * Project-oriented questions are intentionally kept separate: they remain
 * lightweight, but their intent router may request read tools.
 */
export function isLowRiskChatQuestion(message: string): boolean {
  return /^(?:ماذا\s+يمكنني\s+أن\s+أفعل|كيف\s+أبدأ|ساعدني|ممكن\s+تساعدني|what\s+can\s+you\s+help\s+me\s+with|can\s+you\s+help\s+me|how\s+do\s+i\s+start)[؟?!.\s]*$/iu.test(
    message.trim(),
  );
}

/**
 * Short questions about the current project need project context when it is
 * available, without opting into a broad forensic scan. Keeping this detector
 * explicit prevents a generic "can you help me?" from gaining repository
 * capability just because it happens to share the same simple classification.
 */
export function isProjectOrientationQuestion(message: string): boolean {
  return /^(?:ما(?:\s+هو)?\s+(?:هذا\s+)?المشروع|ماذا\s+(?:يفعل|يقدم|يحتوي)\s+(?:هذا\s+)?المشروع|عن\s+ماذا\s+يدور\s+(?:هذا\s+)?المشروع|اشرح(?:\s+لي)?\s+(?:هذا\s+)?المشروع|ساعدني(?:\s+في)?\s+(?:فهم|أفهم)(?:\s+هذا)?\s+المشروع|ممكن\s+تساعدني(?:\s+أن)?\s+(?:أفهم\s+)?المشروع|هل\s+(?:هذا\s+)?المشروع\s+(?:شغال|يعمل)(?:\s+حاليًا)?|what(?:'s| is)\s+(?:this\s+)?project|what\s+does\s+(?:this\s+)?project\s+do|(?:explain|describe)\s+(?:this\s+)?project|help\s+me\s+understand\s+(?:this\s+)?project|is\s+(?:this\s+)?project\s+running)[؟?!.\s]*$/iu.test(
    message.trim(),
  );
}

const PATTERNS: PatternEntry[] = [
  // ── simple ──────────────────────────────────────────────────────────────────
  // Pure greetings / social openers
  {
    category: "simple",
    re: SOCIAL_GREETING_RE,
    weight: 5,
  },
  // "what's your name", "how are you" and similar social questions
  {
    category: "simple",
    re: /^(?:what(?:'s| is)(?: your)? name|من أنت|ما اسمك|كيف حالك|how are you)[؟?!.\s]*$/i,
    weight: 5,
  },

  // ── architecture ────────────────────────────────────────────────────────────
  {
    category: "architecture",
    re: /\b(?:architect(?:ure)?|system[\s-]design|module[\s-]map|depend(?:ency|encies)|structure|overview|diagram|layer|topology|component[\s-]graph|معمارية|تصميم|هيكل(?:ية)?|مكونات|وحدات|طبقات|بنية[\s]النظام)\b/i,
    weight: 3,
  },
  // "how are X connected/organized/structured"
  {
    category: "architecture",
    re: /\b(?:how\s+(?:are|is)\s+.{0,30}\s+(?:connected|organized|structured)|ما(?:\s+هو)?\s+هيكل|كيف\s+ترتبط)\b/i,
    weight: 2,
  },

  // ── workflow ─────────────────────────────────────────────────────────────────
  {
    category: "workflow",
    re: /\b(?:workflow|pipeline|CI[\s\-/]?CD|deploy(?:ment)?|automat(?:e|ion)|trigger|cron|schedul(?:e|er)|phase|stage|مهام|سير\s+العمل|نشر|أتمتة|جدول|مرحلة)\b/i,
    weight: 3,
  },

  // ── deep_analysis ────────────────────────────────────────────────────────────
  {
    category: "deep_analysis",
    re: /\b(?:anal[yz](?:e|is[ei]s)|audit|refactor|deep[\s-]dive|review\s+all|compare|investigate|trace|root[\s-]cause|تحليل|مراجعة|تدقيق|إعادة\s+هيكلة|استقصاء|لماذا\s+يفشل|سبب\s+(?:المشكلة|الخطأ))\b/i,
    weight: 3,
  },
  // "explain how … works" / "why does … do" / "what causes"
  {
    category: "deep_analysis",
    re: /\b(?:explain\s+how|why\s+does|how\s+does.{0,30}work|what\s+causes|كيف\s+يعمل|لماذا\s+يحدث|ما\s+سبب)\b/i,
    weight: 2,
  },

  // ── code ─────────────────────────────────────────────────────────────────────
  // Explicit file path / filename with a recognized extension
  {
    category: "code",
    re: /\b[\w\-./@]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml)\b/i,
    weight: 4,
  },
  // Programming action verbs (Arabic + English)
  {
    category: "code",
    re: /\b(?:fix|bug|error|implement|function|class|method|interface|import|export|const|let|var|async|await|type|lint|test|spec|endpoint|route|أصلح|خطأ|دالة|كلاس|متغير|استيراد|تصدير|اختبار)\b/i,
    weight: 2,
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a user message into a RequestCategory and derive its context hints.
 *
 * Always returns a complete ClassifiedRequest — never throws, never returns null.
 * The default when nothing matches is `"code"` (safest for a coding assistant).
 */
export function classifyRequest(message: string): ClassifiedRequest {
  const trimmed = message.trim();

  const implementationPlanMode = detectImplementationPlanMode(trimmed);
  const implementationTaskMode =
    !implementationPlanMode && detectImplementationTaskMode(trimmed);
  const taskType = implementationPlanMode
    ? "BEHAVIOR_QUERY"
    : classifyForensicTask(trimmed, { implementationTaskMode });
  const taskRoute = routeTask(taskType);
  const firstEvidence = resolveFirstEvidenceGate(taskType, trimmed, {
    implementationTaskMode: implementationTaskMode || implementationPlanMode,
  });
  const singleFileForensicMode =
    !implementationTaskMode &&
    !implementationPlanMode &&
    detectSingleFileForensicMode(trimmed);
  // A single-file forensic scope is the stricter contract (exact named files,
  // read-only). Report/output-format prose in the same message (e.g. ability
  // probes that say "Inspect ONLY these two files" and "X/5 capabilities")
  // must not also route into ordered-directory roots — subordinating ordered
  // roots to single-file mode keeps the named-file scope authoritative.
  const detectedOrderedForensicRoots =
    implementationTaskMode || implementationPlanMode || singleFileForensicMode
      ? []
      : detectOrderedForensicRoots(trimmed);
  const hasExplicitSourceTarget = SOURCE_FILE_EXTENSIONS.test(trimmed) ||
    /(?:^|[\s`"'(])(?:src|lib|artifacts|packages|apps|tests?)\//i.test(trimmed);
  const requestsBroadDiscovery =
    /(?:\b(?:source\s+code|root\s+cause|root\s+causes|gaps?|missing)\b|الفجوات|الأسباب\s+الجذرية|الكود\s+(?:الفعلي|المصدري))/iu.test(
      trimmed,
    );
  // Broad audits must bootstrap source discovery even when the user did not
  // name a directory. Previously these requests entered forensic mode with no
  // ordered roots, leaving the model responsible for deciding whether to call
  // a source tool; a provider could then stop after prose/planning and the
  // evidence gate correctly reported zero reads. "." is the project root, not
  // an unrestricted filesystem path — prefetchForensicRoots resolves it below
  // the authenticated rootPath and applies the normal source-file filters and
  // read budget.
  const orderedForensicRoots =
    detectedOrderedForensicRoots.length > 0
      ? detectedOrderedForensicRoots
      : !implementationTaskMode &&
          !implementationPlanMode &&
          !singleFileForensicMode &&
          !hasExplicitSourceTarget &&
          requestsBroadDiscovery &&
          (taskType === "FULL_FORENSIC_AUDIT" || taskType === "WORKSPACE_REVIEW")
        ? ["."]
        : [];
  const fixtureAuditMode =
    !implementationTaskMode &&
    !implementationPlanMode &&
    detectFixtureAuditMode(trimmed);
  const includeTestSources = detectIncludeTestSources(trimmed, fixtureAuditMode);
  const structuredOutputMode =
    !implementationTaskMode &&
    !implementationPlanMode &&
    (detectStructuredOutputMode(trimmed) ||
      taskType === "WORKSPACE_REVIEW" ||
      singleFileForensicMode ||
      orderedForensicRoots.length > 0);

  // Keep generic/social questions and project orientation on the lightweight
  // profile. Project orientation is still routed to read-capable project chat
  // by resolveTurnIntent; it does not imply a repository-wide scan.
  if (
    (isLowRiskChatQuestion(trimmed) || isProjectOrientationQuestion(trimmed)) &&
    !implementationTaskMode &&
    !implementationPlanMode &&
    !singleFileForensicMode
  ) {
    return {
      category: "simple",
      ...CATEGORY_CONFIG.simple,
      allowPrefetch: false,
      confidence: 0.95,
      structuredOutputMode: false,
      singleFileForensicMode: false,
      orderedForensicRoots: [],
      includeTestSources: false,
      fixtureAuditMode: false,
      implementationTaskMode: false,
      implementationPlanMode: false,
      taskType: "BEHAVIOR_QUERY",
      analysisMode: "STANDARD",
      outputContract: "GENERIC_RESPONSE",
      firstEvidence,
    };
  }

  // Very short messages with no file-extension hint → simple (greeting / quick question)
  if (trimmed.length <= 25 && !/\.[a-zA-Z]{2,5}\b/.test(trimmed)) {
    return {
      category: "simple",
      ...CATEGORY_CONFIG.simple,
      allowPrefetch: false,
      confidence: 0.9,
      structuredOutputMode,
      singleFileForensicMode,
      orderedForensicRoots,
      includeTestSources,
      fixtureAuditMode,
       implementationTaskMode,
      implementationPlanMode,
      taskType,
       analysisMode: implementationTaskMode || implementationPlanMode ? "STANDARD" : taskRoute.analysisMode,
       outputContract: implementationTaskMode || implementationPlanMode ? "GENERIC_RESPONSE" : taskRoute.outputContract,
      firstEvidence,
    };
  }

  // Accumulate weighted score per category
  const scores: Record<RequestCategory, number> = {
    simple: 0, code: 0, architecture: 0, workflow: 0, deep_analysis: 0,
  };

  for (const { category, re, weight } of PATTERNS) {
    // Use global flag to count all occurrences, not just the first
    const gFlag = re.flags.includes("g") ? re.flags : re.flags + "g";
    const hits  = trimmed.match(new RegExp(re.source, gFlag));
    if (hits && hits.length > 0) {
      scores[category] += hits.length * weight;
    }
  }

  // Long messages with weak code / architecture signal → lean toward deep_analysis
  if (trimmed.length > 200 && scores.code < 4 && scores.architecture < 3) {
    scores.deep_analysis += 2;
  }

  // Pick winner
  const sorted = (Object.keys(scores) as RequestCategory[]).sort(
    (a, b) => scores[b] - scores[a],
  );
  const winner     = sorted[0] ?? "code";
  const totalScore = Object.values(scores).reduce((s, v) => s + v, 0);

  // Nothing matched → default to "code" (unclassified substantive message)
  const category: RequestCategory = totalScore === 0 ? "code" : winner;
  const confidence =
    totalScore > 0 ? Math.min(scores[category] / totalScore, 0.95) : 0.5;

  return {
    category,
    ...CATEGORY_CONFIG[category],
     allowPrefetch: singleFileForensicMode || orderedForensicRoots.length > 0
       ? false
       : CATEGORY_CONFIG[category].allowPrefetch,
    confidence,
    structuredOutputMode,
    singleFileForensicMode,
     orderedForensicRoots,
    includeTestSources,
    fixtureAuditMode,
    implementationTaskMode,
    implementationPlanMode,
    taskType,
    analysisMode: implementationTaskMode || implementationPlanMode ? "STANDARD" : taskRoute.analysisMode,
    outputContract: implementationTaskMode || implementationPlanMode ? "GENERIC_RESPONSE" : taskRoute.outputContract,
    firstEvidence,
  };
}

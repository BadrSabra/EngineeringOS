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
  /** Raw history turns to keep verbatim in the model window. */
  historyDepth: 2 | 4 | 6;
  /** Whether speculative prefetch may inject files for this turn. */
  allowPrefetch: boolean;
  /** 0–1 confidence estimate (informational only — not used for routing). */
  confidence: number;
};

// ─── Category → depth / profile mapping ──────────────────────────────────────

const CATEGORY_CONFIG: Record<
  RequestCategory,
  Omit<ClassifiedRequest, "category" | "confidence">
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

const PATTERNS: PatternEntry[] = [
  // ── simple ──────────────────────────────────────────────────────────────────
  // Pure greetings / social openers
  {
    category: "simple",
    re: /^[\s]*(?:hi|hello|hey|مرحبا|أهلا?|سلام|هلا|مرحباً|greetings|good\s+(?:morning|afternoon|evening)|صباح الخير|مساء الخير)[\s!.,،؟?]*$/i,
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

  // Very short messages with no file-extension hint → simple (greeting / quick question)
  if (trimmed.length <= 25 && !/\.[a-zA-Z]{2,5}\b/.test(trimmed)) {
    return { category: "simple", ...CATEGORY_CONFIG.simple, confidence: 0.9 };
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

  return { category, ...CATEGORY_CONFIG[category], confidence };
}

/**
 * Chat Agent — conversational interface with full project context.
 *
 * When `rootPath` is supplied the agent activates the file-system tool suite:
 *   read_file      — reads actual source files
 *   list_directory — browses the project tree
 *   search_code    — grep across the codebase
 *   write_file     — queues a proposed change (never writes immediately)
 *
 * Tool execution discipline — three interlocking guards:
 *
 *   MAX_TOOL_ITERATIONS (12)
 *     Bounds the number of model API calls. On exhaustion the agent returns a
 *     best-effort answer with whatever sources and pending changes accumulated.
 *
 *   MAX_TOOL_CALLS (25)
 *     Bounds total tool executions across all iterations. Each iteration the
 *     model may request multiple tool calls in a single response; this cap
 *     prevents a single confused response from spawning unlimited executions.
 *     Once reached, remaining tool calls in that batch receive a canned
 *     "budget exhausted" response so the model can synthesize from what it has.
 *
 *   toolCallCache (deduplication)
 *     Tool calls are keyed by name + canonicalised arguments. A repeated
 *     identical call returns the cached result without re-executing and without
 *     consuming the MAX_TOOL_CALLS budget. This prevents the most common
 *     stuck-loop pattern (re-reading the same file every iteration) and also
 *     prevents duplicate entries in pendingChanges (write_file called twice
 *     with identical arguments).
 *
 * Sources
 *   Files and patterns actually accessed via read_file, list_directory, and
 *   search_code are recorded in toolSources during the loop. On return they
 *   are prepended to the model-reported sources array so the caller always
 *   receives ground-truth access provenance regardless of what the model
 *   chose to self-report.
 *
 * Proposed file changes
 *   write_file never writes to disk — it pushes to pendingChanges. That array
 *   is returned in ChatOutput and must be approved by the user through the
 *   dashboard UI before anything is written.
 */
import { getStrategy, type ProviderId } from "../provider-registry.js";
import { resolveExecutionDecision } from "../model-selection/decision-engine.js";
import { resolveExecutionProvider } from "../model-selection/provider-strategy.js";
import { resolveExecutionModel } from "../model-selection/model-resolver.js";
import type { AgentErrorCode } from "../errors.js";
import type { RawMessage } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { buildChatSystemPrompt } from "../prompts/chat.prompt.js";
import { classifyRequest } from "../prompts/profile-classifier.js";
import { ChatResponseSchema, ChatOutputSchema, PendingChangeSchema, type ChatOutput, type PendingChange, type ResolvedModelInfo } from "../schemas/chat.schema.js";
import { parseAgentResponse } from "../parsing.js";
import { getAllowedToolDefinitions, resolveToolPolicy } from "../tool-policy.js";
import type { StrategyCallOptions } from "../provider-strategy.js";
import { speculativePrefetch, prefetchFileList } from "./speculative-prefetch.js";
import { planQuery, type QueryPlan } from "./query-planner.js";
import { toolCacheKey, executeToolLoop, BUDGET_BY_SCOPE, type AgentStep } from "../tool-execution-engine.js";
import { executeHierarchical } from "./hierarchical-executor.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type { ChatOutput };

// ── BUG-2 fix: source sanitisation ───────────────────────────────────────────
// The model frequently returns category labels ("project name", "language",
// "branch", "path", "quality") instead of specific citations (entity names,
// metric labels like "Perf: 99.0", or file paths).  Source discipline rule:
// "list only entity names, metric labels, or file paths you actually cited."
//
// This filter runs on every model-reported sources array before it reaches the
// DB or the client.  It is intentionally permissive — it removes only strings
// that are provably generic labels, not anything that could be a real path or
// entity name.  Ground-truth toolSources (from actual file reads) are never
// passed through this filter; they bypass it entirely because they are factual.
const GENERIC_SOURCE_PATTERNS: RegExp[] = [
  // Any "project <anything>" compound — model emits these as generic labels
  /^project\s+\S+(\s+\S+)?$/i,
  // Single-word category labels
  /^(language|branch|path|quality|status|metrics|graph|entities|relationships)$/i,
  /^(framework|architecture|description|overview|context|data|info|information)$/i,
  /^(no project data|no data|unknown|n\/a|none|context)$/i,
  // Tool names masquerading as sources
  /^(read_file|list_directory|search_code|write_file|git_status|git_diff|git_log)$/i,
  // Single-word generic nouns with no qualifier
  /^(name|type|title|label|value|url|date|time|id|uuid)$/i,
];

function isGenericSource(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed || trimmed.length < 2) return true;
  return GENERIC_SOURCE_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Remove generic/fabricated source strings from a model-reported array.
 * Returns the filtered array; returns [] if nothing survives (correct — the
 * source discipline rule prefers an empty array over fabricated labels).
 */
function sanitizeSources(sources: string[]): string[] {
  return sources.filter((s) => !isGenericSource(s));
}

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed after all correction retries,
 * the route surfaces `_parseError` as HTTP 422 instead of a silent 200
 * with degraded fallback content.
 */
export type ChatResult = ChatOutput & {
  _parseError?: { code: AgentErrorCode; message: string; raw: string };
};

// Iteration and call budgets are owned by the engine (DEFAULT_MAX_ITERATIONS / DEFAULT_MAX_TOOL_CALLS).

/**
 * إصلاح #2 — اكتشاف نية التنفيذ الفعلي للأدوات.
 *
 * عندما يطلب المستخدم صراحةً تنفيذ شيء ("اختبر الأدوات"، "run the tests"...)،
 * نستخدم MODEL_POWERFUL بدلاً من MODEL_FAST لأن النموذج الأصغر يميل إلى
 * وصف الأدوات نظرياً بمسارات وهمية بدل استدعائها فعلياً (hallucination).
 */
const TOOL_EXECUTION_PATTERNS: RegExp[] = [
  // العربية: أفعال الكتابة/التنفيذ/الإصلاح/التحقق التي تعني "ابدأ أدوات"
  /(?:اكتب|كتابة|أنشئ|انشئ|إنشئ|كوّن|كون|ابن|ابني|نفّذ|نفذ|تنفيذ|شغّل|شغل|تشغيل|طبّق|طبق|تطبيق|عدّل|عدل|تعديل|أصلح|اصلح|تصحيح|صحّح|صحح|اختبر|فحص|افحص|تحقق|استعرض|راجع|حلّل|حلل|تحليل|ابحث|اكتشف|استكشف|افتح|اقرأ|أرني|اعرض|أظهر|اظهر)/,
  // الإنجليزية — analysis, writing, and exploration verbs.
  /\b(write|create|build|generate|implement|execute|run|try|perform|apply|check|verify|demonstrate|show\s+me|read|list|search|find|scan|inspect|analyze|analyse|review|explore|investigate|examine|look\s+at|open|browse|fix|patch|edit|modify|test)\b/i,
];

/**
 * Imperative-execution patterns — subset of TOOL_EXECUTION_PATTERNS where the
 * user is commanding immediate action rather than asking a question or requesting
 * a description.
 *
 * Matched messages trigger "immediate execution mode" in the system prompt:
 * Rule 9 is replaced with a hard directive to skip any plan/description and
 * call tools as the very first output.
 *
 * Rules for inclusion:
 * - Must be a standalone imperative verb (or short phrase starting with one)
 * - Must NOT match vague exploratory phrasing ("tell me about", "how would I")
 * - Checked AFTER normalizing Arabic diacritics/punctuation
 */
function normalizeIntentText(message: string): string {
  return message
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^0-9A-Za-z\u0600-\u06FF\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requiresToolExecution(message: string): boolean {
  const normalized = normalizeIntentText(message);
  return TOOL_EXECUTION_PATTERNS.some((p) => p.test(normalized));
}


/**
 * Build the tool list for the active provider.
 *
 * Gemini's OpenAI-compatible shim currently returns 404 when tool payloads are
 * included, so we keep it in text-only mode and let it answer from context.
 * Other providers receive the full file + git tool suite.
 */
function buildProviderTools(provider: ProviderId, rootPath: string | undefined) {
  const policy = resolveToolPolicy({ provider, rootPath, mode: "workspace" });
  if (!policy.enabled) {
    console.warn(
      JSON.stringify({
        scope: "chat-agent",
        code: "TOOLS_DISABLED_FOR_PROVIDER",
        provider,
        reason: policy.reason ?? "tool policy denied access",
      }),
    );
    return undefined;
  }
  const tools = getAllowedToolDefinitions(policy);
  if (tools.length === 0) {
    console.warn(
      JSON.stringify({
        scope: "chat-agent",
        code: "TOOLS_DISABLED_FOR_PROVIDER",
        provider,
        reason: "tool policy produced no allowed tools",
      }),
    );
    return undefined;
  }
  return tools;
}

/**
 * Relevance-Ranked Context Focus Hint
 *
 * Parses entity names from the pre-built graphSummary string and scores them
 * against the query terms. Returns the top-5 most relevant entity names as a
 * one-line hint injected into the system prompt — guiding the model to start
 * with the most relevant entities instead of exploring randomly.
 *
 * This is intentionally lightweight (pure string ops, no extra DB/API calls)
 * and works on the already-built context string, so it has zero latency cost.
 */
const ARABIC_STOP = new Set([
  "في","من","إلى","على","هل","ما","ماذا","كيف","لماذا","متى","أين",
  "هذا","هذه","التي","الذي","و","أو","لا","لكن","إن","أن","أنا","أنت",
  "هو","هي","عن","مع","هذه","تلك","ذلك","هناك","هنا","أي","كل","بعض",
]);
const ENGLISH_STOP = new Set([
  "the","a","an","is","are","was","were","what","how","why","when","where",
  "can","could","would","should","in","on","at","to","for","of","with","by",
  "from","this","that","there","any","all","some","it","its","be","has","have",
]);

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s\u060C\u061F,.\-_/؟!?]+/)
    .map((t) => t.replace(/^['"'"`]+|['"'"`]+$/g, ""))
    .filter(
      (t) =>
        t.length >= 2 &&
        !ARABIC_STOP.has(t) &&
        !ENGLISH_STOP.has(t),
    );
}

function buildQueryFocusHint(graphSummary: string, message: string): string | null {
  if (!graphSummary || graphSummary.startsWith("Knowledge graph empty")) return null;

  // Parse entity names from the already-serialized graphSummary
  // Format: "  • EntityName <kind> (file.ts) [conf%] {domain} — description"
  const entityRe = /•\s+([\w\-.:/]+)/g;
  const entityNames: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = entityRe.exec(graphSummary)) !== null) {
    entityNames.push(m[1]);
  }
  if (entityNames.length === 0) return null;

  const queryTerms = tokenizeQuery(message);
  if (queryTerms.length === 0) return null;

  // Score each entity: name matches worth 3×, partial matches worth 1×
  const scored = entityNames
    .map((name) => {
      const lower = name.toLowerCase();
      const score = queryTerms.reduce((s, t) => {
        if (lower === t) return s + 5;           // exact match
        if (lower.includes(t)) return s + 3;    // name contains term
        return s;
      }, 0);
      return { name, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (scored.length === 0) return null;

  return `Entities most relevant to this query: ${scored.map((e) => e.name).join(", ")}`;
}

function normalizeAssistantText(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/```(?:json|text)?\s*([\s\S]*?)```/gi, "$1")
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Build the correction-call options used after a schema/JSON parse failure.
 *
 * OpenRouter free-tier models occasionally reject `response_format: json_object`
 * with HTTP 400 even though the same model can still answer correctly in plain
 * text. For that provider we keep the correction prompt but skip the hard
 * response-format constraint so recovery never becomes a hard failure.
 */
function buildJsonCorrectionOptions(provider: ProviderId, model: string, apiKey?: string): StrategyCallOptions {
  const base: StrategyCallOptions = {
    model,
    maxTokens: 4096,
    apiKey,
  };

  if (provider === "openrouter") {
    return base;
  }

  return {
    ...base,
    responseFormat: { type: "json_object" },
  };
}

function fallbackChatOutput(raw: string): ChatOutput {
  const normalized = normalizeAssistantText(raw);
  // If raw is valid JSON with a non-empty "response" field, extract it.
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "response" in parsed &&
      typeof (parsed as Record<string, unknown>).response === "string" &&
      ((parsed as Record<string, unknown>).response as string).length > 0
    ) {
      const sources = (parsed as Record<string, unknown>).sources;

      // PR-03: attempt to salvage any pendingChanges that individually pass
      // schema validation rather than silently collapsing the whole array to [].
      // Changes that fail the schema are logged so they can be diagnosed without
      // requiring a repro of the original model output.
      const rawChanges = (parsed as Record<string, unknown>).pendingChanges;
      const salvaged: PendingChange[] = [];
      if (Array.isArray(rawChanges)) {
        for (const pc of rawChanges) {
          const check = PendingChangeSchema.safeParse(pc);
          if (check.success) {
            salvaged.push(check.data);
          } else {
            console.warn(
              JSON.stringify({
                scope: "chat-agent",
                code: "PENDING_CHANGE_SCHEMA_FAIL",
                path: typeof pc === "object" && pc !== null ? (pc as Record<string, unknown>).path : undefined,
                issues: check.error.issues,
              }),
            );
          }
        }
      }

      const normalizedResponse = normalizeAssistantText((parsed as Record<string, unknown>).response as string);
      return {
        response: normalizedResponse || "I couldn't generate a response — please try again.",
        // BUG-3 fix: empty array instead of generic "project context" string.
        // Source discipline rule: if no specific citations exist, use [] not a fallback label.
        sources: Array.isArray(sources) ? sanitizeSources(sources as string[]) : [],
        pendingChanges: salvaged,
      };
    }
  } catch {
    // Not JSON — use the raw text as-is.
  }
  return {
    response: normalized || "I couldn't generate a response — please try again.",
    // BUG-3 fix: same — empty array, not a generic label.
    sources: [],
    pendingChanges: [],
  };
}

export async function chat(opts: {
  message: string;
  history: ChatMessage[];
  projectContext: ProjectContext;
  /** Absolute path to the project root on disk. Activates file-system tools when provided. */
  rootPath?: string;
  /**
   * The project ID from the database.  When provided and the project has a
   * completed scan (projectContext.metricsVerified = true), the query planner
   * will enrich its targetFiles list with paths from the knowledge graph.
   */
  projectId?: string;
  /** Optional per-user API key for the selected provider. */
  apiKey?: string;
  /** AI provider to use. Defaults to "groq". */
  provider?: "groq" | "deepseek" | "openrouter" | "gemini";
  /**
   * When provided, the final synthesis call uses streaming and each content
   * delta is yielded to this callback in real time.
   * Groq, DeepSeek, and OpenRouter all support SSE streaming via this path.
   * Pending-changes from tool calls are still returned normally.
   */
  onDelta?: (delta: string) => void;
  /**
   * GAP-A2: Called when the native SSE stream broke mid-flight and the agent
   * is falling back to the non-streaming result. The caller should signal the
   * client to discard any partial content before the full response arrives.
   * Only called when `onDelta` was provided AND at least one delta was emitted.
   */
  onStreamReset?: () => void;
  /**
   * Called at each observable step in the agentic tool loop — iteration start,
   * model call, each tool invocation and its result, soft limit, and loop done.
   * Forwarded directly to executeToolLoop; never throws.
   */
  onStep?: (step: AgentStep) => void;
}): Promise<ChatResult> {
  const { message, history, projectContext, rootPath, projectId, apiKey, provider = "groq", onDelta, onStreamReset, onStep } = opts;

  // ── Profile classification ────────────────────────────────────────────────
  // Pure sync — classifies the message into simple/code/architecture/workflow/
  // deep_analysis and derives context profile, history depth, and prefetch flag.
  const classification = classifyRequest(message);
  const { contextProfile, historyDepth, allowPrefetch } = classification;

  const executionPlan = resolveExecutionDecision(
    rootPath && requiresToolExecution(message) ? "task_execution" : "chat",
    {
      hasTools: !!rootPath,
      requireTools: !!rootPath && requiresToolExecution(message),
    },
  );
  const providerDecision = resolveExecutionProvider(executionPlan, provider);
  const providerId = providerDecision.providerId;
  const strategy = getStrategy(providerId);
  const modelDecision = resolveExecutionModel(providerId, executionPlan);

  const pendingChanges: PendingChange[] = [];

  /**
   * Deduplication cache shared between speculative-prefetch and the tool loop.
   * Seeded here with prefetch results so the engine never re-reads them.
   */
  const toolCallCache = new Map<string, string>();

  /** Ground-truth sources from speculative-prefetch (merged with engine sources later). */
  const prefetchSources: string[] = [];

  const tools = buildProviderTools(providerId, rootPath);

  // Use the more capable tier when explicit tool execution is requested.
  const model: string = (rootPath && requiresToolExecution(message)) ? modelDecision.powerModel : modelDecision.model;
  const powerModel = modelDecision.powerModel;

  // BUG-1 fix: pass `tools != null` (actual tool availability for THIS provider)
  // rather than `!!rootPath`. Gemini gets no tools even when rootPath is set,
  // so using rootPath caused the prompt to advertise file tools that never fired,
  // leading the model to hallucinate tool calls it cannot make.

  // ── Relevance focus hint ──────────────────────────────────────────────────
  // Score entities in the already-built context string against the query terms.
  // Result is a one-line hint injected into the system prompt so the model
  // starts with the most relevant entities instead of exploring randomly.
  const focusHint = buildQueryFocusHint(projectContext.graphSummary, message);

  // ── Profile-aware history windowing ──────────────────────────────────────
  // Keep only the most recent `historyDepth` turns verbatim. Older turns are
  // compressed into a single episode-summary system message so their topics
  // remain visible without bloating the context window.
  const recentHistory = history.slice(-historyDepth);
  const olderHistory  = history.length > historyDepth ? history.slice(0, -historyDepth) : [];

  const episodeSummaryMessage: RawMessage | null =
    olderHistory.length > 0
      ? {
          role: "system",
          content:
            `[Earlier conversation — ${olderHistory.length} turn(s) compressed]: ` +
            olderHistory
              .filter((m) => m.role === "user")
              .map((m) => m.content.slice(0, 60).replace(/\n/g, " "))
              .join("; "),
        }
      : null;

  const messages: RawMessage[] = [
    { role: "system", content: buildChatSystemPrompt(projectContext, tools != null, false, focusHint ?? undefined, contextProfile) },
    ...(episodeSummaryMessage ? [episodeSummaryMessage] : []),
    ...recentHistory.map((m): RawMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  // ── Speculative pre-fetch ─────────────────────────────────────────────────
  // Pre-read files explicitly mentioned in the query (e.g. "what's wrong with
  // auth.ts?") and inject as synthetic tool exchange messages so the model gets
  // the content in its first iteration without spending a real tool call.
  // Skipped for lite turns (allowPrefetch=false) and when the profile is lite.
  if (rootPath && tools != null && allowPrefetch) {
    const prefetch = await speculativePrefetch({
      message,
      rootPath,
      pendingChanges,
      toolCacheKeyFn: toolCacheKey,
      profileDepth: contextProfile,
    });

    if (prefetch.injectedMessages.length > 0) {
      // Inject synthetic reads right after the initial user message
      messages.push(...prefetch.injectedMessages);
      // Accumulate ground-truth sources from pre-fetched files
      prefetchSources.push(...prefetch.sources);
      // Seed dedup cache so the engine never re-reads these files
      for (const entry of prefetch.cacheEntries) {
        toolCallCache.set(entry.key, entry.content);
      }
    }
  }

  // ── Memory-seeded prefetch ────────────────────────────────────────────────
  // Parse file paths recorded in prior session memories and pre-load them so
  // the model starts with cached content on the first iteration instead of
  // spending real tool calls re-reading files it already analysed.
  //
  // File paths are embedded in projectContext.sessionMemories as bullet lines
  // of the form "  • <path>" by session-memory.ts#formatMemoriesForPrompt.
  if (rootPath && tools != null && projectContext.sessionMemories) {
    const memoryPaths: string[] = [];
    const bulletRe = /•\s+([\w\-./@]+\.[a-zA-Z]{2,8})/g;
    let bm: RegExpExecArray | null;
    while ((bm = bulletRe.exec(projectContext.sessionMemories)) !== null) {
      if (bm[1]) memoryPaths.push(bm[1]);
    }
    if (memoryPaths.length > 0) {
      const memPrefetch = await prefetchFileList({
        files: memoryPaths,
        rootPath,
        pendingChanges,
        toolCacheKeyFn: toolCacheKey,
      }).catch(() => ({
        injectedMessages: [] as typeof messages,
        sources: [] as string[],
        cacheEntries: [] as Array<{ key: string; content: string }>,
      }));
      if (memPrefetch.injectedMessages.length > 0) {
        messages.push(...memPrefetch.injectedMessages);
        prefetchSources.push(...memPrefetch.sources);
        for (const entry of memPrefetch.cacheEntries) {
          toolCallCache.set(entry.key, entry.content);
        }
      }
    }
  }

  // ── Query planner ─────────────────────────────────────────────────────────
  // A single fast-model call (≤ 5 s) that estimates the query's scope, which
  // files are most relevant, and how many iterations the tool loop will need.
  // This eliminates random exploration: the engine starts with the right files
  // pre-loaded and a budget matched to the actual complexity of the task.
  //
  // Research basis: arXiv:2511.02424 ReAcTree + arXiv:2504.16563 Global
  // Planning reduce tool calls by 40-65 % vs. pure ReAct.
  //
  // Failures (timeout, parse error, model error) silently return null so the
  // tool loop continues with base defaults — planning never blocks the request.
  let queryPlan: QueryPlan | null = null;
  if (tools != null && rootPath) {
    queryPlan = await planQuery({
      message,
      projectContext,
      model: modelDecision.model,
      strategy,
      apiKey: apiKey ?? undefined,
      projectId,
    }).catch(() => null);

    // Pre-seed the cache with files identified by the planner.
    // These are read in parallel before the tool loop starts, so the model
    // gets their content on the very first iteration — no tool call needed.
    if (queryPlan?.targetFiles.length) {
      const planPrefetch = await prefetchFileList({
        files: queryPlan.targetFiles,
        rootPath,
        pendingChanges,
        toolCacheKeyFn: toolCacheKey,
      }).catch(() => ({ injectedMessages: [] as typeof messages, sources: [] as string[], cacheEntries: [] as Array<{ key: string; content: string }> }));

      if (planPrefetch.injectedMessages.length > 0) {
        messages.push(...planPrefetch.injectedMessages);
        prefetchSources.push(...planPrefetch.sources);
        for (const entry of planPrefetch.cacheEntries) {
          toolCallCache.set(entry.key, entry.content);
        }
      }
    }
  }

  // ── Dynamic budget by task scope + planner hint ───────────────────────────
  // Base budget comes from the scope-keyed table; the planner's
  // suggestedIterations overrides when available (clamped to 5–40).
  // Broad-scope queries also get an expanded tool-call budget.
  const taskType = executionPlan.taskProfile.taskType;
  const baseBudget = BUDGET_BY_SCOPE[taskType as keyof typeof BUDGET_BY_SCOPE] ?? BUDGET_BY_SCOPE.tool_chat;
  const budget = queryPlan?.suggestedIterations
    ? {
        maxIterations: Math.min(Math.max(queryPlan.suggestedIterations, 5), 40),
        maxToolCalls: queryPlan.scopeEstimate === "broad"
          ? BUDGET_BY_SCOPE.task_execution.maxToolCalls
          : baseBudget.maxToolCalls,
      }
    : baseBudget;

  // ── Hierarchical execution for broad queries ──────────────────────────────
  // arXiv:2511.02424 ReAcTree: when the planner identifies ≥ 2 sub-queries,
  // each runs in its own bounded tool loop (maxIter = 7) so no single loop
  // exhausts its iteration budget on a codebase-wide question.
  // The final synthesiser pass combines all sub-results into one answer.
  // On any failure this block is skipped and the standard single-loop path
  // continues — broad queries never hard-fail.
  if (
    queryPlan?.scopeEstimate === "broad" &&
    queryPlan.subQueries.length >= 2 &&
    tools != null &&
    rootPath
  ) {
    try {
      const hierarchicalTasks = queryPlan.subQueries.map((q) => ({
        intent: q,
        targetPaths: queryPlan.targetFiles,
        maxIter: 7,
      }));

      const hierarchicalResult = await executeHierarchical(hierarchicalTasks, {
        systemPrompt: messages[0].content as string,
        strategy,
        model,
        powerModel,
        provider: providerId,
        apiKey: apiKey ?? undefined,
        tools,
        rootPath,
        pendingChanges,
        cache: toolCallCache,
      });

      const mergedSources = [
        ...prefetchSources,
        ...hierarchicalResult.toolSources,
      ];

      if (onDelta) {
        const words = hierarchicalResult.response.split(/(\s+)/);
        for (const chunk of words) {
          if (chunk) onDelta(chunk);
        }
      }

      return {
        response:
          hierarchicalResult.response ||
          "The analysis was too broad to complete. Try breaking your question into more specific parts.",
        sources: mergedSources,
        pendingChanges,
      };
    } catch (hierarchicalErr) {
      // Fall through to the standard single-loop path.
      console.warn(
        JSON.stringify({
          scope: "chat-agent",
          code: "HIERARCHICAL_EXECUTOR_FALLBACK",
          reason: hierarchicalErr instanceof Error ? hierarchicalErr.message : String(hierarchicalErr),
        }),
      );
    }
  }

  // ── Agentic tool loop ─────────────────────────────────────────────────────
  // Delegates iteration budget, per-call budget, cache keying, tool dispatch,
  // and model fallback to the self-contained ToolExecutionEngine.
  const loopResult = await executeToolLoop({
    messages,
    strategy,
    model,
    powerModel,
    provider: providerId,
    apiKey,
    tools,
    rootPath: rootPath ?? "",
    pendingChanges,
    cache: toolCallCache,
    maxIterations: budget.maxIterations,
    maxToolCalls:  budget.maxToolCalls,
    onStep,
  });

  // Merge prefetch sources with the engine's ground-truth sources.
  // Prefetch sources are prepended since they were resolved first.
  const toolSources = [...prefetchSources, ...loopResult.toolSources];

  // ── Exhausted with no text at all ────────────────────────────────────────
  // kind:"partial" falls through to the normal result-processing path below —
  // the model produced at least one text response (triggered by the soft-limit
  // synthesis hint) that we can surface as a useful answer.
  // Only the true kind:"exhausted" (zero text produced) gets the error message.
  if (loopResult.kind === "exhausted") {
    // Bilingual exhaustion message: detect Arabic by checking if the original
    // user message contains Arabic characters (Unicode block U+0600–U+06FF).
    const isArabic = /[\u0600-\u06FF]/.test(message);
    const exhaustionMessage = isArabic
      ? "وصلت إلى الحد الأقصى من خطوات التحليل ولم أتمكن من إنتاج إجابة كاملة. حاول طرح سؤال أكثر تحديداً."
      : "The analysis budget was exhausted before I could produce a complete answer. Try a more specific question.";
    return {
      response: exhaustionMessage,
      sources: toolSources.length > 0 ? toolSources : [],
      pendingChanges,
    };
  }

  // ── Final response from model (kind:"response" or kind:"partial") ─────────
  const result = loopResult.result;

  // STORY-04: capture actual model used — may differ from initial selection if
  // the fallback engine advanced to a different model mid-request.
  const resolvedModelInfo: ResolvedModelInfo | undefined = result.model
    ? { id: result.model, provider: providerId, free: providerId === "openrouter" }
    : undefined;

  // ── Streaming path ────────────────────────────────────────────────────────
  // When the caller provided an onDelta callback, stream the final response
  // so tokens arrive at the client in real time.
  //
  // Strategy:
  //   1. If the tool-loop callRaw already produced plain text content (common
  //      with OpenRouter free models that don't separate tool-use from the
  //      final synthesis), emit it via onDelta word-by-word and return early.
  //      This avoids a second network call which is slow, unreliable on free
  //      tiers, and rejected by many models when the history contains
  //      tool_calls messages but no `tools` parameter.
  //   2. Otherwise make a fresh streaming call (Groq / DeepSeek native SSE).
  if (onDelta) {
    // Strategy 1 — reuse the non-streaming result already in hand.
    // openrouter always uses this path; native providers fall through to SSE.
    const directContent = result.content;
    if (directContent && !strategy.supportsNativeStream) {
      // AI-01: Parse through the unified normalization path before emitting.
      // OpenRouter (and other non-Groq/DeepSeek providers) may return a JSON
      // envelope such as {"response":"...","sources":[...]} even in the
      // "direct content" path. Emitting that raw would expose the wrapper to
      // the UI and store it verbatim in the DB.  Passing through
      // parseAgentResponse strips the envelope and gives us the inner prose.
      // Use ChatOutputSchema (not the strict ChatResponseSchema) so that
      // parsedDirect.data.pendingChanges is typed and defaults to [] via Zod.
      // The model never writes pendingChanges itself — they come from the tool
      // loop — but using the full output schema keeps the type consistent with
      // the return value and avoids a TS2339 on .pendingChanges below.
      const parsedDirect = parseAgentResponse(directContent, ChatOutputSchema, fallbackChatOutput);
      const responseText =
        normalizeAssistantText(parsedDirect.data.response) ||
        normalizeAssistantText(directContent) ||
        "I couldn't generate a response — please try again.";

      // Emit only the clean prose text word-by-word.
      const words = responseText.split(/(\s+)/);
      for (const chunk of words) {
        if (chunk) onDelta(chunk);
      }

      // BUG-2 fix: sanitize model-reported sources before merging.
      const parsedSources = sanitizeSources(parsedDirect.ok ? parsedDirect.data.sources : []);
      const mergedSources =
        toolSources.length > 0
          ? [...toolSources, ...parsedSources.filter((s) => !toolSources.includes(s))]
          : parsedSources;

      // Prefer pending changes from parsed output (model may have proposed
      // writes inside the envelope); fall back to tool-loop accumulated ones.
      const parsedChanges = parsedDirect.ok ? (parsedDirect.data.pendingChanges ?? []) : [];
      const finalChanges = parsedChanges.length > 0 ? parsedChanges : pendingChanges;

      if (!parsedDirect.ok) {
        console.warn(
          JSON.stringify({
            scope: "chat-agent",
            code: "OPENROUTER_DIRECT_PARSE_FALLBACK",
            parseCode: parsedDirect.code,
            message: parsedDirect.message,
          }),
        );
      }

      return { response: responseText, sources: mergedSources, pendingChanges: finalChanges, resolvedModel: resolvedModelInfo };
    }

    // Strategy 2 — native SSE streaming (Groq / DeepSeek).
    // Replace system message with streaming-mode plain-markdown variant.
    const streamMessages = messages.map((m, i) =>
      i === 0 && m.role === "system"
        ? { ...m, content: buildChatSystemPrompt(projectContext, tools != null, /* streamingMode= */ true, focusHint ?? undefined, contextProfile) }
        : m,
    );

    let accumulated = "";
    try {
      const streamGen = strategy.stream(streamMessages, { model, apiKey });
      for await (const delta of streamGen) {
        accumulated += delta;
        onDelta(delta);
      }
    } catch (streamErr) {
      // Streaming failed — fall through to the non-streaming parse below.
      console.warn(
        JSON.stringify({ scope: "chat-agent", code: "STREAM_FALLBACK", provider: providerId, reason: String(streamErr) }),
      );
      // GAP-A2: If we already sent partial deltas to the caller, signal a
      // reset so the client can discard the incomplete bubble before the
      // full fallback response arrives in the return value below.
      if (accumulated && onStreamReset) {
        onStreamReset();
      }
      accumulated = "";
    }

    if (accumulated) {
      // BUG-2/BUG-3 fix: streaming path has no model-reported sources —
      // use only ground-truth toolSources (already clean); never fall back
      // to a generic label.
      const mergedSources = toolSources.length > 0 ? toolSources : [];
      return { response: accumulated.trim(), sources: mergedSources, pendingChanges, resolvedModel: resolvedModelInfo };
    }
    // Streaming failed — fall through to non-streaming path below.
  }
  // ── End streaming path ────────────────────────────────────────────────────

  let content = result.content ?? "";
  let parsed = parseAgentResponse(content, ChatResponseSchema, fallbackChatOutput);

  // JSON format correction: when MODEL_FAST ignores the JSON output instruction
  // (common with non-English responses), send one corrective follow-up that
  // shows the model its own answer and asks it to reformat.
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "chat-agent", code: parsed.code, message: parsed.message, action: "json_correction_retry" }));
    const correctionPrompt =
      "Your previous response was not valid JSON. " +
      "Reformat it as required — output ONLY a valid JSON object with this exact shape, " +
      "nothing before or after it:\n" +
      `{"response":"<your full answer as a markdown string>","sources":["<entity or metric cited>"]}`;
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: correctionPrompt });
    try {
      const retry = await strategy.call(messages, buildJsonCorrectionOptions(provider, model, apiKey));
      const retryContent = retry.content ?? "";
      const retryParsed = parseAgentResponse(retryContent, ChatResponseSchema, fallbackChatOutput);
      if (retryParsed.ok) {
        // Correction succeeded — use the reformatted response.
        parsed = retryParsed;
        content = retryContent;
      } else {
        // Correction also failed — the fallback already wraps raw text gracefully.
        console.warn(JSON.stringify({ scope: "chat-agent", code: "JSON_CORRECTION_FAILED", original: parsed.code, provider }));
      }
    } catch (err) {
      console.warn(JSON.stringify({
        scope: "chat-agent",
        code: "JSON_CORRECTION_RETRY_FAILED",
        provider,
        errorCode: err instanceof Error && "code" in err ? String((err as { code?: unknown }).code ?? "unknown") : "unknown",
        reason: err instanceof Error ? err.message : String(err),
      }));
      // Keep the original fallback output — correction is best-effort only.
    }
  }

  // PR-E: capture parse failure after all correction retries so the route can
  // surface it as 422 instead of silently returning degraded fallback content.
  let parseError: { code: AgentErrorCode; message: string; raw: string } | undefined;
  if (!parsed.ok) {
    parseError = { code: parsed.code, message: parsed.message, raw: parsed.raw };
  }

  // Merge ground-truth tool sources with model-reported sources.
  // Tool sources are prepended (they are factual); model sources follow and
  // are deduplicated so the model's entity/metric references are preserved
  // without repeating paths that are already in toolSources.
  // BUG-2 fix: sanitize model-reported sources before merging — removes
  // generic labels like "project name", "language", "branch", etc.
  const cleanModelSources = sanitizeSources(parsed.data.sources);
  const mergedSources =
    toolSources.length > 0
      ? [...toolSources, ...cleanModelSources.filter((s) => !toolSources.includes(s))]
      : cleanModelSources;

  const output = {
    ...parsed.data,
    sources: mergedSources,
    pendingChanges,
    resolvedModel: resolvedModelInfo,
  };
  const check = ChatOutputSchema.safeParse(output);
  if (!check.success) {
    // Attempt to salvage individual pending changes that fully satisfy
    // PendingChangeSchema (including the absolutePath.isAbsolute refinement
    // and the .strict() guard that rejects extra properties). This is more
    // precise than the previous manual type-checks, which passed a relative
    // absolutePath or an extra field through the salvage path despite the
    // schema forbidding both.
    const validChanges = pendingChanges.filter(
      (pc) => PendingChangeSchema.safeParse(pc).success,
    );
    console.error(
      JSON.stringify({
        scope: "chat-agent",
        code: "CHAT_OUTPUT_INVALID",
        issues: check.error.issues,
        totalChanges: pendingChanges.length,
        savedChanges: validChanges.length,
        droppedChanges: pendingChanges.length - validChanges.length,
      }),
    );
    return { ...parsed.data, sources: mergedSources, pendingChanges: validChanges, _parseError: parseError, resolvedModel: resolvedModelInfo };
  }
  return parseError ? { ...check.data, _parseError: parseError } : check.data;
}

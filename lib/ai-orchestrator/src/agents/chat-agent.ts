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
import { completeRaw, completeStream, MODEL_POWERFUL, MODEL_FAST } from "../groq-client.js";
import { deepseekCompleteRaw, deepseekCompleteStream } from "../deepseek-client.js";
import { openrouterCompleteRaw, geminiCompleteRaw } from "../openai-compatible-client.js";
import { PROVIDER_REGISTRY } from "../provider-registry.js";
import { GroqClientError } from "../errors.js";
import type { AgentErrorCode } from "../errors.js";
import type { RawMessage } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { buildChatSystemPrompt } from "../prompts/chat.prompt.js";
import { ChatResponseSchema, ChatOutputSchema, PendingChangeSchema, type ChatOutput, type PendingChange } from "../schemas/chat.schema.js";
import { parseAgentResponse } from "../parsing.js";
import { FILE_TOOL_DEFINITIONS, executeFileTool } from "../tools/file-tools.js";
import { GIT_TOOL_DEFINITIONS, executeGitTool } from "../tools/git-tools.js";
import { getAllowedToolDefinitions, resolveToolPolicy } from "../tool-policy.js";
import { speculativePrefetch } from "./speculative-prefetch.js";

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

const MAX_TOOL_ITERATIONS = 20;

/**
 * إصلاح #2 — اكتشاف نية التنفيذ الفعلي للأدوات.
 *
 * عندما يطلب المستخدم صراحةً تنفيذ شيء ("اختبر الأدوات"، "run the tests"...)،
 * نستخدم MODEL_POWERFUL بدلاً من MODEL_FAST لأن النموذج الأصغر يميل إلى
 * وصف الأدوات نظرياً بمسارات وهمية بدل استدعائها فعلياً (hallucination).
 */
const TOOL_EXECUTION_PATTERNS: RegExp[] = [
  // العربية: أفعال التنفيذ والاختبار والتحقق والتحليل والفحص والاستعراض
  /اختبر|نفّذ|نفذ|جرّب|جرب|شغّل|شغل|طبّق|طبق|ابدأ|أقرأ|اقرأ|اعرض|أظهر|افحص|تحقق|افعل|حلّل|حلل|تحليل|فحص|استعرض|راجع|أرني|ابحث|ابحث عن|اكتشف|استكشف/,
  // الإنجليزية — analysis and exploration verbs added
  /\b(test|execute|run|try|perform|apply|check|verify|demonstrate|show\s+me|read|list|search|find|scan|inspect|analyze|analyse|review|explore|investigate|examine|look\s+at|open|browse)\b/i,
];

function requiresToolExecution(message: string): boolean {
  return TOOL_EXECUTION_PATTERNS.some((p) => p.test(message));
}

/**
 * Build the tool list for the active provider.
 *
 * Gemini's OpenAI-compatible shim currently returns 404 when tool payloads are
 * included, so we keep it in text-only mode and let it answer from context.
 * Other providers receive the full file + git tool suite.
 */
function buildProviderTools(provider: keyof typeof PROVIDER_REGISTRY, rootPath: string | undefined) {
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
 * Hard cap on total tool executions per request (across all iterations).
 * Prevents a single model response from requesting unbounded tool calls.
 * Duplicate calls do not count against this budget — they are free.
 */
const MAX_TOOL_CALLS = 50;

/**
 * Canonical cache key for a tool call.
 * Object keys are sorted so argument order differences produce the same key:
 * { path: "a", content: "b" } ≡ { content: "b", path: "a" }
 */
function toolCacheKey(name: string, args: Record<string, string>): string {
  const sorted = Object.keys(args)
    .sort()
    .reduce<Record<string, string>>((acc, k) => {
      acc[k] = args[k];
      return acc;
    }, {});
  return `${name}:${JSON.stringify(sorted)}`;
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

function fallbackChatOutput(raw: string): ChatOutput {
  const trimmed = raw.trim();
  // If raw is valid JSON with a non-empty "response" field, extract it.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
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

      return {
        response: (parsed as Record<string, unknown>).response as string,
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
    response: trimmed || "I couldn't generate a response — please try again.",
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
}): Promise<ChatResult> {
  const { message, history, projectContext, rootPath, apiKey, provider = "groq", onDelta, onStreamReset } = opts;

  // Provider dispatch: complete-function references have distinct signatures so
  // they remain an explicit map. Model names come from PROVIDER_REGISTRY so
  // adding a new provider only requires a new entry there + one line below.
  const COMPLETE_FN_BY_PROVIDER = {
    groq:       completeRaw,
    deepseek:   deepseekCompleteRaw,
    openrouter: openrouterCompleteRaw,
    gemini:     geminiCompleteRaw,
  } as const satisfies Partial<Record<string, typeof completeRaw>>;
  const callRaw  = (COMPLETE_FN_BY_PROVIDER as Record<string, typeof completeRaw>)[provider] ?? completeRaw;
  const fastModel  = PROVIDER_REGISTRY[provider]?.defaultModels.fast     ?? MODEL_FAST;
  const powerModel = PROVIDER_REGISTRY[provider]?.defaultModels.powerful ?? MODEL_POWERFUL;

  const pendingChanges: PendingChange[] = [];

  /**
   * Ground-truth access log: file paths and search terms used during the
   * tool loop. Prepended to the model's self-reported sources on return so
   * the caller always receives a record of what was actually accessed.
   */
  const toolSources: string[] = [];

  /**
   * Deduplication cache: maps a canonical tool-call key to the result string
   * returned the first time it was executed. Subsequent identical calls get the
   * cached result without re-executing and without consuming the tool budget.
   */
  const toolCallCache = new Map<string, string>();

  /** Running count of tool executions that hit the real filesystem/grep. */
  let totalToolCalls = 0;

  const tools = buildProviderTools(provider, rootPath);

  // PR-02: build explicit name Sets from the authoritative definition arrays.
  // Replaces the startsWith("git_") prefix heuristic so any future tool whose
  // name happens to start with "git_" is not silently misrouted to the git
  // handler, and any unregistered name produces a loud error instead of falling
  // through to the file handler with undefined behaviour.
  const GIT_TOOL_NAMES  = new Set(GIT_TOOL_DEFINITIONS.map((t) => t.function.name));
  const FILE_TOOL_NAMES = new Set(FILE_TOOL_DEFINITIONS.map((t) => t.function.name));

  // Use the more capable model when tools are involved — smaller models are
  // unreliable at following multi-step tool-calling protocols.
  // Always use MODEL_FAST for the agentic chat loop — it handles multi-turn
  // tool calls well and has significantly higher Groq rate limits than the
  // powerful model, reducing 429 errors during the iterative tool-use phase.
  // MODEL_POWERFUL is reserved for single-shot tasks (code review, analysis)
  // that benefit from deeper reasoning but never loop.
  // نوع string الصريح يمنع TypeScript من تضييق القيمة إلى literal ثابت،
  // وهو ضروري لمقارنة model !== MODEL_POWERFUL عند fallback النموذج.
  // إصلاح #2: استخدم MODEL_POWERFUL عندما يطلب المستخدم تنفيذاً فعلياً للأدوات
  // (اختبر، نفّذ، run...) — يمنع MODEL_FAST من اختراع مسارات وهمية بدل قراءة الكود الحقيقي.
  const model: string = (rootPath && requiresToolExecution(message)) ? powerModel : fastModel;

  // BUG-1 fix: pass `tools != null` (actual tool availability for THIS provider)
  // rather than `!!rootPath`. Gemini gets no tools even when rootPath is set,
  // so using rootPath caused the prompt to advertise file tools that never fired,
  // leading the model to hallucinate tool calls it cannot make.

  // ── Relevance focus hint ──────────────────────────────────────────────────
  // Score entities in the already-built context string against the query terms.
  // Result is a one-line hint injected into the system prompt so the model
  // starts with the most relevant entities instead of exploring randomly.
  const focusHint = buildQueryFocusHint(projectContext.graphSummary, message);

  const messages: RawMessage[] = [
    { role: "system", content: buildChatSystemPrompt(projectContext, tools != null, false, focusHint ?? undefined) },
    ...history.slice(-10).map((m): RawMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  // ── Speculative pre-fetch ─────────────────────────────────────────────────
  // Pre-read files explicitly mentioned in the query (e.g. "what's wrong with
  // auth.ts?") and inject as synthetic tool exchange messages so the model gets
  // the content in its first iteration without spending a real tool call.
  if (rootPath && tools != null) {
    const prefetch = await speculativePrefetch({
      message,
      rootPath,
      pendingChanges,
      toolCacheKeyFn: toolCacheKey,
    });

    if (prefetch.injectedMessages.length > 0) {
      // Inject synthetic reads right after the initial user message
      messages.push(...prefetch.injectedMessages);
      // Seed ground-truth sources from pre-fetched files
      toolSources.push(...prefetch.sources);
      // Seed dedup cache so the loop never re-reads these files
      for (const entry of prefetch.cacheEntries) {
        toolCallCache.set(entry.key, entry.content);
      }
    }
  }

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    // إصلاح #1 و #2: timeout ممتد + fallback تلقائي إلى MODEL_POWERFUL عند NON_200 من MODEL_FAST.
    // llama-3.1-8b-instant يفشل أحياناً بـNON_200 تحت حِمل tool-use ثقيل؛
    // إعادة المحاولة بالنموذج الأقوى تُنقذ الطلب بدل إرجاع 502 للمستخدم.
    let result: Awaited<ReturnType<typeof completeRaw>>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = await (callRaw as any)(messages, { model, maxTokens: 4096, timeoutMs: 60_000, apiKey, ...(tools != null ? { tools } : {}) });
    } catch (err) {
      if (err instanceof GroqClientError && err.code === "NON_200" && model !== powerModel) {
        console.warn(
          JSON.stringify({ scope: "chat-agent", code: "MODEL_FALLBACK", from: model, to: powerModel, provider, iter, reason: err.message }),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await (callRaw as any)(messages, { model: powerModel, maxTokens: 4096, timeoutMs: 60_000, apiKey, ...(tools != null ? { tools } : {}) });
      } else {
        console.warn(
          JSON.stringify({ scope: "chat-agent", code: "MODEL_ERROR", provider, model, iter, errorCode: err instanceof GroqClientError ? err.code : "unknown", reason: err instanceof Error ? err.message : String(err) }),
        );
        throw err;
      }
    }

    // Model wants to call one or more tools → execute them and loop.
    if (result.toolCalls && result.toolCalls.length > 0) {
      // Add the assistant turn (with tool_calls) to the conversation history.
      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const tc of result.toolCalls) {
        let args: Record<string, string> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, string>;
        } catch {
          // Malformed arguments — leave args empty; the handler returns an
          // informative error string that the model can reason about.
        }

        // ── Guard 1: budget ──────────────────────────────────────────────────
        // Duplicates are checked next and are free, so we only enforce the
        // budget for fresh executions. Check budget BEFORE the cache so that
        // a budget-exhausted request can still benefit from a cached result.
        const key = toolCacheKey(tc.function.name, args);
        const cached = toolCallCache.get(key);

        if (cached !== undefined) {
          // ── Guard 2: deduplication ─────────────────────────────────────────
          // Identical call seen before — return cached result at no cost.
          // إصلاح #4: نُعلم النموذج صراحةً أن هذه النتيجة مخزّنة مسبقاً حتى
          // لا يتوهم أنه لم يتلقَّ ردًّا ويعيد طلب نفس الأداة مجدداً.
          console.warn(
            JSON.stringify({
              scope: "chat-agent",
              code: "DUPLICATE_TOOL_CALL",
              tool: tc.function.name,
              iter,
            }),
          );
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `[cached — identical call already executed this request]\n${cached}`,
          });
          continue;
        }

        if (totalToolCalls >= MAX_TOOL_CALLS) {
          // Budget exhausted for fresh calls. Tell the model to stop calling
          // tools and synthesize its answer from what it already has.
          console.warn(
            JSON.stringify({
              scope: "chat-agent",
              code: "TOOL_CALL_LIMIT_REACHED",
              tool: tc.function.name,
              iter,
              totalToolCalls,
            }),
          );
          const budgetMsg =
            "Tool call budget exhausted for this request. " +
            "Synthesize your answer from the information already gathered — do not call further tools.";
          messages.push({ role: "tool", tool_call_id: tc.id, content: budgetMsg });
          continue;
        }

        // PR-02: registry assertion — reject names that don't match any
        // registered handler before touching the tool budget counter.
        const isGitTool  = GIT_TOOL_NAMES.has(tc.function.name);
        const isFileTool = FILE_TOOL_NAMES.has(tc.function.name);
        if (!isGitTool && !isFileTool) {
          console.error(
            JSON.stringify({
              scope: "chat-agent",
              code: "UNKNOWN_TOOL",
              tool: tc.function.name,
              iter,
              knownGit:  [...GIT_TOOL_NAMES],
              knownFile: [...FILE_TOOL_NAMES],
            }),
          );
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Error: Tool "${tc.function.name}" is not registered — use one of the tools listed in the system prompt.`,
          });
          continue;
        }

        // ── Execute ──────────────────────────────────────────────────────────
        totalToolCalls++;
        const output = isGitTool
          ? await executeGitTool(tc.function.name, args, rootPath!)
          : await executeFileTool(tc.function.name, args, rootPath!, pendingChanges);

        // Cache result for deduplication on future iterations.
        toolCallCache.set(key, output);

        // Record ground-truth sources for file reads and searches.
        // write_file is not a read source — it produces a pending change.
        switch (tc.function.name) {
          case "read_file":
            if (args.path) toolSources.push(args.path);
            break;
          case "list_directory":
            toolSources.push(`directory: ${args.path ?? "."}`);
            break;
          case "search_code":
            if (args.pattern) toolSources.push(`search: ${args.pattern}`);
            break;
          case "git_status":
            toolSources.push("git:status");
            break;
          case "git_diff":
            toolSources.push(args.path ? `git:diff:${args.path}` : "git:diff");
            break;
          case "git_log":
            toolSources.push("git:log");
            break;
        }

        messages.push({ role: "tool", tool_call_id: tc.id, content: output });
      }

      continue; // send enriched history back to the model
    }

    // No tool calls — this is the final response.

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
      if (directContent && (provider === "openrouter" || !["groq", "deepseek"].includes(provider))) {
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
        const responseText = parsedDirect.data.response.trim() || directContent.trim();

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

        return { response: responseText, sources: mergedSources, pendingChanges: finalChanges };
      }

      // Strategy 2 — native SSE streaming (Groq / DeepSeek).
      // Replace system message with streaming-mode plain-markdown variant.
      const streamMessages = messages.map((m, i) =>
        i === 0 && m.role === "system"
          ? { ...m, content: buildChatSystemPrompt(projectContext, tools != null, /* streamingMode= */ true, focusHint ?? undefined) }
          : m,
      );

      let accumulated = "";
      try {
        const streamGen =
          provider === "deepseek"
            ? deepseekCompleteStream(streamMessages, { model, apiKey: apiKey! })
            : completeStream(streamMessages, { model, apiKey });
        for await (const delta of streamGen) {
          accumulated += delta;
          onDelta(delta);
        }
      } catch (streamErr) {
        // Streaming failed — fall through to the non-streaming parse below.
        console.warn(
          JSON.stringify({ scope: "chat-agent", code: "STREAM_FALLBACK", provider, reason: String(streamErr) }),
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
        return { response: accumulated.trim(), sources: mergedSources, pendingChanges };
      }
      // Streaming failed — fall through to non-streaming path below.
    }
    // ── End streaming path ────────────────────────────────────────────────────

    let content = result.content ?? "";
    let parsed = parseAgentResponse(content, ChatResponseSchema, fallbackChatOutput);

    // JSON format correction: when MODEL_FAST ignores the JSON output instruction
    // (common with non-English responses), send one corrective follow-up that
    // shows the model its own answer and asks it to reformat — without making
    // another full tool loop iteration (iter budget is shared).
    if (!parsed.ok && iter < MAX_TOOL_ITERATIONS - 1) {
      console.warn(JSON.stringify({ scope: "chat-agent", code: parsed.code, message: parsed.message, action: "json_correction_retry" }));
      const correctionPrompt =
        "Your previous response was not valid JSON. " +
        "Reformat it as required — output ONLY a valid JSON object with this exact shape, " +
        "nothing before or after it:\n" +
        `{"response":"<your full answer as a markdown string>","sources":["<entity or metric cited>"]}`;
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: correctionPrompt });
      try {
        // إصلاح #3: response_format: json_object يُجبر النموذج على إرجاع JSON صالح.
        // Use provider-aware `callRaw` (not the hardcoded `completeRaw`) so that
        // DeepSeek correction calls hit api.deepseek.com with the DeepSeek key
        // instead of failing with AUTH_ERROR against Groq's endpoint.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retry = await (callRaw as any)(messages, {
          model,
          maxTokens: 4096,
          apiKey,
          responseFormat: { type: "json_object" },
        });
        const retryContent = retry.content ?? "";
        const retryParsed = parseAgentResponse(retryContent, ChatResponseSchema, fallbackChatOutput);
        if (retryParsed.ok) {
          // Correction succeeded — use the reformatted response.
          parsed = retryParsed;
          content = retryContent;
        } else {
          // Correction also failed — the fallback already wraps raw text gracefully.
          console.warn(JSON.stringify({ scope: "chat-agent", code: "JSON_CORRECTION_FAILED", original: parsed.code }));
        }
      } catch {
        // Groq error during correction — keep the original fallback output.
      }
    } else if (!parsed.ok) {
      console.warn(JSON.stringify({ scope: "chat-agent", code: parsed.code, message: parsed.message }));
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
      return { ...parsed.data, sources: mergedSources, pendingChanges: validChanges, _parseError: parseError };
    }
    return parseError ? { ...check.data, _parseError: parseError } : check.data;
  }

  // Exhausted iterations without a final text response.
  console.warn(
    JSON.stringify({ scope: "chat-agent", code: "TOOL_LOOP_EXHAUSTED", iterations: MAX_TOOL_ITERATIONS }),
  );
  // Bilingual exhaustion message: detect Arabic by checking if the original user
  // message contains Arabic characters (Unicode block U+0600–U+06FF).
  const isArabic = /[\u0600-\u06FF]/.test(message);
  const exhaustionMessage = isArabic
    ? "وصلت إلى الحد الأقصى من خطوات الأدوات. حاول طرح سؤال أكثر تحديداً أو تقسيمه إلى أجزاء أصغر."
    : "I reached the maximum number of tool steps. Try asking a more specific question or break it into smaller parts.";
  return {
    response: exhaustionMessage,
    // Use accumulated tool sources rather than the generic "tool-loop" string
    // so the caller retains a record of what was actually accessed.
    sources: toolSources.length > 0 ? toolSources : [],
    pendingChanges,
  };
}

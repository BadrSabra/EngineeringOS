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
import { completeRaw, MODEL_POWERFUL, MODEL_FAST } from "../groq-client.js";
import { deepseekCompleteRaw, DEEPSEEK_MODEL_FAST, DEEPSEEK_MODEL_POWERFUL } from "../deepseek-client.js";
import { GroqClientError } from "../errors.js";
import type { AgentErrorCode } from "../errors.js";
import type { RawMessage } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { buildChatSystemPrompt } from "../prompts/chat.prompt.js";
import { ChatResponseSchema, ChatOutputSchema, PendingChangeSchema, type ChatOutput, type PendingChange } from "../schemas/chat.schema.js";
import { parseAgentResponse } from "../parsing.js";
import { FILE_TOOL_DEFINITIONS, executeFileTool } from "../tools/file-tools.js";
import { GIT_TOOL_DEFINITIONS, executeGitTool } from "../tools/git-tools.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type { ChatOutput };

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed after all correction retries,
 * the route surfaces `_parseError` as HTTP 422 instead of a silent 200
 * with degraded fallback content.
 */
export type ChatResult = ChatOutput & {
  _parseError?: { code: AgentErrorCode; message: string; raw: string };
};

const MAX_TOOL_ITERATIONS = 12;

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
 * Hard cap on total tool executions per request (across all iterations).
 * Prevents a single model response from requesting unbounded tool calls.
 * Duplicate calls do not count against this budget — they are free.
 */
const MAX_TOOL_CALLS = 25;

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
        sources: Array.isArray(sources) ? (sources as string[]) : ["project context"],
        pendingChanges: salvaged,
      };
    }
  } catch {
    // Not JSON — use the raw text as-is.
  }
  return {
    response: trimmed || "I couldn't generate a response — please try again.",
    sources: ["project context"],
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
  provider?: "groq" | "deepseek";
}): Promise<ChatResult> {
  const { message, history, projectContext, rootPath, apiKey, provider = "groq" } = opts;

  // Route to the correct client + model constants based on provider.
  const callRaw     = provider === "deepseek" ? deepseekCompleteRaw : completeRaw;
  const fastModel   = provider === "deepseek" ? DEEPSEEK_MODEL_FAST    : MODEL_FAST;
  const powerModel  = provider === "deepseek" ? DEEPSEEK_MODEL_POWERFUL : MODEL_POWERFUL;

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

  const tools = rootPath ? [...FILE_TOOL_DEFINITIONS, ...GIT_TOOL_DEFINITIONS] : undefined;

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

  const messages: RawMessage[] = [
    { role: "system", content: buildChatSystemPrompt(projectContext, !!rootPath) },
    ...history.slice(-10).map((m): RawMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    // إصلاح #1 و #2: timeout ممتد + fallback تلقائي إلى MODEL_POWERFUL عند NON_200 من MODEL_FAST.
    // llama-3.1-8b-instant يفشل أحياناً بـNON_200 تحت حِمل tool-use ثقيل؛
    // إعادة المحاولة بالنموذج الأقوى تُنقذ الطلب بدل إرجاع 502 للمستخدم.
    let result: Awaited<ReturnType<typeof completeRaw>>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = await (callRaw as any)(messages, { model, maxTokens: 4096, timeoutMs: 60_000, apiKey, tools });
    } catch (err) {
      if (err instanceof GroqClientError && err.code === "NON_200" && model !== powerModel) {
        console.warn(
          JSON.stringify({ scope: "chat-agent", code: "MODEL_FALLBACK", from: model, to: powerModel, provider, iter }),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await (callRaw as any)(messages, { model: powerModel, maxTokens: 4096, timeoutMs: 60_000, apiKey, tools });
      } else {
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
        // إصلاح #3: response_format: json_object يُجبر Groq على إرجاع JSON صالح.
        // مقبول هنا لأن طلب التصحيح لا يحمل tools (متبادلان حصريًا على Groq).
        const retry = await completeRaw(messages, {
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
    const mergedSources =
      toolSources.length > 0
        ? [...toolSources, ...parsed.data.sources.filter((s) => !toolSources.includes(s))]
        : parsed.data.sources;

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

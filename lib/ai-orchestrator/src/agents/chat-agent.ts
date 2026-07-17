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
 *   MAX_TOOL_ITERATIONS (6)
 *     Bounds the number of model API calls. On exhaustion the agent returns a
 *     best-effort answer with whatever sources and pending changes accumulated.
 *
 *   MAX_TOOL_CALLS (10)
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
import type { RawMessage } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { buildChatSystemPrompt } from "../prompts/chat.prompt.js";
import { ChatResponseSchema, type ChatOutput, type PendingChange } from "../schemas/chat.schema.js";
import { parseAgentResponse } from "../parsing.js";
import { FILE_TOOL_DEFINITIONS, executeFileTool } from "../tools/file-tools.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type { ChatOutput };

const MAX_TOOL_ITERATIONS = 6;
/**
 * Hard cap on total tool executions per request (across all iterations).
 * Prevents a single model response from requesting unbounded tool calls.
 * Duplicate calls do not count against this budget — they are free.
 */
const MAX_TOOL_CALLS = 10;

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
      return {
        response: (parsed as Record<string, unknown>).response as string,
        sources: Array.isArray(sources) ? (sources as string[]) : ["project context"],
      };
    }
  } catch {
    // Not JSON — use the raw text as-is.
  }
  return {
    response: trimmed || "I couldn't generate a response — please try again.",
    sources: ["project context"],
  };
}

export async function chat(opts: {
  message: string;
  history: ChatMessage[];
  projectContext: ProjectContext;
  /** Absolute path to the project root on disk. Activates file-system tools when provided. */
  rootPath?: string;
  /** Optional per-user Groq API key. Falls back to process.env.GROQ_API_KEY. */
  apiKey?: string;
}): Promise<ChatOutput> {
  const { message, history, projectContext, rootPath, apiKey } = opts;

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

  const tools = rootPath ? FILE_TOOL_DEFINITIONS : undefined;
  // Use the more capable model when tools are involved — smaller models are
  // unreliable at following multi-step tool-calling protocols.
  const model = rootPath ? MODEL_POWERFUL : MODEL_FAST;

  const messages: RawMessage[] = [
    { role: "system", content: buildChatSystemPrompt(projectContext) },
    ...history.slice(-10).map((m): RawMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const result = await completeRaw(messages, { model, maxTokens: 4096, apiKey, tools });

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
          // Identical call seen before — return the cached result at no cost.
          // This short-circuits stuck loops (model re-reading the same file)
          // and prevents duplicate pendingChanges entries for write_file.
          console.warn(
            JSON.stringify({
              scope: "chat-agent",
              code: "DUPLICATE_TOOL_CALL",
              tool: tc.function.name,
              iter,
            }),
          );
          messages.push({ role: "tool", tool_call_id: tc.id, content: cached });
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

        // ── Execute ──────────────────────────────────────────────────────────
        totalToolCalls++;
        const output = await executeFileTool(tc.function.name, args, rootPath!, pendingChanges);

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
        }

        messages.push({ role: "tool", tool_call_id: tc.id, content: output });
      }

      continue; // send enriched history back to the model
    }

    // No tool calls — this is the final response.
    const content = result.content ?? "";
    const parsed = parseAgentResponse(content, ChatResponseSchema, fallbackChatOutput);
    if (!parsed.ok) {
      console.warn(JSON.stringify({ scope: "chat-agent", code: parsed.code, message: parsed.message }));
    }

    // Merge ground-truth tool sources with model-reported sources.
    // Tool sources are prepended (they are factual); model sources follow and
    // are deduplicated so the model's entity/metric references are preserved
    // without repeating paths that are already in toolSources.
    const mergedSources =
      toolSources.length > 0
        ? [...toolSources, ...parsed.data.sources.filter((s) => !toolSources.includes(s))]
        : parsed.data.sources;

    return {
      ...parsed.data,
      sources: mergedSources,
      ...(pendingChanges.length > 0 ? { pendingChanges } : {}),
    };
  }

  // Exhausted iterations without a final text response.
  console.warn(
    JSON.stringify({ scope: "chat-agent", code: "TOOL_LOOP_EXHAUSTED", iterations: MAX_TOOL_ITERATIONS }),
  );
  return {
    response:
      "I reached the maximum number of tool steps. Try asking a more specific question or break it into smaller parts.",
    // Use accumulated tool sources rather than the generic "tool-loop" string
    // so the caller retains a record of what was actually accessed.
    sources: toolSources.length > 0 ? toolSources : ["tool-loop"],
    ...(pendingChanges.length > 0 ? { pendingChanges } : {}),
  };
}

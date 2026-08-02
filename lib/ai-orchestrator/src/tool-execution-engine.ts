/**
 * ToolExecutionEngine — self-contained agentic tool loop.
 *
 * Extracts the complete tool-calling machinery from chat-agent.ts so it can
 * be tested and evolved independently of any specific agent or prompt.
 *
 * Two public surfaces:
 *
 *   executeSingleTool(opts)
 *     Dispatches one tool call by name to the correct handler (file-tools or
 *     git-tools), enforces the registry, and returns the output string plus
 *     an optional ground-truth source label.  Unknown tool names are returned
 *     as an error result — never thrown.
 *
 *   executeToolLoop(opts)
 *     Runs the full agentic loop: calls the model, processes any tool calls
 *     it requests (via executeSingleTool), appends results to the message
 *     history, and repeats until the model emits a non-tool response or the
 *     iteration / call budgets are exhausted.
 *
 * Budget rules (same as the original inline loop):
 *   maxIterations  — caps the number of model API calls.  On exhaustion the
 *                    caller receives kind:"exhausted" and constructs its own
 *                    fallback response.
 *   maxToolCalls   — caps real (non-cached) tool executions across all
 *                    iterations.  Once reached, subsequent fresh calls get a
 *                    canned "budget exhausted" string so the model can still
 *                    synthesise an answer from what it already has.
 *   cache          — a Map<key, result> shared with the speculative-prefetch
 *                    layer.  Duplicate calls hit the cache for free (no budget
 *                    consumed, no re-execution).
 */

import { GroqClientError } from "./errors.js";
import type { RawMessage, RawGroqResponse } from "./groq-client.js";
import type { ProviderStrategy } from "./provider-strategy.js";
import type { ToolDefinitionLike } from "./tool-policy.js";
import type { PendingChange } from "./schemas/chat.schema.js";
import { FILE_TOOL_DEFINITIONS, executeFileTool } from "./tools/file-tools.js";
import { GIT_TOOL_DEFINITIONS, executeGitTool } from "./tools/git-tools.js";

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_ITERATIONS = 20;
export const DEFAULT_MAX_TOOL_CALLS = 50;

// ── Registry ──────────────────────────────────────────────────────────────────

// Built once from the authoritative definition arrays.  Any name not in one
// of these sets is an unknown tool and is rejected before touching the budget.
const GIT_TOOL_NAMES = new Set(GIT_TOOL_DEFINITIONS.map((t) => t.function.name));
const FILE_TOOL_NAMES = new Set(FILE_TOOL_DEFINITIONS.map((t) => t.function.name));

// ── Cache key ─────────────────────────────────────────────────────────────────

/**
 * Canonical cache key for a tool call.
 *
 * Object keys are sorted so argument-order differences produce the same key:
 *   { path: "a", content: "b" } ≡ { content: "b", path: "a" }
 *
 * Exported so the speculative-prefetch layer can seed the same cache without
 * duplicating the keying logic.
 */
export function toolCacheKey(name: string, args: Record<string, string>): string {
  const sorted = Object.keys(args)
    .sort()
    .reduce<Record<string, string>>((acc, k) => {
      acc[k] = args[k];
      return acc;
    }, {});
  return `${name}:${JSON.stringify(sorted)}`;
}

// ── Single tool execution ─────────────────────────────────────────────────────

export type SingleToolOpts = {
  /** Registered tool name (e.g. "read_file", "git_status"). */
  name: string;
  /** Parsed arguments from the model's tool_call.function.arguments. */
  args: Record<string, string>;
  /** Absolute path to the project root — required for path containment. */
  rootPath: string;
  /** Accumulated pending changes array — mutated in place by write_file. */
  pendingChanges: PendingChange[];
};

export type SingleToolResult =
  | {
      kind: "ok";
      /** Raw text output of the tool, forwarded as the tool-role message. */
      output: string;
      /**
       * Ground-truth source label, if this call reads observable state.
       * write_file produces no source — it queues a pending change instead.
       */
      source?: string;
    }
  | {
      kind: "unknown_tool";
      /** Human-readable error forwarded to the model as the tool message. */
      errorMessage: string;
    };

/**
 * Execute a single tool call by name.
 *
 * Routing:
 *   - Names in GIT_TOOL_NAMES   → executeGitTool
 *   - Names in FILE_TOOL_NAMES  → executeFileTool
 *   - Anything else             → unknown_tool (not thrown)
 *
 * Source labels are produced for read operations only (read_file,
 * list_directory, search_code, git_status, git_diff, git_log).
 * write_file never produces a source — it mutates pendingChanges instead.
 */
export async function executeSingleTool(opts: SingleToolOpts): Promise<SingleToolResult> {
  const { name, args, rootPath, pendingChanges } = opts;

  const isGitTool = GIT_TOOL_NAMES.has(name);
  const isFileTool = FILE_TOOL_NAMES.has(name);

  if (!isGitTool && !isFileTool) {
    return {
      kind: "unknown_tool",
      errorMessage: `Tool "${name}" is not registered — use one of the tools listed in the system prompt.`,
    };
  }

  const output = isGitTool
    ? await executeGitTool(name, args, rootPath)
    : await executeFileTool(name, args, rootPath, pendingChanges);

  // Ground-truth source label for observable reads.
  let source: string | undefined;
  switch (name) {
    case "read_file":
      if (args.path) source = args.path;
      break;
    case "list_directory":
      source = `directory: ${args.path ?? "."}`;
      break;
    case "search_code":
      if (args.pattern) source = `search: ${args.pattern}`;
      break;
    case "git_status":
      source = "git:status";
      break;
    case "git_diff":
      source = args.path ? `git:diff:${args.path}` : "git:diff";
      break;
    case "git_log":
      source = "git:log";
      break;
  }

  return { kind: "ok", output, source };
}

// ── Tool loop ─────────────────────────────────────────────────────────────────

export type ToolLoopOpts = {
  /**
   * Conversation messages — mutated in place.
   * The loop appends assistant (with tool_calls) and tool-result messages.
   * The caller owns the initial system + user messages.
   */
  messages: RawMessage[];

  /** Provider strategy used for model API calls. */
  strategy: ProviderStrategy;

  /**
   * Model identifier used for tool-calling iterations.
   * When the strategy returns NON_200 from this model, the loop automatically
   * retries once with powerModel before propagating the error.
   */
  model: string;

  /** More capable fallback model used on NON_200 from model. */
  powerModel: string;

  /** Provider name used only for structured log attribution. */
  provider: string;

  /** Optional per-user API key forwarded to every strategy.call(). */
  apiKey?: string;

  /**
   * Tool definitions passed to the model.  undefined means tools are
   * disabled for this provider/mode and the loop will return on the very
   * first iteration (the model never emits tool_calls without definitions).
   */
  tools: ToolDefinitionLike[] | undefined;

  /**
   * Absolute path to the project root.  Required for executeSingleTool but
   * never touched when tools is undefined.  Pass "" when rootPath is absent.
   */
  rootPath: string;

  /** Accumulated pending changes — mutated in place by write_file calls. */
  pendingChanges: PendingChange[];

  /**
   * Deduplication cache — keyed by toolCacheKey().
   *
   * Pass the same Map instance seeded by speculativePrefetch so pre-fetched
   * files are never re-read.  When omitted a fresh empty Map is used.
   */
  cache?: Map<string, string>;

  /** Maximum number of model API calls (default: DEFAULT_MAX_ITERATIONS = 20). */
  maxIterations?: number;

  /** Maximum real (non-cached) tool executions (default: DEFAULT_MAX_TOOL_CALLS = 50). */
  maxToolCalls?: number;
};

export type ToolLoopResult =
  | {
      kind: "response";
      /** Raw model response — contains content but no tool_calls. */
      result: RawGroqResponse;
      /** Ground-truth file/search/git accesses accumulated during the loop. */
      toolSources: string[];
    }
  | {
      kind: "exhausted";
      /** Ground-truth accesses accumulated before exhaustion. */
      toolSources: string[];
    };

/**
 * Run the full agentic tool loop until the model stops requesting tools or
 * a budget is hit.
 *
 * The loop:
 *   1. Calls the model with the current message history + tool definitions.
 *   2. If the model returns tool_calls: for each call —
 *        a. Cache hit  → serve cached result (free, no budget).
 *        b. Budget hit → serve canned "exhausted" string (no execution).
 *        c. Unknown    → serve error string (no budget consumed).
 *        d. Execute via executeSingleTool, cache result, record source.
 *      Append all results to messages and loop.
 *   3. If the model returns no tool_calls: return kind:"response".
 *   4. If maxIterations exhausted without a text response: return kind:"exhausted".
 *
 * NON_200 from model: retried once with powerModel before re-throwing.
 * Other errors: re-thrown immediately.
 */
export async function executeToolLoop(opts: ToolLoopOpts): Promise<ToolLoopResult> {
  const {
    messages,
    strategy,
    model,
    powerModel,
    provider,
    apiKey,
    tools,
    rootPath,
    pendingChanges,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
  } = opts;

  const toolCallCache = opts.cache ?? new Map<string, string>();
  const toolSources: string[] = [];
  let totalToolCalls = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    // ── Model call (with NON_200 fallback to powerModel) ────────────────────
    let result: RawGroqResponse;
    try {
      result = await strategy.call(messages, {
        model,
        maxTokens: 4096,
        timeoutMs: 60_000,
        apiKey,
        ...(tools != null ? { tools } : {}),
      });
    } catch (err) {
      if (err instanceof GroqClientError && err.code === "NON_200" && model !== powerModel) {
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "MODEL_FALLBACK",
            from: model,
            to: powerModel,
            provider,
            iter,
            reason: err.message,
          }),
        );
        result = await strategy.call(messages, {
          model: powerModel,
          maxTokens: 4096,
          timeoutMs: 60_000,
          apiKey,
          ...(tools != null ? { tools } : {}),
        });
      } else {
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "MODEL_ERROR",
            provider,
            model,
            iter,
            errorCode: err instanceof GroqClientError ? err.code : "unknown",
            reason: err instanceof Error ? err.message : String(err),
          }),
        );
        throw err;
      }
    }

    // ── No tool calls → final response ──────────────────────────────────────
    if (!result.toolCalls || result.toolCalls.length === 0) {
      return { kind: "response", result, toolSources };
    }

    // ── Append assistant turn with tool_calls ────────────────────────────────
    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls,
    });

    // ── Dispatch each requested tool call ────────────────────────────────────
    for (const tc of result.toolCalls) {
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, string>;
      } catch {
        // Malformed arguments — leave args empty; handler returns an error string.
      }

      const key = toolCacheKey(tc.function.name, args);
      const cached = toolCallCache.get(key);

      // Guard 1: Cache hit — identical call, return cached result for free.
      if (cached !== undefined) {
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
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

      // Guard 2: Budget exhausted for fresh calls.
      if (totalToolCalls >= maxToolCalls) {
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "TOOL_CALL_LIMIT_REACHED",
            tool: tc.function.name,
            iter,
            totalToolCalls,
          }),
        );
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "Tool call budget exhausted for this request. " +
            "Synthesize your answer from the information already gathered — do not call further tools.",
        });
        continue;
      }

      // Guard 3: Registry check + dispatch via executeSingleTool.
      const toolResult = await executeSingleTool({ name: tc.function.name, args, rootPath, pendingChanges });

      if (toolResult.kind === "unknown_tool") {
        console.error(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "UNKNOWN_TOOL",
            tool: tc.function.name,
            iter,
            knownGit: [...GIT_TOOL_NAMES],
            knownFile: [...FILE_TOOL_NAMES],
          }),
        );
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: ${toolResult.errorMessage}`,
        });
        continue;
      }

      // Successful execution — consume budget, cache, record source.
      totalToolCalls++;
      toolCallCache.set(key, toolResult.output);
      if (toolResult.source) toolSources.push(toolResult.source);
      messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult.output });
    }
  }

  // Iteration budget exhausted without a text response.
  console.warn(
    JSON.stringify({
      scope: "tool-execution-engine",
      code: "TOOL_LOOP_EXHAUSTED",
      iterations: maxIterations,
    }),
  );
  return { kind: "exhausted", toolSources };
}

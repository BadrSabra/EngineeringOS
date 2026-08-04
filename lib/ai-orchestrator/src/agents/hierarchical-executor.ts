/**
 * Hierarchical Executor — ReAcTree-inspired decomposed tool loop.
 *
 * When the query planner labels a request as "broad" and produces ≥ 2
 * sub-queries, running them all in a single giant tool loop reliably
 * exhausts the iteration budget before producing a useful answer.
 *
 * This module solves that by giving each sub-query its own small, bounded
 * tool loop (maxIter = 5–8), then running a final synthesis pass that
 * combines all partial results into one coherent answer.  No single loop
 * ever runs out of budget, and partial results are preserved even if one
 * sub-loop hits its limit.
 *
 * Research basis:
 *   arXiv:2511.02424 ReAcTree — hierarchical task decomposition before execution.
 *   arXiv:2504.16563 — Global Planning + Hierarchical Execution reduces tool
 *     calls by 40-65 % vs. pure ReAct.
 *
 * Out of scope (future work):
 *   - Recursive nesting (sub-queries spawning their own sub-queries).
 *   - Parallel sub-loop execution (serial keeps the implementation simple
 *     and avoids rate-limit collisions on free-tier providers).
 *   - Per-sub-query SSE streaming.
 */

import type { ProviderStrategy } from "../provider-strategy.js";
import type { ToolDefinitionLike } from "../tool-policy.js";
import type { PendingChange } from "../schemas/chat.schema.js";
import type { RawMessage } from "../groq-client.js";
import { executeToolLoop } from "../tool-execution-engine.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single focused unit of work in the hierarchical plan.
 *
 * Produced by mapping each SubQuery from the query planner into a
 * HierarchicalTask before passing to executeHierarchical.
 */
export type HierarchicalTask = {
  /** The focused sub-question this task must answer. */
  intent: string;
  /** File paths from the planner's targetFiles, pre-seeded in the shared cache. */
  targetPaths: string[];
  /** Per-task iteration budget (recommended: 5–8). */
  maxIter: number;
};

export type HierarchicalExecutorOpts = {
  /** System prompt already built for this request — reused verbatim per sub-task. */
  systemPrompt: string;
  strategy: ProviderStrategy;
  model: string;
  powerModel: string;
  provider: string;
  apiKey?: string;
  /** Tool definitions as given to the main agent (may be undefined for Gemini). */
  tools: ToolDefinitionLike[] | undefined;
  /** Absolute project root path. */
  rootPath: string;
  /** Shared pending-changes array — mutated in place by write_file tool calls. */
  pendingChanges: PendingChange[];
  /**
   * Shared deduplication cache, pre-seeded by speculative-prefetch.
   * All sub-loops read from and write to the same cache so repeated file
   * reads across tasks are served for free.
   */
  cache: Map<string, string>;
  /** Max real tool calls per sub-task (default: 20). */
  maxToolCallsPerTask?: number;
};

export type HierarchicalResult = {
  /** Final synthesised answer — suitable for returning directly to the caller. */
  response: string;
  /** Deduplicated union of all tool sources accessed across all sub-loops. */
  toolSources: string[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOOL_CALLS_PER_TASK = 20;
const SYNTHESIS_MAX_TOKENS = 4_096;
const SYNTHESIS_TIMEOUT_MS = 60_000;

// ── Internal helpers ──────────────────────────────────────────────────────────

type SubResult = {
  intent: string;
  text: string;
  toolSources: string[];
};

/**
 * Run a single sub-task tool loop and return the text output plus sources.
 * Never throws — errors are caught and logged; a placeholder string is
 * returned so the synthesis pass still has something to work with.
 */
async function runSubTask(
  task: HierarchicalTask,
  opts: HierarchicalExecutorOpts,
): Promise<SubResult> {
  const { systemPrompt, strategy, model, powerModel, provider, apiKey, tools, rootPath, pendingChanges, cache } = opts;
  const maxToolCalls = opts.maxToolCallsPerTask ?? DEFAULT_MAX_TOOL_CALLS_PER_TASK;

  const taskMessages: RawMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task.intent },
  ];

  try {
    const loopResult = await executeToolLoop({
      messages: taskMessages,
      strategy,
      model,
      powerModel,
      provider,
      apiKey,
      tools,
      rootPath,
      pendingChanges,
      cache,
      maxIterations: task.maxIter,
      maxToolCalls,
    });

    const text =
      loopResult.kind === "response" || loopResult.kind === "partial"
        ? (loopResult.result.content ?? "")
        : `[Analysis for "${task.intent}" — iteration budget exhausted before a complete answer was produced]`;

    return { intent: task.intent, text, toolSources: loopResult.toolSources };
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "hierarchical-executor",
        code: "SUBTASK_ERROR",
        intent: task.intent.slice(0, 100),
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      intent: task.intent,
      text: `[Analysis for "${task.intent}" encountered an error]`,
      toolSources: [],
    };
  }
}

/**
 * Build the user turn that is passed to the synthesis model call.
 * Includes all sub-results separated by section headers so the model can
 * cite specific findings rather than hallucinating.
 */
function buildSynthesisUserTurn(subResults: SubResult[]): string {
  const sections = subResults
    .map((r, i) => `## Sub-analysis ${i + 1}: ${r.intent}\n\n${r.text}`)
    .join("\n\n---\n\n");

  return (
    `Here are the results of each sub-analysis:\n\n${sections}\n\n` +
    `Synthesize these into one clear, comprehensive answer. ` +
    `Cite specific findings. Do not call any tools.`
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Execute a hierarchical (multi-loop) plan for a broad query.
 *
 * Algorithm:
 *   1. For each HierarchicalTask, run executeToolLoop with task.maxIter as
 *      the per-task budget.  Tasks run in series.
 *   2. Collect {text, toolSources} from every sub-loop.  Partial results
 *      (kind:"exhausted") are preserved as a placeholder string so the
 *      synthesis pass still has context.
 *   3. Run one final synthesis call (no tools, text-only) that receives all
 *      sub-results and returns a single cohesive answer.
 *   4. Deduplicate toolSources across all sub-loops and return them alongside
 *      the synthesised response.
 *
 * Always resolves — synthesis errors fall back to a plain concatenation of
 * sub-results.  Callers should also wrap the entire call in a try/catch and
 * fall back to the standard single-loop path if executeHierarchical itself
 * throws (though it is designed not to).
 */
export async function executeHierarchical(
  tasks: HierarchicalTask[],
  opts: HierarchicalExecutorOpts,
): Promise<HierarchicalResult> {
  // ── 1. Run each sub-task sequentially ────────────────────────────────────
  const subResults: SubResult[] = [];
  for (const task of tasks) {
    const sub = await runSubTask(task, opts);
    subResults.push(sub);

    console.info(
      JSON.stringify({
        scope: "hierarchical-executor",
        code: "SUBTASK_COMPLETE",
        intent: task.intent.slice(0, 100),
        sourceCount: sub.toolSources.length,
        textLength: sub.text.length,
      }),
    );
  }

  // ── 2. Deduplicate all sources ────────────────────────────────────────────
  const allSources = subResults.flatMap((r) => r.toolSources);
  const uniqueSources = [...new Set(allSources)];

  // ── 3. Synthesis call (no tools) ─────────────────────────────────────────
  const synthesisMessages: RawMessage[] = [
    {
      role: "system",
      content:
        "You are a synthesis agent. A broad user query was decomposed into focused sub-analyses. " +
        "Your job is to combine those sub-analysis results into a single, coherent, comprehensive answer. " +
        "Be concise but thorough. Cite specific findings from the sub-analyses. " +
        "Do NOT call any tools — this is a text-only synthesis pass.",
    },
    {
      role: "user",
      content: buildSynthesisUserTurn(subResults),
    },
  ];

  let synthesisText = "";
  try {
    const synthesisResult = await opts.strategy.call(synthesisMessages, {
      model: opts.model,
      maxTokens: SYNTHESIS_MAX_TOKENS,
      timeoutMs: SYNTHESIS_TIMEOUT_MS,
      apiKey: opts.apiKey,
      // Intentionally no `tools` — synthesis is text-only
    });
    synthesisText = synthesisResult.content ?? "";
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "hierarchical-executor",
        code: "SYNTHESIS_ERROR",
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
    // Fallback: join sub-results directly so the caller always gets something useful.
    synthesisText = subResults
      .map((r) => `**${r.intent}**\n\n${r.text}`)
      .join("\n\n---\n\n");
  }

  console.info(
    JSON.stringify({
      scope: "hierarchical-executor",
      code: "HIERARCHICAL_COMPLETE",
      taskCount: tasks.length,
      uniqueSourceCount: uniqueSources.length,
      synthesisLength: synthesisText.length,
    }),
  );

  return {
    response: synthesisText,
    toolSources: uniqueSources,
  };
}

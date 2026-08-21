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
 *   - Per-sub-query SSE streaming.
 */

import type { ProviderStrategy } from "../provider-strategy.js";
import type { ToolDefinitionLike } from "../tool-policy.js";
import type { PendingChange } from "../schemas/chat.schema.js";
import type { RawMessage } from "../groq-client.js";
import { executeToolLoop } from "../tool-execution-engine.js";
import type { CompoundQueryPart } from "./query-planner.js";

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
  /** Per-task iteration budget (recommended: 6–10). */
  maxIter: number;
  /**
   * Read-only tasks may share a scheduling wave because they cannot enqueue
   * pending writes. Write-capable tasks remain conservative unless their
   * targetPaths provide a known, disjoint scope.
   */
  readOnly?: boolean;
};

export type HierarchicalExecutorOpts = {
  /** System prompt already built for this request — reused verbatim per sub-task. */
  systemPrompt: string;
  strategy: ProviderStrategy;
  model: string;
  powerModel: string;
  provider: string;
  apiKey?: string;
  signal?: AbortSignal;
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
  /** Max real tool calls per sub-task (default: 30). */
  maxToolCallsPerTask?: number;
  /** Maximum number of compatible sub-tasks in one scheduling wave. */
  maxParallelTasks?: number;
  /** Optional coverage contract for a compound question. */
  compoundParts?: CompoundQueryPart[];
};

export type SourceEvidence = {
  file: string;
  excerpt: string;
  startLine: number;
  endLine: number;
};

export type HierarchicalResult = {
  /** Final synthesised answer — suitable for returning directly to the caller. */
  response: string;
  /** Deduplicated union of all tool sources accessed across all sub-loops. */
  toolSources: string[];
  /** Bodies returned by completed read tools, never planner hints. */
  sourceEvidence: SourceEvidence[];
  coverage?: CompoundSynthesisValidation;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOOL_CALLS_PER_TASK = 30;
const DEFAULT_MAX_PARALLEL_TASKS = 3;
const SYNTHESIS_MAX_TOKENS = 4_096;
const SYNTHESIS_TIMEOUT_MS = 60_000;
const WRITE_TOOL_NAMES = new Set(["write_file", "replace_text", "run_validation"]);

// ── Internal helpers ──────────────────────────────────────────────────────────

type SubResult = {
  intent: string;
  text: string;
  toolSources: string[];
  sourceEvidence: SourceEvidence[];
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
  const { systemPrompt, strategy, model, powerModel, provider, apiKey, tools, rootPath, pendingChanges, cache, signal } = opts;
  const maxToolCalls = opts.maxToolCallsPerTask ?? DEFAULT_MAX_TOOL_CALLS_PER_TASK;
  const taskTools = task.readOnly
    ? tools?.filter((tool) => !WRITE_TOOL_NAMES.has(tool.function.name))
    : tools;

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
       tools: taskTools,
      rootPath,
      pendingChanges,
      cache,
      maxIterations: task.maxIter,
      maxToolCalls,
      signal,
    });

    const text =
      loopResult.kind === "response" || loopResult.kind === "partial"
        ? (loopResult.result.content ?? "")
        : `[Analysis for "${task.intent}" — iteration budget exhausted before a complete answer was produced]`;

    const sourceEvidence: SourceEvidence[] = Array.from(loopResult.fileContents ?? new Map<string, string>()).map(([file, content]) => {
      const raw = content
        .replace(/^File:\s*[^\n]+\n```[^\n]*\n/u, "")
        .replace(/\n```\s*$/u, "")
        .trim();
      const excerpt = raw.slice(0, 4_000);
      return {
        file,
        excerpt,
        startLine: 1,
        endLine: Math.max(1, excerpt.split("\n").length),
      };
    });
    return { intent: task.intent, text, toolSources: loopResult.toolSources, sourceEvidence };
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
      sourceEvidence: [],
    };
  }
}

function normalizedScope(paths: readonly string[]): Set<string> {
  return new Set(paths
    .map((file) => file.trim().replace(/^\.\/+/, "").replace(/\\/g, "/"))
    .filter(Boolean));
}

function scopesOverlap(left: Set<string>, right: Set<string>): boolean {
  for (const file of left) {
    if (right.has(file)) return true;
  }
  return false;
}

/**
 * Build a bounded scheduling wave without allowing unknown write scopes to run
 * together. Read-only tasks have no write scope by contract.
 */
function takeSchedulingWave(
  pending: readonly HierarchicalTask[],
  maxParallelTasks: number,
): { wave: HierarchicalTask[]; rest: HierarchicalTask[] } {
  const wave: HierarchicalTask[] = [];
  const reservedScopes: Set<string>[] = [];
  const rest: HierarchicalTask[] = [];

  for (const task of pending) {
    if (wave.length >= maxParallelTasks) {
      rest.push(task);
      continue;
    }

    const scope = task.readOnly ? new Set<string>() : normalizedScope(task.targetPaths);
    const unknownWriteScope = !task.readOnly && scope.size === 0;
    const conflicts = unknownWriteScope || reservedScopes.some((reserved) =>
      scopesOverlap(scope, reserved) ||
      (reserved.size === 0 && !task.readOnly),
    );

    if (conflicts) {
      rest.push(task);
      continue;
    }

    wave.push(task);
    reservedScopes.push(scope);
  }

  // Unknown or overlapping scopes still make progress, but only alone.
  if (wave.length === 0 && pending.length > 0) {
    return { wave: [pending[0]], rest: pending.slice(1) };
  }

  return { wave, rest };
}

/**
 * Build the user turn that is passed to the synthesis model call.
 * Includes all sub-results separated by section headers so the model can
 * cite specific findings rather than hallucinating.
 */
function buildSynthesisUserTurn(
  subResults: SubResult[],
  compoundParts: CompoundQueryPart[] = [],
): string {
  const sections = subResults
    .map((r, i) => `## Sub-analysis ${i + 1}: ${r.intent}\n\n${r.text}`)
    .join("\n\n---\n\n");
  const evidence = [...new Map(
    subResults.flatMap((r) => r.sourceEvidence)
      .map((item) => [`${item.file}:${item.startLine}:${item.endLine}`, item]),
  ).values()];
  const evidenceManifest = evidence.length > 0
    ? evidence.map((item) =>
      `- ${item.file}:${item.startLine}-${item.endLine}\n  ${item.excerpt}`,
    ).join("\n")
    : "(No completed source body was returned by a read tool.)";
  const coverage = compoundParts.length > 0
    ? compoundParts.map((part) =>
      `- ${part.id} (${part.kind})${part.requiredCount ? ` — exactly ${part.requiredCount} items` : ""}: ${part.question}`,
    ).join("\n")
    : "(No explicit compound coverage contract.)";

  return (
    `Original compound-question coverage contract:\n${coverage}\n\n` +
    `Verified source evidence (only these read bodies may be cited):\n${evidenceManifest}\n\n` +
    `Here are the results of each sub-analysis:\n\n${sections}\n\n` +
    `Synthesize every requested part without dropping any part. ` +
    `Classify each material statement as FACT (حقيقة مؤكدة), INFERENCE (استنتاج), or PROPOSAL (اقتراح/أولوية). ` +
    `Every FACT and every PROPOSAL must cite a file and line range from the verified source evidence manifest. ` +
    `An INFERENCE must be labeled as such and must not be stated as a fact. ` +
    `If a part has no supporting read evidence, write NOT PROVEN / غير مثبت for that part; do not replace it with generic advice. ` +
    `Honor exact requested counts. Do not call any tools.`
  );
}

export type CompoundSynthesisValidation = {
  valid: boolean;
  missingPartIds: string[];
  invalidCitations: string[];
  violations: string[];
};

export function validateCompoundSynthesis(
  response: string,
  parts: readonly CompoundQueryPart[],
  sourceEvidence: readonly SourceEvidence[],
): CompoundSynthesisValidation {
  const lower = response.toLocaleLowerCase();
  const knownFiles = new Set(sourceEvidence.map((item) => item.file.replace(/^\.\/+/, "")));
  const missingPartIds = parts
    .filter((part) => !lower.includes(part.id.toLocaleLowerCase()) &&
      !lower.includes(part.kind.toLocaleLowerCase()) &&
      !(
        (part.kind === "FEATURES" && /feature|ميزة|وظيف/iu.test(response)) ||
        (part.kind === "GAPS" && /gap|فجوة|ثغر|نقص/iu.test(response)) ||
        (part.kind === "PRIORITIES" && /priorit|أولوية|أولويات/iu.test(response)) ||
        (part.kind === "CURRENT_STATE" && /current|حالي|موجود/iu.test(response))
      ))
    .map((part) => part.id);
  const citedFiles = [
    ...[...response.matchAll(
      /`((?:\.{0,2}\/|lib\/|src\/|artifacts\/|packages\/)[\w.@/-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|rb|sql|md|json|yaml|yml|toml))`/g,
    )].map((match) => match[1]!),
    ...[...response.matchAll(
      /(?<![\w/@.`])((?:\.{0,2}\/|lib\/|src\/|artifacts\/|packages\/)[\w.@/-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|rb|sql|md|json|yaml|yml|toml))/g,
    )].map((match) => match[1]!),
  ].map((file) => file.replace(/^\.\/+/, ""));
  const invalidCitations = citedFiles.filter((file) => !knownFiles.has(file));
  const violations: string[] = [];
  if (missingPartIds.length > 0) violations.push(`missing compound parts: ${missingPartIds.join(", ")}`);
  if (invalidCitations.length > 0) violations.push(`citations are not completed reads: ${invalidCitations.join(", ")}`);
  if (parts.some((part) => part.requiresCitation) && citedFiles.length === 0) {
    violations.push("compound claims contain no citation to a completed source read");
  }
  if (parts.some((part) => part.requiresCitation) && sourceEvidence.length === 0) {
    violations.push("compound claims have no completed source evidence");
  }
  return { valid: violations.length === 0, missingPartIds, invalidCitations, violations };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Execute a hierarchical (multi-loop) plan for a broad query.
 *
 * Algorithm:
 *   1. Schedule compatible HierarchicalTasks in bounded waves. Read-only tasks
 *      may run together; write-capable tasks require known disjoint scopes.
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
  // ── 1. Run compatible sub-task waves ───────────────────────────────────────
  const subResults: SubResult[] = [];
  let pendingTasks = [...tasks];
  const maxParallelTasks = Math.max(
    1,
    Math.min(opts.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS, 8),
  );
  while (pendingTasks.length > 0) {
    const { wave, rest } = takeSchedulingWave(pendingTasks, maxParallelTasks);
    pendingTasks = rest;
    console.info(JSON.stringify({
      scope: "hierarchical-executor",
      code: "SCHEDULING_WAVE_STARTED",
      taskCount: wave.length,
      maxParallelTasks,
      readOnlyTasks: wave.filter((task) => task.readOnly).length,
    }));

    const waveResults = await Promise.all(wave.map((task) => runSubTask(task, opts)));
    for (const [index, sub] of waveResults.entries()) {
      const task = wave[index];
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
  }

  // ── 2. Deduplicate all sources ────────────────────────────────────────────
  const allSources = subResults.flatMap((r) => r.toolSources);
  const uniqueSources = [...new Set(allSources)];
  const sourceEvidence = [...new Map(
    subResults.flatMap((r) => r.sourceEvidence)
      .map((item) => [`${item.file}:${item.startLine}:${item.endLine}`, item]),
  ).values()];

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
      content: buildSynthesisUserTurn(subResults, opts.compoundParts),
    },
  ];

  let synthesisText = "";
  try {
    const synthesisResult = await opts.strategy.call(synthesisMessages, {
      model: opts.model,
      maxTokens: SYNTHESIS_MAX_TOKENS,
      timeoutMs: SYNTHESIS_TIMEOUT_MS,
      apiKey: opts.apiKey,
      ...(opts.signal ? { signal: opts.signal } : {}),
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

  const coverage = opts.compoundParts?.length
    ? validateCompoundSynthesis(synthesisText, opts.compoundParts, sourceEvidence)
    : undefined;
  return {
    response: synthesisText,
    toolSources: uniqueSources,
    sourceEvidence,
    ...(coverage ? { coverage } : {}),
  };
}

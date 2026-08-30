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
import { stripReadFileWrapper } from "../tools/file-tools.js";
import type { CompoundQueryPart } from "./query-planner.js";
import type { ExecutionLedger } from "../execution-ledger.js";

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
  executionLedger?: ExecutionLedger;
};

export type SourceEvidence = {
  file: string;
  excerpt: string;
  startLine: number;
  endLine: number;
  truncated?: boolean;
  taskIndex?: number;
};

export type HierarchicalSubtaskStatus =
  | "complete"
  | "partial"
  | "failed"
  | "cancelled"
  | "exhausted";

export type HierarchicalSubtaskReceipt = {
  taskIndex: number;
  intent: string;
  status: HierarchicalSubtaskStatus;
  reason?: string;
  tool?: string;
  failureKind?: string;
  diagnosticCode?: string;
  text?: string;
  toolSources: string[];
  sourceEvidence: SourceEvidence[];
};

export type HierarchicalResult = {
  /** Final synthesised answer — suitable for returning directly to the caller. */
  response: string;
  /** Deduplicated union of all tool sources accessed across all sub-loops. */
  toolSources: string[];
  /** Bodies returned by completed read tools, never planner hints. */
  sourceEvidence: SourceEvidence[];
  receipts: HierarchicalSubtaskReceipt[];
  status: "complete" | "partial" | "failed" | "cancelled";
  synthesisStatus: "complete" | "failed" | "skipped";
  coverage?: CompoundSynthesisValidation;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOOL_CALLS_PER_TASK = 30;
const DEFAULT_MAX_PARALLEL_TASKS = 3;
const SYNTHESIS_MAX_TOKENS = 4_096;
const SYNTHESIS_TIMEOUT_MS = 60_000;
const WRITE_TOOL_NAMES = new Set(["write_file", "replace_text", "run_validation"]);

// ── Internal helpers ──────────────────────────────────────────────────────────

type SubResult = HierarchicalSubtaskReceipt;

/**
 * Run a single sub-task tool loop and return the text output plus sources.
 * Never throws — errors are caught and logged; a placeholder string is
 * returned so the synthesis pass still has something to work with.
 */
async function runSubTask(
  task: HierarchicalTask,
  taskIndex: number,
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
  const targetedRanges = new Map<string, { startLine: number; requestedEndLine: number }>();

  try {
    if (opts.executionLedger && !opts.executionLedger.admit("hierarchical_task", {
      provider,
      model,
      operation: `subtask:${taskIndex}`,
    })) {
      return {
        taskIndex,
        intent: task.intent,
        status: opts.executionLedger.signal.aborted ? "cancelled" : "exhausted",
        reason: "aggregate_request_budget_exhausted",
        toolSources: [],
        sourceEvidence: [],
      };
    }
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
      executionLedger: opts.executionLedger,
      onStep: (step) => {
        if (step.kind !== "tool_call" || step.tool !== "read_file_range") return;
        const path = step.args.path;
        const startLine = Number(step.args.start_line);
        const requestedEndLine = Number(step.args.end_line);
        if (
          path &&
          Number.isInteger(startLine) &&
          startLine > 0 &&
          Number.isInteger(requestedEndLine) &&
          requestedEndLine >= startLine
        ) {
          targetedRanges.set(path, { startLine, requestedEndLine });
        }
      },
    });

    const status: HierarchicalSubtaskStatus =
      loopResult.kind === "response" ? "complete" :
        loopResult.kind === "partial" ? "partial" :
          loopResult.kind === "exhausted" || loopResult.kind === "stopped" || loopResult.kind === "incomplete"
            ? "exhausted" :
              loopResult.kind === "cancelled" ? "cancelled" : "failed";
    const sourceEvidence: SourceEvidence[] = Array.from(loopResult.fileContents ?? new Map<string, string>()).map(([file, content]) => {
      const raw = stripReadFileWrapper(content);
      const excerpt = raw.slice(0, 4_000);
      const range = targetedRanges.get(file);
      const lineCount = Math.max(1, excerpt.split("\n").length);
      return {
        file,
        excerpt,
        startLine: range?.startLine ?? 1,
        endLine: range ? Math.min(range.requestedEndLine, range.startLine + lineCount - 1) : lineCount,
        truncated: excerpt.length < raw.length || Boolean(range && range.requestedEndLine > range.startLine + lineCount - 1),
        taskIndex,
      };
    });
    const text = "result" in loopResult && loopResult.result?.content
      ? loopResult.result.content
      : undefined;
    return {
      taskIndex,
      intent: task.intent,
      status,
      ...(loopResult.kind === "failed"
        ? {
            tool: loopResult.tool,
            failureKind: loopResult.failureKind,
            diagnosticCode: loopResult.diagnosticCode,
          }
        : {}),
      ...(loopResult.kind === "incomplete" || loopResult.kind === "exhausted" || loopResult.kind === "stopped"
        ? { reason: loopResult.reason }
        : {}),
      ...(text ? { text } : {}),
      toolSources: loopResult.toolSources,
      sourceEvidence,
    };
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
      taskIndex,
      intent: task.intent,
      status: "failed",
      reason: "subtask_exception",
      diagnosticCode: "SUBTASK_EXCEPTION",
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
    .map((r, i) => {
      const outcome = r.text && (r.status === "complete" || r.status === "partial")
        ? r.text
        : "(No candidate findings; this receipt is diagnostic only.)";
      return `## Sub-analysis ${i + 1}: ${r.intent}\nSTATUS: ${r.status}\nOUTCOME:\n${outcome}`;
    })
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
    `Here are the results of each sub-analysis. FAILED, CANCELLED, and EXHAUSTED ` +
    `statuses and reasons are diagnostic context only and cannot support a FACT:\n\n${sections}\n\n` +
    `Synthesize every requested part without dropping any part. ` +
    `Classify each material statement as FACT (حقيقة مؤكدة), INFERENCE (استنتاج), or PROPOSAL (اقتراح/أولوية). ` +
    `Every FACT and every PROPOSAL must cite a file and line range from the verified source evidence manifest. ` +
    `An INFERENCE must be labeled as such and must not be stated as a fact. ` +
    `If a part has no supporting read evidence, write NOT PROVEN / غير مثبت for that part; do not replace it with generic advice. ` +
    `Honor exact requested counts. Do not call any tools.`
  );
}

function aggregateStatus(receipts: readonly HierarchicalSubtaskReceipt[]): HierarchicalResult["status"] {
  if (receipts.length === 0) return "failed";
  if (receipts.some((receipt) => receipt.status === "cancelled")) return "cancelled";
  if (receipts.some((receipt) => receipt.status === "failed")) return "failed";
  if (receipts.some((receipt) => receipt.status === "partial" || receipt.status === "exhausted")) return "partial";
  return "complete";
}

function cancelledReceipt(task: HierarchicalTask, taskIndex: number): HierarchicalSubtaskReceipt {
  return {
    taskIndex,
    intent: task.intent,
    status: "cancelled",
    reason: "cancelled_before_start",
    toolSources: [],
    sourceEvidence: [],
  };
}

function isAbortRequested(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export type CompoundSynthesisValidation = {
  valid: boolean;
  missingPartIds: string[];
  invalidCitations: string[];
  violations: string[];
};

export type SynthesisSafetyValidation = {
  valid: boolean;
  violations: string[];
};

/**
 * Validate the synthesis boundary independently of the model's wording.
 * Diagnostics from failed receipts are not evidence, and citations must point
 * to an evidence window owned by a non-failed receipt.
 */
export function validateSynthesisSafety(
  response: string,
  receipts: readonly HierarchicalSubtaskReceipt[],
  sourceEvidence: readonly SourceEvidence[],
): SynthesisSafetyValidation {
  const violations: string[] = [];
  const evidenceByFile = new Map<string, SourceEvidence[]>();
  for (const item of sourceEvidence) {
    const key = item.file.replace(/^\.\/+/, "");
    evidenceByFile.set(key, [...(evidenceByFile.get(key) ?? []), item]);
  }
  const citedFiles = [
    ...[...response.matchAll(
      /`((?:\.{0,2}\/|lib\/|src\/|artifacts\/|packages\/)[\w.@/-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|rb|sql|md|json|yaml|yml|toml))`/g,
    )].map((match) => match[1]!),
    ...[...response.matchAll(
      /(?<![\w/@.`])((?:\.{0,2}\/|lib\/|src\/|artifacts\/|packages\/)[\w.@/-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|rb|sql|md|json|yaml|yml|toml))/g,
    )].map((match) => match[1]!),
  ].map((file) => file.replace(/^\.\/+/, ""));
  for (const file of citedFiles) {
    const windows = evidenceByFile.get(file) ?? [];
    if (windows.length === 0) {
      violations.push(`citation is not a retained source window: ${file}`);
      continue;
    }
    if (windows.every((window) => {
      const receipt = window.taskIndex === undefined
        ? undefined
        : receipts.find((candidate) => candidate.taskIndex === window.taskIndex);
      return receipt?.status === "failed" || receipt?.status === "cancelled" || receipt?.status === "exhausted";
    })) {
      violations.push(`citation belongs only to an incomplete subtask: ${file}`);
    }
  }
  const lower = response.toLocaleLowerCase();
  for (const receipt of receipts) {
    if (
      receipt.status !== "complete" &&
      receipt.status !== "partial" &&
      receipt.intent.trim() &&
      lower.includes(receipt.intent.toLocaleLowerCase()) &&
      /\bfact\b|حقيقة مؤكدة|كحقيقة/iu.test(response)
    ) {
      violations.push(`failed subtask "${receipt.intent.slice(0, 80)}" was presented as a fact`);
    }
  }
  if (/\bfact\b|حقيقة مؤكدة/iu.test(response) && sourceEvidence.length === 0) {
    violations.push("a FACT was synthesized without retained source evidence");
  }
  return { valid: violations.length === 0, violations: [...new Set(violations)] };
}

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
  const taskIndexes = new Map(tasks.map((task, index) => [task, index]));
  const maxParallelTasks = Math.max(
    1,
    Math.min(opts.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS, 8),
  );
  while (pendingTasks.length > 0) {
    if (isAbortRequested(opts.signal)) {
      subResults.push(...pendingTasks.map((task) => cancelledReceipt(task, taskIndexes.get(task) ?? 0)));
      pendingTasks = [];
      break;
    }
    const { wave, rest } = takeSchedulingWave(pendingTasks, maxParallelTasks);
    pendingTasks = rest;
    console.info(JSON.stringify({
      scope: "hierarchical-executor",
      code: "SCHEDULING_WAVE_STARTED",
      taskCount: wave.length,
      maxParallelTasks,
      readOnlyTasks: wave.filter((task) => task.readOnly).length,
    }));

    const waveResults = await Promise.all(wave.map((task) =>
      isAbortRequested(opts.signal)
        ? Promise.resolve(cancelledReceipt(task, taskIndexes.get(task) ?? 0))
        : runSubTask(task, taskIndexes.get(task) ?? 0, opts),
    ));
    for (const [index, sub] of waveResults.entries()) {
      const task = wave[index];
      subResults.push(sub);
      console.info(
        JSON.stringify({
          scope: "hierarchical-executor",
          code: "SUBTASK_COMPLETE",
          intent: task.intent.slice(0, 100),
          sourceCount: sub.toolSources.length,
          status: sub.status,
          textLength: sub.text?.length ?? 0,
        }),
      );
    }
    if (isAbortRequested(opts.signal)) {
      subResults.push(...pendingTasks.map((task) => cancelledReceipt(task, taskIndexes.get(task) ?? 0)));
      pendingTasks = [];
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
  const aggregate = aggregateStatus(subResults);
  if (aggregate === "cancelled") {
    return {
      response: "ANALYSIS_INCOMPLETE — execution was cancelled before all sub-analyses completed.",
      toolSources: [...new Set(subResults.flatMap((r) => r.toolSources))],
      sourceEvidence: [...new Map(subResults.flatMap((r) => r.sourceEvidence)
        .map((item) => [`${item.taskIndex}:${item.file}:${item.startLine}:${item.endLine}`, item])).values()],
      receipts: subResults,
      status: "cancelled",
      synthesisStatus: "skipped",
    };
  }
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
  let synthesisStatus: HierarchicalResult["synthesisStatus"] = "complete";
  try {
    const synthesisStartedAt = Date.now();
    if (opts.executionLedger && !opts.executionLedger.admit("synthesis", {
      provider: opts.provider,
      model: opts.model,
      operation: "hierarchical_synthesis",
    })) {
      throw new Error("Aggregate execution budget exhausted before hierarchical synthesis.");
    }
    const synthesisResult = await opts.strategy.call(synthesisMessages, {
      model: opts.model,
      maxTokens: SYNTHESIS_MAX_TOKENS,
      timeoutMs: opts.executionLedger?.timeoutMs(SYNTHESIS_TIMEOUT_MS) ?? SYNTHESIS_TIMEOUT_MS,
      apiKey: opts.apiKey,
      signal: opts.executionLedger?.signal ?? opts.signal,
      // Intentionally no `tools` — synthesis is text-only
    });
    opts.executionLedger?.complete("synthesis", {
      provider: opts.provider,
      model: opts.model,
      operation: "hierarchical_synthesis",
      startedAt: synthesisStartedAt,
    });
    synthesisText = synthesisResult.content ?? "";
    if (!synthesisText.trim()) {
      synthesisStatus = "failed";
      synthesisText = [
        "ANALYSIS_INCOMPLETE — synthesis returned no usable report.",
        ...subResults
          .filter((r) => r.status === "complete" || r.status === "partial")
          .map((r) => [
            `- ${r.intent}: ${r.status}; verified evidence windows: ${r.sourceEvidence.length}`,
            r.text ? `  ${r.text}` : "",
          ].filter(Boolean).join("\n")),
      ].join("\n");
    }
  } catch (err) {
    synthesisStatus = "failed";
    console.warn(
      JSON.stringify({
        scope: "hierarchical-executor",
        code: "SYNTHESIS_ERROR",
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
    // Never expose diagnostics as answer text. A deterministic status report
    // remains useful to the caller and cannot turn a failure into a finding.
    synthesisText = [
      "ANALYSIS_INCOMPLETE — synthesis did not complete.",
      ...subResults
        .filter((r) => r.status === "complete" || r.status === "partial")
        .map((r) => [
          `- ${r.intent}: ${r.status}; verified evidence windows: ${r.sourceEvidence.length}`,
          r.text ? `  ${r.text}` : "",
        ].filter(Boolean).join("\n")),
    ].join("\n");
  }

  const safety = validateSynthesisSafety(synthesisText, subResults, sourceEvidence);
  if (!safety.valid) {
    synthesisStatus = "failed";
    synthesisText = [
      "ANALYSIS_INCOMPLETE — synthesis was rejected because its claims were not safely bound to completed evidence.",
      ...safety.violations.slice(0, 4).map((violation) => `- ${violation}`),
    ].join("\n");
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
    receipts: subResults,
    status: aggregate,
    synthesisStatus,
    ...(coverage ? { coverage } : {}),
  };
}

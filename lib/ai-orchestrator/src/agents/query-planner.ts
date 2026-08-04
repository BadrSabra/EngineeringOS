/**
 * Query Planner
 *
 * A lightweight pre-planning phase (single model call, ≤ 5 s) that runs
 * before the main agentic tool loop.  It analyses the user's message and the
 * project's knowledge-graph summary to produce a structured QueryPlan:
 *
 *   • targetFiles    — files most likely needed (pre-seeded into the cache)
 *   • scopeEstimate  — narrow / medium / broad  (drives iteration budget)
 *   • suggestedIterations — concrete maxIterations hint
 *   • subQueries     — decomposed sub-questions for broad tasks
 *
 * Research basis:
 *   - arXiv:2511.02424 ReAcTree — hierarchical task decomposition before execution
 *   - arXiv:2504.16563 — Global Planning + Hierarchical Execution reduces tool
 *     calls by 40-65 % vs. pure ReAct
 *   - ICML 2025 KG-RAG — graph-guided navigation cuts random exploration by ~70 %
 *
 * Design constraints:
 *   - Hard 5-second timeout: if planning takes too long, FALLBACK_PLAN is
 *     returned and the tool loop starts with sensible defaults.  Planning
 *     must never block the main request.
 *   - No tool calls: the planner uses a single fast-model completion — it
 *     reads only from projectContext.graphSummary, not from the filesystem.
 *   - Graceful degradation: JSON parse failures, model errors, and timeouts
 *     all resolve to FALLBACK_PLAN.
 */

import type { ProjectContext } from "../context-builder.js";
import type { ProviderStrategy } from "../provider-strategy.js";
import type { RawMessage } from "../groq-client.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScopeEstimate = "narrow" | "medium" | "broad";

export type QueryPlan = {
  /** Relevant file paths extracted from the knowledge graph. Max 10. */
  targetFiles: string[];
  /** Entity names from the knowledge graph most relevant to the query. */
  targetEntities: string[];
  /** Estimated breadth of the query — drives iteration budget selection. */
  scopeEstimate: ScopeEstimate;
  /**
   * Concrete maxIterations hint (5–40).
   * narrow → 5-10, medium → 12-20, broad → 25-40.
   */
  suggestedIterations: number;
  /** False only when the planner is confident no filesystem access is needed. */
  requiresToolUse: boolean;
  /** Sub-questions produced for broad queries (empty for narrow/medium). */
  subQueries: string[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PLANNER_TIMEOUT_MS = 5_000;
const MAX_GRAPH_CHARS = 3_000;
const MAX_TARGET_FILES = 10;
const MAX_SUBQUERIES = 5;

/**
 * Returned whenever planning fails (timeout, parse error, model error).
 * Keeps the tool loop running with sensible mid-range defaults.
 */
const FALLBACK_PLAN: QueryPlan = {
  targetFiles: [],
  targetEntities: [],
  scopeEstimate: "medium",
  suggestedIterations: 20,
  requiresToolUse: true,
  subQueries: [],
};

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPlannerPrompt(message: string, graphSummary: string): string {
  const truncated =
    graphSummary.length > MAX_GRAPH_CHARS
      ? graphSummary.slice(0, MAX_GRAPH_CHARS) + "\n…[truncated]"
      : graphSummary;

  return `You are a planning agent for a code intelligence system.
Analyse the user query and return ONLY valid JSON — no markdown, no explanation.

Project knowledge graph (entity names and file paths for context):
${truncated}

User query:
${message}

Return exactly this JSON shape:
{
  "targetFiles": [],
  "targetEntities": [],
  "scopeEstimate": "narrow",
  "suggestedIterations": 10,
  "requiresToolUse": true,
  "subQueries": []
}

Rules:
- scopeEstimate "narrow"  → single concept or file, <5 tool calls needed
- scopeEstimate "medium"  → multiple related files, 5-15 tool calls
- scopeEstimate "broad"   → codebase-wide (e.g. "summarize backlog", "review architecture"), 15+ tool calls
- targetFiles: file paths visible in the graph above that are relevant — max ${MAX_TARGET_FILES}, empty if none known
- targetEntities: entity names from the graph — max 10, empty if none relevant
- suggestedIterations: integer — narrow 5-10, medium 12-20, broad 25-40
- subQueries: non-empty only when scopeEstimate is "broad" — decompose into 2-5 focused sub-questions
- requiresToolUse: false only if the answer is factual and requires no file reading`;
}

// ── JSON parser ───────────────────────────────────────────────────────────────

function parsePlannerResponse(raw: string | null): QueryPlan | null {
  if (!raw) return null;

  // Extract the first JSON object from the response (handles spurious prose)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const scopeEstimate: ScopeEstimate =
      parsed["scopeEstimate"] === "narrow" || parsed["scopeEstimate"] === "broad"
        ? (parsed["scopeEstimate"] as ScopeEstimate)
        : "medium";

    const rawIter = parsed["suggestedIterations"];
    const suggestedIterations =
      typeof rawIter === "number"
        ? Math.min(Math.max(Math.round(rawIter), 5), 40)
        : scopeEstimate === "narrow" ? 8 : scopeEstimate === "broad" ? 30 : 18;

    return {
      targetFiles: Array.isArray(parsed["targetFiles"])
        ? (parsed["targetFiles"] as string[]).filter((f) => typeof f === "string").slice(0, MAX_TARGET_FILES)
        : [],
      targetEntities: Array.isArray(parsed["targetEntities"])
        ? (parsed["targetEntities"] as string[]).filter((e) => typeof e === "string").slice(0, 10)
        : [],
      scopeEstimate,
      suggestedIterations,
      requiresToolUse: parsed["requiresToolUse"] !== false,
      subQueries: Array.isArray(parsed["subQueries"])
        ? (parsed["subQueries"] as string[]).filter((q) => typeof q === "string").slice(0, MAX_SUBQUERIES)
        : [],
    };
  } catch {
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run the planning phase for a user query.
 *
 * Always resolves — returns FALLBACK_PLAN on any failure.
 * Callers should await this without a try/catch if they want the fallback
 * behaviour; wrap in .catch(() => null) if they want to distinguish failure
 * from the fallback.
 */
export async function planQuery(opts: {
  message: string;
  projectContext: ProjectContext;
  model: string;
  strategy: ProviderStrategy;
  apiKey?: string;
}): Promise<QueryPlan> {
  const { message, projectContext, model, strategy, apiKey } = opts;

  const plannerPrompt = buildPlannerPrompt(message, projectContext.graphSummary);
  const messages: RawMessage[] = [
    { role: "system", content: plannerPrompt },
    { role: "user", content: message },
  ];

  // Race the model call against a hard timeout so planning never blocks the
  // main request even when the provider is slow or unresponsive.
  const plannerCall = strategy
    .call(messages, {
      model,
      maxTokens: 512,
      timeoutMs: PLANNER_TIMEOUT_MS,
      apiKey,
      // No tools — the planner is a pure text completion
    })
    .then((r) => r)
    .catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          scope: "query-planner",
          code: "MODEL_ERROR",
          model,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
      return null;
    });

  const timeoutSignal = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), PLANNER_TIMEOUT_MS),
  );

  const result = await Promise.race([plannerCall, timeoutSignal]);

  if (!result) {
    console.warn(JSON.stringify({ scope: "query-planner", code: "TIMEOUT_OR_ERROR", model }));
    return FALLBACK_PLAN;
  }

  const plan = parsePlannerResponse(result.content);
  if (!plan) {
    console.warn(
      JSON.stringify({
        scope: "query-planner",
        code: "PARSE_FAILED",
        model,
        raw: result.content?.slice(0, 300),
      }),
    );
    return FALLBACK_PLAN;
  }

  console.info(
    JSON.stringify({
      scope: "query-planner",
      code: "PLAN_READY",
      scopeEstimate: plan.scopeEstimate,
      suggestedIterations: plan.suggestedIterations,
      targetFileCount: plan.targetFiles.length,
      subQueryCount: plan.subQueries.length,
      requiresToolUse: plan.requiresToolUse,
    }),
  );

  return plan;
}

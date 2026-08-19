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

import { db } from "@workspace/db";
import {
  findFileEntities,
  searchNodes,
  getNeighborhood,
} from "@workspace/knowledge-engine";
import type {
  GraphEntity,
  GraphRelationship,
} from "@workspace/knowledge-engine";
import type { ProjectContext } from "../context-builder.js";
import type { ProviderStrategy } from "../provider-strategy.js";
import type { RawMessage } from "../groq-client.js";
import { extractMentionedFiles } from "./speculative-prefetch.js";
import {
  buildCrossFileSemanticTrace,
  type CrossFileSemanticTrace,
  type SemanticGraphEdge,
  type SemanticGraphNode,
} from "../semantic-trace.js";

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
   * Concrete maxIterations hint (5–60).
   * narrow → 5-16, medium → 18-35, broad → 40-60.
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
/** Hard cap on files added by graph enrichment (task spec: ≤ 15 total). */
const MAX_GRAPH_FILES = 15;
/** Hard timeout for the graph enrichment step (task spec: ≤ 2 seconds). */
const GRAPH_ENRICH_TIMEOUT_MS = 2_000;
const GRAPH_GUIDANCE_TIMEOUT_MS = 2_000;
const MAX_GRAPH_GUIDED_FILES = 10;
const MAX_GRAPH_GUIDED_ROOTS = 4;
const MAX_GRAPH_GUIDED_NEIGHBORS = 6;

/**
 * Returned whenever planning fails (timeout, parse error, model error).
 * Keeps the tool loop running with sensible mid-range defaults.
 */
const FALLBACK_PLAN: QueryPlan = {
  targetFiles: [],
  targetEntities: [],
  scopeEstimate: "medium",
    suggestedIterations: 30,
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
- suggestedIterations: integer — narrow 5-16, medium 18-35, broad 40-60
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
        ? Math.min(Math.max(Math.round(rawIter), 5), 60)
        : scopeEstimate === "narrow" ? 10 : scopeEstimate === "broad" ? 45 : 24;

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

// ── Deterministic graph-guided file planning ───────────────────────────────────

export type GraphGuidance = {
  mentionedFiles: string[];
  resolvedFiles: string[];
  /** Mentioned files plus direct file neighbours, and nothing broader. */
  prefetchFiles: string[];
  /** Bounded prompt-ready map with names, relationships, and source coordinates. */
  promptHint: string;
  /** Bounded, source-grounded traces for the explicit file scope. */
  crossFileTraces: CrossFileSemanticTrace[];
};

type GraphEvidenceLike = {
  file?: unknown;
  line?: unknown;
  column?: unknown;
  snippet?: unknown;
  kind?: unknown;
};

function graphEvidence(
  value: GraphEntity | GraphRelationship,
): GraphEvidenceLike[] {
  const direct =
    "evidenceJson" in value && Array.isArray(value.evidenceJson)
      ? value.evidenceJson
      : [];
  const provenance =
    value.provenance && Array.isArray(value.provenance.evidence)
      ? value.provenance.evidence
      : [];
  return [...direct, ...provenance] as GraphEvidenceLike[];
}

function graphCoordinate(
  value: GraphEntity | GraphRelationship,
  fallbackPath?: string | null,
): string | null {
  const evidence = graphEvidence(value);
  const located = evidence.find(
    (item) => typeof item.file === "string" && typeof item.line === "number",
  );
  if (located && typeof located.file === "string" && typeof located.line === "number") {
    return `${located.file}:${located.line}`;
  }
  const fileOnly = evidence.find((item) => typeof item.file === "string");
  if (fileOnly && typeof fileOnly.file === "string") return fileOnly.file;
  return fallbackPath ?? null;
}

function graphSourceSpan(
  value: GraphEntity | GraphRelationship,
): SemanticGraphEdge["sourceSpan"] | undefined {
  const evidence = graphEvidence(value).find(
    (item) =>
      typeof item.file === "string" &&
      typeof item.line === "number" &&
      Number.isInteger(item.line) &&
      item.line > 0,
  );
  if (!evidence || typeof evidence.file !== "string" || typeof evidence.line !== "number") {
    return undefined;
  }
  return {
    file: evidence.file,
    line: evidence.line,
    ...(typeof evidence.column === "number" && Number.isInteger(evidence.column) && evidence.column >= 0
      ? { column: evidence.column }
      : {}),
    ...(typeof evidence.snippet === "string" && evidence.snippet.trim()
      ? { snippet: evidence.snippet.trim().slice(0, 240) }
      : {}),
  };
}

function graphNode(value: GraphEntity): SemanticGraphNode {
  return {
    id: value.id,
    name: value.name || value.path || value.id,
    ...(graphPath(value) ? { path: graphPath(value) as string } : {}),
    type: value.type,
  };
}

function graphPath(value: GraphEntity | null | undefined): string | null {
  const raw = value?.path?.trim();
  return raw ? raw.replace(/\\/g, "/").replace(/^\.\/+/, "") : null;
}

function graphRelationLabel(relationship: GraphRelationship): string {
  return relationship.relationType ?? relationship.relation ?? "related";
}

/**
 * Resolve explicit file mentions directly through the graph before the
 * model-driven planner runs. Only the mentioned file entities and their
 * depth-1 neighbours are admitted to this guidance/prefetch path.
 *
 * This is deliberately separate from `planQuery`: a model may still choose
 * useful target entities for broad questions, but it must not turn a concrete
 * `chat.ts` mention into an unrelated project-wide prefetch.
 */
export async function buildMentionedFileGraphGuidance(opts: {
  message: string;
  projectId: string;
}): Promise<GraphGuidance | null> {
  const mentionedFiles = extractMentionedFiles(opts.message);
  if (mentionedFiles.length === 0) return null;

  const build = async (): Promise<GraphGuidance | null> => {
    const roots = (await findFileEntities(db, opts.projectId, mentionedFiles))
      .slice(0, MAX_GRAPH_GUIDED_ROOTS);
    if (roots.length === 0) return null;

    const neighbourhoods = await Promise.all(
      roots.map(async (root) => ({
        root,
        result: await getNeighborhood(db, root.id, 1).catch(() => ({
          root: null,
          entities: [],
          relationships: [],
        })),
      })),
    );

    const prefetchFiles: string[] = [];
    const seenFiles = new Set<string>();
    const addFile = (file: string | null): void => {
      if (!file || seenFiles.has(file) || prefetchFiles.length >= MAX_GRAPH_GUIDED_FILES) return;
      seenFiles.add(file);
      prefetchFiles.push(file);
    };

    const mapLines: string[] = [
      "Graph-guided file map — use the mentioned files and direct neighbours first; do not explore unrelated files:",
    ];
    const resolvedFiles: string[] = [];
    const crossFileTraces: CrossFileSemanticTrace[] = [];

    for (const { root, result } of neighbourhoods) {
      const rootPath = graphPath(root);
      if (rootPath) {
        resolvedFiles.push(rootPath);
        addFile(rootPath);
      }

      const entities = new Map<string, GraphEntity>();
      entities.set(root.id, root);
      for (const entity of result.entities) entities.set(entity.id, entity);

      const neighbours = result.relationships
        .map((relationship) => {
          const neighbourId =
            relationship.sourceId === root.id
              ? relationship.targetId
              : relationship.targetId === root.id
                ? relationship.sourceId
                : null;
          return neighbourId ? { relationship, entity: entities.get(neighbourId) } : null;
        })
        .filter(
          (entry): entry is { relationship: GraphRelationship; entity: GraphEntity } =>
            entry !== null && entry.entity !== undefined,
        )
        .slice(0, MAX_GRAPH_GUIDED_NEIGHBORS);

      const rootLabel = rootPath ?? root.name;
      mapLines.push(`- Mentioned \`${rootLabel}\` — direct neighbours:`);
      if (neighbours.length === 0) {
        mapLines.push("  - (none recorded in the graph)");
        continue;
      }

      for (const { relationship, entity } of neighbours) {
        const neighbourPath = graphPath(entity);
        if (entity.type === "file") addFile(neighbourPath);
        const coordinate = graphCoordinate(entity, neighbourPath) ??
          graphCoordinate(relationship, rootPath);
        const location = coordinate ? ` at ${coordinate}` : "";
        const relation = graphRelationLabel(relationship);
        const label =
          entity.name && neighbourPath && entity.name !== neighbourPath
            ? `${entity.name} in ${neighbourPath}`
            : entity.name || neighbourPath || entity.id;
        mapLines.push(`  - \`${label}\` via ${relation}${location}`);

        const sourceEntity = relationship.sourceId === root.id ? root : entity;
        const targetEntity = relationship.targetId === root.id ? root : entity;
        const sourceSpan = graphSourceSpan(relationship) ??
          graphSourceSpan(entity);
        if (
          sourceEntity.id !== targetEntity.id &&
          crossFileTraces.length < MAX_GRAPH_GUIDED_FILES
        ) {
          const traceNodes = [graphNode(sourceEntity), graphNode(targetEntity)];
          const edge: SemanticGraphEdge = {
            source: sourceEntity.id,
            target: targetEntity.id,
            relation,
            ...(sourceSpan ? { sourcePath: sourceSpan.file, sourceSpan } : {}),
            ...(sourceSpan
              ? {
                  evidence: [
                    typeof sourceSpan.column === "number"
                      ? `${sourceSpan.file}:${sourceSpan.line}:${sourceSpan.column}`
                      : `${sourceSpan.file}:${sourceSpan.line}`,
                    sourceSpan.snippet ? ` — ${sourceSpan.snippet}` : "",
                  ].join(""),
                }
              : {}),
          };
          crossFileTraces.push(buildCrossFileSemanticTrace({
            nodes: traceNodes,
            edges: [edge],
            from: sourceEntity.id,
            to: targetEntity.id,
            maxDepth: 1,
          }));
        }
      }
    }

    if (prefetchFiles.length === 0) return null;
    return {
      mentionedFiles,
      resolvedFiles: [...new Set(resolvedFiles)],
      prefetchFiles,
      promptHint: mapLines.join("\n").slice(0, 3_000),
      crossFileTraces,
    };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        JSON.stringify({
          scope: "query-planner",
          code: "GRAPH_GUIDANCE_TIMEOUT",
          projectId: opts.projectId,
          timeoutMs: GRAPH_GUIDANCE_TIMEOUT_MS,
        }),
      );
      resolve(null);
    }, GRAPH_GUIDANCE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([build().catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Graph enrichment ──────────────────────────────────────────────────────────

/**
 * Enrich a QueryPlan's targetFiles with paths discovered from the knowledge
 * graph neighbourhood of the plan's targetEntities.
 *
 * Design:
 *   1. Search the graph for entities matching the planner's targetEntities.
 *   2. Run getNeighborhood (depth 2) on the top 5 matching entities.
 *   3. Collect the `path` field from every neighbour entity.
 *   4. Merge unique paths into targetFiles (total cap: MAX_GRAPH_FILES).
 *   5. The whole call is raced against a 2-second hard timeout — if the graph
 *      query is slow or the DB is unavailable the original plan is returned
 *      unchanged, so enrichment never blocks the main request.
 *
 * Only called when projectId is provided AND the project has a completed scan
 * (indicated by projectContext.metricsVerified).
 */
async function enrichPlanWithGraph(
  plan: QueryPlan,
  projectId: string,
): Promise<QueryPlan> {
  if (plan.targetEntities.length === 0) return plan;

  const enrichAsync = async (): Promise<QueryPlan> => {
    // Step 1: search the graph for matching entities.
    const matches = await searchNodes(db, projectId, plan.targetEntities);
    if (matches.length === 0) return plan;

    // Step 2: neighbourhood traversal on the top 5 candidates.
    const top5 = matches.slice(0, 5);
    const neighbourResults = await Promise.all(
      top5.map((entity) =>
        getNeighborhood(db, entity.id, 2).catch(() => null),
      ),
    );

    // Step 3: collect paths from all discovered entities.
    const graphPaths = new Set<string>();

    // Include root entities' own paths.
    for (const entity of top5) {
      if (entity.path) graphPaths.add(entity.path);
    }

    for (const result of neighbourResults) {
      if (!result) continue;
      if (result.root?.path) graphPaths.add(result.root.path);
      for (const entity of result.entities) {
        if (entity.path) graphPaths.add(entity.path);
      }
    }

    if (graphPaths.size === 0) return plan;

    // Step 4: merge with existing targetFiles, cap at MAX_GRAPH_FILES.
    const existing = new Set(plan.targetFiles);
    const merged = [...plan.targetFiles];

    for (const p of graphPaths) {
      if (merged.length >= MAX_GRAPH_FILES) break;
      if (!existing.has(p)) {
        merged.push(p);
        existing.add(p);
      }
    }

    console.info(
      JSON.stringify({
        scope: "query-planner",
        code: "GRAPH_ENRICH_DONE",
        projectId,
        addedFiles: merged.length - plan.targetFiles.length,
        totalFiles: merged.length,
      }),
    );

    return { ...plan, targetFiles: merged };
  };

  const timeout = new Promise<QueryPlan>((resolve) =>
    setTimeout(() => {
      console.warn(
        JSON.stringify({
          scope: "query-planner",
          code: "GRAPH_ENRICH_TIMEOUT",
          projectId,
          timeoutMs: GRAPH_ENRICH_TIMEOUT_MS,
        }),
      );
      resolve(plan);
    }, GRAPH_ENRICH_TIMEOUT_MS),
  );

  return Promise.race([enrichAsync().catch(() => plan), timeout]);
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
  /**
   * When provided alongside a scanned project (metricsVerified = true),
   * enrichPlanWithGraph() augments targetFiles with paths discovered from
   * the knowledge graph neighbourhood of targetEntities.
   */
  projectId?: string;
}): Promise<QueryPlan> {
  const { message, projectContext, model, strategy, apiKey, projectId } = opts;

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

  // ── Graph enrichment ───────────────────────────────────────────────────────
  // Only enrich when we have a project ID and the project has a completed scan
  // (metricsVerified = true).  Skipping on un-scanned projects avoids wasted
  // DB queries against an empty graph.
  const enriched =
    projectId && projectContext.metricsVerified
      ? await enrichPlanWithGraph(plan, projectId)
      : plan;

  console.info(
    JSON.stringify({
      scope: "query-planner",
      code: "PLAN_READY",
      scopeEstimate: enriched.scopeEstimate,
      suggestedIterations: enriched.suggestedIterations,
      targetFileCount: enriched.targetFiles.length,
      graphEnriched: enriched.targetFiles.length > plan.targetFiles.length,
      subQueryCount: enriched.subQueries.length,
      requiresToolUse: enriched.requiresToolUse,
    }),
  );

  return enriched;
}
